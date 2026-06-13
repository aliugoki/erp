#!/usr/bin/env bash
# Accounting e2e: hierarchical chart of accounts (group vs leaf), journal list, general ledger,
# trial balance, and the balance-sheet / income-statement read models. Boots dist/main.js against
# the dev infra DB on a spare port (needs `pnpm --filter @app/api build` + the COA-hierarchy
# migration applied first).
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PW="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
v=functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d)
print('' if v is None else v)" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PW")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('acctsa@acme.test','acctmgr@acct.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='acct-co');
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='acct-co');
DELETE FROM tenants WHERE slug='acct-co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','acctsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3390; for p in 3390 3391 3392 3393; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/acct-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PW\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
get() { curl -s "$B/$2" -H "Authorization: Bearer $1"; }

SA=$(login "acctsa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Acct Co\",\"adminEmail\":\"admin@acct.test\",\"adminPassword\":\"$PW\",\"plan\":\"business\"}" | jget data.tenant.id)
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$T1','acctmgr@acct.test','$HASH',true,'{FINANCE_MANAGER}');
SQL
MGR=$(login "acctmgr@acct.test")
echo "tenant Acct Co=$T1"

echo "== hierarchical chart of accounts =="
ASSETS=$(post "$MGR" finance/accounts '{"code":"1","name":"Assets","type":"ASSET","isGroup":true}' | jget data.id)
[ -n "$ASSETS" ] && echo "  ✅ group account created" && pass=$((pass+1)) || { echo "  ❌ group create failed"; fail=$((fail+1)); }
CASH=$(post "$MGR" finance/accounts "{\"code\":\"1000\",\"name\":\"Cash\",\"type\":\"ASSET\",\"parentId\":\"$ASSETS\"}" | jget data.id)
check "child account level = 2" "$(get "$MGR" finance/accounts | python3 -c "import sys,json;print(next(a['level'] for a in json.load(sys.stdin)['data'] if a['code']=='1000'))")" "2"
check "child under a NON-group parent -> 422" "$(code -XPOST "$B/finance/accounts" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"code\":\"1001\",\"name\":\"Petty\",\"type\":\"ASSET\",\"parentId\":\"$CASH\"}")" "422"

REV=$(post "$MGR" finance/accounts '{"code":"4000","name":"Sales Revenue","type":"REVENUE"}' | jget data.id)
RENT=$(post "$MGR" finance/accounts '{"code":"5000","name":"Rent Expense","type":"EXPENSE"}' | jget data.id)

echo "== posting rules: cannot post to a group account =="
check "post to GROUP account -> 422" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"description\":\"bad\",\"entries\":[{\"accountId\":\"$ASSETS\",\"debitMinor\":1000},{\"accountId\":\"$REV\",\"creditMinor\":1000}]}")" "422"

echo "== journal entries =="
check "Dr Cash / Cr Revenue 100000 -> 201" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"description\":\"Cash sale\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100000},{\"accountId\":\"$REV\",\"creditMinor\":100000}]}")" "201"
check "Dr Rent / Cr Cash 30000 -> 201" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"description\":\"Pay rent\",\"entries\":[{\"accountId\":\"$RENT\",\"debitMinor\":30000},{\"accountId\":\"$CASH\",\"creditMinor\":30000}]}")" "201"
check "GET /finance/transactions lists 2" "$(get "$MGR" finance/transactions | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "2"

echo "== general ledger (Cash) =="
check "Cash ledger closing = 70000 (100000 in - 30000 out)" "$(get "$MGR" "finance/ledger/$CASH" | jget data.closing.amountMinor)" "70000"

echo "== trial balance =="
check "trial balance is balanced" "$(get "$MGR" finance/trial-balance | jget data.balanced)" "True"
check "trial debit total == credit total" "$(get "$MGR" finance/trial-balance | jget data.totals.debitMinor)" "$(get "$MGR" finance/trial-balance | jget data.totals.creditMinor)"

echo "== income statement =="
check "income net = 70000 (rev 100000 - exp 30000)" "$(get "$MGR" finance/statements/income | jget data.netIncomeMinor)" "70000"
check "income revenue total = 100000" "$(get "$MGR" finance/statements/income | jget data.revenue.totalMinor)" "100000"

echo "== balance sheet =="
check "balance sheet balances (A = L + E + NI)" "$(get "$MGR" finance/statements/balance-sheet | jget data.balanced)" "True"
check "total assets = 70000" "$(get "$MGR" finance/statements/balance-sheet | jget data.totals.assetsMinor)" "70000"

echo "== 4-level chart of accounts cap + type inheritance =="
G1=$(post "$MGR" finance/accounts '{"code":"9","name":"Head","type":"ASSET","isGroup":true}' | jget data.id)
G2=$(post "$MGR" finance/accounts "{\"code\":\"9-1\",\"name\":\"Control\",\"parentId\":\"$G1\",\"isGroup\":true}" | jget data.id)
G3=$(post "$MGR" finance/accounts "{\"code\":\"9-1-1\",\"name\":\"Subsidiary\",\"parentId\":\"$G2\",\"isGroup\":true}" | jget data.id)
G4=$(post "$MGR" finance/accounts "{\"code\":\"9-1-1-1\",\"name\":\"Detail Group\",\"parentId\":\"$G3\",\"isGroup\":true}" | jget data.id)
check "child inherits parent type (no type sent)" "$(get "$MGR" finance/accounts | python3 -c "import sys,json;print(next(a['type'] for a in json.load(sys.stdin)['data'] if a['code']=='9-1'))")" "ASSET"
check "level-4 group has level 4" "$(get "$MGR" finance/accounts | python3 -c "import sys,json;print(next(a['level'] for a in json.load(sys.stdin)['data'] if a['code']=='9-1-1-1'))")" "4"
check "5th level rejected (max 4) -> 422" "$(code -XPOST "$B/finance/accounts" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"code\":\"9-1-1-1-1\",\"name\":\"too deep\",\"parentId\":\"$G4\"}")" "422"

echo "== voucher types & numbering =="
V1=$(post "$MGR" finance/transactions "{\"description\":\"Bank receipt\",\"voucherType\":\"BRV\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":1000},{\"accountId\":\"$REV\",\"creditMinor\":1000}]}" | jget data.voucherNo)
check "first BRV -> BRV-000001" "$V1" "BRV-000001"
V2=$(post "$MGR" finance/transactions "{\"description\":\"Bank receipt 2\",\"voucherType\":\"BRV\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":2000},{\"accountId\":\"$REV\",\"creditMinor\":2000}]}" | jget data.voucherNo)
check "second BRV -> BRV-000002 (per-type sequence)" "$V2" "BRV-000002"
VC=$(post "$MGR" finance/transactions "{\"description\":\"Cash payment\",\"voucherType\":\"CPV\",\"entries\":[{\"accountId\":\"$RENT\",\"debitMinor\":500},{\"accountId\":\"$CASH\",\"creditMinor\":500}]}" | jget data.voucherNo)
check "first CPV -> CPV-000001 (independent sequence)" "$VC" "CPV-000001"
check "filter voucherType=BRV lists 2" "$(get "$MGR" "finance/transactions?voucherType=BRV" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "2"

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
