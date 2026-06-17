#!/usr/bin/env bash
# Production e2e: work center → BOM (components + routing) → order from BOM → release → complete. The
# complete backflushes materials (decrements stock at WAVG cost), costs the operation + overhead, and
# receives the finished good back into stock at the computed unit cost. Asserts stock + cost end-to-end.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PLATFORM="11111111-1111-1111-1111-111111111111"
PW1=Password; PW2='123!'; PASSWORD="$PW1$PW2"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d))" "$1" 2>/dev/null; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('prodsa@acme.test','admin@prod.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE name='Prod Co');
DELETE FROM tenants WHERE name='Prod Co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','prodsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3420; for p in 3420 3421 3422 3423; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/production-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
patch() { curl -s -XPATCH "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }

SA=$(login "prodsa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Prod Co\",\"adminEmail\":\"admin@prod.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
A=$(login "admin@prod.test")
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO inventory_product (tenant_id, sku, name, unit, cost_price_minor, sell_price_minor, currency, min_stock, on_hand, stock_value_minor)
VALUES ('$T','FG-PROD','Finished Good','ea',0,20000,'PKR',0,0,0),
       ('$T','RAW-PROD','Raw Material','ea',2000,0,'PKR',0,50,100000);
SQL
FG=$(ownerq "SELECT id FROM inventory_product WHERE tenant_id='$T' AND sku='FG-PROD'")
RAW=$(ownerq "SELECT id FROM inventory_product WHERE tenant_id='$T' AND sku='RAW-PROD'")
fgoh() { ownerq "SELECT on_hand FROM inventory_product WHERE id='$FG'"; }
rawoh() { ownerq "SELECT on_hand FROM inventory_product WHERE id='$RAW'"; }
echo "tenant=$T FG=$FG(on_hand $(fgoh)) RAW=$RAW(on_hand $(rawoh))"

echo "== work center + BOM (2 raw/unit, 6 min on a 600/h station) =="
WC=$(post "$A" production/work-centers '{"name":"Assembly","costPerHourMinor":60000}' | jget data.id)
BOM=$(post "$A" production/boms "{\"productId\":\"$FG\",\"name\":\"Recipe\",\"outputQty\":1,\"overheadPct\":0,\"lines\":[{\"componentProductId\":\"$RAW\",\"quantity\":2}],\"operations\":[{\"name\":\"Assemble\",\"workCenterId\":\"$WC\",\"runMinutes\":6}]}" | jget data.id)
check "BOM created" "$([ -n "$BOM" ] && echo ok)" "ok"
check "BOM activate -> ACTIVE" "$(patch "$A" "production/boms/$BOM/status" '{"status":"ACTIVE"}' | jget data.status)" "ACTIVE"

echo "== order from BOM (planned 5) -> release -> complete =="
OID=$(post "$A" production/orders "{\"productId\":\"$FG\",\"bomId\":\"$BOM\",\"plannedQty\":5}" | jget data.id)
check "order DRAFT, material estimate 5x2x2000=20000" "$(curl -s "$B/production/orders/$OID" -H "Authorization: Bearer $A" | jget data.materialCost.amountMinor)" "20000"
check "release -> RELEASED" "$(post "$A" "production/orders/$OID/release" '{}' | jget data.status)" "RELEASED"
DONE=$(post "$A" "production/orders/$OID/complete" '{}')
check "order COMPLETED" "$(echo "$DONE" | jget data.status)" "COMPLETED"
check "produced 5" "$(echo "$DONE" | jget data.producedQty)" "5"
check "material cost 20000" "$(echo "$DONE" | jget data.materialCost.amountMinor)" "20000"
check "operation cost 30 min @ 600/h = 30000" "$(echo "$DONE" | jget data.operationCost.amountMinor)" "30000"
check "total cost 50000" "$(echo "$DONE" | jget data.totalCost.amountMinor)" "50000"
check "unit cost 10000" "$(echo "$DONE" | jget data.unitCost.amountMinor)" "10000"

echo "== inventory moved through the ledger =="
check "raw consumed 50->40" "$(rawoh)" "40"
check "finished good received 0->5" "$(fgoh)" "5"
check "FG WAVG cost now 10000" "$(ownerq "SELECT cost_price_minor FROM inventory_product WHERE id='$FG'")" "10000"
check "production.order_completed in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='production.order_completed.v1'")" "1"

echo "== a second ACTIVE BOM for the same product is rejected (409) =="
BOM2=$(post "$A" production/boms "{\"productId\":\"$FG\",\"name\":\"Recipe v2\",\"lines\":[{\"componentProductId\":\"$RAW\",\"quantity\":1}]}" | jget data.id)
check "activate 2nd BOM -> 409" "$(curl -s -o /dev/null -w '%{http_code}' -XPATCH "$B/production/boms/$BOM2/status" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"status":"ACTIVE"}')" "409"

echo; echo "Production e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
