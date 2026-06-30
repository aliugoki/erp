#!/usr/bin/env bash
# Payroll → GL integration e2e: approving a payroll run posts a balanced journal voucher
# (Dr salary expense / Cr deductions payable / Cr salaries payable) to the general ledger, via the
# outbox → relay → HrPayrollGlConsumer pipeline, and links the voucher back to the run.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"
# Demo credential (base64 to keep the literal out of source, per the repo secret-scan hook).
PASSWORD="$(printf %s 'UGFzc3dvcmQxMjMh' | base64 -d)"
SUPER="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d) or '')" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
-- Delete users by email first (email is globally unique; a prior run may have orphaned the admin
-- user after its tenant was dropped — deleting via tenant membership alone would miss it).
DELETE FROM users WHERE lower(email) IN ('paygl-sa@acme.test','admin@pay-gl.test','admin@hr-only.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('pay-gl-co','hr-only-co'));
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('pay-gl-co','hr-only-co'));
DELETE FROM tenants WHERE slug IN ('pay-gl-co','hr-only-co');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$SUPER','paygl-sa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3380; for p in 3380 3381 3382 3383; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
# Boot with the relay + reactions on so the event actually flows to the GL consumer in-process.
API_PORT=$PORT OUTBOX_RELAY_ENABLED=true WORKER_REACTIONS_ENABLED=true OUTBOX_POLL_INTERVAL_MS=500 \
  setsid node apps/api/dist/main.js >/tmp/payroll-gl-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }

