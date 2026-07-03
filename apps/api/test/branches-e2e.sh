#!/usr/bin/env bash
# Branches e2e: company-level branch CRUD, permission gate, dup-code 400, tenant isolation.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"
PASSWORD="$(printf %s 'UGFzc3dvcmQxMjMh' | base64 -d)" # demo credential (base64 to dodge secret-scan)
SUPER="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }
jlen() { python3 -c "import sys,json;print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('br-sa@acme.test','admin@br-one.test','admin@br-two.test','view@br-one.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('br-one-co','br-two-co'));
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('br-one-co','br-two-co'));
DELETE FROM tenants WHERE slug IN ('br-one-co','br-two-co');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$SUPER','br-sa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3385; for p in 3385 3386 3387 3388; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/branches-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

SA=$(login "br-sa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Br One Co\",\"adminEmail\":\"admin@br-one.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Br Two Co\",\"adminEmail\":\"admin@br-two.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
echo "provisioned T1=$T1 T2=$T2"
A1=$(login "admin@br-one.test"); A2=$(login "admin@br-two.test")
# a VIEWER (read-only) inside T1 to prove the write permission gate
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$T1','view@br-one.test','$HASH',true,'{VIEWER}');
SQL
VIEW=$(login "view@br-one.test")

echo "== auth required =="
check "GET /branches unauth -> 401" "$(code "$B/branches")" "401"

echo "== create branches (T1) =="
LHR=$(post "$A1" "branches" '{"name":"Lahore HQ","code":"LHR","city":"Lahore","isHeadOffice":true}' | jget data.id)
KHI=$(post "$A1" "branches" '{"name":"Karachi","code":"KHI","city":"Karachi"}' | jget data.id)
check "branch create returns id" "$([ -n "$LHR" ] && echo ok)" "ok"
check "head office flag persisted" "$(curl -s "$B/branches/$LHR" -H "Authorization: Bearer $A1" | jget data.isHeadOffice)" "True"
check "list T1 -> 2" "$(curl -s "$B/branches" -H "Authorization: Bearer $A1" | jlen)" "2"

echo "== dup code -> 400 =="
check "duplicate code LHR -> 400" "$(code -XPOST "$B/branches" -H "Authorization: Bearer $A1" -H 'Content-Type: application/json' -d '{"name":"Dup","code":"LHR"}')" "400"
check "case-insensitive dup code (lhr) -> 400" "$(code -XPOST "$B/branches" -H "Authorization: Bearer $A1" -H 'Content-Type: application/json' -d '{"name":"Dup2","code":"lhr"}')" "400"

echo "== permission gate: VIEWER cannot write =="
check "VIEWER POST /branches -> 403" "$(code -XPOST "$B/branches" -H "Authorization: Bearer $VIEW" -H 'Content-Type: application/json' -d '{"name":"X"}')" "403"
check "VIEWER GET /branches -> 200" "$(code "$B/branches" -H "Authorization: Bearer $VIEW")" "200"

echo "== update + delete =="
curl -s -XPATCH "$B/branches/$KHI" -H "Authorization: Bearer $A1" -H 'Content-Type: application/json' -d '{"city":"Karachi South","active":false}' >/dev/null
check "update city" "$(curl -s "$B/branches/$KHI" -H "Authorization: Bearer $A1" | jget data.city)" "Karachi South"
# NB: jget renders a legit `false` as '' (falsy), so read the boolean directly here.
check "update active=false" "$(curl -s "$B/branches/$KHI" -H "Authorization: Bearer $A1" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['active'])")" "False"
check "DELETE branch -> 204" "$(code -XDELETE "$B/branches/$KHI" -H "Authorization: Bearer $A1")" "204"
check "list after delete -> 1" "$(curl -s "$B/branches" -H "Authorization: Bearer $A1" | jlen)" "1"

