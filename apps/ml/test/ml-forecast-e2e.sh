#!/usr/bin/env bash
# Demand-forecast gate (Chunk 6.2): build the image, seed ~30 days of OUT movements, run the refresh
# (fit + store), then verify the served-from-cache forecast (correct shape, p95 < 200ms) and the
# on-demand fallback for an un-precomputed product. Service-auth enforced throughout. The container
# runs with --network host so it reaches the host Postgres (owner URL; ML scopes by explicit tenant).
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env 2>/dev/null; set +a
SECRET="${SERVICE_AUTH_SECRET:-dev-service-secret-change-me}"
DBURL="${MIGRATION_DATABASE_URL}"
T="fcfcfcfc-fcfc-fcfc-fcfc-fcfcfcfcfcfc"   # test tenant

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json;print(json.load(sys.stdin).get(sys.argv[1],''))" "$1" 2>/dev/null; }
jlen() { python3 -c "import sys,json;print(len(json.load(sys.stdin).get(sys.argv[1],[])))" "$1" 2>/dev/null; }

echo "== docker build (heavy deps: numpy/pandas/statsmodels) =="
docker build -q -t metaxperts-ml apps/ml >/tmp/ml-fc-build.out 2>&1 || { echo "  ❌ build failed"; tail -20 /tmp/ml-fc-build.out; exit 1; }
echo "  ✅ image built"

echo "== seed 30 days of OUT demand for a product =="
# Product + movements in ONE statement (CTE) so there's no fragile shell round-trip for the product id.
psql "$DBURL" -q <<SQL >/dev/null
DELETE FROM ml_demand_forecast WHERE tenant_id='$T';
DELETE FROM inventory_stock_movement WHERE tenant_id='$T';
DELETE FROM inventory_product WHERE tenant_id='$T';
WITH p AS (
  INSERT INTO inventory_product (tenant_id, sku, name, unit, cost_price_minor, sell_price_minor, currency, min_stock, on_hand)
  VALUES ('$T','FC-1','Forecast Widget','ea',5000,9000,'PKR',5,1000) RETURNING id
)
INSERT INTO inventory_stock_movement (tenant_id, product_id, type, quantity, created_at)
SELECT '$T', p.id, 'OUT', (3 + (g % 5)), now() - ((30-g) || ' days')::interval
FROM p, generate_series(1,30) g;
SQL
PID=$(psql "$DBURL" -tAc "SELECT id FROM inventory_product WHERE tenant_id='$T' AND sku='FC-1'")
MOVES=$(psql "$DBURL" -tAc "SELECT count(*) FROM inventory_stock_movement WHERE tenant_id='$T' AND product_id='$PID' AND type='OUT'")
check "30 OUT movements seeded" "$MOVES" "30"

PORT=8055; for p in 8055 8056 8057 8058; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
CID=$(docker run -d --rm --network host -e ML_PORT="$PORT" -e SERVICE_AUTH_SECRET="$SECRET" -e ML_DATABASE_URL="$DBURL" metaxperts-ml)
cleanup() { docker stop "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
B="http://127.0.0.1:$PORT"
for i in $(seq 1 40); do curl -fsS "$B/health" >/dev/null 2>&1 && break || sleep 0.4; done
TOK=$(cd apps/api && S="$SECRET" node -e "const j=require('jsonwebtoken');process.stdout.write(j.sign({svc:'api'}, process.env.S, {audience:'internal',issuer:'metaxperts-api',expiresIn:'5m'}))")
sauth=(-H "x-service-token: $TOK" -H 'Content-Type: application/json')

echo "== auth =="
check "forecast without token -> 401" "$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$B/ml/forecast/demand" -H 'Content-Type: application/json' -d "{\"tenantId\":\"$T\",\"productId\":\"$PID\"}")" "401"

echo "== refresh (fit + store) =="
REFRESHED=$(curl -s -XPOST "$B/ml/forecast/refresh" "${sauth[@]}" | jget refreshed)
check "refresh fitted >= 1 series" "$([ "${REFRESHED:-0}" -ge 1 ] && echo ok)" "ok"

echo "== served from cache (precomputed) =="
RESP=$(curl -s -XPOST "$B/ml/forecast/demand" "${sauth[@]}" -d "{\"tenantId\":\"$T\",\"productId\":\"$PID\",\"horizon\":7}")
check "source == cache" "$(echo "$RESP" | jget source)" "cache"
check "predicted length == horizon 7" "$(echo "$RESP" | jlen predicted)" "7"
check "dates length == 7" "$(echo "$RESP" | jlen dates)" "7"
check "lower length == 7" "$(echo "$RESP" | jlen lower)" "7"
check "history points == 30" "$(echo "$RESP" | jget historyPoints)" "30"

echo "== p95 of cached serve < 200ms =="
TIMES=""
for i in $(seq 1 12); do
  T1=$(curl -s -o /dev/null -w '%{time_total}' -XPOST "$B/ml/forecast/demand" "${sauth[@]}" -d "{\"tenantId\":\"$T\",\"productId\":\"$PID\",\"horizon\":7}")
  TIMES="$TIMES $T1"
done
P95=$(python3 -c "import sys;xs=sorted(float(x) for x in sys.argv[1].split());print('%.3f'%xs[int(len(xs)*0.95)-1])" "$TIMES")
check "cached serve p95 < 0.200s ($P95)" "$(python3 -c "print('ok' if float('$P95')<0.2 else 'slow')")" "ok"

echo "== on-demand fallback for un-precomputed product =="
ND=$(curl -s -XPOST "$B/ml/forecast/demand" "${sauth[@]}" -d "{\"tenantId\":\"$T\",\"productId\":\"abababab-abab-abab-abab-abababababab\",\"horizon\":5}")
check "source == on-demand" "$(echo "$ND" | jget source)" "on-demand"
check "on-demand predicted length == 5" "$(echo "$ND" | jlen predicted)" "5"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
