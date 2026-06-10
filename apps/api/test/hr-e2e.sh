#!/usr/bin/env bash
# HR module e2e (Chunk 3.1): feature gate, role gate, CRUD, list+filter+pagination, tenant isolation.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"
PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }
jlen() { python3 -c "import sys,json;print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('hrsa@acme.test','hrmgr@hrone.test','hrview@hrone.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('hr-one','hr-two'));
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('hr-one','hr-two'));
DELETE FROM tenants WHERE slug IN ('hr-one','hr-two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','hrsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3370; for p in 3370 3371 3372 3373; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/hr-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
authget() { curl -s "$B/$2" -H "Authorization: Bearer $1"; }

SA=$(login "hrsa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"HR One","adminEmail":"admin@hrone.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"HR Two","adminEmail":"admin@hrtwo.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
echo "provisioned HR One=$T1, HR Two=$T2"
# seed an HR manager + viewer inside HR One
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES
 ('$T1','hrmgr@hrone.test','$HASH',true,'{HR_MANAGER}'),
 ('$T1','hrview@hrone.test','$HASH',true,'{VIEWER}');
SQL
MGR=$(login "hrmgr@hrone.test"); VIEW=$(login "hrview@hrone.test"); ADMIN2=$(login "admin@hrtwo.test")

echo "== feature gate: HR One (business plan) has hr enabled =="
check "GET /hr/employees -> 200" "$(code "$B/hr/employees" -H "Authorization: Bearer $MGR")" "200"

echo "== role gate: VIEWER cannot write, HR_MANAGER can =="
check "VIEWER POST /hr/employees -> 403" \
  "$(code -XPOST "$B/hr/employees" -H "Authorization: Bearer $VIEW" -H 'Content-Type: application/json' -d '{"firstName":"X","lastName":"Y"}')" "403"

DEPT=$(curl -s -XPOST "$B/hr/departments" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d '{"name":"Engineering"}' | jget data.id)
POS=$(curl -s -XPOST "$B/hr/positions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d '{"title":"Software Engineer"}' | jget data.id)
echo "  dept=$DEPT pos=$POS"

echo "== create employees (Pakistani names, PKR salaries) =="
mk() { curl -s -o /dev/null -w "%{http_code}" -XPOST "$B/hr/employees" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' \
  -d "{\"firstName\":\"$1\",\"lastName\":\"$2\",\"departmentId\":\"$DEPT\",\"positionId\":\"$POS\",\"salary\":{\"amountMinor\":$3,\"currency\":\"PKR\"},\"status\":\"$4\"}"; }
c1=$(mk Ayesha Khan 15000000 ACTIVE); c2=$(mk Bilal Ahmed 22000000 ACTIVE); c3=$(mk Fatima Malik 18000000 ON_LEAVE); c4=$(mk Usman Ali 30000000 ACTIVE)
check "employee creates -> 201" "$c1$c2$c3$c4" "201201201201"

echo "== list returns { data, meta } with pagination =="
RESP=$(authget "$MGR" "hr/employees")
check "list count == 4" "$(echo "$RESP" | jlen)" "4"
check "pagination total == 4" "$(echo "$RESP" | jget meta.pagination.total)" "4"

echo "== filters =="
check "status=ON_LEAVE -> 1" "$(authget "$MGR" "hr/employees?status=ON_LEAVE" | jlen)" "1"
check "search=Usman -> 1" "$(authget "$MGR" "hr/employees?search=Usman" | jlen)" "1"
check "department filter -> 4" "$(authget "$MGR" "hr/employees?department=$DEPT" | jlen)" "4"

echo "== pagination page size =="
P1=$(authget "$MGR" "hr/employees?page=1&pageSize=2")
check "page1 size2 -> 2 items" "$(echo "$P1" | jlen)" "2"
check "page1 size2 totalPages == 2" "$(echo "$P1" | jget meta.pagination.totalPages)" "2"

echo "== salary is Money (integer minor units) =="
EMP_SALARY=$(authget "$MGR" "hr/employees?search=Bilal" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['salary']['amountMinor'])" 2>/dev/null)
check "Bilal salary amountMinor == 22000000" "$EMP_SALARY" "22000000"

echo "== tenant isolation: HR Two admin can't see HR One employees =="
EMPID=$(authget "$MGR" "hr/employees?search=Ayesha" | jget data.0.id 2>/dev/null)
[ -z "$EMPID" ] && EMPID=$(authget "$MGR" "hr/employees?search=Ayesha" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)
check "HR Two list is empty" "$(authget "$ADMIN2" "hr/employees" | jlen)" "0"
check "HR Two GET HR One employee -> 404" "$(code "$B/hr/employees/$EMPID" -H "Authorization: Bearer $ADMIN2")" "404"

echo "== update + soft delete =="
check "PATCH employee -> 200" "$(code -XPATCH "$B/hr/employees/$EMPID" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d '{"status":"TERMINATED"}')" "200"
check "DELETE employee -> 204" "$(code -XDELETE "$B/hr/employees/$EMPID" -H "Authorization: Bearer $MGR")" "204"
check "deleted employee GET -> 404" "$(code "$B/hr/employees/$EMPID" -H "Authorization: Bearer $MGR")" "404"
check "list now 3" "$(authget "$MGR" "hr/employees" | jlen)" "3"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
