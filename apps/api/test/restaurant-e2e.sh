#!/usr/bin/env bash
# Restaurant acceptance e2e (Phase 11). Provisions an isolated tenant, spins its own API instance with
# the reaction workers ON, and walks the full service→cash→ledger path end to end, asserting each stage:
#   menu/floor/recipe setup → order → KDS fire → settle (tax + rounding + weighted-avg COGS + stock
#   deduction) → balanced GL journal (async, via outbox→consumer) → delivery lifecycle with OTP →
#   reservation → state-machine rejections → RLS tenant isolation → fiscal config.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; PLATFORM="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
checkge() { if [ "$2" -ge "$3" ] 2>/dev/null; then echo "  ✅ $1 ($2 ≥ $3)"; pass=$((pass+1)); else echo "  ❌ $1: expected ≥ '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d))" "$1" 2>/dev/null; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }

# ── isolated tenants — unique per run (restaurant tenants have FK data, so we never delete) ──
SUF="$$$RANDOM"; ADMIN1="admin+${SUF}@rmse2e.test"; ADMIN2="admin2+${SUF}@rmse2e.test"
HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','rmssa@e2e.test','$HASH',true,'{SUPER_ADMIN}') ON CONFLICT (lower(email)) DO UPDATE SET password_hash=EXCLUDED.password_hash;
SQL

# ── own API instance, workers + relay ON ─────────────────────────────────────
PORT=3410; for p in 3410 3411 3412 3413; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT WORKER_REACTIONS_ENABLED=1 OUTBOX_RELAY_ENABLED=1 setsid node apps/api/dist/main.js >/tmp/restaurant-e2e.out 2>&1 < /dev/null &
INSTANCE_PID=$!
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
B="http://127.0.0.1:$PORT"
for i in $(seq 1 40); do curl -fsS "$B/health" >/dev/null 2>&1 && break || sleep 0.4; done

login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
SA=$(login "rmssa@e2e.test")
prov() { curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "$1"; }
T1=$(prov "{\"name\":\"RMS E2E Co ${SUF}\",\"adminEmail\":\"${ADMIN1}\",\"adminPassword\":\"Password123!\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
T2=$(prov "{\"name\":\"RMS E2E Two ${SUF}\",\"adminEmail\":\"${ADMIN2}\",\"adminPassword\":\"Password123!\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
for f in inventory finance crm restaurant; do
  curl -s -XPATCH "$B/tenants/$T1/features/$f" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"enabled":true}' >/dev/null
  curl -s -XPATCH "$B/tenants/$T2/features/$f" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"enabled":true}' >/dev/null
