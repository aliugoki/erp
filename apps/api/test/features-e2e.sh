#!/usr/bin/env bash
# Feature entitlements e2e (Chunk 2.5, ADR-009).
# Provision a tenant on the 'starter' plan, confirm a feature-gated route is blocked, enable the
# feature and confirm access, verify the toggle is audited and that non-admins can't toggle.
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
# is a given module key enabled in a GET /tenant/features response (reads stdin JSON)
modEnabled() { python3 -c "import sys,json
d=json.load(sys.stdin)['data']
m=[x for x in d if x['key']==sys.argv[1]]
print(str(m[0]['enabled']).lower() if m else 'missing')" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('featsa@acme.test','admin@feattest.test','viewer@feattest.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='featuretest-co');
DELETE FROM tenants WHERE slug='featuretest-co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','featsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL
echo "seeded super admin"

PORT=3360; for p in 3360 3361 3362 3363; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/feat-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

SA=$(login "featsa@acme.test")
echo "== provision a tenant on the 'starter' plan =="
PROV=$(curl -s -X POST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' \
  -d '{"name":"FeatureTest Co","adminEmail":"admin@feattest.test","adminPassword":"Password123!","plan":"starter"}')
FT_TENANT=$(echo "$PROV" | jget data.tenant.id)
[ -n "$FT_TENANT" ] && echo "  ✅ provisioned tenant=$FT_TENANT" && pass=$((pass+1)) || { echo "  ❌ provision failed: $PROV"; fail=$((fail+1)); }
# seed a viewer in the new tenant (no user-create endpoint yet)
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$FT_TENANT','viewer@feattest.test','$HASH',true,'{VIEWER}');
SQL
FT=$(login "admin@feattest.test"); VW=$(login "viewer@feattest.test")

echo "== plan applied: starter has HR, not reporting/finance =="
FEATS=$(curl -s "$B/tenant/features" -H "Authorization: Bearer $FT")
check "hr enabled" "$(echo "$FEATS" | modEnabled hr)" "true"
check "reporting disabled" "$(echo "$FEATS" | modEnabled reporting)" "false"
check "finance disabled" "$(echo "$FEATS" | modEnabled finance)" "false"

echo "== feature-gated route blocked when disabled =="
check "probe/reporting -> 403 (disabled)" "$(code "$B/tenant/features/probe/reporting" -H "Authorization: Bearer $FT")" "403"

echo "== enable reporting, then route allowed =="
check "PATCH reporting enabled -> 200" \
  "$(code -X PATCH "$B/tenant/features/reporting" -H "Authorization: Bearer $FT" -H 'Content-Type: application/json' -d '{"enabled":true}')" "200"
check "probe/reporting -> 200 (enabled)" "$(code "$B/tenant/features/probe/reporting" -H "Authorization: Bearer $FT")" "200"
check "catalog now shows reporting enabled" "$(curl -s "$B/tenant/features" -H "Authorization: Bearer $FT" | modEnabled reporting)" "true"

echo "== toggle is audited =="
AUD=$(ownerq "SELECT (new_value->>'enabled') FROM audit_log WHERE tenant_id='$FT_TENANT' AND action='FEATURE_TOGGLE' AND resource_id='reporting' ORDER BY created_at DESC LIMIT 1")
check "FEATURE_TOGGLE audit row" "$AUD" "true"

echo "== disable again =="
code -X PATCH "$B/tenant/features/reporting" -H "Authorization: Bearer $FT" -H 'Content-Type: application/json' -d '{"enabled":false}' >/dev/null
check "probe/reporting -> 403 after disable" "$(code "$B/tenant/features/probe/reporting" -H "Authorization: Bearer $FT")" "403"

echo "== only admins can toggle =="
check "VIEWER PATCH -> 403" \
  "$(code -X PATCH "$B/tenant/features/reporting" -H "Authorization: Bearer $VW" -H 'Content-Type: application/json' -d '{"enabled":true}')" "403"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
