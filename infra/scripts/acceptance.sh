#!/usr/bin/env bash
# Final acceptance (Chunk 9.4): exercise the running production stack end-to-end —
# provision a tenant, drive every module, fire each domain event, confirm the transactional outbox +
# relay published them, and prove graceful degradation when ML is killed.
#
#   API_URL=http://127.0.0.1:3300 OWNER_URL=postgresql://metaxperts:metaxperts@127.0.0.1:55433/metaxperts \
#     ML_CONTAINER=metaxperts-erp-prod-ml-1 COMPOSE="docker compose -f infra/docker-compose.prod.yml -f infra/docker-compose.prod.local.yml" \
#     bash infra/scripts/acceptance.sh
#
# Requires the background workers to be ON (outbox relay + reactions + notifications).
set -uo pipefail
cd "$(dirname "$0")/../.." # repo root

API_URL="${API_URL:-http://127.0.0.1:3300}"
OWNER_URL="${OWNER_URL:-postgresql://metaxperts:metaxperts@127.0.0.1:55433/metaxperts}"
ML_CONTAINER="${ML_CONTAINER:-metaxperts-erp-prod-ml-1}"
COMPOSE="${COMPOSE:-docker compose -f infra/docker-compose.prod.yml -f infra/docker-compose.prod.local.yml}"
SAPW="SuperAdmin123!"; ADMPW="Acceptance123!"
SUFFIX="$(date -u +%H%M%S)"
SLUG="acc-$SUFFIX"; EMAIL="admin-$SUFFIX@acceptance.test"

pass=0; fail=0
ok()   { echo "  ✅ $1"; pass=$((pass+1)); }
bad()  { echo "  ❌ $1"; fail=$((fail+1)); }
chk()  { [ "$2" = "$3" ] && ok "$1 ($2)" || bad "$1: expected '$3' got '$2'"; }
jget() { python3 -c "import sys,json,functools;d=json.load(sys.stdin);v=functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None,sys.argv[1].split('.'),d);print('' if v is None else v)" "$1" 2>/dev/null; }
login(){ curl -s -X POST "$API_URL/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jget data.accessToken; }
P(){ curl -s -X POST "$API_URL/$2" -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$3"; }
ownerq(){ psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }

echo "== provision acceptance tenant =="
SA=$(login "superadmin@metaxperts.local" "$SAPW")
[ -n "$SA" ] && ok "super-admin login" || { bad "super-admin login (is the stack up + seeded?)"; exit 1; }
TID=$(curl -s -X POST "$API_URL/tenants" -H "authorization: Bearer $SA" -H 'content-type: application/json' \
  -d "{\"name\":\"Acceptance $SUFFIX\",\"adminEmail\":\"$EMAIL\",\"adminPassword\":\"$ADMPW\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
[ -n "$TID" ] && ok "tenant provisioned ($TID)" || { bad "tenant provision"; exit 1; }
T=$(login "$EMAIL" "$ADMPW")
[ -n "$T" ] && ok "tenant-admin login" || { bad "tenant-admin login"; exit 1; }

echo "== exercise every module =="
DEPT=$(P "$T" hr/departments '{"name":"Ops"}' | jget data.id)
chk "HR employee created" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/hr/employees" -H "authorization: Bearer $T" -H 'content-type: application/json' -d "{\"firstName\":\"A\",\"lastName\":\"B\",\"departmentId\":\"$DEPT\"}")" "201"
ACC1=$(P "$T" finance/accounts '{"code":"1000","name":"Cash","type":"ASSET"}' | jget data.id)
ACC2=$(P "$T" finance/accounts '{"code":"4000","name":"Sales","type":"REVENUE"}' | jget data.id)
chk "Finance journal voucher" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/finance/transactions" -H "authorization: Bearer $T" -H 'content-type: application/json' -d "{\"voucherType\":\"JV\",\"description\":\"acc\",\"entries\":[{\"accountId\":\"$ACC1\",\"debitMinor\":1000},{\"accountId\":\"$ACC2\",\"creditMinor\":1000}]}")" "201"
INV=$(P "$T" finance/invoices '{"number":"ACC-INV-1","lineItems":[{"description":"x","quantity":1,"unitPriceMinor":100000}]}' | jget data.id)
WH=$(P "$T" inventory/warehouses '{"name":"WH","code":"W1"}' | jget data.id)
PROD=$(P "$T" inventory/products '{"sku":"ACC-SKU","name":"P","minStock":100}' | jget data.id)
CLIENT=$(P "$T" crm/clients '{"companyName":"AccClient"}' | jget data.id)
DEAL=$(P "$T" crm/deals "{\"clientId\":\"$CLIENT\",\"title\":\"D\",\"valueMinor\":500000,\"stage\":\"PROPOSAL\"}" | jget data.id)

echo "== fire each domain event (outbox) =="
# Stock above minStock first, then draw down below it so the movement TRANSITIONS into low stock.
P "$T" inventory/movements "{\"productId\":\"$PROD\",\"type\":\"IN\",\"quantity\":200,\"warehouseId\":\"$WH\"}" >/dev/null
chk "inventory.low_stock (draw-down crosses minStock)" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/inventory/movements" -H "authorization: Bearer $T" -H 'content-type: application/json' -d "{\"productId\":\"$PROD\",\"type\":\"OUT\",\"quantity\":150,\"warehouseId\":\"$WH\"}")" "201"
chk "finance.invoice_paid (pay invoice)" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API_URL/finance/invoices/$INV/pay" -H "authorization: Bearer $T")" "200"
chk "crm.deal_closed (stage -> CLOSED_WON)" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API_URL/crm/deals/$DEAL/stage" -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{"stage":"CLOSED_WON"}')" "200"

echo "== confirm the relay published the events =="
TOTAL=$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$TID'")
for i in $(seq 1 15); do
  UNPUB=$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$TID' AND published_at IS NULL")
  [ "${UNPUB:-1}" = "0" ] && break || sleep 1
done
chk "3 domain events written to the outbox" "$TOTAL" "3"
chk "relay published every event (none pending)" "${UNPUB:-?}" "0"
PROCESSED=$(ownerq "SELECT count(*) FROM processed_event WHERE tenant_id='$TID'")
[ "${PROCESSED:-0}" -ge 1 ] && ok "consumers reacted (processed_event=$PROCESSED)" || bad "no processed_event rows (consumers idle?)"

echo "== graceful degradation: kill ML =="
$COMPOSE stop ml >/dev/null 2>&1
sleep 2
DEG=$(curl -s -X POST "$API_URL/api/ai/forecast/$PROD" -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{}')
DCODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/api/ai/forecast/$PROD" -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{}')
chk "AI endpoint stays 200 with ML down" "$DCODE" "200"
chk "response is flagged degraded" "$(echo "$DEG" | jget data.degraded)" "True"
chk "liveness unaffected" "$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/health")" "200"
echo "   restoring ML…"; $COMPOSE start ml >/dev/null 2>&1

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
