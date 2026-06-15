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
  -d "{\"name\":\"Acct Co\",\"adminEmail\":\"admin@acct.test\",\"adminPassword\":\"$PW\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$T1','acctmgr@acct.test','$HASH',true,'{FINANCE_MANAGER}');
SQL
MGR=$(login "acctmgr@acct.test"); ADMIN=$(login "admin@acct.test")
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

echo "== accounts payable (vendors / bills / payments) =="
VEN=$(post "$MGR" finance/vendors '{"name":"Acme Supplies","email":"ar@acme.test"}' | jget data.id)
[ -n "$VEN" ] && echo "  ✅ vendor created" && pass=$((pass+1)) || { echo "  ❌ vendor create failed"; fail=$((fail+1)); }
BILL=$(post "$MGR" finance/bills "{\"number\":\"BILL-1\",\"vendorId\":\"$VEN\",\"lineItems\":[{\"description\":\"materials\",\"quantity\":2,\"unitPriceMinor\":50000}],\"dueDate\":\"2020-02-01\"}" | jget data.id)
check "bill total = 100000" "$(get "$MGR" "finance/bills/$BILL" | jget data.total.amountMinor)" "100000"
check "new bill status = RECEIVED" "$(get "$MGR" "finance/bills/$BILL" | jget data.status)" "RECEIVED"
post "$MGR" "finance/bills/$BILL/payments" '{"amountMinor":40000}' >/dev/null
check "after partial payment -> PARTIALLY_PAID" "$(get "$MGR" "finance/bills/$BILL" | jget data.status)" "PARTIALLY_PAID"
check "outstanding = 60000" "$(get "$MGR" "finance/bills/$BILL" | jget data.outstanding.amountMinor)" "60000"
check "overpayment -> 422" "$(code -XPOST "$B/finance/bills/$BILL/payments" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d '{"amountMinor":999999}')" "422"
post "$MGR" "finance/bills/$BILL/payments" '{"amountMinor":60000}' >/dev/null
check "after full payment -> PAID" "$(get "$MGR" "finance/bills/$BILL" | jget data.status)" "PAID"
post "$MGR" finance/bills "{\"number\":\"BILL-OLD\",\"vendorId\":\"$VEN\",\"lineItems\":[{\"description\":\"old\",\"quantity\":1,\"unitPriceMinor\":70000}],\"dueDate\":\"2020-01-01\"}" >/dev/null
check "AP aging total = 70000 (one outstanding bill)" "$(get "$MGR" finance/ap-aging | jget data.totals.total)" "70000"
check "AP overdue bill in 90+ bucket" "$(get "$MGR" finance/ap-aging | jget data.totals.d90_plus)" "70000"

echo "== vendor → chart of accounts + AP→GL posting (before any period exists) =="
APCTRL=$(post "$MGR" finance/accounts '{"code":"2-09","name":"Sundry Creditors","type":"LIABILITY","isGroup":true,"controlType":"PAYABLE"}' | jget data.id)
[ -n "$APCTRL" ] && echo "  ✅ payables control group created" && pass=$((pass+1)) || { echo "  ❌ payables control create failed"; fail=$((fail+1)); }
VACC=$(post "$MGR" finance/vendors '{"name":"Globex Supplier"}' | jget data.accountCode)
[ -n "$VACC" ] && echo "  ✅ vendor got ledger sub-account ($VACC)" && pass=$((pass+1)) || { echo "  ❌ vendor sub-account not created"; fail=$((fail+1)); }
check "vendor account is a child of the payables control" "$(get "$MGR" finance/accounts | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];p=next(a['id'] for a in d if a['code']=='2-09');print(any(a.get('parentId')==p and a['name']=='Globex Supplier' for a in d))")" "True"
GLVID=$(post "$MGR" finance/vendors '{"name":"GL Vendor"}' | jget data.id)
BRES=$(post "$MGR" finance/bills "{\"number\":\"GLBILL-1\",\"vendorId\":\"$GLVID\",\"lineItems\":[{\"description\":\"svc\",\"quantity\":1,\"unitPriceMinor\":80000}],\"expenseAccountId\":\"$RENT\"}")
BID=$(echo "$BRES" | jget data.id)
[ -n "$(echo "$BRES" | jget data.journalNo)" ] && echo "  ✅ bill posted to GL ($(echo "$BRES" | jget data.journalNo))" && pass=$((pass+1)) || { echo "  ❌ bill did not post to GL"; fail=$((fail+1)); }
VPACC=$(get "$MGR" finance/accounts | python3 -c "import sys,json;print(next(a['id'] for a in json.load(sys.stdin)['data'] if a['name']=='GL Vendor'))")
check "vendor payable balance = 80000 after bill" "$(get "$MGR" "finance/ledger/$VPACC" | jget data.closing.amountMinor)" "80000"
# Pay from CASH (CPV) so it doesn't disturb the BANK ledger the reconciliation section asserts on.
PRES=$(post "$MGR" "finance/bills/$BID/payments" "{\"amountMinor\":80000,\"paymentAccountId\":\"$CASH\"}")
[ -n "$(echo "$PRES" | jget data.journalNo)" ] && echo "  ✅ payment posted to GL ($(echo "$PRES" | jget data.journalNo))" && pass=$((pass+1)) || { echo "  ❌ payment did not post to GL"; fail=$((fail+1)); }
check "vendor payable cleared to 0 after full payment" "$(get "$MGR" "finance/ledger/$VPACC" | jget data.closing.amountMinor)" "0"

