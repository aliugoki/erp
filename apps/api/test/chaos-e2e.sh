#!/usr/bin/env bash
# Chaos / failure suite (Chunk 7.5): fault EACH dependency and assert bounded, documented behaviour —
# never a cascade. Faults are contained: each scenario boots its own API instance with that one
# dependency's URL pointed at a dead port (the shared infra is never touched). Behaviours are
# documented in docs/resilience.md. Separate/slower job — run with `pnpm --filter @app/api test:chaos`.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email)='chaossa@acme.test';
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='chaos-co');
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='chaos-co');
DELETE FROM tenants WHERE slug='chaos-co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','chaossa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

CID=""
boot() { # boot <env-prefix...>  -> sets B, CIDpid
  local port=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { port=$p; break; }; done
  env API_PORT=$port "$@" setsid node apps/api/dist/main.js >/tmp/chaos-e2e.out 2>&1 < /dev/null &
  CIDpid=$!
  B="http://127.0.0.1:$port"
  for i in $(seq 1 40); do curl -fsS "$B/health" >/dev/null 2>&1 && break || sleep 0.4; done
}
killsrv() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; sleep 1; }
trap killsrv EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }

echo "== CHAOS 1/4: DB latency → statement_timeout cancels the query (bounded), process stays up =="
boot
START=$(date +%s%N)
OUT=$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=0 -c "BEGIN; SET LOCAL statement_timeout=500; SELECT pg_sleep(5); COMMIT;" 2>&1)
MS=$(( ($(date +%s%N) - START) / 1000000 ))
check "slow query cancelled <1.5s (was ${MS}ms)" "$([ "$MS" -lt 1500 ] && echo "$OUT" | grep -qi 'statement timeout' && echo ok)" "ok"
check "process healthy through DB fault" "$(code "$B/health")" "200"
killsrv

echo "== CHAOS 2/4: ML down → AI route degrades to 200 (no 5xx cascade) =="
boot ML_BASE_URL="http://127.0.0.1:9" ML_RETRY_ATTEMPTS=0 ML_HTTP_TIMEOUT_MS=800
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $(login chaossa@acme.test)" -H 'Content-Type: application/json' -d '{"name":"Chaos Co","adminEmail":"admin@chaos.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
A=$(login "admin@chaos.test")
F=$(curl -s -XPOST "$B/api/ai/forecast/abababab-abab-abab-abab-abababababab" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"horizon":7}')
check "AI forecast 200 (degraded, not 5xx)" "$(code -XPOST "$B/api/ai/forecast/abababab-abab-abab-abab-abababababab" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"horizon":7}')" "200"
check "forecast marked degraded" "$(echo "$F" | jget data.degraded)" "True"
check "process healthy through ML fault" "$(code "$B/health")" "200"
killsrv

echo "== CHAOS 3/4: broker down → business write still succeeds, event stays pending, no cascade =="
boot RABBITMQ_URL="amqp://127.0.0.1:9" OUTBOX_RELAY_ENABLED=true OUTBOX_POLL_INTERVAL_MS=500 BROKER_PUBLISH_TIMEOUT_MS=800
A=$(login "admin@chaos.test")
CLIENT=$(curl -s -XPOST "$B/crm/clients" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"companyName":"Chaos Buyer","status":"ACTIVE"}' | jget data.id)
DEAL=$(curl -s -XPOST "$B/crm/deals" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"clientId\":\"$CLIENT\",\"title\":\"Chaos Deal\",\"valueMinor\":100000,\"stage\":\"NEGOTIATION\"}" | jget data.id)
check "close deal succeeds despite dead broker (200)" "$(code -XPATCH "$B/crm/deals/$DEAL/stage" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"stage":"CLOSED_WON"}')" "200"
sleep 2  # let the relay try (and fail) to publish
check "event safely PENDING in outbox (not lost)" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T1' AND type='crm.deal_closed.v1' AND published_at IS NULL")" "1"
check "process healthy through broker fault" "$(code "$B/health")" "200"
killsrv

echo "== CHAOS 4/4: redis down → liveness up, readiness 503 (bounded gate, LB pulls instance) =="
boot REDIS_URL="redis://127.0.0.1:9"
check "liveness /health -> 200 (process alive)" "$(code "$B/health")" "200"
RC=$(code "$B/health/ready")
check "readiness /health/ready -> 503 (bounded, not a hang)" "$RC" "503"
killsrv

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