done
A=$(login "$ADMIN1"); A2=$(login "$ADMIN2")
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
put()  { curl -s -XPUT  "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
put_patch() { curl -s -XPATCH "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
get()  { curl -s "$B/$2" -H "Authorization: Bearer $1"; }
code() {
  local m="$1" tok="$2" path="$3" body="${4:-}"
  if [ -n "$body" ]; then curl -s -o /dev/null -w '%{http_code}' -X "$m" "$B/$path" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d "$body"
  else curl -s -o /dev/null -w '%{http_code}' -X "$m" "$B/$path" -H "Authorization: Bearer $tok"; fi
}
echo "tenant=$T1 (port $PORT)"

echo "== setup: warehouse, ingredient, config, GL accounts =="
WH=$(post "$A" inventory/warehouses '{"name":"Kitchen Store"}' | jget data.id)
FLOUR=$(post "$A" inventory/products '{"sku":"E2E-FLR","name":"Flour","unit":"g","costPriceMinor":100,"currency":"PKR"}' | jget data.id)
post "$A" inventory/adjustments "{\"productId\":\"$FLOUR\",\"warehouseId\":\"$WH\",\"quantity\":20000,\"unitCostMinor\":100,\"docType\":\"OPENING\"}" >/dev/null
put "$A" restaurant/config "{\"defaultWarehouseId\":\"$WH\",\"currency\":\"PKR\",\"defaultTaxBp\":1600}" >/dev/null
acc() { post "$A" finance/accounts "$1" | jget data.id; }
AST=$(acc '{"code":"1","name":"Assets","type":"ASSET","isGroup":true}')
INC=$(acc '{"code":"4","name":"Income","type":"REVENUE","isGroup":true}')
LIA=$(acc '{"code":"2","name":"Liabilities","type":"LIABILITY","isGroup":true}')
EXP=$(acc '{"code":"5","name":"Expenses","type":"EXPENSE","isGroup":true}')
CASH=$(acc "{\"code\":\"1-01\",\"name\":\"Cash\",\"parentId\":\"$AST\",\"controlType\":\"CASH\"}")
INV=$(acc "{\"code\":\"1-02\",\"name\":\"Inventory\",\"parentId\":\"$AST\"}")
SALES=$(acc "{\"code\":\"4-01\",\"name\":\"Sales\",\"parentId\":\"$INC\"}")
TAXA=$(acc "{\"code\":\"2-01\",\"name\":\"Tax Payable\",\"parentId\":\"$LIA\"}")
COGSA=$(acc "{\"code\":\"5-01\",\"name\":\"COGS\",\"parentId\":\"$EXP\"}")
put "$A" restaurant/gl-config "{\"cashAccountId\":\"$CASH\",\"revenueAccountId\":\"$SALES\",\"taxAccountId\":\"$TAXA\",\"cogsAccountId\":\"$COGSA\",\"inventoryAccountId\":\"$INV\"}" >/dev/null
check "GL config saved" "$(get "$A" restaurant/gl-config | jget data.cashAccountId)" "$CASH"

echo "== menu, floor, recipe =="
CAT=$(post "$A" restaurant/categories '{"name":"Mains"}' | jget data.id)
ITEM=$(post "$A" restaurant/items "{\"categoryId\":\"$CAT\",\"name\":\"E2E Dish\",\"basePriceMinor\":50000,\"taxBp\":1600,\"stationKey\":\"HOT_KITCHEN\",\"prepMinutes\":10}" | jget data.id)
check "item created" "$(get "$A" "restaurant/items/$ITEM" | jget data.name)" "E2E Dish"
AREA=$(post "$A" restaurant/areas '{"name":"Hall","kind":"INDOOR"}' | jget data.id)
TABLE=$(post "$A" restaurant/tables "{\"areaId\":\"$AREA\",\"code\":\"E1\",\"capacity\":4}" | jget data.id)
check "table created" "$(get "$A" "restaurant/tables/$TABLE" | jget data.code)" "E1"
# recipe: 200 g flour @100/g → COGS 20000 for one dish
put "$A" "restaurant/items/$ITEM/recipe" "{\"yieldQty\":1,\"ingredients\":[{\"productId\":\"$FLOUR\",\"qtyPerYieldMilli\":200}]}" >/dev/null
check "recipe attached" "$(get "$A" "restaurant/items/$ITEM/recipe" | jget data.itemName)" "E2E Dish"

echo "== order → KDS → settle (money + COGS + stock) =="
OID=$(post "$A" restaurant/orders "{\"channel\":\"DINE_IN\",\"tableId\":\"$TABLE\",\"guestCount\":2}" | jget data.id)
post "$A" "restaurant/orders/$OID/items" "{\"items\":[{\"itemId\":\"$ITEM\",\"qty\":1}]}" >/dev/null
# auto_fire_kitchen defaults ON → placing a dine-in order confirms it and fires the kitchen in one step.
PL=$(post "$A" "restaurant/orders/$OID/place" '{}' | jget data.status)
check "place auto-fires → CONFIRMED" "$PL" "CONFIRMED"
checkge "kitchen ticket fired" "$(get "$A" restaurant/kds/board | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["data"]))')" "1"
ORDNO=$(get "$A" "restaurant/orders/$OID" | jget data.orderNo)
SET=$(post "$A" "restaurant/orders/$OID/settle" '{"payments":[{"method":"CASH","amountMinor":58000}]}')
check "settle → SETTLED" "$(echo "$SET" | jget data.status)" "SETTLED"
check "tax = 16% (8000)" "$(echo "$SET" | jget data.totals.tax.amountMinor)" "8000"
check "total = 58000" "$(echo "$SET" | jget data.totals.total.amountMinor)" "58000"
check "COGS captured = 20000" "$(echo "$SET" | jget data.totals.cogs.amountMinor)" "20000"
check "stock deducted 20000→19800" "$(get "$A" "inventory/products/$FLOUR" | jget data.onHand)" "19800"

echo "== GL journal posted (async: outbox → relay → consumer) =="
JV=""; for i in $(seq 1 30); do
  JV=$(get "$A" finance/transactions | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(next((t['id'] for t in d if t.get('reference')=='$ORDNO'),''))")
  [ -n "$JV" ] && break || sleep 0.5
done
check "restaurant JV posted for $ORDNO" "$([ -n "$JV" ] && echo yes || echo no)" "yes"
if [ -n "$JV" ]; then
  BAL=$(get "$A" "finance/transactions/$JV" | python3 -c "
import sys,json;d=json.load(sys.stdin)['data'];e=d.get('entries') or d.get('lines') or []
dr=sum(x['debit']['amountMinor'] for x in e); cr=sum(x['credit']['amountMinor'] for x in e)
print('BALANCED' if dr==cr and dr>0 else f'UNBALANCED {dr}/{cr}')")
  check "JV is balanced" "$BAL" "BALANCED"
fi

echo "== state-machine rejections =="
check "double-settle rejected (422)" "$(code POST "$A" "restaurant/orders/$OID/settle" '{"payments":[{"method":"CASH","amountMinor":58000}]}')" "422"

echo "== delivery lifecycle (OWN fleet + OTP) =="
OD=$(post "$A" restaurant/orders '{"channel":"DELIVERY","guestCount":1}' | jget data.id)
post "$A" "restaurant/orders/$OD/items" "{\"items\":[{\"itemId\":\"$ITEM\",\"qty\":1}]}" >/dev/null
post "$A" "restaurant/orders/$OD/place" '{}' >/dev/null
DID=$(post "$A" restaurant/deliveries "{\"orderId\":\"$OD\",\"provider\":\"OWN\",\"address\":\"E2E addr\",\"etaMinutes\":15}" | jget data.id)
post "$A" "restaurant/deliveries/$DID/assign" "{\"driverEmployeeId\":\"$(ownerq 'select gen_random_uuid()')\"}" >/dev/null
check "assign → ASSIGNED" "$(get "$A" "restaurant/deliveries/$DID" | jget data.status)" "ASSIGNED"
post "$A" "restaurant/deliveries/$DID/pickup" '{}' >/dev/null
post "$A" "restaurant/deliveries/$DID/enroute" '{}' >/dev/null
check "enroute → EN_ROUTE" "$(get "$A" "restaurant/deliveries/$DID" | jget data.status)" "EN_ROUTE"
check "wrong OTP → 422" "$(code POST "$A" "restaurant/deliveries/$DID/complete" '{"otp":"000000"}')" "422"
OTP=$(ownerq "SELECT otp_code FROM restaurant_delivery WHERE id='$DID'")
post "$A" "restaurant/deliveries/$DID/complete" "{\"otp\":\"$OTP\"}" >/dev/null
check "correct OTP → DELIVERED" "$(get "$A" "restaurant/deliveries/$DID" | jget data.status)" "DELIVERED"

echo "== reservation =="
RID=$(post "$A" restaurant/reservations "{\"guestName\":\"E2E Guest\",\"partySize\":2,\"tableId\":\"$TABLE\",\"reservedFor\":\"2026-08-01T19:00:00.000Z\"}" | jget data.id)
put "$A" "restaurant/reservations/$RID/status" '{"status":"SEATED"}' >/dev/null
check "reservation → SEATED" "$(get "$A" "restaurant/reservations/$RID" | jget data.status)" "SEATED"

echo "== RLS: tenant 2 cannot see tenant 1's order =="
check "cross-tenant order read → 404" "$(code GET "$A2" "restaurant/orders/$OID")" "404"
check "tenant 2 order list excludes it" "$(get "$A2" restaurant/orders | python3 -c "import sys,json;print('$OID' in [o['id'] for o in json.load(sys.stdin)['data']])")" "False"

echo "== multi-branch (one tenant, many outlets) =="
BR1=$(post "$A" branches '{"name":"E2E HQ","code":"E2E-HQ","isHeadOffice":true}' | jget data.id)
BR2=$(post "$A" branches '{"name":"E2E Outlet 2","code":"E2E-O2"}' | jget data.id)
check "branch created" "$([ -n "$BR1" ] && echo yes || echo no)" "yes"
# provision BR1 → clones the head-office (null-branch) config: warehouse + PKR + 16% tax
PROV=$(post "$A" "restaurant/branches/$BR1/provision" '{}')
check "provision clones warehouse" "$(echo "$PROV" | jget data.defaultWarehouseId)" "$WH"
check "provision clones 16% tax" "$(echo "$PROV" | jget data.defaultTaxBp)" "1600"
check "branch shows configured in list" "$(get "$A" restaurant/branches | python3 -c "import sys,json;print(next((b['configured'] for b in json.load(sys.stdin)['data'] if b['id']=='$BR1'),None))")" "True"
# order on BR1: place + settle, then assert branch-scoped listing isolates it from BR2
BO=$(post "$A" restaurant/orders "{\"channel\":\"DINE_IN\",\"branchId\":\"$BR1\",\"guestCount\":2}" | jget data.id)
post "$A" "restaurant/orders/$BO/items" "{\"items\":[{\"itemId\":\"$ITEM\",\"qty\":1}]}" >/dev/null
post "$A" "restaurant/orders/$BO/place" '{}' >/dev/null
BSET=$(post "$A" "restaurant/orders/$BO/settle" '{"payments":[{"method":"CASH","amountMinor":58000}]}')
check "branch order settled" "$(echo "$BSET" | jget data.status)" "SETTLED"
check "branch order tax = 16%" "$(echo "$BSET" | jget data.totals.tax.amountMinor)" "8000"
check "orders?branchId=BR1 includes it" "$(get "$A" "restaurant/orders?branchId=$BR1" | python3 -c "import sys,json;print('$BO' in [o['id'] for o in json.load(sys.stdin)['data']])")" "True"
check "orders?branchId=BR2 excludes it" "$(get "$A" "restaurant/orders?branchId=$BR2" | python3 -c "import sys,json;print('$BO' in [o['id'] for o in json.load(sys.stdin)['data']])")" "False"
check "unknown branch on order → 400" "$(code POST "$A" restaurant/orders "{\"channel\":\"DINE_IN\",\"branchId\":\"$(ownerq 'select gen_random_uuid()')\"}")" "400"

echo "== uniqueness with a NULL branch (the tenant-wide row) =="
# A tenant-wide table/station carries branch_id NULL, and Postgres counts NULLs as DISTINCT — so
# (tenant_id, branch_id, code) accepted duplicates for exactly those rows until NULLS NOT DISTINCT.
check "table code index is NULLS NOT DISTINCT" "$(ownerq "SELECT indexdef ILIKE '%nulls not distinct%' FROM pg_indexes WHERE indexname='uq_restaurant_table_code'")" "t"
check "station key index is NULLS NOT DISTINCT" "$(ownerq "SELECT indexdef ILIKE '%nulls not distinct%' FROM pg_indexes WHERE indexname='uq_restaurant_station_key'")" "t"
check "duplicate tenant-wide table code → 400" "$(code POST "$A" restaurant/tables "{\"areaId\":\"$AREA\",\"code\":\"E1\"}")" "400"
# The same code on a DIFFERENT outlet stays legal: T2 at Gulberg and T2 at DHA are two tables.
BTB=$(post "$A" restaurant/tables "{\"code\":\"E1\",\"branchId\":\"$BR1\"}" | jget data.id)
check "same code on another branch allowed" "$([ -n "$BTB" ] && echo yes || echo no)" "yes"
check "duplicate code within that branch → 400" "$(code POST "$A" restaurant/tables "{\"code\":\"E1\",\"branchId\":\"$BR1\"}")" "400"
# Stations are reference rows with no create endpoint (seeded/administered), so drive the index itself:
# the second insert must be rejected, leaving exactly one row.
ownerq "INSERT INTO restaurant_station (tenant_id, branch_id, key, name) VALUES ('$T1', NULL, 'E2E_GRILL', 'E2E Grill')" >/dev/null
ownerq "INSERT INTO restaurant_station (tenant_id, branch_id, key, name) VALUES ('$T1', NULL, 'E2E_GRILL', 'E2E Grill Two')" >/dev/null
check "duplicate tenant-wide station key rejected" "$(ownerq "SELECT count(*) FROM restaurant_station WHERE tenant_id='$T1' AND key='E2E_GRILL' AND deleted_at IS NULL")" "1"
ownerq "INSERT INTO restaurant_station (tenant_id, branch_id, key, name) VALUES ('$T1', '$BR1', 'E2E_GRILL', 'E2E Grill BR1')" >/dev/null
check "same station key on another branch allowed" "$(ownerq "SELECT count(*) FROM restaurant_station WHERE tenant_id='$T1' AND key='E2E_GRILL' AND deleted_at IS NULL")" "2"

echo "== printing: registry, routing, spool =="
# A kitchen printer bound to the station the seeded item routes to, plus the till's receipt printer.
STATION=$(ownerq "SELECT COALESCE(station_key,'MAIN') FROM restaurant_menu_item WHERE id='$ITEM'")
PKIT=$(post "$A" restaurant/printers "{\"key\":\"e2e-kitchen\",\"name\":\"E2E Kitchen\",\"kind\":\"KITCHEN\",\"connection\":\"NETWORK\",\"host\":\"127.0.0.1\",\"stationKey\":\"$STATION\",\"charsPerLine\":32}" | jget data.id)
PTILL=$(post "$A" restaurant/printers '{"key":"e2e-till","name":"E2E Till","kind":"RECEIPT","connection":"NETWORK","host":"127.0.0.1","charsPerLine":42,"cashDrawer":true,"isDefault":true}' | jget data.id)
check "printer registered" "$([ -n "$PTILL" ] && echo yes || echo no)" "yes"
check "NETWORK printer needs a host → 400" "$(code POST "$A" restaurant/printers '{"key":"e2e-bad","name":"No host","connection":"NETWORK"}')" "400"
check "duplicate printer key → 400" "$(code POST "$A" restaurant/printers '{"key":"e2e-till","name":"Dupe","host":"127.0.0.1"}')" "400"
# Regression: patching only the port must not be rejected for "needs a host" (DTO fields arrive as
# own `undefined` properties, so a naive spread erased the stored host).
check "patch port only keeps the host" "$(put_patch "$A" "restaurant/printers/$PTILL" '{"port":9100}' | jget data.host)" "127.0.0.1"

echo "== printing: a fired order queues its KOT =="
PO=$(post "$A" restaurant/orders '{"channel":"DINE_IN","guestCount":2}' | jget data.id)
post "$A" "restaurant/orders/$PO/items" "{\"items\":[{\"itemId\":\"$ITEM\",\"qty\":2}]}" >/dev/null
post "$A" "restaurant/orders/$PO/place" '{}' >/dev/null
KOTQ=$(get "$A" "restaurant/print-jobs?kind=KOT" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(len([j for j in d if j['status']=='QUEUED']))")
check "KOT auto-queued on fire" "$([ "$KOTQ" -ge 1 ] && echo yes || echo no)" "yes"
check "KOT routed to the station printer" "$(get "$A" "restaurant/print-jobs?printerId=$PKIT" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(len(d)>0)")" "True"

echo "== printing: the agent claims, prints, completes =="
CLAIMED=$(post "$A" restaurant/print-jobs/claim '{"printerKey":"e2e-kitchen","agent":"e2e"}')
CJID=$(echo "$CLAIMED" | jget data.id)
check "agent claims a KOT" "$(echo "$CLAIMED" | jget data.kind)" "KOT"
check "ESC/POS stream starts with ESC @" "$(echo "$CLAIMED" | jget data.escposBase64 | base64 -d | head -c2 | xxd -p)" "1b40"
check "KOT names the station" "$(echo "$CLAIMED" | jget data.text | head -1 | tr -d ' ')" "$(echo "$STATION" | tr '[:lower:]' '[:upper:]')"
check "KOT carries no prices" "$(echo "$CLAIMED" | jget data.text | grep -cE '[0-9]+\.[0-9]{2}')" "0"
post "$A" "restaurant/print-jobs/$CJID/complete" '{"ok":true}' >/dev/null
check "completed job leaves the queue" "$(get "$A" "restaurant/print-jobs/$CJID" | jget data.status)" "PRINTED"
for _ in 1 2 3 4 5 6 7 8; do
  DRAIN=$(post "$A" restaurant/print-jobs/claim '{"printerKey":"e2e-kitchen","agent":"e2e"}' | jget data.id)
  [ -z "$DRAIN" ] || [ "$DRAIN" = "None" ] && break
  post "$A" "restaurant/print-jobs/$DRAIN/complete" '{"ok":true}' >/dev/null
done
check "queue drains to empty" "$(post "$A" restaurant/print-jobs/claim '{"printerKey":"e2e-kitchen"}' | jget data.id)" "None"

echo "== printing: the bill adds up on paper =="
post "$A" "restaurant/orders/$PO/settle" '{"payments":[{"method":"CASH","amountMinor":150000}]}' >/dev/null
BILL=$(get "$A" "restaurant/orders/$PO/receipt")
check "receipt renders the order number" "$(echo "$BILL" | jget data.text | grep -c "$(get "$A" "restaurant/orders/$PO" | jget data.orderNo)")" "2"
# Two lines of 500.00 must print as 1,000.00 beside a 1,000.00 subtotal — line amounts and the
# subtotal share one (tax-exclusive) basis, so a guest adding the column gets the printed subtotal.
check "printed lines equal the printed subtotal" "$(echo "$BILL" | jget data.text | grep -c '1,000.00')" "2"
PJOB=$(post "$A" "restaurant/orders/$PO/print" '{}')
check "bill queues to the till" "$(echo "$PJOB" | jget data.kind)" "RECEIPT"
BCLAIM=$(post "$A" restaurant/print-jobs/claim '{"printerKey":"e2e-till","agent":"e2e"}')
check "cash sale kicks the drawer" "$(echo "$BCLAIM" | jget data.escposBase64 | base64 -d | xxd -p | tr -d '\n' | grep -c '1b7000')" "1"
BJID=$(echo "$BCLAIM" | jget data.id)
post "$A" "restaurant/print-jobs/$BJID/complete" '{"ok":false,"error":"out of paper"}' >/dev/null
check "a failed print returns to the queue" "$(get "$A" "restaurant/print-jobs/$BJID" | jget data.status)" "QUEUED"

echo "== scanning: one endpoint resolves every code =="
QR=$(get "$A" "restaurant/tables/$TABLE/qr")
QRPAY=$(echo "$QR" | jget data.payload)
check "table QR issued" "$(echo "$QRPAY" | grep -c '^mx://table/')" "1"
check "table QR resolves to the table" "$(post "$A" restaurant/scan "{\"code\":\"$QRPAY\"}" | jget data.kind)" "TABLE"
PONO=$(get "$A" "restaurant/orders/$PO" | jget data.orderNo)
check "bill barcode resolves to the order" "$(post "$A" restaurant/scan "{\"code\":\"$PONO\"}" | jget data.order.orderNo)" "$PONO"
check "unknown code → 404" "$(code POST "$A" restaurant/scan '{"code":"NO-SUCH-CODE-12345"}')" "404"
ROTATED=$(post "$A" "restaurant/tables/$TABLE/qr/rotate" '{}' | jget data.payload)
check "rotating invalidates the old sticker" "$(code POST "$A" restaurant/scan "{\"code\":\"$QRPAY\"}")" "404"
check "rotated sticker resolves" "$(post "$A" restaurant/scan "{\"code\":\"$ROTATED\"}" | jget data.kind)" "TABLE"

echo "== scanning: barcode straight onto the ticket =="
patch_item=$(put_patch "$A" "restaurant/items/$ITEM" '{"barcode":"8964000E2E01"}' | jget data.barcode)
check "menu item carries a barcode" "$patch_item" "8964000E2E01"
SO=$(post "$A" restaurant/orders '{"channel":"TAKEAWAY"}' | jget data.id)
SADD=$(post "$A" "restaurant/orders/$SO/scan-add" '{"code":"8964000E2E01","qty":3}')
check "scan-add puts it on the order" "$(echo "$SADD" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['order']['items'][0]['qty'])")" "3"
check "scan-add prices from the menu" "$(echo "$SADD" | jget data.order.totals.subtotal.amountMinor)" "150000"
check "scanning a barcode resolves the dish" "$(post "$A" restaurant/scan '{"code":"8964000E2E01"}' | jget data.kind)" "MENU_ITEM"
check "RLS: tenant 2 cannot scan our table QR" "$(code POST "$A2" restaurant/scan "{\"code\":\"$ROTATED\"}")" "404"

echo "== code generation: barcodes =="
# The scanning section above hand-set this item's barcode, so mint over it explicitly.
GEN=$(post "$A" "restaurant/items/$ITEM/barcode" '{"regenerate":true}')
GENBC=$(echo "$GEN" | jget data.barcode)
check "internal barcode minted" "$(echo "$GEN" | jget data.generated)" "True"
check "minted code is a valid EAN-13" "$(python3 -c "
c='$GENBC'
print(len(c)==13 and c.isdigit() and (10-sum(int(d)*(1 if i%2==0 else 3) for i,d in enumerate(c[:12]))%10)%10==int(c[12]))")" "True"
check "minted in the GS1 in-store range" "$(echo "$GENBC" | cut -c1-1)" "2"
check "re-minting is idempotent" "$(post "$A" "restaurant/items/$ITEM/barcode" '{}' | jget data.generated)" "False"
check "the existing code is returned unchanged" "$(post "$A" "restaurant/items/$ITEM/barcode" '{}' | jget data.barcode)" "$GENBC"
check "a bad EAN check digit → 400" "$(code POST "$A" "restaurant/items/$ITEM/barcode" '{"value":"5449000000997"}')" "400"
check "the minted code scans back to the dish" "$(post "$A" restaurant/scan "{\"code\":\"$GENBC\"}" | jget data.kind)" "MENU_ITEM"
# The item EDIT path must validate too — otherwise a bad code enters through the form and fails at the till.
check "editing in a bad EAN → 400" "$(code PATCH "$A" "restaurant/items/$ITEM" '{"barcode":"8964000112234"}')" "400"
check "a non-EAN code still allowed" "$(put_patch "$A" "restaurant/items/$ITEM" '{"barcode":"E2E-SKU-1"}' | jget data.barcode)" "E2E-SKU-1"
ITEM2=$(post "$A" restaurant/items "{\"categoryId\":\"$CAT\",\"name\":\"E2E Second Dish\",\"basePriceMinor\":25000}" | jget data.id)
check "duplicate barcode → 400, not 500" "$(code PATCH "$A" "restaurant/items/$ITEM2" '{"barcode":"E2E-SKU-1"}')" "400"
put_patch "$A" "restaurant/items/$ITEM" "{\"barcode\":\"$GENBC\"}" >/dev/null
BULK=$(post "$A" restaurant/items/barcodes/generate-missing '{}')
check "bulk mint covers every remaining item" "$(get "$A" restaurant/items | python3 -c "import sys,json;print(sum(1 for i in json.load(sys.stdin)['data'] if not i.get('barcode')))")" "0"
check "bulk mint is idempotent" "$(post "$A" restaurant/items/barcodes/generate-missing '{}' | jget data.issued)" "0"

echo "== code generation: images =="
QRSVG=$(curl -s "$B/restaurant/codes/qr?value=mx://table/e2e" -H "Authorization: Bearer $A")
check "QR renders as SVG" "$(echo "$QRSVG" | head -c 4)" "<svg"
check "QR PNG has the PNG magic bytes" "$(curl -s "$B/restaurant/codes/qr?value=x&format=png" -H "Authorization: Bearer $A" | head -c4 | xxd -p)" "89504e47"
BCSVG=$(curl -s "$B/restaurant/codes/barcode?value=$GENBC" -H "Authorization: Bearer $A")
check "barcode renders as SVG with bars" "$([ "$(echo "$BCSVG" | grep -o '<rect' | wc -l)" -gt 10 ] && echo yes || echo no)" "yes"
check "an unencodable value → 400" "$(code GET "$A" "restaurant/codes/barcode?value=%C3%A9%C3%A9%C3%A9&symbology=CODE39")" "400"

echo "== code generation: labels =="
QRSHEET=$(get "$A" restaurant/tables/qr-sheet)
check "QR sheet issues a payload per table" "$(echo "$QRSHEET" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(len(d)>0 and all(t['payload'].startswith('mx://table/') for t in d))")" "True"
LBL=$(post "$A" "restaurant/tables/$TABLE/qr/print" '{"copies":2}')
check "table QR label queued" "$(echo "$LBL" | jget data.kind)" "LABEL"
check "label honours the copy count" "$(echo "$LBL" | jget data.copies)" "2"
ILBL=$(post "$A" "restaurant/items/$ITEM/barcode/print" '{}')
ILID=$(echo "$ILBL" | jget data.id)
check "item barcode label queued" "$(echo "$ILBL" | jget data.kind)" "LABEL"
# A product label must carry a REAL EAN command (GS k 67), not CODE39 digits, or retail scanners reject it.
check "product label prints a native EAN-13" "$(get "$A" "restaurant/print-jobs/$ILID" | jget data.escposBase64 | base64 -d | xxd -p | tr -d '\n' | grep -c '1d6b43')" "1"

echo "== inventory barcodes (shared catalogue) =="
IPROD=$(post "$A" inventory/products "{\"sku\":\"E2E-ING-1\",\"name\":\"E2E Ingredient\",\"unit\":\"g\",\"costPriceMinor\":100}" | jget data.id)
check "product created without a barcode" "$(get "$A" "inventory/products/$IPROD" | jget data.barcode)" "None"
IGEN=$(post "$A" "inventory/products/$IPROD/barcode" '{}')
IBC=$(echo "$IGEN" | jget data.barcode)
check "inventory barcode minted" "$(echo "$IGEN" | jget data.generated)" "True"
check "inventory code is a valid EAN-13" "$(python3 -c "
c='$IBC'
print(len(c)==13 and c.isdigit() and (10-sum(int(d)*(1 if i%2==0 else 3) for i,d in enumerate(c[:12]))%10)%10==int(c[12]))")" "True"
check "creating with a bad EAN → 400" "$(code POST "$A" inventory/products '{"sku":"E2E-BAD","name":"Bad","barcode":"5449000000997"}')" "400"
check "duplicate barcode across products → 400" "$(code POST "$A" inventory/products "{\"sku\":\"E2E-DUP\",\"name\":\"Dup\",\"barcode\":\"$IBC\"}")" "400"
check "scanned code finds the product" "$(get "$A" "inventory/products/by-code?code=$IBC" | jget data.sku)" "E2E-ING-1"
check "SKU also resolves" "$(get "$A" "inventory/products/by-code?code=E2E-ING-1" | jget data.id)" "$IPROD"

echo "== barcodes are unique ACROSS modules (a carton must not ring up a dish) =="
# Menu items and inventory products draw from ONE tenant-wide counter; separate counters would each
# start at 1 and issue the same code, so scanning stock would resolve to a menu item.
MBC=$(post "$A" "restaurant/items/$ITEM/barcode" '{"regenerate":true}' | jget data.barcode)
check "menu code differs from the inventory code" "$([ "$MBC" != "$IBC" ] && echo yes || echo no)" "yes"
check "the inventory code resolves to the PRODUCT" "$(post "$A" restaurant/scan "{\"code\":\"$IBC\"}" | jget data.kind)" "INVENTORY_PRODUCT"
check "the menu code resolves to the MENU ITEM" "$(post "$A" restaurant/scan "{\"code\":\"$MBC\"}" | jget data.kind)" "MENU_ITEM"
IBULK=$(post "$A" inventory/products/barcodes/generate-missing '{}')
check "inventory bulk mint leaves nothing uncoded" "$(get "$A" inventory/products | python3 -c "import sys,json;print(sum(1 for p in json.load(sys.stdin)['data'] if not p.get('barcode')))")" "0"
check "every barcode in the tenant is unique" "$(python3 -c "
import json,subprocess
inv=json.loads(subprocess.run(['curl','-s','$B/inventory/products','-H','Authorization: Bearer $A'],capture_output=True,text=True).stdout)['data']
men=json.loads(subprocess.run(['curl','-s','$B/restaurant/items','-H','Authorization: Bearer $A'],capture_output=True,text=True).stdout)['data']
codes=[p['barcode'] for p in inv if p.get('barcode')]+[i['barcode'] for i in men if i.get('barcode')]
print(len(codes)==len(set(codes)))")" "True"

echo "== shared code images (no restaurant feature required) =="
check "GET /codes/qr renders" "$(curl -s "$B/codes/qr?value=hello" -H "Authorization: Bearer $A" | head -c 4)" "<svg"
check "GET /codes/barcode renders" "$(curl -s "$B/codes/barcode?value=$IBC" -H "Authorization: Bearer $A" | head -c 4)" "<svg"

echo "== fiscal config (dynamic authority) =="
put "$A" restaurant/fiscal-config '{"authority":"PRA","environment":"sandbox","enabled":true}' >/dev/null
check "fiscal authority = PRA" "$(get "$A" restaurant/fiscal-config | jget data.authority)" "PRA"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