echo "== AR → GL posting (invoices/receipts hit the ledger) =="
ARCTRL=$(post "$MGR" finance/accounts '{"code":"1-90","name":"Trade Debtors","type":"ASSET","isGroup":true,"controlType":"RECEIVABLE"}' | jget data.id)
[ -n "$ARCTRL" ] && echo "  ✅ receivables control group created" && pass=$((pass+1)) || { echo "  ❌ receivables control failed"; fail=$((fail+1)); }
CLID=$(post "$ADMIN" crm/clients '{"companyName":"Beta Client"}' | jget data.id)
[ -n "$CLID" ] && echo "  ✅ CRM client created" && pass=$((pass+1)) || { echo "  ❌ crm client create failed (crm feature/role?)"; fail=$((fail+1)); }
IRES=$(post "$MGR" finance/invoices "{\"number\":\"GLINV-1\",\"clientId\":\"$CLID\",\"lineItems\":[{\"description\":\"svc\",\"quantity\":1,\"unitPriceMinor\":90000}],\"incomeAccountId\":\"$REV\"}")
INVID=$(echo "$IRES" | jget data.id)
[ -n "$(echo "$IRES" | jget data.journalNo)" ] && echo "  ✅ invoice posted to GL ($(echo "$IRES" | jget data.journalNo))" && pass=$((pass+1)) || { echo "  ❌ invoice did not post to GL"; fail=$((fail+1)); }
CRACC=$(get "$MGR" finance/accounts | python3 -c "import sys,json;print(next((a['id'] for a in json.load(sys.stdin)['data'] if a['name']=='Beta Client'),''))")
check "client receivable balance = 90000 after invoice" "$(get "$MGR" "finance/ledger/$CRACC" | jget data.closing.amountMinor)" "90000"
RRES=$(curl -s -XPATCH "$B/finance/invoices/$INVID/pay" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"paymentAccountId\":\"$CASH\"}")
[ -n "$(echo "$RRES" | jget data.journalNo)" ] && echo "  ✅ receipt posted to GL ($(echo "$RRES" | jget data.journalNo))" && pass=$((pass+1)) || { echo "  ❌ receipt did not post to GL"; fail=$((fail+1)); }
check "client receivable cleared to 0 after receipt" "$(get "$MGR" "finance/ledger/$CRACC" | jget data.closing.amountMinor)" "0"

echo "== cash flow statement (direct method) =="
check "cash flow reconciles (opening + net = closing)" "$(get "$MGR" finance/statements/cash-flow | jget data.reconciles)" "True"
check "operating activities non-zero" "$(get "$MGR" finance/statements/cash-flow | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['operating']['totalMinor']!=0)")" "True"

