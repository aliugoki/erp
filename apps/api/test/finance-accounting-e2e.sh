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

echo "== cash/bank tagging + voucher-side validation =="
# Tag the existing Cash leaf as CASH; add a BANK control account under the Assets group.
curl -s -o /dev/null -XPATCH "$B/finance/accounts/$CASH" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d '{"controlType":"CASH"}'
BANK=$(post "$MGR" finance/accounts "{\"code\":\"1100\",\"name\":\"Bank\",\"parentId\":\"$ASSETS\",\"controlType\":\"BANK\",\"bankName\":\"HBL\"}" | jget data.id)
check "account tagged BANK" "$(get "$MGR" finance/accounts | python3 -c "import sys,json;print(next(a['controlType'] for a in json.load(sys.stdin)['data'] if a['code']=='1100'))")" "BANK"
V1=$(post "$MGR" finance/transactions "{\"voucherType\":\"BRV\",\"description\":\"Bank receipt\",\"entries\":[{\"accountId\":\"$BANK\",\"debitMinor\":1000},{\"accountId\":\"$REV\",\"creditMinor\":1000}]}" | jget data.voucherNo)
check "BRV debiting bank -> BRV-000001" "$V1" "BRV-000001"
V2=$(post "$MGR" finance/transactions "{\"voucherType\":\"BRV\",\"description\":\"Bank receipt 2\",\"entries\":[{\"accountId\":\"$BANK\",\"debitMinor\":2000},{\"accountId\":\"$REV\",\"creditMinor\":2000}]}" | jget data.voucherNo)
check "second BRV -> BRV-000002 (per-type sequence)" "$V2" "BRV-000002"
check "BRV NOT debiting a bank acct -> 422" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"voucherType\":\"BRV\",\"description\":\"bad\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":500},{\"accountId\":\"$REV\",\"creditMinor\":500}]}")" "422"
VC=$(post "$MGR" finance/transactions "{\"voucherType\":\"CPV\",\"description\":\"Cash payment\",\"entries\":[{\"accountId\":\"$RENT\",\"debitMinor\":500},{\"accountId\":\"$CASH\",\"creditMinor\":500}]}" | jget data.voucherNo)
check "CPV crediting cash -> CPV-000001" "$VC" "CPV-000001"
check "CPV NOT crediting cash -> 422" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"voucherType\":\"CPV\",\"description\":\"bad\",\"entries\":[{\"accountId\":\"$RENT\",\"debitMinor\":500},{\"accountId\":\"$BANK\",\"creditMinor\":500}]}")" "422"
check "filter voucherType=BRV lists 2" "$(get "$MGR" "finance/transactions?voucherType=BRV" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "2"

echo "== voucher reversal =="
RID=$(post "$MGR" finance/transactions "{\"voucherType\":\"JV\",\"description\":\"To reverse\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":700},{\"accountId\":\"$REV\",\"creditMinor\":700}]}" | jget data.id)
RV=$(curl -s -XPOST "$B/finance/transactions/$RID/reverse" -H "Authorization: Bearer $MGR" | jget data.voucherNo)
[ -n "$RV" ] && echo "  ✅ reversal voucher $RV created" && pass=$((pass+1)) || { echo "  ❌ reversal failed"; fail=$((fail+1)); }
check "reversing again -> 422 (already reversed)" "$(code -XPOST "$B/finance/transactions/$RID/reverse" -H "Authorization: Bearer $MGR")" "422"

echo "== cash & bank book =="
check "cash book lists cash + bank accounts" "$(get "$MGR" finance/cash-book | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['accounts']))")" "2"

echo "== maker/checker draft workflow =="
DRES=$(post "$MGR" finance/transactions "{\"voucherType\":\"JV\",\"description\":\"Draft entry\",\"draft\":true,\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":12345},{\"accountId\":\"$REV\",\"creditMinor\":12345}]}")
DID=$(echo "$DRES" | jget data.id)
check "voucher saved as DRAFT" "$(echo "$DRES" | jget data.status)" "DRAFT"
check "draft is under status=DRAFT" "$(get "$MGR" "finance/transactions?status=DRAFT" | python3 -c "import sys,json;print('$DID' in [t['id'] for t in json.load(sys.stdin)['data']])")" "True"
check "draft NOT under status=POSTED" "$(get "$MGR" "finance/transactions?status=POSTED" | python3 -c "import sys,json;print('$DID' in [t['id'] for t in json.load(sys.stdin)['data']])")" "False"
check "post (approve) the draft -> 201" "$(code -XPOST "$B/finance/transactions/$DID/post" -H "Authorization: Bearer $MGR")" "201"
check "posted draft now under status=POSTED" "$(get "$MGR" "finance/transactions?status=POSTED" | python3 -c "import sys,json;print('$DID' in [t['id'] for t in json.load(sys.stdin)['data']])")" "True"
D2=$(post "$MGR" finance/transactions "{\"voucherType\":\"JV\",\"description\":\"Draft to discard\",\"draft\":true,\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":1},{\"accountId\":\"$REV\",\"creditMinor\":1}]}" | jget data.id)
check "discard a draft -> 200" "$(code -XDELETE "$B/finance/transactions/$D2" -H "Authorization: Bearer $MGR")" "200"

echo "== AR aging =="
post "$MGR" finance/invoices "{\"number\":\"INV-AGE-1\",\"lineItems\":[{\"description\":\"Old sale\",\"quantity\":1,\"unitPriceMinor\":50000}],\"dueDate\":\"2020-01-01\"}" >/dev/null
check "AR aging total = 50000 (one outstanding invoice)" "$(get "$MGR" finance/ar-aging | jget data.totals.total)" "50000"
check "overdue invoice falls in the 90+ bucket" "$(get "$MGR" finance/ar-aging | jget data.totals.d90_plus)" "50000"

echo "== bank reconciliation =="
check "bank book balance = 3000 (two BRVs)" "$(get "$MGR" "finance/reconciliation/$BANK" | jget data.bookBalance.amountMinor)" "3000"
E1=$(get "$MGR" "finance/reconciliation/$BANK" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['entries'][0]['entryId'])")
curl -s -o /dev/null -XPOST "$B/finance/reconciliation" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"entryIds\":[\"$E1\"],\"reconciled\":true}"
check "cleared balance = 1000 after clearing one entry" "$(get "$MGR" "finance/reconciliation/$BANK" | jget data.clearedBalance.amountMinor)" "1000"
check "uncleared count = 1" "$(get "$MGR" "finance/reconciliation/$BANK" | jget data.unclearedCount)" "1"

echo "== fiscal period lock (run last — enabling periods restricts posting) =="
P=$(post "$MGR" finance/periods '{"name":"Jan 2020","startDate":"2020-01-01","endDate":"2020-01-31"}' | jget data.id)
check "posting today blocked (no open period covers it) -> 422" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"voucherType\":\"JV\",\"description\":\"today\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100},{\"accountId\":\"$REV\",\"creditMinor\":100}]}")" "422"
check "posting inside the open period -> 201" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"voucherType\":\"JV\",\"description\":\"in period\",\"occurredOn\":\"2020-01-15\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100},{\"accountId\":\"$REV\",\"creditMinor\":100}]}")" "201"
curl -s -o /dev/null -XPATCH "$B/finance/periods/$P" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d '{"status":"CLOSED"}'
check "posting into a CLOSED period -> 422" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"voucherType\":\"JV\",\"description\":\"closed\",\"occurredOn\":\"2020-01-15\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100},{\"accountId\":\"$REV\",\"creditMinor\":100}]}")" "422"

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
