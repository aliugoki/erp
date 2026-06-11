#!/usr/bin/env bash
# Distributed tracing gate (Chunk 8.1): a single user action (close a deal) produces ONE connected
# trace spanning api → broker → in-process consumer. We boot the API with OTel on + the relay +
# reactions, close a deal, then confirm the otel-collector received spans for that action's trace id
# across the HTTP request AND the amqplib publish/consume (proving trace context survived the async
# transactional outbox + the broker).
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"
COL="docker compose -f infra/docker-compose.yml logs otel-collector"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email)='tracesa@acme.test';
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='trace-co');
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='trace-co');
DELETE FROM tenants WHERE slug='trace-co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','tracesa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL
docker compose -f infra/docker-compose.yml exec -T rabbitmq rabbitmqctl purge_queue c.notify-deal-closed >/dev/null 2>&1 || true

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT OTEL_ENABLED=true OTEL_SERVICE_NAME=metaxperts-api OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  OUTBOX_RELAY_ENABLED=true OUTBOX_POLL_INTERVAL_MS=500 WORKER_REACTIONS_ENABLED=true NOTIFICATIONS_ENABLED=true \
  setsid node apps/api/dist/main.js >/tmp/tracing-api.out 2>&1 < /dev/null &
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }

SA=$(login "tracesa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Trace Co","adminEmail":"admin@trace.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
A=$(login "admin@trace.test")
CLIENT=$(post "$A" crm/clients '{"companyName":"Trace Buyer","status":"ACTIVE"}' | jget data.id)
DEAL=$(post "$A" crm/deals "{\"clientId\":\"$CLIENT\",\"title\":\"Traced Deal\",\"valueMinor\":900000,\"stage\":\"NEGOTIATION\"}" | jget data.id)

echo "== close the deal (the traced user action) =="
check "close deal -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -XPATCH "$B/crm/deals/$DEAL/stage" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"stage":"CLOSED_WON"}')" "200"
sleep 4 # let the relay publish + consumers react, and the span batch export

# The trace id of the close-deal request (from the trace-correlated structured log line).
TID=$(grep '"method":"PATCH"' /tmp/tracing-api.out | grep '/stage' | tail -1 | grep -oE '"traceId":"[a-f0-9]{32}"' | grep -oE '[a-f0-9]{32}' | head -1)
echo "  close-deal traceId: ${TID:-<none>}"
check "request log is trace-correlated (traceId present)" "$([ -n "$TID" ] && echo ok)" "ok"

echo "== collector received this action's trace, across api + broker =="
LOGS=$($COL --since=60s 2>/dev/null)
check "collector received metaxperts-api spans" "$([ "$(echo "$LOGS" | grep -c 'metaxperts-api')" -gt 0 ] && echo yes)" "yes"
HITS=0; [ -n "$TID" ] && HITS=$(echo "$LOGS" | grep -cF "$TID")
echo "  spans carrying the close-deal trace id: $HITS"
check "ONE connected trace: traceId spans >=2 (HTTP + broker)" "$([ "${HITS:-0}" -ge 2 ] && echo yes)" "yes"
check "broker hop present (crm.deal_closed amqp span)" "$([ "$(echo "$LOGS" | grep -ic 'crm.deal_closed')" -gt 0 ] && echo yes)" "yes"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