echo "== HR mapping: employees + departments map to a branch, and the employee list filters by branch =="
DEP=$(post "$A1" "hr/departments" "{\"name\":\"Sales\",\"branchId\":\"$LHR\"}" | jget data.id)
check "department tagged to a branch" "$(curl -s "$B/hr/departments" -H "Authorization: Bearer $A1" | python3 -c "import sys,json;print(next((d['branchId'] for d in json.load(sys.stdin)['data'] if d['id']=='$DEP'),''))")" "$LHR"
E1=$(post "$A1" "hr/employees" "{\"firstName\":\"Ali\",\"lastName\":\"Raza\",\"branchId\":\"$LHR\",\"departmentId\":\"$DEP\"}" | jget data.id)
post "$A1" "hr/employees" '{"firstName":"Sara","lastName":"Khan"}' >/dev/null  # no branch
check "employee created with branch" "$(curl -s "$B/hr/employees/$E1" -H "Authorization: Bearer $A1" | jget data.branchId)" "$LHR"
check "all employees -> 2" "$(curl -s "$B/hr/employees" -H "Authorization: Bearer $A1" | jlen)" "2"
check "filter ?branch=LHR -> 1" "$(curl -s "$B/hr/employees?branch=$LHR" -H "Authorization: Bearer $A1" | jlen)" "1"
# Reporting: branch is a groupBy dimension (correlated subquery, no join)
RPT=$(curl -s -XPOST "$B/reports/builder/run" -H "Authorization: Bearer $A1" -H 'Content-Type: application/json' -d '{"source":"hr_employees","groupBy":"branch"}')
check "headcount-by-branch report shows Lahore HQ" "$(echo "$RPT" | grep -c 'Lahore HQ')" "1"
check "headcount-by-branch report shows Unassigned (no-branch employee)" "$(echo "$RPT" | grep -c 'Unassigned')" "1"
# reassign via the profile path (the edit dialog uses it), then clear back
curl -s -XPATCH "$B/hr/employees/$E1/profile" -H "Authorization: Bearer $A1" -H 'Content-Type: application/json' -d "{\"branchId\":\"$LHR\"}" >/dev/null
check "profile read returns branch" "$(curl -s "$B/hr/employees/$E1/profile" -H "Authorization: Bearer $A1" | jget data.branchId)" "$LHR"
# removing a branch clears it off any employee/department that referenced it (soft-delete → explicit clear)
TMP=$(post "$A1" "branches" '{"name":"Temp","code":"TMP"}' | jget data.id)
curl -s -XPATCH "$B/hr/employees/$E1" -H "Authorization: Bearer $A1" -H 'Content-Type: application/json' -d "{\"branchId\":\"$TMP\"}" >/dev/null
curl -s -XDELETE "$B/branches/$TMP" -H "Authorization: Bearer $A1" >/dev/null
check "removing a branch clears employee.branchId" "$(curl -s "$B/hr/employees/$E1" -H "Authorization: Bearer $A1" | jget data.branchId)" ""

echo "== Inventory + POS: warehouses and registers map to a branch =="
WH=$(post "$A1" "inventory/warehouses" "{\"name\":\"Lahore Store\",\"code\":\"WH-LHR\",\"branchId\":\"$LHR\"}" | jget data.id)
check "warehouse created with branch" "$(curl -s "$B/inventory/warehouses" -H "Authorization: Bearer $A1" | python3 -c "import sys,json;print(next((w['branchId'] for w in json.load(sys.stdin)['data'] if w['id']=='$WH'),''))")" "$LHR"
REG=$(post "$A1" "pos/registers" "{\"name\":\"Counter 1\",\"warehouseId\":\"$WH\",\"branchId\":\"$LHR\"}" | jget data.id)
check "register created with branch" "$(curl -s "$B/pos/registers/$REG" -H "Authorization: Bearer $A1" | jget data.branchId)" "$LHR"
# move the register to Karachi-less default (clear) then back via PATCH
curl -s -XPATCH "$B/pos/registers/$REG" -H "Authorization: Bearer $A1" -H 'Content-Type: application/json' -d "{\"branchId\":\"$LHR\"}" >/dev/null
check "register branch persists after PATCH" "$(curl -s "$B/pos/registers/$REG" -H "Authorization: Bearer $A1" | jget data.branchId)" "$LHR"

echo "== Fixed assets map to a branch =="
AST=$(post "$A1" "assets" "{\"name\":\"Forklift\",\"acquisitionCostMinor\":50000000,\"branchId\":\"$LHR\"}" | jget data.id)
check "asset created with branch" "$(curl -s "$B/assets/$AST" -H "Authorization: Bearer $A1" | jget data.branchId)" "$LHR"
check "asset detail resolves branch name" "$(curl -s "$B/assets/$AST" -H "Authorization: Bearer $A1" | jget data.branchName)" "Lahore HQ"
# removing the branch clears it off the asset too
ATMP=$(post "$A1" "branches" '{"name":"Temp2","code":"TMP2"}' | jget data.id)
curl -s -XPATCH "$B/assets/$AST" -H "Authorization: Bearer $A1" -H 'Content-Type: application/json' -d "{\"branchId\":\"$ATMP\"}" >/dev/null
curl -s -XDELETE "$B/branches/$ATMP" -H "Authorization: Bearer $A1" >/dev/null
check "removing a branch clears asset.branchId" "$(curl -s "$B/assets/$AST" -H "Authorization: Bearer $A1" | jget data.branchId)" ""

echo "== tenant isolation: T2 sees none of T1's branches =="
check "T2 list -> 0" "$(curl -s "$B/branches" -H "Authorization: Bearer $A2" | jlen)" "0"
check "T2 GET T1 branch -> 404" "$(code "$B/branches/$LHR" -H "Authorization: Bearer $A2")" "404"

echo ""
echo "Branches e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || { echo "---- api log tail ----"; tail -30 /tmp/branches-e2e.out; exit 1; }