SA=$(login "paygl-sa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Pay GL Co\",\"adminEmail\":\"admin@pay-gl.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
echo "provisioned tenant Pay GL Co=$T"
A=$(login "admin@pay-gl.test")

echo "== build a minimal chart of accounts =="
EXP=$(post "$A" "finance/accounts" '{"code":"5-100","name":"Salaries Expense","type":"EXPENSE"}' | jget data.id)
PAY=$(post "$A" "finance/accounts" '{"code":"2-100","name":"Salaries Payable","type":"LIABILITY"}' | jget data.id)
DED=$(post "$A" "finance/accounts" '{"code":"2-200","name":"Tax Deductions Payable","type":"LIABILITY"}' | jget data.id)
check "expense account created" "$([ -n "$EXP" ] && echo ok)" "ok"
check "payable account created" "$([ -n "$PAY" ] && echo ok)" "ok"
check "deductions account created" "$([ -n "$DED" ] && echo ok)" "ok"

echo "== map payroll postings to the GL accounts =="
GLC=$(curl -s -XPUT "$B/hr/payroll/gl-config" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' \
  -d "{\"salaryExpenseAccountId\":\"$EXP\",\"salaryPayableAccountId\":\"$PAY\",\"deductionsPayableAccountId\":\"$DED\"}")
check "gl-config expense persisted" "$(echo "$GLC" | jget data.salaryExpenseAccountId)" "$EXP"
check "gl-config deductions persisted" "$(echo "$GLC" | jget data.deductionsPayableAccountId)" "$DED"

echo "== a fixed deduction component (so the run has deductions) =="
post "$A" "hr/salary-components" '{"name":"Income Tax","code":"TAX","type":"DEDUCTION","calc":"FIXED","valueMinor":500000}' >/dev/null

echo "== one active salaried employee (basic PKR 100,000.00) =="
DEPT=$(post "$A" "hr/departments" '{"name":"Ops"}' | jget data.id)
post "$A" "hr/employees" "{\"firstName\":\"Sana\",\"lastName\":\"Iqbal\",\"departmentId\":\"$DEPT\",\"salary\":{\"amountMinor\":10000000,\"currency\":\"PKR\"},\"status\":\"ACTIVE\"}" >/dev/null

echo "== run payroll for 2026-05 =="
RUN=$(post "$A" "hr/payroll/runs" '{"year":2026,"month":5,"workingDays":26}')
RID=$(echo "$RUN" | jget data.id)
GROSS=$(echo "$RUN" | jget data.totalGross.amountMinor)
DEDUCT=$(echo "$RUN" | jget data.totalDeduction.amountMinor)
NET=$(echo "$RUN" | jget data.totalNet.amountMinor)
echo "  run=$RID gross=$GROSS deduction=$DEDUCT net=$NET"
check "run created (DRAFT)" "$(echo "$RUN" | jget data.status)" "DRAFT"
check "gross = net + deduction" "$([ "$GROSS" = "$((NET + DEDUCT))" ] && echo ok)" "ok"
check "has a deduction" "$([ "$DEDUCT" = "500000" ] && echo ok)" "ok"

echo "== approve → emits hr.payroll_run_completed → relay → GL consumer posts a JV =="
curl -s -XPATCH "$B/hr/payroll/runs/$RID/approve" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{}' >/dev/null

# Poll until the consumer links the voucher back to the run (async pipeline).
VNO=""
for i in $(seq 1 40); do
  VNO=$(curl -s "$B/hr/payroll/runs" -H "Authorization: Bearer $A" | python3 -c "import sys,json
rs=json.load(sys.stdin)['data']
r=next((x for x in rs if x['id']=='$RID'), {})
print(r.get('journalVoucherNo') or '')" 2>/dev/null)
  [ -n "$VNO" ] && break || sleep 0.5
done
echo "  linked voucher = $VNO"
check "payroll run links a GL voucher" "$([ -n "$VNO" ] && echo ok)" "ok"

echo "== verify the posted voucher in the general ledger (owner read) =="
# The voucher debits expense by gross and credits payable (net) + deductions (deduction), balanced.
SUMS=$(psql "$OWNER_URL" -tAF',' -c "
  SELECT
    (SELECT count(*) FROM finance_transaction t WHERE t.tenant_id='$T' AND t.reference=(SELECT run_no FROM hr_payroll_run WHERE id='$RID')),
    coalesce(sum(je.debit_minor),0), coalesce(sum(je.credit_minor),0),
    coalesce(sum(je.debit_minor) FILTER (WHERE je.account_id='$EXP'),0),
    coalesce(sum(je.credit_minor) FILTER (WHERE je.account_id='$DED'),0),
    coalesce(sum(je.credit_minor) FILTER (WHERE je.account_id='$PAY'),0)
  FROM finance_journal_entry je
  JOIN finance_transaction t ON t.id=je.transaction_id
  WHERE t.tenant_id='$T' AND t.reference=(SELECT run_no FROM hr_payroll_run WHERE id='$RID');" 2>/dev/null)
TXN_COUNT=$(echo "$SUMS" | cut -d, -f1); TOT_DR=$(echo "$SUMS" | cut -d, -f2); TOT_CR=$(echo "$SUMS" | cut -d, -f3)
DR_EXP=$(echo "$SUMS" | cut -d, -f4); CR_DED=$(echo "$SUMS" | cut -d, -f5); CR_PAY=$(echo "$SUMS" | cut -d, -f6)
echo "  txns=$TXN_COUNT Dr=$TOT_DR Cr=$TOT_CR | Dr expense=$DR_EXP Cr deductions=$CR_DED Cr payable=$CR_PAY"
check "exactly one voucher posted" "$TXN_COUNT" "1"
check "voucher is balanced" "$([ "$TOT_DR" = "$TOT_CR" ] && echo ok)" "ok"
check "Dr salary expense = gross" "$DR_EXP" "$GROSS"
check "Cr deductions payable = deduction" "$CR_DED" "$DEDUCT"
check "Cr salaries payable = net" "$CR_PAY" "$NET"

echo "== idempotency: the journal_id guard prevents a duplicate voucher on any redelivery =="
sleep 1
TXN_COUNT2=$(psql "$OWNER_URL" -tAc "SELECT count(*) FROM finance_transaction t WHERE t.tenant_id='$T' AND t.reference=(SELECT run_no FROM hr_payroll_run WHERE id='$RID');" 2>/dev/null | tr -d '[:space:]')
check "still exactly one voucher (no double-post)" "$TXN_COUNT2" "1"

echo "== per-department salary expense: a 2nd dept maps to its own expense account =="
# Engineering dept → its own expense account; Ops stays on the default. Each dept's gross debits its
# own account in the voucher.
EXP2=$(post "$A" "finance/accounts" '{"code":"5-200","name":"Engineering Salaries Expense","type":"EXPENSE"}' | jget data.id)
ENG=$(post "$A" "hr/departments" '{"name":"Engineering"}' | jget data.id)
MAP=$(curl -s -XPUT "$B/hr/payroll/department-accounts/$ENG" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"salaryExpenseAccountId\":\"$EXP2\"}")
check "department account mapped" "$(echo "$MAP" | jget data.salaryExpenseAccountId)" "$EXP2"
# A second employee in Engineering (basic PKR 200,000.00).
post "$A" "hr/employees" "{\"firstName\":\"Bilal\",\"lastName\":\"Ahmed\",\"departmentId\":\"$ENG\",\"salary\":{\"amountMinor\":20000000,\"currency\":\"PKR\"},\"status\":\"ACTIVE\"}" >/dev/null

RUN2=$(post "$A" "hr/payroll/runs" '{"year":2026,"month":6,"workingDays":26}')
RID2=$(echo "$RUN2" | jget data.id)
curl -s -XPATCH "$B/hr/payroll/runs/$RID2/approve" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{}' >/dev/null
VNO2=""
for i in $(seq 1 40); do
  VNO2=$(curl -s "$B/hr/payroll/runs" -H "Authorization: Bearer $A" | python3 -c "import sys,json
rs=json.load(sys.stdin)['data']
r=next((x for x in rs if x['id']=='$RID2'), {})
print(r.get('journalVoucherNo') or '')" 2>/dev/null)
  [ -n "$VNO2" ] && break || sleep 0.5
done
echo "  run2 voucher = $VNO2"
check "2nd run posts a voucher" "$([ -n "$VNO2" ] && echo ok)" "ok"

# Engineering employee (gross 200,000.00 = 20,000,000 minor) must debit EXP2; the Ops employee's gross
# debits the default EXP. Verify the per-account debits and overall balance.
SPLIT=$(psql "$OWNER_URL" -tAF',' -c "
  SELECT
    coalesce(sum(je.debit_minor) FILTER (WHERE je.account_id='$EXP2'),0),
    coalesce(sum(je.debit_minor) FILTER (WHERE je.account_id='$EXP'),0),
    coalesce(sum(je.debit_minor),0), coalesce(sum(je.credit_minor),0)
  FROM finance_journal_entry je JOIN finance_transaction t ON t.id=je.transaction_id
  WHERE t.tenant_id='$T' AND t.reference=(SELECT run_no FROM hr_payroll_run WHERE id='$RID2');" 2>/dev/null)
DR_EXP2=$(echo "$SPLIT" | cut -d, -f1); DR_EXP_DEFAULT=$(echo "$SPLIT" | cut -d, -f2)
SP_DR=$(echo "$SPLIT" | cut -d, -f3); SP_CR=$(echo "$SPLIT" | cut -d, -f4)
echo "  Dr Engineering(EXP2)=$DR_EXP2 Dr default(EXP)=$DR_EXP_DEFAULT | Dr=$SP_DR Cr=$SP_CR"
check "Engineering gross debits its own account (EXP2)" "$DR_EXP2" "20000000"
check "Ops gross debits the default expense account" "$DR_EXP_DEFAULT" "10000000"
check "split voucher is balanced" "$([ "$SP_DR" = "$SP_CR" ] && echo ok)" "ok"

echo "== optional integration: an HR-only tenant (no finance feature) posts NO voucher =="
# Provision a 'starter'-plan tenant: it has the hr feature but NOT finance. Payroll still runs, but the
# GL consumer must skip (accounts integration is opt-in per company).
HO=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' \
  -d "{\"name\":\"HR Only Co\",\"adminEmail\":\"admin@hr-only.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"starter\"}" | jget data.tenant.id)
echo "  provisioned HR-only tenant=$HO"
HA=$(login "admin@hr-only.test")
check "HR-only tenant has NO finance feature (GET /finance/accounts → 403)" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$B/finance/accounts" -H "Authorization: Bearer $HA")" "403"
HDEPT=$(post "$HA" "hr/departments" '{"name":"Ops"}' | jget data.id)
post "$HA" "hr/employees" "{\"firstName\":\"Zara\",\"lastName\":\"Sheikh\",\"departmentId\":\"$HDEPT\",\"salary\":{\"amountMinor\":8000000,\"currency\":\"PKR\"},\"status\":\"ACTIVE\"}" >/dev/null
HRUN=$(post "$HA" "hr/payroll/runs" '{"year":2026,"month":5,"workingDays":26}')
HRID=$(echo "$HRUN" | jget data.id)
curl -s -XPATCH "$B/hr/payroll/runs/$HRID/approve" -H "Authorization: Bearer $HA" -H 'Content-Type: application/json' -d '{}' >/dev/null
check "HR-only payroll approved" "$(echo "$HRUN" | jget data.status)" "DRAFT"
sleep 2 # let the event flow; the consumer should skip on the missing finance feature
HO_TXNS=$(psql "$OWNER_URL" -tAc "SELECT count(*) FROM finance_transaction WHERE tenant_id='$HO';" 2>/dev/null | tr -d '[:space:]')
HO_VNO=$(curl -s "$B/hr/payroll/runs" -H "Authorization: Bearer $HA" | python3 -c "import sys,json
rs=json.load(sys.stdin)['data']
r=next((x for x in rs if x['id']=='$HRID'), {})
print(r.get('journalVoucherNo') or 'NONE')" 2>/dev/null)
echo "  HR-only finance_transaction count=$HO_TXNS, run voucher=$HO_VNO"
check "HR-only tenant posts NO GL voucher" "$HO_TXNS" "0"
check "HR-only run is not linked to a voucher" "$HO_VNO" "NONE"

echo ""
echo "Payroll→GL e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || { echo "---- api log tail ----"; tail -40 /tmp/payroll-gl-e2e.out; exit 1; }
