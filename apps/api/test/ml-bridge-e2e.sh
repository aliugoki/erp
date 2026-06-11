#!/usr/bin/env bash
# API↔ML bridge e2e (Chunk 6.5): boot the API pointed at a DEAD ML endpoint and prove every AI route
# returns a graceful 200 `degraded` response (never a 5xx cascade), and that the circuit breaker opens
# after the failure threshold. No ML service runs — that's the point.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d))" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email)='aisa@acme.test';
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='ai-co');
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='ai-co');
DELETE FROM tenants WHERE slug='ai-co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','aisa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
# Point the bridge at a dead port; tighten the breaker so it opens fast; no retry delays.
API_PORT=$PORT ML_BASE_URL="http://127.0.0.1:9" ML_BREAKER_THRESHOLD=2 ML_RETRY_ATTEMPTS=0 ML_HTTP_TIMEOUT_MS=1000 \
  setsid node apps/api/dist/main.js >/tmp/ml-bridge-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

SA=$(login "aisa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"AI Co","adminEmail":"admin@ai.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
A=$(login "admin@ai.test")
ah=(-H "Authorization: Bearer $A" -H 'Content-Type: application/json')
PROD="abababab-abab-abab-abab-abababababab"

echo "== auth =="
check "AI forecast unauthenticated -> 401" "$(code -XPOST "$B/api/ai/forecast/$PROD" -H 'Content-Type: application/json' -d '{}')" "401"

echo "== ML down -> graceful degraded (NOT 5xx) =="
F=$(curl -s -XPOST "$B/api/ai/forecast/$PROD" "${ah[@]}" -d '{"horizon":7}')
check "forecast HTTP 200 (no cascade)" "$(code -XPOST "$B/api/ai/forecast/$PROD" "${ah[@]}" -d '{"horizon":7}')" "200"
check "forecast degraded=true" "$(echo "$F" | jget data.degraded)" "True"
check "forecast source=degraded" "$(echo "$F" | jget data.source)" "degraded"
check "forecast model=unavailable" "$(echo "$F" | jget data.model)" "unavailable"

S=$(curl -s -XPOST "$B/api/ai/anomalies/scan" "${ah[@]}" -d '{}')
check "anomaly scan 200" "$(code -XPOST "$B/api/ai/anomalies/scan" "${ah[@]}" -d '{}')" "200"
check "anomaly degraded=true" "$(echo "$S" | jget data.degraded)" "True"

X=$(curl -s -XPOST "$B/api/ai/invoice/extract" -H "Authorization: Bearer $A" -F "file=@apps/ml/tests/fixtures/sample_invoice.pdf;type=application/pdf")
check "invoice extract 200" "$(code -XPOST "$B/api/ai/invoice/extract" -H "Authorization: Bearer $A" -F "file=@apps/ml/tests/fixtures/sample_invoice.pdf;type=application/pdf")" "200"
check "invoice degraded=true" "$(echo "$X" | jget data.degraded)" "True"

echo "== circuit breaker opened after repeated failures =="
# Several calls above already exceeded the threshold (2); the breaker should now be OPEN.
check "breaker is OPEN" "$(curl -s "$B/api/ai/health" -H "Authorization: Bearer $A" | jget data.ml.breaker)" "OPEN"
check "still graceful while open (200)" "$(code -XPOST "$B/api/ai/anomalies/scan" "${ah[@]}" -d '{}')" "200"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
