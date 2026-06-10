#!/usr/bin/env bash
# Inventory module e2e (Chunk 3.3): feature/role gates, stock movements, low-stock query, and the
# TRANSACTIONAL-OUTBOX ATOMICITY proof (a rolled-back movement leaves no outbox row).
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }
jlen() { python3 -c "import sys,json
d=json.load(sys.stdin); d=d.get('data',d) if isinstance(d,dict) else d
print(len(d) if isinstance(d,list) else 0)" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('invsa@acme.test','invmgr@invco.test','invview@invco.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('inv-co','inv-two'));
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('inv-co','inv-two'));
DELETE FROM tenants WHERE slug IN ('inv-co','inv-two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','invsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3390; for p in 3390 3391 3392 3393; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/inv-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }

SA=$(login "invsa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Inv Co","adminEmail":"admin@invco.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Inv Two","adminEmail":"admin@invtwo.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES
 ('$T1','invmgr@invco.test','$HASH',true,'{INVENTORY_MANAGER}'),
 ('$T1','invview@invco.test','$HASH',true,'{VIEWER}');
SQL
MGR=$(login "invmgr@invco.test"); VIEW=$(login "invview@invco.test"); ADMIN2=$(login "admin@invtwo.test")
echo "tenant Inv Co=$T1"

echo "== feature + role gates =="
check "GET /inventory/products -> 200" "$(code "$B/inventory/products" -H "Authorization: Bearer $MGR")" "200"
check "VIEWER POST product -> 403" "$(code -XPOST "$B/inventory/products" -H "Authorization: Bearer $VIEW" -H 'Content-Type: application/json' -d '{"sku":"X","name":"X"}')" "403"

echo "== create warehouse + product (minStock 10) =="
WH=$(post "$MGR" inventory/warehouses '{"name":"Main"}' | jget data.id)
PID=$(post "$MGR" inventory/products '{"sku":"WIDGET-1","name":"Widget","minStock":10,"costPriceMinor":12000,"sellPriceMinor":20000}' | jget data.id)
[ -n "$WH" ] && [ -n "$PID" ] && echo "  ✅ created wh=$WH product=$PID" && pass=$((pass+1)) || { echo "  ❌ create failed"; fail=$((fail+1)); }

echo "== IN 15 -> on_hand 15 (no low-stock) =="
check "IN movement -> 201" "$(code -XPOST "$B/inventory/movements" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"productId\":\"$PID\",\"warehouseId\":\"$WH\",\"type\":\"IN\",\"quantity\":15}")" "201"
check "on_hand == 15" "$(curl -s "$B/inventory/products/$PID" -H "Authorization: Bearer $MGR" | jget data.onHand)" "15"
check "no low_stock event yet" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T1' AND type='inventory.low_stock.v1'")" "0"

echo "== ATOMICITY: oversell OUT 100 -> 422, and NOTHING persists =="
check "OUT 100 (oversell) -> 422" "$(code -XPOST "$B/inventory/movements" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"productId\":\"$PID\",\"type\":\"OUT\",\"quantity\":100}")" "422"
check "on_hand STILL 15 (rolled back)" "$(curl -s "$B/inventory/products/$PID" -H "Authorization: Bearer $MGR" | jget data.onHand)" "15"
check "NO low_stock outbox row (event rolled back with movement)" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T1' AND type='inventory.low_stock.v1'")" "0"
check "no movement row for the failed OUT" "$(ownerq "SELECT count(*) FROM inventory_stock_movement WHERE tenant_id='$T1' AND type='OUT'")" "0"

echo "== low-stock emit: OUT 8 -> on_hand 7 -> outbox event =="
check "OUT 8 -> 201" "$(code -XPOST "$B/inventory/movements" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"productId\":\"$PID\",\"type\":\"OUT\",\"quantity\":8}")" "201"
check "on_hand == 7" "$(curl -s "$B/inventory/products/$PID" -H "Authorization: Bearer $MGR" | jget data.onHand)" "7"
check "low_stock event written (pending)" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T1' AND type='inventory.low_stock.v1' AND published_at IS NULL")" "1"

echo "== low-stock query =="
check "GET products/low-stock -> 1" "$(curl -s "$B/inventory/products/low-stock" -H "Authorization: Bearer $MGR" | jlen)" "1"

echo "== tenant isolation =="
check "Inv Two sees no products" "$(curl -s "$B/inventory/products" -H "Authorization: Bearer $ADMIN2" | jlen)" "0"
check "Inv Two GET Inv Co product -> 404" "$(code "$B/inventory/products/$PID" -H "Authorization: Bearer $ADMIN2")" "404"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