echo "== cost centers (analytical dimension) =="
CC=$(post "$MGR" finance/cost-centers '{"code":"BR1","name":"Branch 1"}' | jget data.id)
[ -n "$CC" ] && echo "  ✅ cost center created" && pass=$((pass+1)) || { echo "  ❌ cost center create failed"; fail=$((fail+1)); }
post "$MGR" finance/transactions "{\"voucherType\":\"JV\",\"description\":\"Branch sale\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":5000},{\"accountId\":\"$REV\",\"creditMinor\":5000,\"costCenterId\":\"$CC\"}]}" >/dev/null
check "cost-center P&L shows BR1 revenue = 5000" "$(get "$MGR" finance/reports/cost-center | python3 -c "import sys,json;d=json.load(sys.stdin)['data']['costCenters'];print(next((c['revenue']['amountMinor'] for c in d if c['code']=='BR1'),0))")" "5000"
check "untagged income rolls up to Unassigned" "$(get "$MGR" finance/reports/cost-center | python3 -c "import sys,json;d=json.load(sys.stdin)['data']['costCenters'];print(any(c['name']=='Unassigned' for c in d))")" "True"

echo "== recurring vouchers (before any period exists) =="
REC=$(post "$MGR" finance/recurring "{\"description\":\"Monthly rent\",\"voucherType\":\"JV\",\"frequency\":\"MONTHLY\",\"nextRunDate\":\"2026-06-01\",\"entries\":[{\"accountId\":\"$RENT\",\"debitMinor\":25000},{\"accountId\":\"$CASH\",\"creditMinor\":25000}]}" | jget data.id)
[ -n "$REC" ] && echo "  ✅ recurring template created" && pass=$((pass+1)) || { echo "  ❌ recurring create failed"; fail=$((fail+1)); }
RV=$(curl -s -XPOST "$B/finance/recurring/$REC/run" -H "Authorization: Bearer $MGR" | jget data.voucherNo)
[ -n "$RV" ] && echo "  ✅ run generated voucher $RV" && pass=$((pass+1)) || { echo "  ❌ recurring run failed"; fail=$((fail+1)); }
check "next run advanced (no longer 2026-06-01)" "$(get "$MGR" finance/recurring | python3 -c "import sys,json;print(next(r['nextRunDate'][:10] for r in json.load(sys.stdin)['data'] if r['id']=='$REC')!='2026-06-01')")" "True"
post "$MGR" finance/recurring "{\"description\":\"Weekly fee\",\"frequency\":\"WEEKLY\",\"nextRunDate\":\"2026-06-05\",\"entries\":[{\"accountId\":\"$RENT\",\"debitMinor\":1000},{\"accountId\":\"$CASH\",\"creditMinor\":1000}]}" >/dev/null
check "run-due generates at least one" "$(curl -s -XPOST "$B/finance/recurring/run-due" -H "Authorization: Bearer $MGR" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['generated']>=1)")" "True"

echo "== budget vs actual =="
BP=$(post "$MGR" finance/periods '{"name":"Budget Month","startDate":"2026-06-01","endDate":"2026-06-30"}' | jget data.id)
BREV=$(post "$MGR" finance/accounts '{"code":"4999","name":"Budgeted Sales","type":"REVENUE"}' | jget data.id)
post "$MGR" finance/budgets "{\"periodId\":\"$BP\",\"accountId\":\"$BREV\",\"amountMinor\":100000}" >/dev/null
post "$MGR" finance/transactions "{\"voucherType\":\"JV\",\"description\":\"budget actual\",\"occurredOn\":\"2026-06-10\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":60000},{\"accountId\":\"$BREV\",\"creditMinor\":60000}]}" >/dev/null
bva(){ get "$MGR" "finance/reports/budget-vs-actual?periodId=$BP" | python3 -c "import sys,json;d=json.load(sys.stdin)['data']['lines'];print(next((l['$1']['amountMinor'] for l in d if l['code']=='4999'),0))"; }
check "budgeted = 100000" "$(bva budget)" "100000"
check "actual = 60000" "$(bva actual)" "60000"
check "variance = -40000 (under)" "$(bva variance)" "-40000"
# Close Budget Month so the period-lock section below still sees no OPEN period covering today.
curl -s -o /dev/null -XPATCH "$B/finance/periods/$BP" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d '{"status":"CLOSED"}'

echo "== year-end close =="
RE=$(post "$MGR" finance/accounts '{"code":"3000","name":"Retained Earnings","type":"EQUITY"}' | jget data.id)
CY=$(post "$MGR" finance/periods '{"name":"Close 2026","startDate":"2026-01-01","endDate":"2026-12-31"}' | jget data.id)
check "year-end close posts a closing voucher" "$(curl -s -XPOST "$B/finance/year-end-close" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"periodId\":\"$CY\",\"retainedEarningsAccountId\":\"$RE\"}" | jget data.posted)" "True"
check "income statement net = 0 after close" "$(get "$MGR" finance/statements/income | jget data.netIncomeMinor)" "0"
check "re-running close finds nothing to close" "$(curl -s -XPOST "$B/finance/year-end-close" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"periodId\":\"$CY\",\"retainedEarningsAccountId\":\"$RE\"}" | jget data.posted)" "False"
# Close the year period so the period-lock section below still sees no OPEN period covering today.
curl -s -o /dev/null -XPATCH "$B/finance/periods/$CY" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d '{"status":"CLOSED"}'

