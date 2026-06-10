#!/usr/bin/env bash
# Finance module e2e (Chunk 3.2): feature/role gates, double-entry balance invariant, money-as-int,
# invoices + filters, and the transactional-outbox write on invoice payment.
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
jlen() { python3 -c "import sys,json;print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('finsa@acme.test','finmgr@finco.test','finview@finco.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('fin-co','fin-two'));
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('fin-co','fin-two'));
DELETE FROM tenants WHERE slug IN ('fin-co','fin-two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','finsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3380; for p in 3380 3381 3382 3383; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/fin-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }

SA=$(login "finsa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Fin Co","adminEmail":"admin@finco.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Fin Two","adminEmail":"admin@fintwo.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES
 ('$T1','finmgr@finco.test','$HASH',true,'{FINANCE_MANAGER}'),
 ('$T1','finview@finco.test','$HASH',true,'{VIEWER}');
SQL
MGR=$(login "finmgr@finco.test"); VIEW=$(login "finview@finco.test"); ADMIN2=$(login "admin@fintwo.test")
echo "tenant Fin Co=$T1"

echo "== feature + role gates =="
check "GET /finance/accounts -> 200" "$(code "$B/finance/accounts" -H "Authorization: Bearer $MGR")" "200"
check "VIEWER POST account -> 403" "$(code -XPOST "$B/finance/accounts" -H "Authorization: Bearer $VIEW" -H 'Content-Type: application/json' -d '{"code":"X","name":"X","type":"ASSET"}')" "403"

echo "== chart of accounts =="
CASH=$(post "$MGR" finance/accounts '{"code":"1000","name":"Cash","type":"ASSET"}' | jget data.id)
REV=$(post "$MGR" finance/accounts '{"code":"4000","name":"Revenue","type":"REVENUE"}' | jget data.id)
[ -n "$CASH" ] && [ -n "$REV" ] && echo "  ✅ accounts created" && pass=$((pass+1)) || { echo "  ❌ account create failed"; fail=$((fail+1)); }

echo "== double-entry: balanced accepted, unbalanced + float rejected =="
check "balanced txn -> 201" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"description\":\"Sale\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100000},{\"accountId\":\"$REV\",\"creditMinor\":100000}]}")" "201"
check "UNBALANCED txn -> 422" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"description\":\"Bad\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100000},{\"accountId\":\"$REV\",\"creditMinor\":90000}]}")" "422"
check "FLOAT amount -> 400 (money is integer only)" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"description\":\"Float\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100.5},{\"accountId\":\"$REV\",\"creditMinor\":100.5}]}")" "400"

echo "== invoices: totals (Money), filter, then pay -> outbox =="
INV=$(post "$MGR" finance/invoices '{"number":"INV-001","lineItems":[{"description":"Consulting","quantity":3,"unitPriceMinor":50000}],"taxMinor":20000}')
INVID=$(echo "$INV" | jget data.id)
check "invoice total == subtotal+tax (170000)" "$(echo "$INV" | jget data.total.amountMinor)" "170000"
check "invoice subtotal == 150000" "$(echo "$INV" | jget data.subtotal.amountMinor)" "150000"
check "list ?status=DRAFT -> 1" "$(curl -s "$B/finance/invoices?status=DRAFT" -H "Authorization: Bearer $MGR" | jlen)" "1"
check "pay invoice -> 200" "$(code -XPATCH "$B/finance/invoices/$INVID/pay" -H "Authorization: Bearer $MGR")" "200"
OUTBOX=$(ownerq "SELECT type FROM outbox_event WHERE tenant_id='$T1' AND type='finance.invoice_paid.v1' AND published_at IS NULL ORDER BY occurred_at DESC LIMIT 1")
check "finance.invoice_paid written to OUTBOX (pending)" "$OUTBOX" "finance.invoice_paid.v1"
check "invoice now PAID" "$(curl -s "$B/finance/invoices/$INVID" -H "Authorization: Bearer $MGR" | jget data.status)" "PAID"

echo "== tenant isolation =="
check "Fin Two sees no invoices" "$(curl -s "$B/finance/invoices" -H "Authorization: Bearer $ADMIN2" | jlen)" "0"
check "Fin Two GET Fin Co invoice -> 404" "$(code "$B/finance/invoices/$INVID" -H "Authorization: Bearer $ADMIN2")" "404"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
