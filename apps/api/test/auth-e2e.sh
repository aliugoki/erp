#!/usr/bin/env bash
# Auth e2e gate (Chunk 2.1). Seeds a user, then exercises login, refresh rotation, reuse detection,
# and logout against the running API. Requires infra up + the api built (dist/). Exits non-zero on
# any failed assertion.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root

# --- load env -------------------------------------------------------------------------------------
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"
EMAIL="admin@acme.test"
PASSWORD="Password123!"
TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { # check <desc> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1));
  else echo "  ❌ $1: expected '$3', got '$2'"; fail=$((fail+1)); fi
}
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }

# --- seed user (as owner, direct — bypasses RLS) --------------------------------------------------
HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
PGPASSWORD="$(echo "$OWNER_URL" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')" \
psql "$OWNER_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
DELETE FROM users WHERE lower(email) = lower('$EMAIL');
INSERT INTO users (tenant_id, email, password_hash, is_active)
VALUES ('$TENANT_A', '$EMAIL', '$HASH', true);
SQL
echo "seeded $EMAIL"

# --- start api on a free port ---------------------------------------------------------------------
PORT=3320; for p in 3320 3321 3322 3323; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/auth-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
BASE="http://127.0.0.1:$PORT"
post() { curl -s -o /tmp/body.json -w "%{http_code}" -X POST "$BASE/$1" -H 'Content-Type: application/json' -d "$2"; }
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT

echo "== login =="
code=$(post auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
check "login 200" "$code" "200"
R1=$(jget data.refreshToken </tmp/body.json); A1=$(jget data.accessToken </tmp/body.json)
[ -n "$R1" ] && echo "  got refresh+access" || { echo "  ❌ no tokens"; fail=$((fail+1)); }

echo "== wrong password rejected =="
code=$(post auth/login "{\"email\":\"$EMAIL\",\"password\":\"wrongpassword\"}")
check "bad login 401" "$code" "401"

echo "== refresh rotates =="
code=$(post auth/refresh "{\"refreshToken\":\"$R1\"}")
check "refresh 200" "$code" "200"
R2=$(jget data.refreshToken </tmp/body.json)
[ -n "$R2" ] && [ "$R2" != "$R1" ] && echo "  ✅ rotated to a new token" && pass=$((pass+1)) || { echo "  ❌ token not rotated"; fail=$((fail+1)); }

echo "== reuse of old refresh rejected (reuse detection) =="
code=$(post auth/refresh "{\"refreshToken\":\"$R1\"}")
check "reused old refresh 401" "$code" "401"

echo "== family revoked: the rotated token is now dead too =="
code=$(post auth/refresh "{\"refreshToken\":\"$R2\"}")
check "post-reuse refresh 401" "$code" "401"

echo "== logout then refresh rejected =="
code=$(post auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"); R3=$(jget data.refreshToken </tmp/body.json)
code=$(post auth/logout "{\"refreshToken\":\"$R3\"}")
check "logout 204" "$code" "204"
code=$(post auth/refresh "{\"refreshToken\":\"$R3\"}")
check "refresh after logout 401" "$code" "401"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
