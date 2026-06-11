#!/usr/bin/env bash
# Reporting e2e (Chunk 5.2): create real data through the module APIs, refresh the read models, then
# verify each of the 4 reports returns { raw, series } with correct aggregates, is tenant-scoped, and
# serves fast (read-model, not inline aggregation). Boots its own API; reports refresh on demand.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }
rawlen() { python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']['raw']))" 2>/dev/null; }
serieslen() { python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']['series']))" 2>/dev/null; }
stageval() { python3 -c "import sys,json
d=json.load(sys.stdin)['data']['raw']
s=[x for x in d if x['stage']==sys.argv[1]]
print(s[0]['total']['amountMinor'] if s else 'missing')" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email)='reportsa@acme.test';
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('report-co','report-two'));
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('report-co','report-two'));
DELETE FROM tenants WHERE slug IN ('report-co','report-two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','reportsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/reports-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
get() { curl -s "$B/$2" -H "Authorization: Bearer $1"; }

SA=$(login "reportsa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Report Co","adminEmail":"admin@report.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Report Two","adminEmail":"admin@reporttwo.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
A=$(login "admin@report.test"); A2=$(login "admin@reporttwo.test")
echo "tenant Report Co=$T1"

echo "== seed finance (P&L), inventory, hr, crm via module APIs =="
CASH=$(post "$A" finance/accounts '{"code":"1000","name":"Cash","type":"ASSET"}' | jget data.id)
SALES=$(post "$A" finance/accounts '{"code":"4000","name":"Sales","type":"REVENUE"}' | jget data.id)
COSTS=$(post "$A" finance/accounts '{"code":"5000","name":"Costs","type":"EXPENSE"}' | jget data.id)
check "revenue txn -> 201" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"description\":\"Sale\",\"occurredOn\":\"2026-03-15\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100000},{\"accountId\":\"$SALES\",\"creditMinor\":100000}]}")" "201"
check "expense txn -> 201" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"description\":\"Cost\",\"occurredOn\":\"2026-03-20\",\"entries\":[{\"accountId\":\"$COSTS\",\"debitMinor\":40000},{\"accountId\":\"$CASH\",\"creditMinor\":40000}]}")" "201"

PROD=$(post "$A" inventory/products '{"sku":"RPT-1","name":"Report Widget","minStock":5,"costPriceMinor":5000,"sellPriceMinor":9000}' | jget data.id)
post "$A" inventory/movements "{\"productId\":\"$PROD\",\"type\":\"IN\",\"quantity\":20}" >/dev/null
post "$A" hr/employees '{"employeeCode":"R-1","firstName":"Rana","lastName":"K","status":"ACTIVE"}' >/dev/null
CLIENT=$(post "$A" crm/clients '{"companyName":"Pipeline Co","status":"ACTIVE"}' | jget data.id)
DEAL=$(post "$A" crm/deals "{\"clientId\":\"$CLIENT\",\"title\":\"Won Deal\",\"valueMinor\":750000,\"stage\":\"NEGOTIATION\"}" | jget data.id)
curl -s -XPATCH "$B/crm/deals/$DEAL/stage" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"stage":"CLOSED_WON"}' >/dev/null

echo "== reports are EMPTY before refresh (served from read models) =="
check "P&L empty pre-refresh" "$(get "$A" reports/finance/profit-loss | rawlen)" "0"

echo "== refresh read models (admin only) =="
check "VIEWER-less: refresh as admin -> 200" "$(code -XPOST "$B/reports/refresh" -H "Authorization: Bearer $A")" "200"

echo "== finance profit & loss =="
PL=$(get "$A" reports/finance/profit-loss)
check "P&L has { raw, series }" "$([ "$(echo "$PL" | rawlen)" -ge 1 ] && [ "$(echo "$PL" | serieslen)" -ge 1 ] && echo ok)" "ok"
check "P&L revenue == 100000" "$(echo "$PL" | jget data.totals.revenue.amountMinor)" "100000"
check "P&L expense == 40000" "$(echo "$PL" | jget data.totals.expense.amountMinor)" "40000"
check "P&L profit == 60000" "$(echo "$PL" | jget data.totals.profit.amountMinor)" "60000"
check "P&L range filter (out of range) empty" "$(get "$A" 'reports/finance/profit-loss?from=2026-01-01&to=2026-02-28' | rawlen)" "0"

echo "== inventory valuation =="
INV=$(get "$A" reports/inventory/valuation)
check "valuation total == 100000 (20 * 5000)" "$(echo "$INV" | jget data.totals.value.amountMinor)" "100000"
check "valuation has series" "$([ "$(echo "$INV" | serieslen)" -ge 1 ] && echo ok)" "ok"

echo "== hr headcount =="
HR=$(get "$A" reports/hr/headcount)
check "headcount total == 1" "$(echo "$HR" | jget data.totals.headcount)" "1"

echo "== crm sales pipeline =="
CRM=$(get "$A" reports/crm/sales-pipeline)
check "pipeline lists all 6 stages" "$(echo "$CRM" | rawlen)" "6"
check "CLOSED_WON total == 750000" "$(echo "$CRM" | stageval CLOSED_WON)" "750000"

echo "== tenant isolation: other tenant sees empty reports =="
curl -s -XPOST "$B/reports/refresh" -H "Authorization: Bearer $A2" >/dev/null
check "Report Two P&L empty" "$(get "$A2" reports/finance/profit-loss | rawlen)" "0"
check "Report Two valuation empty" "$(get "$A2" reports/inventory/valuation | rawlen)" "0"

echo "== perf: read-model serve is fast =="
T=$(curl -s -o /dev/null -w "%{time_total}" "$B/reports/inventory/valuation" -H "Authorization: Bearer $A")
check "valuation served < 1.0s ($T)" "$(python3 -c "print('ok' if float('$T')<1.0 else 'slow')")" "ok"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
