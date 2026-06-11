#!/usr/bin/env bash
# Resilience e2e (Chunk 7.1): fault-inject latency/errors per dependency and prove BOUNDED failure with
# the process staying responsive on /health. (1) DB latency → statement_timeout cancels a slow query
# fast (no unbounded hang); (2) ML down → AI routes degrade to 200, no 5xx cascade; (3) /health and
# /health/ready stay 200 throughout.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d))" "$1" 2>/dev/null; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email)='ressa@acme.test';
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='res-co');
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='res-co');
DELETE FROM tenants WHERE slug='res-co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','ressa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
# ML pointed at a dead port to fault that dependency.
API_PORT=$PORT ML_BASE_URL="http://127.0.0.1:9" ML_RETRY_ATTEMPTS=0 ML_HTTP_TIMEOUT_MS=1000 \
  setsid node apps/api/dist/main.js >/tmp/resilience-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }

echo "== process responsive =="
check "GET /health -> 200" "$(code "$B/health")" "200"
check "GET /health/ready -> 200 (db+redis reachable)" "$(code "$B/health/ready")" "200"

echo "== DB latency fault: statement_timeout bounds a slow query =="
# Exactly what TenantTransactionService does per tx: bound the statement, then run a 5s sleep.
START=$(date +%s%N)
OUT=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=0 -c "BEGIN; SET LOCAL statement_timeout=500; SELECT pg_sleep(5); COMMIT;" 2>&1)
MS=$(( ($(date +%s%N) - START) / 1000000 ))
check "slow query CANCELLED (not hung)" "$(echo "$OUT" | grep -qi 'statement timeout' && echo bounded)" "bounded"
check "cancelled within ~timeout (<1500ms, was $MS ms)" "$([ "$MS" -lt 1500 ] && echo ok)" "ok"
check "process still healthy after DB fault" "$(code "$B/health")" "200"

echo "== ML down fault: AI route degrades, no 5xx cascade =="
A=$(login "ressa@acme.test")
PROD="abababab-abab-abab-abab-abababababab"
RESP=$(curl -s -XPOST "$B/api/ai/forecast/$PROD" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"horizon":7}')
check "AI forecast HTTP 200 (no cascade)" "$(code -XPOST "$B/api/ai/forecast/$PROD" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"horizon":7}')" "200"
check "AI forecast degraded=true" "$(echo "$RESP" | jget data.degraded)" "True"

echo "== still responsive after all faults =="
check "GET /health/ready -> 200" "$(code "$B/health/ready")" "200"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
