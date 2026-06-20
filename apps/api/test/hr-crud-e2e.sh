#!/usr/bin/env bash
# HR CRUD e2e: the newly-added update/delete endpoints for the previously create-only org + payroll
# reference entities — departments, positions, designations, leave types, salary components.
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
DELETE FROM users WHERE lower(email) IN ('hrcsa@acme.test','admin@hrcrud.test');
DELETE FROM tenants WHERE name='HR Crud';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','hrcsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3480; for p in 3480 3481 3482 3483; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/hrcrud-e2e.out 2>&1 < /dev/null &
trap 'for pid in $(pgrep -f "apps/api/dist/main.js"); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done' EXIT
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
patch() { curl -s -XPATCH "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
delcode() { curl -s -o /dev/null -w '%{http_code}' -XDELETE "$B/$2" -H "Authorization: Bearer $1"; }

SA=$(login "hrcsa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"HR Crud\",\"adminEmail\":\"admin@hrcrud.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"business\"}" | jget data.tenant.id)
A=$(login "admin@hrcrud.test")
echo "tenant=$T"

echo "== department: create → update → delete =="
DID=$(post "$A" hr/departments '{"name":"Engineering"}' | jget data.id)
check "department update name" "$(patch "$A" "hr/departments/$DID" '{"name":"Platform Eng"}' | jget data.name)" "Platform Eng"
check "department delete (204)" "$(delcode "$A" "hr/departments/$DID")" "204"

echo "== position: create → update → delete =="
PID=$(post "$A" hr/positions '{"title":"Engineer"}' | jget data.id)
check "position update title" "$(patch "$A" "hr/positions/$PID" '{"title":"Senior Engineer"}' | jget data.title)" "Senior Engineer"
check "position delete (204)" "$(delcode "$A" "hr/positions/$PID")" "204"

echo "== designation: create → update → delete =="
GID=$(post "$A" hr/designations '{"name":"Grade A"}' | jget data.id)
check "designation update name" "$(patch "$A" "hr/designations/$GID" '{"name":"Grade A+"}' | jget data.name)" "Grade A+"
check "designation delete (204)" "$(delcode "$A" "hr/designations/$GID")" "204"

echo "== leave type: create → update → delete =="
LID=$(post "$A" hr/leave-types '{"name":"Annual","daysPerYear":14,"paid":true}' | jget data.id)
check "leave type update days" "$(patch "$A" "hr/leave-types/$LID" '{"name":"Annual Leave","daysPerYear":20}' | jget data.daysPerYear)" "20"
check "leave type delete (204)" "$(delcode "$A" "hr/leave-types/$LID")" "204"

echo "== salary component: create → update → delete =="
SID=$(post "$A" hr/salary-components '{"name":"House Rent","code":"HRA","type":"EARNING","calc":"PCT_OF_BASIC","percent":40}' | jget data.id)
check "component update percent" "$(patch "$A" "hr/salary-components/$SID" '{"percent":50}' | jget data.percent)" "50"
check "component delete (204)" "$(delcode "$A" "hr/salary-components/$SID")" "204"

echo "== not-found after delete =="
check "deleted leave type update → 404" "$(curl -s -o /dev/null -w '%{http_code}' -XPATCH "$B/hr/leave-types/$LID" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"name":"x"}')" "404"

echo ""
echo "──────── $pass passed, $fail failed ────────"
[ "$fail" -eq 0 ]
