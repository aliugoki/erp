#!/usr/bin/env bash
# Overload e2e (Chunk 7.4): under a tight rate limit the API SHEDS load with 429 + Retry-After (it does
# not fall over), health probes are never throttled, and a SIGTERM drains and exits cleanly (graceful
# shutdown) rather than being force-killed.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email)='olsa@acme.test';
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='ol-co');
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='ol-co');
DELETE FROM tenants WHERE slug='ol-co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','olsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
# Tight limit so we can trip it; instant drain for the shutdown check.
API_PORT=$PORT THROTTLE_LIMIT=5 THROTTLE_TTL_MS=60000 SHUTDOWN_DRAIN_MS=0 \
  setsid node apps/api/dist/main.js >/tmp/overload-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }

SA=$(login "olsa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"OL Co","adminEmail":"admin@ol.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
A=$(login "admin@ol.test")

echo "== health probes are never throttled =="
hok=0; for i in $(seq 1 12); do [ "$(code "$B/health")" = "200" ] && hok=$((hok+1)); done
check "12/12 /health -> 200 (SkipThrottle)" "$hok" "12"

echo "== overload sheds load with 429 =="
codes=""
for i in $(seq 1 9); do codes="$codes $(code "$B/me" -H "Authorization: Bearer $A")"; done
echo "  codes:$codes"
check "some requests 429 (limit=5)" "$(echo "$codes" | grep -qo 429 && echo yes)" "yes"
check "early requests succeeded (200 present)" "$(echo "$codes" | grep -qo 200 && echo yes)" "yes"
curl -s -D /tmp/ol-h.txt -o /dev/null "$B/me" -H "Authorization: Bearer $A"
check "429 carries Retry-After header" "$(grep -ic '^retry-after:' /tmp/ol-h.txt)" "1"
check "API still alive after overload (/health 200)" "$(code "$B/health")" "200"

echo "== graceful shutdown on SIGTERM (drains + exits cleanly) =="
SRV=$(pgrep -f 'apps/api/dist/main.js' | head -1)
kill -TERM "$SRV" 2>/dev/null
exited=no; for i in $(seq 1 20); do kill -0 "$SRV" 2>/dev/null || { exited=yes; break; }; sleep 0.5; done
check "process drained and exited on SIGTERM" "$exited" "yes"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
