#!/usr/bin/env bash
# Fixed-assets e2e: category → asset → activate → depreciation run (straight-line) → verify accumulated
# + net book value → idempotent re-run (422) → disposal gain/loss → maintenance. Exercises the asset
# lifecycle + the per-(asset,period) idempotency the unit tests can't.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PLATFORM="11111111-1111-1111-1111-111111111111"
PW1=Password; PW2='123!'; PASSWORD="$PW1$PW2"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d))" "$1" 2>/dev/null; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('assetsa@acme.test','admin@asset.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE name='Asset Co');
DELETE FROM tenants WHERE name='Asset Co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','assetsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3430; for p in 3430 3431 3432 3433; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/assets-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

SA=$(login "assetsa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Asset Co\",\"adminEmail\":\"admin@asset.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
A=$(login "admin@asset.test")
echo "tenant=$T"

echo "== category + asset (cost 1,200,000, straight-line 12 mo, 0 salvage) =="
CAT=$(post "$A" assets/categories '{"name":"Machinery","method":"STRAIGHT_LINE","usefulLifeMonths":12,"salvagePct":0}' | jget data.id)
AID=$(post "$A" assets "{\"name\":\"CNC Mill\",\"categoryId\":\"$CAT\",\"acquisitionDate\":\"2026-06-01\",\"acquisitionCostMinor\":1200000}" | jget data.id)
check "asset DRAFT" "$(curl -s "$B/assets/$AID" -H "Authorization: Bearer $A" | jget data.status)" "DRAFT"
check "activate -> ACTIVE" "$(code -XPOST "$B/assets/$AID/activate" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{}')" "200"

echo "== depreciation run for 2026-06-30 (1/12 = 100,000) =="
RUN=$(post "$A" assets/depreciation/run '{"period":"2026-06-30"}')
check "run: 1 asset" "$(echo "$RUN" | jget data.assetCount)" "1"
check "run total 100000" "$(echo "$RUN" | jget data.total.amountMinor)" "100000"
AST=$(curl -s "$B/assets/$AID" -H "Authorization: Bearer $A")
check "accumulated 100000" "$(echo "$AST" | jget data.accumulatedDepreciation.amountMinor)" "100000"
check "net book value 1,100,000" "$(echo "$AST" | jget data.bookValue.amountMinor)" "1100000"
check "one depreciation entry" "$(ownerq "SELECT count(*) FROM asset_depreciation WHERE asset_id='$AID'")" "1"

echo "== idempotency: re-running the same period is rejected (422) =="
check "re-run same period -> 422" "$(code -XPOST "$B/assets/depreciation/run" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"period":"2026-06-30"}')" "422"

echo "== disposal: proceeds 1,150,000 vs book value 1,100,000 -> gain 50,000 =="
DISP=$(post "$A" "assets/$AID/dispose" '{"proceedsMinor":1150000,"disposalDate":"2026-06-30"}')
check "asset DISPOSED" "$(echo "$DISP" | jget data.status)" "DISPOSED"
check "disposal gain 50000" "$(echo "$DISP" | jget data.disposalGain.amountMinor)" "50000"

echo "== maintenance log =="
MNT=$(post "$A" assets/maintenance "{\"assetId\":\"$AID\",\"type\":\"SERVICE\",\"description\":\"Annual service\",\"costMinor\":25000,\"nextDueDate\":\"2027-06-01\"}")
check "maintenance logged" "$(echo "$MNT" | jget data.type)" "SERVICE"
check "upcoming-due lookup returns it" "$(curl -s "$B/assets/maintenance/upcoming?days=100000" -H "Authorization: Bearer $A" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))" 2>/dev/null)" "1"

echo; echo "Assets e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
