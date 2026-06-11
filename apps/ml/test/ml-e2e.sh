#!/usr/bin/env bash
# ML service gate (Chunk 6.1): build the image reproducibly, run it, and verify /health is public while
# /ml/ping requires the API's signed service token. The token is signed on the host with the SAME
# SERVICE_AUTH_SECRET the container runs with, proving the API↔ML auth contract (ADR-006).
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env 2>/dev/null; set +a
SECRET="${SERVICE_AUTH_SECRET:-dev-service-secret-change-me}"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }

echo "== docker build (reproducible, hard-pinned deps) =="
if ! docker build -q -t metaxperts-ml apps/ml >/tmp/ml-build.out 2>&1; then
  echo "  ❌ docker build failed"; tail -20 /tmp/ml-build.out; exit 1
fi
echo "  ✅ image built"

PORT=8000; for p in 8000 8010 8011 8012; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
CID=$(docker run -d --rm -e SERVICE_AUTH_SECRET="$SECRET" -p "$PORT:8000" metaxperts-ml)
cleanup() { docker stop "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
B="http://127.0.0.1:$PORT"
for i in $(seq 1 30); do curl -fsS "$B/health" >/dev/null 2>&1 && break || sleep 0.4; done

echo "== endpoints =="
check "GET /health -> 200 (public)" "$(curl -s -o /dev/null -w '%{http_code}' "$B/health")" "200"
check "health body status ok" "$(curl -s "$B/health" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])' 2>/dev/null)" "ok"
check "GET /ml/ping no token -> 401" "$(curl -s -o /dev/null -w '%{http_code}' "$B/ml/ping")" "401"

BAD=$(cd apps/api && node -e "const j=require('jsonwebtoken');process.stdout.write(j.sign({svc:'api'}, 'wrong-secret', {audience:'internal',issuer:'metaxperts-api',expiresIn:'5m'}))")
check "GET /ml/ping bad signature -> 401" "$(curl -s -o /dev/null -w '%{http_code}' -H "x-service-token: $BAD" "$B/ml/ping")" "401"

TOK=$(cd apps/api && S="$SECRET" node -e "const j=require('jsonwebtoken');process.stdout.write(j.sign({svc:'api'}, process.env.S, {audience:'internal',issuer:'metaxperts-api',expiresIn:'5m'}))")
check "GET /ml/ping valid token -> 200" "$(curl -s -o /dev/null -w '%{http_code}' -H "x-service-token: $TOK" "$B/ml/ping")" "200"
check "ping caller == api" "$(curl -s -H "x-service-token: $TOK" "$B/ml/ping" | python3 -c 'import sys,json;print(json.load(sys.stdin)["caller"])' 2>/dev/null)" "api"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
