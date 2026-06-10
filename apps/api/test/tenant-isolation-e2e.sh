#!/usr/bin/env bash
# Tenant provisioning + cross-tenant isolation e2e (Chunk 2.3).
# SUPER_ADMIN provisions a new tenant via the API; an admin of tenant A then cannot read tenant B's
# data (RLS → 404), and provisioning is SUPER_ADMIN-only.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"
PASSWORD="Password123!"
TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
seed() { psql "$OWNER_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
DELETE FROM users WHERE lower(email) = lower('$1');
INSERT INTO users (tenant_id, email, password_hash, is_active, roles) VALUES ('$TENANT_A','$1','$HASH',true,'$2');
SQL
}
# clean any prior globex tenant/users so the run is idempotent
psql "$OWNER_URL" -q >/dev/null 2>&1 <<'SQL'
DELETE FROM users WHERE lower(email) = lower('admin@globex.test');
DELETE FROM tenants WHERE slug = 'globex-inc';
SQL
seed "superadmin@acme.test" "{SUPER_ADMIN}"
seed "acmeadmin@acme.test"  "{TENANT_ADMIN}"
echo "seeded super admin + acme admin"

PORT=3340; for p in 3340 3341 3342 3343; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/tenant-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

SA=$(login "superadmin@acme.test"); ACME=$(login "acmeadmin@acme.test")
[ -n "$SA" ] && [ -n "$ACME" ] && echo "  logged in super-admin + acme-admin" || { echo "  ❌ login failed"; fail=$((fail+1)); }

echo "== provisioning is SUPER_ADMIN-only =="
check "acme admin POST /tenants -> 403" \
  "$(code -X POST "$B/tenants" -H "Authorization: Bearer $ACME" -H 'Content-Type: application/json' -d '{"name":"Nope","adminEmail":"x@y.test","adminPassword":"Password123!"}')" "403"

echo "== SUPER_ADMIN provisions tenant 'Globex' =="
PROV=$(curl -s -X POST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' \
  -d '{"name":"Globex Inc","adminEmail":"admin@globex.test","adminPassword":"Password123!"}')
GTENANT=$(echo "$PROV" | jget data.tenant.id); GADMIN=$(echo "$PROV" | jget data.admin.id)
[ -n "$GTENANT" ] && [ -n "$GADMIN" ] && echo "  ✅ created tenant=$GTENANT admin=$GADMIN" && pass=$((pass+1)) || { echo "  ❌ provision failed: $PROV"; fail=$((fail+1)); }
check "GET /tenants/:id as SA -> 200" "$(code "$B/tenants/$GTENANT" -H "Authorization: Bearer $SA")" "200"

echo "== newly provisioned globex admin can log in =="
GLOGIN=$(login "admin@globex.test")
[ -n "$GLOGIN" ] && echo "  ✅ globex admin logged in" && pass=$((pass+1)) || { echo "  ❌ globex admin cannot log in"; fail=$((fail+1)); }

echo "== CROSS-TENANT ISOLATION =="
# acme admin reading the globex admin user id -> RLS hides it -> 404
check "acme admin GET /users/<globex-user> -> 404" \
  "$(code "$B/users/$GADMIN" -H "Authorization: Bearer $ACME")" "404"
# acme admin reading their own user id -> 200
ACME_ID=$(curl -s "$B/me" -H "Authorization: Bearer $ACME" | jget data.userId)
check "acme admin GET /users/<own id> -> 200" \
  "$(code "$B/users/$ACME_ID" -H "Authorization: Bearer $ACME")" "200"
# globex admin reading their own id -> 200 (proves they see their own tenant)
check "globex admin GET /users/<self> -> 200" \
  "$(code "$B/users/$GADMIN" -H "Authorization: Bearer $GLOGIN")" "200"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
