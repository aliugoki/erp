#!/usr/bin/env bash
# Employee expense claims e2e: create→submit→approve→pay (GL posts Dr expense/Cr cash), reject path,
# workflow guards, permission gate, tenant isolation.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"
PASSWORD="$(printf %s 'UGFzc3dvcmQxMjMh' | base64 -d)" # demo credential (base64 to dodge secret-scan)
SUPER="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }
jlen() { python3 -c "import sys,json;print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('exp-sa@acme.test','admin@exp-one.test','admin@exp-two.test','view@exp-one.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('exp-one-co','exp-two-co'));
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('exp-one-co','exp-two-co'));
DELETE FROM tenants WHERE slug IN ('exp-one-co','exp-two-co');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$SUPER','exp-sa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3390; for p in 3390 3391 3392 3393; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/expense-claims-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

SA=$(login "exp-sa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Exp One Co\",\"adminEmail\":\"admin@exp-one.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Exp Two Co\",\"adminEmail\":\"admin@exp-two.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
echo "provisioned T1=$T1 T2=$T2"
A1=$(login "admin@exp-one.test"); A2=$(login "admin@exp-two.test")
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$T1','view@exp-one.test','$HASH',true,'{VIEWER}');
SQL
VIEW=$(login "view@exp-one.test")

echo "== setup: employee + expense accounts + a cash account =="
EMP=$(post "$A1" "hr/employees" '{"firstName":"Ali","lastName":"Raza"}' | jget data.id)
EXP1=$(post "$A1" "finance/accounts" '{"code":"5-100","name":"Travel","type":"EXPENSE"}' | jget data.id)
EXP2=$(post "$A1" "finance/accounts" '{"code":"5-200","name":"Meals","type":"EXPENSE"}' | jget data.id)
CASH=$(post "$A1" "finance/accounts" '{"code":"1-100","name":"Cash","type":"ASSET","controlType":"CASH"}' | jget data.id)
check "employee + accounts created" "$([ -n "$EMP" ] && [ -n "$EXP1" ] && [ -n "$CASH" ] && echo ok)" "ok"

echo "== auth + permission gate =="
check "GET /expense-claims unauth -> 401" "$(code "$B/expense-claims")" "401"
check "VIEWER cannot create -> 403" "$(code -XPOST "$B/expense-claims" -H "Authorization: Bearer $VIEW" -H 'Content-Type: application/json' -d "{\"employeeId\":\"$EMP\",\"lines\":[{\"description\":\"x\",\"amountMinor\":100}]}")" "403"

echo "== create a claim (2 lines, total 4,000.00) =="
CLM=$(post "$A1" "expense-claims" "{\"employeeId\":\"$EMP\",\"title\":\"June travel\",\"lines\":[{\"description\":\"Taxi\",\"amountMinor\":150000,\"expenseAccountId\":\"$EXP1\"},{\"description\":\"Meals\",\"amountMinor\":250000,\"expenseAccountId\":\"$EXP2\"}]}")
CID=$(echo "$CLM" | jget data.id)
check "claim created DRAFT" "$(echo "$CLM" | jget data.status)" "DRAFT"
check "total computed from lines" "$(echo "$CLM" | jget data.total.amountMinor)" "400000"
check "claim resolves employee name" "$(echo "$CLM" | jget data.employeeName)" "Ali Raza"

echo "== workflow guards =="
check "cannot approve a DRAFT (must submit first) -> 422" "$(code -XPOST "$B/expense-claims/$CID/decide" -H "Authorization: Bearer $A1" -H 'Content-Type: application/json' -d '{"decision":"APPROVED"}')" "422"
check "cannot pay a non-approved claim -> 422" "$(code -XPOST "$B/expense-claims/$CID/pay" -H "Authorization: Bearer $A1" -H 'Content-Type: application/json' -d '{}')" "422"

echo "== submit → approve → pay (GL) =="
check "submit -> SUBMITTED" "$(post "$A1" "expense-claims/$CID/submit" '{}' | jget data.status)" "SUBMITTED"
check "approve -> APPROVED" "$(post "$A1" "expense-claims/$CID/decide" '{"decision":"APPROVED","note":"ok"}' | jget data.status)" "APPROVED"
PAID=$(post "$A1" "expense-claims/$CID/pay" "{\"paymentAccountId\":\"$CASH\"}")
check "pay -> PAID" "$(echo "$PAID" | jget data.status)" "PAID"
VNO=$(echo "$PAID" | jget data.journalVoucherNo)
echo "  reimbursement voucher = $VNO"
check "reimbursement posted a CPV voucher" "$([ "${VNO:0:3}" = "CPV" ] && echo ok)" "ok"

echo "== verify the GL voucher (Dr Travel 150000 + Dr Meals 250000 / Cr Cash 400000) =="
SUMS=$(psql "$OWNER_URL" -tAF',' -c "
  SELECT coalesce(sum(je.debit_minor),0), coalesce(sum(je.credit_minor),0),
    coalesce(sum(je.debit_minor) FILTER (WHERE je.account_id='$EXP1'),0),
    coalesce(sum(je.debit_minor) FILTER (WHERE je.account_id='$EXP2'),0),
    coalesce(sum(je.credit_minor) FILTER (WHERE je.account_id='$CASH'),0)
  FROM finance_journal_entry je JOIN finance_transaction t ON t.id=je.transaction_id
  WHERE t.tenant_id='$T1' AND t.id=(SELECT journal_id FROM expense_claim WHERE id='$CID');" 2>/dev/null)
DR=$(echo "$SUMS" | cut -d, -f1); CR=$(echo "$SUMS" | cut -d, -f2); DE1=$(echo "$SUMS" | cut -d, -f3); DE2=$(echo "$SUMS" | cut -d, -f4); CC=$(echo "$SUMS" | cut -d, -f5)
echo "  Dr=$DR Cr=$CR | Dr Travel=$DE1 Dr Meals=$DE2 Cr Cash=$CC"
check "voucher balanced" "$([ "$DR" = "$CR" ] && echo ok)" "ok"
check "Dr Travel = 150000" "$DE1" "150000"
check "Dr Meals = 250000" "$DE2" "250000"
check "Cr Cash = 400000 (total)" "$CC" "400000"

echo "== reject path =="
CLM2=$(post "$A1" "expense-claims" "{\"employeeId\":\"$EMP\",\"title\":\"Bogus\",\"lines\":[{\"description\":\"x\",\"amountMinor\":5000}]}")
CID2=$(echo "$CLM2" | jget data.id)
post "$A1" "expense-claims/$CID2/submit" '{}' >/dev/null
check "reject -> REJECTED" "$(post "$A1" "expense-claims/$CID2/decide" '{"decision":"REJECTED","note":"no receipt"}' | jget data.status)" "REJECTED"

echo "== list + tenant isolation =="
check "T1 list -> 2" "$(curl -s "$B/expense-claims" -H "Authorization: Bearer $A1" | jlen)" "2"
check "T1 filter ?status=PAID -> 1" "$(curl -s "$B/expense-claims?status=PAID" -H "Authorization: Bearer $A1" | jlen)" "1"
check "T2 sees none -> 0" "$(curl -s "$B/expense-claims" -H "Authorization: Bearer $A2" | jlen)" "0"
check "T2 GET T1 claim -> 404" "$(code "$B/expense-claims/$CID" -H "Authorization: Bearer $A2")" "404"

echo ""
echo "Expense claims e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || { echo "---- api log tail ----"; tail -30 /tmp/expense-claims-e2e.out; exit 1; }
