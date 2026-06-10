#!/usr/bin/env bash
# Consumers/DLQ admin-endpoint e2e (Chunk 4.3): GET /admin/dlq lists the tenant's dead-lettered
# events (TENANT_ADMIN only, RLS-scoped); POST /admin/dlq/:id/requeue removes the entry.
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

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('dlqsa@acme.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='dlq-co');
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='dlq-co');
DELETE FROM tenants WHERE slug='dlq-co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','dlqsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3420; for p in 3420 3421 3422 3423; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/dlq-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

SA=$(login "dlqsa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"DLQ Co","adminEmail":"admin@dlqco.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$T1','dlqview@dlqco.test','$HASH',true,'{VIEWER}');
SQL
ADMIN=$(login "admin@dlqco.test"); VIEW=$(login "dlqview@dlqco.test")

# seed a dead-lettered event for this tenant (event_type in a real domain so requeue can republish)
EVID=$(ownerq "SELECT gen_random_uuid()")
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO dlq_event (tenant_id, consumer, event_id, event_type, payload, original_event, reason, attempts)
VALUES ('$T1','worker-finance','$EVID','finance.invoice_paid.v1','{}'::jsonb,
        json_build_object('id','$EVID','type','finance.invoice_paid.v1','tenantId','$T1','occurredAt','2026-06-10T00:00:00Z','payload', '{}'::jsonb)::jsonb,
        'handler exploded', 3);
SQL
echo "tenant DLQ Co=$T1; seeded dlq event"

echo "== admin DLQ visibility + RBAC =="
check "VIEWER GET /admin/dlq -> 403" "$(code "$B/admin/dlq" -H "Authorization: Bearer $VIEW")" "403"
LIST=$(curl -s "$B/admin/dlq" -H "Authorization: Bearer $ADMIN")
check "TENANT_ADMIN sees 1 dlq entry" "$(echo "$LIST" | jlen)" "1"
DLQID=$(echo "$LIST" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)

echo "== requeue removes the entry =="
check "POST /admin/dlq/:id/requeue -> 200" "$(code -XPOST "$B/admin/dlq/$DLQID/requeue" -H "Authorization: Bearer $ADMIN")" "200"
check "dlq now empty" "$(curl -s "$B/admin/dlq" -H "Authorization: Bearer $ADMIN" | jlen)" "0"
check "row gone in DB" "$(ownerq "SELECT count(*) FROM dlq_event WHERE id='$DLQID'")" "0"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
