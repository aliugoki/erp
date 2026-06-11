#!/usr/bin/env bash
# Idempotency-Key e2e (Chunk 7.2): the SAME unsafe POST with the same key twice produces ONE effect and
# an identical response (replayed); reusing the key for a different body → 422; no key → normal create.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d))" "$1" 2>/dev/null; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email)='idemsa@acme.test';
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='idem-co');
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='idem-co');
DELETE FROM tenants WHERE slug='idem-co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','idemsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/idempotency-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }

SA=$(login "idemsa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Idem Co","adminEmail":"admin@idem.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
A=$(login "admin@idem.test")
KEY="idem-key-0001"
INV1='{"number":"INV-IDEM-1","lineItems":[{"description":"Widget","quantity":2,"unitPriceMinor":5000}],"taxMinor":500}'
post_inv() { curl -s -D /tmp/idem-h.txt -XPOST "$B/finance/invoices" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' ${1:+-H "Idempotency-Key: $1"} -d "$2"; }

echo "== first request creates =="
R1=$(post_inv "$KEY" "$INV1")
ID1=$(echo "$R1" | jget data.id)
check "first POST -> 201" "$(grep -ic 'HTTP/1.1 201' /tmp/idem-h.txt)" "1"
check "invoice created (has id)" "$([ -n "$ID1" ] && echo ok)" "ok"

echo "== duplicate (same key, same body) replays — ONE effect, identical response =="
R2=$(post_inv "$KEY" "$INV1")
ID2=$(echo "$R2" | jget data.id)
check "duplicate returns the SAME invoice id" "$ID2" "$ID1"
check "identical response body" "$(python3 -c "import sys,json;print('identical' if json.loads(sys.argv[1])==json.loads(sys.argv[2]) else 'different')" "$R1" "$R2")" "identical"
check "Idempotency-Replayed header present" "$(grep -ic 'Idempotency-Replayed: true' /tmp/idem-h.txt)" "1"
check "exactly ONE INV-IDEM-1 invoice persisted" "$(ownerq "SELECT count(*) FROM finance_invoice WHERE tenant_id='$T1' AND number='INV-IDEM-1'")" "1"

echo "== same key, DIFFERENT body -> 422 =="
check "key reuse with different body -> 422" "$(code -XPOST "$B/finance/invoices" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -H "Idempotency-Key: $KEY" -d '{"number":"INV-IDEM-9","lineItems":[{"description":"Z","quantity":1,"unitPriceMinor":1}],"taxMinor":0}')" "422"

echo "== no key -> normal create (not idempotent) =="
NK='{"number":"INV-IDEM-3","lineItems":[{"description":"Y","quantity":1,"unitPriceMinor":1000}],"taxMinor":0}'
check "POST without key -> 201" "$(code -XPOST "$B/finance/invoices" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "$NK")" "201"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
