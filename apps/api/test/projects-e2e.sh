#!/usr/bin/env bash
# Projects e2e: project → member (rates) → task → log time → approve (costs + bills from the member's
# rate) → project costing rolls up labour + expense vs budget → portfolio. Asserts the costing math
# through the real API + SQL.
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
DELETE FROM users WHERE lower(email) IN ('projsa@acme.test','admin@proj.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE name='Proj Co');
DELETE FROM tenants WHERE name='Proj Co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','projsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3440; for p in 3440 3441 3442 3443; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/projects-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
patch() { curl -s -XPATCH "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }

SA=$(login "projsa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Proj Co\",\"adminEmail\":\"admin@proj.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
A=$(login "admin@proj.test")
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO hr_employee (tenant_id, employee_code, first_name, last_name, status) VALUES ('$T','E-001','Dev','One','ACTIVE');
SQL
EMP=$(ownerq "SELECT id FROM hr_employee WHERE tenant_id='$T' AND employee_code='E-001'")
echo "tenant=$T employee=$EMP"

echo "== project (budget 1,000,000) + member (cost 2,000/h, bill 3,000/h) =="
PID=$(post "$A" projects "{\"name\":\"Website rebuild\",\"budgetMinor\":1000000}" | jget data.id)
check "project created" "$([ -n "$PID" ] && echo ok)" "ok"
post "$A" "projects/$PID/members" "{\"employeeId\":\"$EMP\",\"costRateMinor\":200000,\"billRateMinor\":300000}" >/dev/null
check "member added" "$(curl -s "$B/projects/$PID/members" -H "Authorization: Bearer $A" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))" 2>/dev/null)" "1"

echo "== task + log 120 min (2h) =="
post "$A" "projects/$PID/tasks" '{"name":"Build homepage"}' >/dev/null
TE=$(post "$A" "projects/$PID/time" "{\"employeeId\":\"$EMP\",\"minutes\":120}")
TEID=$(echo "$TE" | jget data.id)
check "time entry DRAFT, not yet costed" "$(echo "$TE" | jget data.cost.amountMinor)" "0"

echo "== approve -> cost 2h x 2,000 = 400,000; bill 2h x 3,000 = 600,000 =="
AP=$(patch "$A" "projects/$PID/time/$TEID/status" '{"status":"APPROVED"}')
check "approved cost 400000" "$(echo "$AP" | jget data.cost.amountMinor)" "400000"
check "approved bill 600000" "$(echo "$AP" | jget data.bill.amountMinor)" "600000"

echo "== expense 50,000 -> project costing rolls up =="
post "$A" "projects/$PID/expenses" '{"category":"Software","amountMinor":50000}' >/dev/null
PR=$(curl -s "$B/projects/$PID" -H "Authorization: Bearer $A")
check "labour cost 400000" "$(echo "$PR" | jget data.costing.laborCost.amountMinor)" "400000"
check "expense cost 50000" "$(echo "$PR" | jget data.costing.expenseCost.amountMinor)" "50000"
check "total cost 450000" "$(echo "$PR" | jget data.costing.totalCost.amountMinor)" "450000"
check "billable 600000" "$(echo "$PR" | jget data.costing.billable.amountMinor)" "600000"
check "remaining 550000 (budget 1,000,000 - cost 450,000)" "$(echo "$PR" | jget data.costing.remaining.amountMinor)" "550000"

echo "== portfolio report =="
check "portfolio has 1 project" "$(curl -s "$B/projects/reports/portfolio" -H "Authorization: Bearer $A" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))" 2>/dev/null)" "1"
check "timesheet: employee 2h approved" "$(curl -s "$B/projects/reports/timesheet" -H "Authorization: Bearer $A" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(d[0]['hours'] if d else 'none')" 2>/dev/null)" "2"

echo; echo "Projects e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
