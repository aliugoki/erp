#!/usr/bin/env bash
# Security hardening gate (Chunk 8.3): security headers (helmet), CORS locked to an allowlist, payload
# size limits (413), and a ROUTE AUDIT confirming every non-allowlisted route is guarded.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT CORS_ORIGINS="http://localhost:3001,https://app.metaxperts.test" MAX_BODY_SIZE=512kb \
  setsid node apps/api/dist/main.js >/tmp/security-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT

echo "== security headers (helmet) =="
H=$(curl -s -D - -o /dev/null "$B/health")
check "X-Content-Type-Options: nosniff" "$(echo "$H" | grep -ic '^x-content-type-options: nosniff')" "1"
check "X-Frame-Options present" "$(echo "$H" | grep -ic '^x-frame-options:')" "1"
check "Strict-Transport-Security present (HSTS)" "$(echo "$H" | grep -ic '^strict-transport-security:')" "1"
check "X-Powered-By removed" "$(echo "$H" | grep -ic '^x-powered-by:')" "0"

echo "== CORS locked to the allowlist =="
ALLOWED=$(curl -s -D - -o /dev/null -H "Origin: http://localhost:3001" "$B/health" | grep -i '^access-control-allow-origin:' | tr -d '\r' | awk '{print $2}')
check "allowed origin reflected" "$ALLOWED" "http://localhost:3001"
EVIL=$(curl -s -D - -o /dev/null -H "Origin: http://evil.example" "$B/health" | grep -i '^access-control-allow-origin:' | tr -d '\r' | awk '{print $2}')
check "disallowed origin NOT granted" "$([ "$EVIL" != "http://evil.example" ] && echo ok)" "ok"

echo "== payload size limit (413) =="
python3 -c "open('/tmp/sec-big.json','w').write('{\"x\":\"'+('a'*800000)+'\"}')"
check "oversize body (>512kb) -> 413" "$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$B/auth/login" -H 'Content-Type: application/json' --data-binary @/tmp/sec-big.json)" "413"
rm -f /tmp/sec-big.json

echo "== public allowlist reachable, business routes guarded =="
check "/health public (200)" "$(code "$B/health")" "200"
check "/metrics public (200)" "$(code "$B/metrics")" "200"
check "/me without token -> 401" "$(code "$B/me")" "401"
check "/crm/clients without token -> 401" "$(code "$B/crm/clients")" "401"

echo "== route audit: every non-allowlisted route requires auth =="
API_BASE="$B" node apps/api/test/route-audit.cjs
RC=$?
check "route audit passed" "$([ $RC -eq 0 ] && echo ok)" "ok"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
