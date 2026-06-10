#!/usr/bin/env bash
# RBAC e2e gate (Chunk 2.2). Seeds users with different roles, then verifies the global auth + role +
# permission guards: unauthenticated → 401, wrong role → 403, right role → 200, public route open.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"
PASSWORD="Password123!"
TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
seed() { # seed <email> <roles-array-literal>
  psql "$OWNER_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
DELETE FROM users WHERE lower(email) = lower('$1');
INSERT INTO users (tenant_id, email, password_hash, is_active, roles)
VALUES ('$TENANT_A', '$1', '$HASH', true, '$2');
SQL
}
seed "tadmin@acme.test" "{TENANT_ADMIN}"
seed "viewer@acme.test" "{VIEWER}"
seed "hr@acme.test"     "{HR_MANAGER}"
echo "seeded 3 users"

PORT=3330; for p in 3330 3331 3332 3333; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/rbac-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
BASE="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT

login() { curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code_with() { curl -s -o /dev/null -w "%{http_code}" "$BASE/$2" ${1:+-H "Authorization: Bearer $1"}; }

ADMIN=$(login "tadmin@acme.test"); VIEWER=$(login "viewer@acme.test"); HR=$(login "hr@acme.test")
[ -n "$ADMIN" ] && [ -n "$VIEWER" ] && [ -n "$HR" ] && echo "  got 3 access tokens" || { echo "  ❌ login failed"; fail=$((fail+1)); }

echo "== public route open without token =="
check "GET /health 200 (public)" "$(code_with '' health)" "200"

echo "== authentication =="
check "GET /me no token -> 401" "$(code_with '' me)" "401"
check "GET /me with token -> 200" "$(code_with "$VIEWER" me)" "200"
check "GET /me bad token -> 401" "$(code_with 'garbage.token.here' me)" "401"

echo "== role guard (/admin/ping needs TENANT_ADMIN/SUPER_ADMIN) =="
check "VIEWER -> 403" "$(code_with "$VIEWER" admin/ping)" "403"
check "TENANT_ADMIN -> 200" "$(code_with "$ADMIN" admin/ping)" "200"

echo "== permission guard (/admin/perm-ping needs hr:employee:write) =="
check "VIEWER (no perm) -> 403" "$(code_with "$VIEWER" admin/perm-ping)" "403"
check "HR_MANAGER (has perm) -> 200" "$(code_with "$HR" admin/perm-ping)" "200"
check "TENANT_ADMIN (wildcard) -> 200" "$(code_with "$ADMIN" admin/perm-ping)" "200"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
