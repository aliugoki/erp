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

# ── Enterprise documents: opening → requisition → PO → GRN → gate pass → issue → MRN ───────────
sline() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)['data']['lines']
r=next((l for l in d if l['sku']==sys.argv[1]),None)
v=functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[2].split('.'), r) if r else None
print('' if v is None else v)" "$1" "$2" 2>/dev/null; }
get() { curl -s "$B/$2" -H "Authorization: Bearer $1"; }

echo "== enterprise: stock master + opening stock (valued ledger) =="
WP=$(post "$MGR" inventory/products '{"sku":"WIDGET-2","name":"Widget 2","unit":"pcs","minStock":30}' | jget data.id)
GP_PROD=$(post "$MGR" inventory/products '{"sku":"GADGET-2","name":"Gadget 2","unit":"pcs","minStock":10}' | jget data.id)
post "$MGR" inventory/adjustments "{\"productId\":\"$WP\",\"warehouseId\":\"$WH\",\"quantity\":100,\"unitCostMinor\":5000,\"docType\":\"OPENING\"}" >/dev/null
check "opening sets on-hand 100" "$(get "$MGR" "inventory/products/$WP" | jget data.onHand)" "100"
check "opening stock value = 500000" "$(get "$MGR" inventory/reports/stock | sline WIDGET-2 value.amountMinor)" "500000"
check "weighted-avg unit cost = 5000" "$(get "$MGR" "inventory/products/$WP" | jget data.costPrice.amountMinor)" "5000"

echo "== enterprise: requisition (submit → approve) =="
REQ=$(post "$MGR" inventory/requisitions "{\"warehouseId\":\"$WH\",\"requestedBy\":\"Line 1\",\"items\":[{\"productId\":\"$WP\",\"qty\":50}]}")
REQID=$(echo "$REQ" | jget data.id)
check "requisition starts DRAFT" "$(echo "$REQ" | jget data.status)" "DRAFT"
check "cannot approve a DRAFT directly -> 422" "$(code -XPOST "$B/inventory/requisitions/$REQID/approve" -H "Authorization: Bearer $MGR")" "422"
post "$MGR" "inventory/requisitions/$REQID/submit" '' >/dev/null
check "requisition approved" "$(post "$MGR" "inventory/requisitions/$REQID/approve" '' | jget data.status)" "APPROVED"

echo "== enterprise: purchase order → GRN (weighted-average costing) =="
PO=$(post "$MGR" inventory/purchase-orders "{\"warehouseId\":\"$WH\",\"items\":[{\"productId\":\"$WP\",\"qty\":100,\"unitPriceMinor\":7000}]}")
POID=$(echo "$PO" | jget data.id)
check "PO total = 700000" "$(echo "$PO" | jget data.total.amountMinor)" "700000"
check "cannot receive a DRAFT PO -> 422" "$(code -XPOST "$B/inventory/grns" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"poId\":\"$POID\"}")" "422"
post "$MGR" "inventory/purchase-orders/$POID/approve" '' >/dev/null
GRN=$(post "$MGR" inventory/grns "{\"poId\":\"$POID\"}")
check "GRN posted (GRN-000001)" "$(echo "$GRN" | jget data.grnNo)" "GRN-000001"
check "on-hand after GRN = 200" "$(get "$MGR" "inventory/products/$WP" | jget data.onHand)" "200"
check "weighted-avg cost after GRN = 6000" "$(get "$MGR" "inventory/products/$WP" | jget data.costPrice.amountMinor)" "6000"
check "stock value after GRN = 1200000" "$(get "$MGR" inventory/reports/stock | sline WIDGET-2 value.amountMinor)" "1200000"
check "PO fully received -> RECEIVED" "$(get "$MGR" "inventory/purchase-orders/$POID" | jget data.status)" "RECEIVED"

echo "== enterprise: gate pass =="
GP=$(post "$MGR" inventory/gate-passes "{\"direction\":\"OUTWARD\",\"returnable\":true,\"party\":\"Workshop\",\"items\":[{\"description\":\"Drill machine\",\"qty\":1}]}")
GPID=$(echo "$GP" | jget data.id)
check "gate pass created (GP-000001)" "$(echo "$GP" | jget data.gpNo)" "GP-000001"
check "gate pass closed" "$(post "$MGR" "inventory/gate-passes/$GPID/close" '' | jget data.status)" "CLOSED"

echo "== enterprise: store issuance (against the requisition) =="
ISS=$(post "$MGR" inventory/issues "{\"requisitionId\":\"$REQID\",\"issuedTo\":\"Line 1\"}")
ISSID=$(echo "$ISS" | jget data.id)
check "issue posted (ISS-000001)" "$(echo "$ISS" | jget data.issueNo)" "ISS-000001"
check "on-hand after issuing 50 = 150" "$(get "$MGR" "inventory/products/$WP" | jget data.onHand)" "150"
check "requisition fully issued -> ISSUED" "$(get "$MGR" "inventory/requisitions/$REQID" | jget data.status)" "ISSUED"

echo "== enterprise: material return note (return 20) =="
MRN=$(post "$MGR" inventory/mrns "{\"issueId\":\"$ISSID\",\"items\":[{\"productId\":\"$WP\",\"qty\":20}]}")
check "MRN posted (MRN-000001)" "$(echo "$MRN" | jget data.mrnNo)" "MRN-000001"
check "on-hand after returning 20 = 170" "$(get "$MGR" "inventory/products/$WP" | jget data.onHand)" "170"
check "stock value after MRN = 1020000 (return at issue cost)" "$(get "$MGR" inventory/reports/stock | sline WIDGET-2 value.amountMinor)" "1020000"

echo "== enterprise: inventory ledger + reorder report =="
check "item ledger has 4 movements" "$(get "$MGR" "inventory/products/$WP/ledger" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "4"
check "item ledger last running balance = 170" "$(get "$MGR" "inventory/products/$WP/ledger" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][-1]['balanceQty'])")" "170"
check "reorder flags GADGET-2 (on-hand 0 <= min 10)" "$(get "$MGR" inventory/reports/reorder | python3 -c "import sys,json;print(any(l['sku']=='GADGET-2' for l in json.load(sys.stdin)['data']))")" "True"
check "reorder excludes WIDGET-2 (well stocked)" "$(get "$MGR" inventory/reports/reorder | python3 -c "import sys,json;print(any(l['sku']=='WIDGET-2' for l in json.load(sys.stdin)['data']))")" "False"

echo "== enterprise: oversell guard =="
check "issuing more than on-hand -> 422" "$(code -XPOST "$B/inventory/issues" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"warehouseId\":\"$WH\",\"items\":[{\"productId\":\"$WP\",\"qty\":1000}]}")" "422"
check "on-hand unchanged after the failed issue = 170" "$(get "$MGR" "inventory/products/$WP" | jget data.onHand)" "170"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
