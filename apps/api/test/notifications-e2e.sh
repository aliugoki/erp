#!/usr/bin/env bash
# Notifications e2e (Chunk 5.1): the FULL pipeline — close a deal -> crm.deal_closed to the outbox ->
# OutboxRelay publishes to RabbitMQ -> notifications consumer creates an in-app notification for the
# ASSIGNEE -> the assignee reads it over HTTP and marks it read. Plus auth + tenant-isolation checks.
# Boots its own API with the relay + notifications consumer enabled (email disabled -> in-app only,
# so no SMTP server is needed: graceful degradation by configuration).
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }
jlen() { python3 -c "import sys,json
d=json.load(sys.stdin); d=d.get('data',d) if isinstance(d,dict) else d
print(len(d) if isinstance(d,list) else 0)" 2>/dev/null; }
first() { python3 -c "import sys,json
d=json.load(sys.stdin); d=d.get('data',d) if isinstance(d,dict) else d
print(d[0][sys.argv[1]] if isinstance(d,list) and d else '')" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
# Clean any prior run, seed a platform SUPER_ADMIN in tenant A to provision with.
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('notifysa@acme.test','notifyrep@nco.test');
DELETE FROM notification WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('notify-co','notify-two'));
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('notify-co','notify-two'));
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('notify-co','notify-two'));
DELETE FROM tenants WHERE slug IN ('notify-co','notify-two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','notifysa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

# Purge any stray crm.deal_closed.v1 messages other suites (e.g. eventbus.spec) published to the
# durable crm exchange and captured by this consumer's durable queue — keeps the run deterministic.
docker compose -f infra/docker-compose.yml exec -T rabbitmq rabbitmqctl purge_queue c.notify-deal-closed >/dev/null 2>&1 || true

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
# Enable the relay + notifications consumer; fast poll so the pipeline completes quickly. Email off.
API_PORT=$PORT OUTBOX_RELAY_ENABLED=true OUTBOX_POLL_INTERVAL_MS=500 NOTIFICATIONS_ENABLED=true \
  setsid node apps/api/dist/main.js >/tmp/notifications-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }

SA=$(login "notifysa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Notify Co","adminEmail":"admin@notify.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Notify Two","adminEmail":"admin@notifytwo.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
# A sales rep in tenant 1 — the deal assignee / notification recipient.
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$T1','notifyrep@nco.test','$HASH',true,'{SALES_REP}');
SQL
REP_ID=$(ownerq "SELECT id FROM users WHERE lower(email)='notifyrep@nco.test'")
REP=$(login "notifyrep@nco.test"); ADMIN2=$(login "admin@notifytwo.test")
echo "tenant Notify Co=$T1 rep=$REP_ID"

echo "== auth required =="
check "GET /notifications unauthenticated -> 401" "$(code "$B/notifications")" "401"
check "GET /notifications (rep) -> 200" "$(code "$B/notifications" -H "Authorization: Bearer $REP")" "200"
check "rep feed starts empty" "$(curl -s "$B/notifications" -H "Authorization: Bearer $REP" | jlen)" "0"

echo "== close a deal assigned to the rep =="
CLIENT=$(post "$REP" crm/clients '{"companyName":"Big Buyer","status":"ACTIVE"}' | jget data.id)
DEAL=$(post "$REP" crm/deals "{\"clientId\":\"$CLIENT\",\"title\":\"Mega Deal\",\"valueMinor\":2500000,\"stage\":\"NEGOTIATION\",\"assignedTo\":\"$REP_ID\"}" | jget data.id)
check "deal created assigned to rep" "$([ -n "$DEAL" ] && echo ok)" "ok"
check "move deal -> CLOSED_WON -> 200" "$(code -XPATCH "$B/crm/deals/$DEAL/stage" -H "Authorization: Bearer $REP" -H 'Content-Type: application/json' -d '{"stage":"CLOSED_WON"}')" "200"

echo "== pipeline: outbox -> relay -> RabbitMQ -> notifications consumer =="
N=0
for i in $(seq 1 40); do
  N=$(curl -s "$B/notifications" -H "Authorization: Bearer $REP" | jlen)
  [ "$N" = "1" ] && break || sleep 0.5
done
check "assignee received exactly one in-app notification" "$N" "1"
FEED=$(curl -s "$B/notifications" -H "Authorization: Bearer $REP")
check "notification type is crm.deal_won" "$(echo "$FEED" | first type)" "crm.deal_won"
check "notification title names the deal" "$(echo "$FEED" | first title)" "Deal won: Mega Deal"
NID=$(echo "$FEED" | first id)

echo "== mark read =="
check "POST /notifications/:id/read -> 200" "$(code -XPOST "$B/notifications/$NID/read" -H "Authorization: Bearer $REP")" "200"
check "feed empty after read" "$(curl -s "$B/notifications" -H "Authorization: Bearer $REP" | jlen)" "0"
check "POST read unknown id -> 404" "$(code -XPOST "$B/notifications/99999999-9999-9999-9999-999999999999/read" -H "Authorization: Bearer $REP")" "404"

echo "== tenant isolation =="
check "other tenant admin sees no notifications" "$(curl -s "$B/notifications" -H "Authorization: Bearer $ADMIN2" | jlen)" "0"
check "exactly one notification row persisted for tenant 1" "$(ownerq "SELECT count(*) FROM notification WHERE tenant_id='$T1'")" "1"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