echo "== multi-currency =="
post "$MGR" finance/currencies '{"code":"PKR","name":"Pak Rupee","symbol":"Rs","isBase":true}' >/dev/null
post "$MGR" finance/currencies '{"code":"USD","name":"US Dollar","symbol":"$"}' >/dev/null
post "$MGR" finance/exchange-rates '{"currencyCode":"USD","rate":278.5}' >/dev/null
check "USD 10000 minor -> PKR = 2785000" "$(get "$MGR" "finance/convert?amountMinor=10000&from=USD&to=PKR" | jget data.result.amountMinor)" "2785000"
check "PKR 2785000 -> USD = 10000" "$(get "$MGR" "finance/convert?amountMinor=2785000&from=PKR&to=USD" | jget data.result.amountMinor)" "10000"
check "second base currency rejected -> 400" "$(code -XPOST "$B/finance/currencies" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d '{"code":"EUR","name":"Euro","isBase":true}')" "400"

echo "== bank statement import + auto-match =="
# BANK has two BRV deposits (1000, 2000); the 1000 was cleared manually in the reconciliation section.
post "$MGR" finance/bank-statements/import "{\"accountId\":\"$BANK\",\"lines\":[{\"date\":\"2026-06-15\",\"amountMinor\":2000,\"description\":\"deposit\"},{\"date\":\"2026-06-16\",\"amountMinor\":999999,\"description\":\"unknown\"}]}" >/dev/null
check "auto-match matches the 2000 deposit" "$(post "$MGR" finance/bank-statements/auto-match "{\"accountId\":\"$BANK\"}" | jget data.matched)" "1"
check "one imported line remains unmatched" "$(get "$MGR" "finance/bank-statements/$BANK" | python3 -c "import sys,json;print(sum(1 for s in json.load(sys.stdin)['data'] if not s['matched']))")" "1"
check "bank now fully cleared (uncleared count 0)" "$(get "$MGR" "finance/reconciliation/$BANK" | jget data.unclearedCount)" "0"

echo "== transaction detail (double-entry view) =="
TX=$(get "$MGR" "finance/transactions?pageSize=1&status=POSTED" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")
check "transaction detail returns lines with account names" "$(get "$MGR" "finance/transactions/$TX" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(len(d['entries'])>=2 and all(e.get('accountCode') and e.get('accountName') for e in d['entries']))")" "True"

echo "== fiscal period lock (run last — enabling periods restricts posting) =="
P=$(post "$MGR" finance/periods '{"name":"Jan 2020","startDate":"2020-01-01","endDate":"2020-01-31"}' | jget data.id)
check "posting today blocked (no open period covers it) -> 422" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"voucherType\":\"JV\",\"description\":\"today\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100},{\"accountId\":\"$REV\",\"creditMinor\":100}]}")" "422"
check "posting inside the open period -> 201" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"voucherType\":\"JV\",\"description\":\"in period\",\"occurredOn\":\"2020-01-15\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100},{\"accountId\":\"$REV\",\"creditMinor\":100}]}")" "201"
curl -s -o /dev/null -XPATCH "$B/finance/periods/$P" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d '{"status":"CLOSED"}'
check "posting into a CLOSED period -> 422" "$(code -XPOST "$B/finance/transactions" -H "Authorization: Bearer $MGR" -H 'Content-Type: application/json' -d "{\"voucherType\":\"JV\",\"description\":\"closed\",\"occurredOn\":\"2020-01-15\",\"entries\":[{\"accountId\":\"$CASH\",\"debitMinor\":100},{\"accountId\":\"$REV\",\"creditMinor\":100}]}")" "422"

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
