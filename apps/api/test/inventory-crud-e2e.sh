#!/usr/bin/env bash
# Inventory CRUD e2e: the newly-added endpoints — product update/delete, warehouse update, and the
# camelCase document detail endpoints (requisition, PO, GRN, issue, MRN, gate pass) with line items,
# exercised end-to-end through a real procurement + issuance flow. Mirrors crm-crud-e2e.sh.
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

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('invcsa@acme.test','admin@invcrud.test');
DELETE FROM tenants WHERE name='Inv Crud';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','invcsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3470; for p in 3470 3471 3472 3473; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/invcrud-e2e.out 2>&1 < /dev/null &
trap 'for pid in $(pgrep -f "apps/api/dist/main.js"); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done' EXIT
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
patch() { curl -s -XPATCH "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
del() { curl -s -XDELETE "$B/$2" -H "Authorization: Bearer $1"; }
get() { curl -s "$B/$2" -H "Authorization: Bearer $1"; }
codeauth() { curl -s -o /dev/null -w "%{http_code}" "$B/$2" -H "Authorization: Bearer $1"; }

SA=$(login "invcsa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Inv Crud\",\"adminEmail\":\"admin@invcrud.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"business\"}" | jget data.tenant.id)
A=$(login "admin@invcrud.test")
echo "tenant=$T"

echo "== product: create → update → delete =="
P=$(post "$A" inventory/products '{"sku":"WIDGET-1","name":"Widget","unit":"pcs","costPriceMinor":1000,"sellPriceMinor":1500,"minStock":5}')
PID=$(echo "$P" | jget data.id)
check "product update name + price" "$(patch "$A" "inventory/products/$PID" '{"name":"Widget Pro","sellPriceMinor":2000}' | jget data.name)" "Widget Pro"
check "update reflected on get" "$(get "$A" "inventory/products/$PID" | jget data.sellPrice.amountMinor)" "2000"
check "product delete (zero stock)" "$(del "$A" "inventory/products/$PID" | jget data.deleted)" "True"
check "deleted product → 404" "$(codeauth "$A" "inventory/products/$PID")" "404"

echo "== product delete blocked while holding stock =="
P2=$(post "$A" inventory/products '{"sku":"GADGET-1","name":"Gadget","unit":"pcs","minStock":2}')
PID2=$(echo "$P2" | jget data.id)
post "$A" inventory/adjustments "{\"productId\":\"$PID2\",\"quantity\":100,\"unitCostMinor\":500,\"docType\":\"OPENING\"}" >/dev/null
check "delete blocked with stock (400)" "$(curl -s -o /dev/null -w '%{http_code}' -XDELETE "$B/inventory/products/$PID2" -H "Authorization: Bearer $A")" "400"

echo "== warehouse: create → update =="
W=$(post "$A" inventory/warehouses '{"name":"Main Store","code":"WH1"}')
WID=$(echo "$W" | jget data.id)
check "warehouse update" "$(patch "$A" "inventory/warehouses/$WID" '{"location":"Karachi"}' | jget data.location)" "Karachi"

echo "== requisition detail (camelCase) → issue flow =="
REQ=$(post "$A" inventory/requisitions "{\"requestedBy\":\"Dana\",\"items\":[{\"productId\":\"$PID2\",\"qty\":10}]}")
RID=$(echo "$REQ" | jget data.id)
check "requisition detail returns camelCase reqNo" "$(get "$A" "inventory/requisitions/$RID" | jget data.reqNo | grep -c REQ)" "1"
check "requisition detail items camelCase" "$(get "$A" "inventory/requisitions/$RID" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['items'][0]['productId'])")" "$PID2"
post "$A" "inventory/requisitions/$RID/submit" '{}' >/dev/null
post "$A" "inventory/requisitions/$RID/approve" '{}' >/dev/null
ISS=$(post "$A" inventory/issues "{\"requisitionId\":\"$RID\"}")
ISID=$(echo "$ISS" | jget data.id)
check "issue posted" "$(echo "$ISS" | jget data.status)" "POSTED"
check "issue detail returns camelCase issueNo" "$(get "$A" "inventory/issues/$ISID" | jget data.issueNo | grep -c ISS)" "1"
check "issue detail has line items" "$(get "$A" "inventory/issues/$ISID" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['items']))")" "1"

echo "== MRN detail against the issue =="
MRN=$(post "$A" inventory/mrns "{\"issueId\":\"$ISID\",\"items\":[{\"productId\":\"$PID2\",\"qty\":3}]}")
MID=$(echo "$MRN" | jget data.id)
check "MRN detail returns camelCase mrnNo" "$(get "$A" "inventory/mrns/$MID" | jget data.mrnNo | grep -c MRN)" "1"

echo "== PO → approve → receive (GRN) detail =="
PO=$(post "$A" inventory/purchase-orders "{\"items\":[{\"productId\":\"$PID2\",\"qty\":20,\"unitPriceMinor\":600}]}")
POID=$(echo "$PO" | jget data.id)
check "PO detail returns camelCase poNo" "$(get "$A" "inventory/purchase-orders/$POID" | jget data.poNo | grep -c PO)" "1"
check "PO detail total Money object" "$(get "$A" "inventory/purchase-orders/$POID" | jget data.total.amountMinor)" "12000"
post "$A" "inventory/purchase-orders/$POID/approve" '{}' >/dev/null
GRN=$(post "$A" inventory/grns "{\"poId\":\"$POID\"}")
GID=$(echo "$GRN" | jget data.id)
check "GRN posted from PO" "$(echo "$GRN" | jget data.status)" "POSTED"
check "GRN detail returns camelCase grnNo + items" "$(get "$A" "inventory/grns/$GID" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d['grnNo'][:3], len(d['items']))")" "GRN 1"

echo "== gate pass detail → close =="
GP=$(post "$A" inventory/gate-passes '{"direction":"OUTWARD","party":"Acme","items":[{"description":"Tools","qty":2}]}')
GPID=$(echo "$GP" | jget data.id)
check "gate pass detail camelCase gpNo" "$(get "$A" "inventory/gate-passes/$GPID" | jget data.gpNo | grep -c GP)" "1"
check "gate pass close" "$(post "$A" "inventory/gate-passes/$GPID/close" '{}' | jget data.status)" "CLOSED"

echo ""
echo "──────── $pass passed, $fail failed ────────"
[ "$fail" -eq 0 ]
