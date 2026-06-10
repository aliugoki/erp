#!/usr/bin/env bash
# Audit + service-to-service auth e2e (Chunk 2.4).
#  - a mutation writes an audit row with correct before/after (and secrets redacted)
#  - internal endpoints require a valid service token (else 401)
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"
PASSWORD="Password123!"
TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
# clean prior + seed
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('auditadmin@acme.test','audittarget@acme.test','superadmin@acme.test','admin@auditco.test');
DELETE FROM tenants WHERE slug='auditco';
DELETE FROM audit_log WHERE tenant_id='$TENANT_A';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES
 ('$TENANT_A','auditadmin@acme.test','$HASH',true,'{TENANT_ADMIN}'),
 ('$TENANT_A','audittarget@acme.test','$HASH',true,'{VIEWER}'),
 ('$TENANT_A','superadmin@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL
TARGET_ID="$(ownerq "SELECT id FROM users WHERE email='audittarget@acme.test'")"
echo "seeded users; target=$TARGET_ID"

PORT=3350; for p in 3350 3351 3352 3353; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/audit-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

ADMIN=$(login "auditadmin@acme.test"); SA=$(login "superadmin@acme.test")
ADMIN_ID="$(ownerq "SELECT id FROM users WHERE email='auditadmin@acme.test'")"

echo "== explicit before/after audit: deactivate a user =="
check "PATCH /users/:id/active -> 200" \
  "$(code -X PATCH "$B/users/$TARGET_ID/active" -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"isActive":false}')" "200"
ROW="$(ownerq "SELECT action||'|'||resource||'|'||coalesce(resource_id,'')||'|'||(old_value->>'isActive')||'|'||(new_value->>'isActive')||'|'||coalesce(user_id::text,'') FROM audit_log WHERE action='USER_SET_ACTIVE' AND resource_id='$TARGET_ID' ORDER BY created_at DESC LIMIT 1")"
echo "  audit row: $ROW"
check "audit action/old/new correct" "$ROW" "USER_SET_ACTIVE|users|$TARGET_ID|true|false|$ADMIN_ID"

echo "== generic auto-audit + secret redaction: SUPER_ADMIN provisions a tenant =="
code -X POST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' \
  -d '{"name":"AuditCo","adminEmail":"admin@auditco.test","adminPassword":"Password123!"}' >/dev/null
REDACTED="$(ownerq "SELECT new_value->>'adminPassword' FROM audit_log WHERE action='POST' AND resource LIKE '%tenants%' ORDER BY created_at DESC LIMIT 1")"
check "provisioning audited with password REDACTED" "$REDACTED" "[REDACTED]"

echo "== service-to-service auth on internal endpoint =="
check "GET /internal/ping no service token -> 401" "$(code "$B/internal/ping")" "401"
check "GET /internal/ping bad service token -> 401" "$(code "$B/internal/ping" -H 'x-service-token: garbage')" "401"
SVC="$(cd apps/api && node -e "const jwt=require('jsonwebtoken');process.stdout.write(jwt.sign({svc:'test'},process.env.SERVICE_AUTH_SECRET,{audience:'internal',issuer:'metaxperts-api',expiresIn:'5m'}))")"
check "GET /internal/ping valid service token -> 200" "$(code "$B/internal/ping" -H "x-service-token: $SVC")" "200"
# a normal user bearer token must NOT satisfy service auth
check "GET /internal/ping with user token -> 401" "$(code "$B/internal/ping" -H "Authorization: Bearer $ADMIN")" "401"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
