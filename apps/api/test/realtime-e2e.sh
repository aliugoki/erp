#!/usr/bin/env bash
# Realtime e2e (Chunk 5.3): JWT-authenticated, tenant-scoped Socket.IO. Boots the API with the outbox
# relay on, provisions two tenants, creates a deal in tenant A, then runs a socket.io-client harness
# that asserts: unauthenticated socket rejected; authed sockets join their tenant room; closing the
# deal reaches tenant A's socket but never tenant B's. Socket assertions live in realtime-client.cjs.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email)='rtsa@acme.test';
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('rt-co','rt-two'));
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('rt-co','rt-two'));
DELETE FROM tenants WHERE slug IN ('rt-co','rt-two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','rtsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT OUTBOX_RELAY_ENABLED=true OUTBOX_POLL_INTERVAL_MS=500 \
  setsid node apps/api/dist/main.js >/tmp/realtime-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }

SA=$(login "rtsa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"RT Co","adminEmail":"admin@rt.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"RT Two","adminEmail":"admin@rttwo.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
A=$(login "admin@rt.test"); A2=$(login "admin@rttwo.test")
CLIENT=$(post "$A" crm/clients '{"companyName":"Realtime Buyer","status":"ACTIVE"}' | jget data.id)
DEAL=$(post "$A" crm/deals "{\"clientId\":\"$CLIENT\",\"title\":\"RT Deal\",\"valueMinor\":900000,\"stage\":\"NEGOTIATION\"}" | jget data.id)
echo "tenant RT Co=$T1 deal=$DEAL"

BASE="$B" TOKEN_A="$A" TOKEN_B="$A2" DEAL_ID="$DEAL" node apps/api/test/realtime-client.cjs
