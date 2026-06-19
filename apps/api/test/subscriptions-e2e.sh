#!/usr/bin/env bash
# Subscriptions e2e: the recurring-billing engine through the real API + SQL — create plan → AUTO
# subscription bills + collects immediately → MRR metrics → the billing cycle re-bills a due subscription
# and advances the period → a MANUAL invoice goes overdue → dunning marks it PAST_DUE (emits
# payment_failed) → manual payment reactivates → dunning to exhaustion cancels the subscription
# (uncollectible, emits canceled) → a trial subscription bills only after the trial → cancel-at-period-end
# ends cleanly at the boundary → pause skips billing, resume restores it. Feature-gating + tenant
# isolation hold. Mirrors helpdesk-e2e.sh: side effects are asserted via the outbox + SQL state.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PLATFORM="11111111-1111-1111-1111-111111111111"
PW1=Password; PW2='123!'; PASSWORD="$PW1$PW2"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
checkne() { if [ "$2" != "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: did not expect '$3'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d))" "$1" 2>/dev/null; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('subsa@acme.test','admin@subs.test','admin@substwo.test','admin@substarter.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE name IN ('Sub Co','Sub Two','Sub Starter'));
DELETE FROM tenants WHERE name IN ('Sub Co','Sub Two','Sub Starter');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','subsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3440; for p in 3440 3441 3442 3443; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/subs-e2e.out 2>&1 < /dev/null &
trap 'for pid in $(pgrep -f "apps/api/dist/main.js"); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done' EXIT
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
patch() { curl -s -XPATCH "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
put() { curl -s -XPUT "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
get() { curl -s "$B/$2" -H "Authorization: Bearer $1"; }
codeauth() { curl -s -o /dev/null -w "%{http_code}" "$B/$2" -H "Authorization: Bearer $1"; }

SA=$(login "subsa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Sub Co\",\"adminEmail\":\"admin@subs.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
A=$(login "admin@subs.test")
echo "tenant=$T"

echo "== plans =="
PLAN=$(post "$A" subscriptions/plans '{"name":"Pro Monthly","code":"PRO-M","amountMinor":1000000,"taxRate":0,"billingInterval":"MONTH","intervalCount":1}')
PID=$(echo "$PLAN" | jget data.id)
check "plan created" "$(echo "$PLAN" | jget data.name)" "Pro Monthly"
check "duplicate plan code rejected" "$(post "$A" subscriptions/plans '{"name":"Dup","code":"PRO-M","amountMinor":1,"billingInterval":"MONTH"}' | jget status)" "400"
TRIALPLAN=$(post "$A" subscriptions/plans '{"name":"Trial Plan","code":"TRIAL-M","amountMinor":500000,"billingInterval":"MONTH","trialDays":14}')
TPID=$(echo "$TRIALPLAN" | jget data.id)

echo "== AUTO subscription bills + collects immediately =="
SA1=$(post "$A" subscriptions '{"planId":"'"$PID"'","customerName":"Dana Scully","customerEmail":"dana@buyer.test","collectionMode":"AUTO"}')
SID1=$(echo "$SA1" | jget data.id); SNO1=$(echo "$SA1" | jget data.subscriptionNo)
check "subscription ACTIVE (no trial)" "$(echo "$SA1" | jget data.status)" "ACTIVE"
check "first invoice generated" "$(echo "$SA1" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['invoices']))")" "1"
check "first invoice auto-PAID" "$(ownerq "SELECT status FROM sub_invoice WHERE subscription_id='$SID1'")" "PAID"
check "subscription.created in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='subscription.created.v1'")" "1"
check "invoice_paid in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='subscription.invoice_paid.v1'")" "1"

echo "== MRR / ARR metrics =="
MET=$(get "$A" subscriptions/metrics)
check "MRR = monthly plan price" "$(echo "$MET" | jget data.mrr.amountMinor)" "1000000"
check "ARR = 12x MRR" "$(echo "$MET" | jget data.arr.amountMinor)" "12000000"
check "active count" "$(echo "$MET" | jget data.active)" "1"

echo "== billing cycle re-bills a due subscription and advances the period =="
PE_BEFORE=$(ownerq "SELECT current_period_end FROM subscription WHERE id='$SID1'")
ownerq "UPDATE subscription SET next_billing_at = now() - interval '1 minute', current_period_end = now() - interval '1 minute' WHERE id='$SID1'" >/dev/null
RB=$(post "$A" subscriptions/run-billing '{}')
check "run-billing billed 1" "$(echo "$RB" | jget data.billed)" "1"
check "second invoice generated" "$(ownerq "SELECT count(*) FROM sub_invoice WHERE subscription_id='$SID1'")" "2"
check "both invoices PAID (AUTO)" "$(ownerq "SELECT count(*) FROM sub_invoice WHERE subscription_id='$SID1' AND status='PAID'")" "2"
check "period advanced into the future" "$(ownerq "SELECT current_period_end > now() FROM subscription WHERE id='$SID1'")" "t"

echo "== MANUAL invoice goes overdue → dunning → manual pay reactivates =="
SB=$(post "$A" subscriptions '{"planId":"'"$PID"'","customerName":"Fox Mulder","customerEmail":"fox@buyer.test","collectionMode":"MANUAL"}')
SID2=$(echo "$SB" | jget data.id)
INV2=$(ownerq "SELECT id FROM sub_invoice WHERE subscription_id='$SID2'")
check "MANUAL first invoice OPEN" "$(ownerq "SELECT status FROM sub_invoice WHERE id='$INV2'")" "OPEN"
ownerq "UPDATE sub_invoice SET due_date = now() - interval '1 day' WHERE id='$INV2'" >/dev/null
post "$A" subscriptions/run-billing '{}' >/dev/null
check "overdue → subscription PAST_DUE" "$(ownerq "SELECT status FROM subscription WHERE id='$SID2'")" "PAST_DUE"
check "payment_failed in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='subscription.payment_failed.v1'")" "1"
PAY=$(post "$A" "subscriptions/invoices/$INV2/pay" '{"paymentRef":"BANK-123"}')
check "manual pay marks PAID" "$(echo "$PAY" | jget data.status)" "PAID"
check "manual pay reactivates subscription" "$(ownerq "SELECT status FROM subscription WHERE id='$SID2'")" "ACTIVE"

echo "== dunning to exhaustion cancels the subscription =="
SC=$(post "$A" subscriptions '{"planId":"'"$PID"'","customerName":"Walter Skinner","customerEmail":"walter@buyer.test","collectionMode":"MANUAL"}')
SID3=$(echo "$SC" | jget data.id); SNO3=$(echo "$SC" | jget data.subscriptionNo)
INV3=$(ownerq "SELECT id FROM sub_invoice WHERE subscription_id='$SID3'")
# Pretend 3 attempts already failed; the 4th (MAX_DUNNING) tips it over.
ownerq "UPDATE subscription SET failed_attempts = 3 WHERE id='$SID3'" >/dev/null
ownerq "UPDATE sub_invoice SET due_date = now() - interval '1 day' WHERE id='$INV3'" >/dev/null
post "$A" subscriptions/run-billing '{}' >/dev/null
check "exhausted dunning → CANCELLED" "$(ownerq "SELECT status FROM subscription WHERE id='$SID3'")" "CANCELLED"
check "invoice UNCOLLECTIBLE" "$(ownerq "SELECT status FROM sub_invoice WHERE id='$INV3'")" "UNCOLLECTIBLE"
check "canceled in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='subscription.canceled.v1' AND payload->>'subscriptionNo'='$SNO3'")" "1"

echo "== trial subscription bills only after the trial =="
ST=$(post "$A" subscriptions '{"planId":"'"$TPID"'","customerName":"John Doggett","customerEmail":"john@buyer.test","collectionMode":"AUTO"}')
SID4=$(echo "$ST" | jget data.id)
check "trial → TRIALING" "$(echo "$ST" | jget data.status)" "TRIALING"
check "no invoice during trial" "$(ownerq "SELECT count(*) FROM sub_invoice WHERE subscription_id='$SID4'")" "0"
ownerq "UPDATE subscription SET next_billing_at = now() - interval '1 minute', current_period_end = now() - interval '1 minute' WHERE id='$SID4'" >/dev/null
post "$A" subscriptions/run-billing '{}' >/dev/null
check "after trial → ACTIVE" "$(ownerq "SELECT status FROM subscription WHERE id='$SID4'")" "ACTIVE"
check "first invoice generated after trial" "$(ownerq "SELECT count(*) FROM sub_invoice WHERE subscription_id='$SID4'")" "1"

echo "== cancel-at-period-end ends at the boundary =="
SD=$(post "$A" subscriptions '{"planId":"'"$PID"'","customerName":"Monica Reyes","customerEmail":"monica@buyer.test","collectionMode":"AUTO"}')
SID5=$(echo "$SD" | jget data.id)
post "$A" "subscriptions/$SID5/cancel" '{"atPeriodEnd":true}' >/dev/null
check "cancel_at_period_end set" "$(ownerq "SELECT cancel_at_period_end FROM subscription WHERE id='$SID5'")" "t"
check "still ACTIVE before boundary" "$(ownerq "SELECT status FROM subscription WHERE id='$SID5'")" "ACTIVE"
INVCNT5=$(ownerq "SELECT count(*) FROM sub_invoice WHERE subscription_id='$SID5'")
ownerq "UPDATE subscription SET next_billing_at = now() - interval '1 minute', current_period_end = now() - interval '1 minute' WHERE id='$SID5'" >/dev/null
post "$A" subscriptions/run-billing '{}' >/dev/null
check "boundary reached → CANCELLED" "$(ownerq "SELECT status FROM subscription WHERE id='$SID5'")" "CANCELLED"
check "no extra invoice at cancel boundary" "$(ownerq "SELECT count(*) FROM sub_invoice WHERE subscription_id='$SID5'")" "$INVCNT5"

echo "== pause skips billing; resume restores it =="
SE=$(post "$A" subscriptions '{"planId":"'"$PID"'","customerName":"Alex Krycek","customerEmail":"alex@buyer.test","collectionMode":"AUTO"}')
SID6=$(echo "$SE" | jget data.id)
post "$A" "subscriptions/$SID6/pause" '{}' >/dev/null
check "paused" "$(ownerq "SELECT status FROM subscription WHERE id='$SID6'")" "PAUSED"
PCNT=$(ownerq "SELECT count(*) FROM sub_invoice WHERE subscription_id='$SID6'")
ownerq "UPDATE subscription SET next_billing_at = now() - interval '1 minute' WHERE id='$SID6'" >/dev/null
post "$A" subscriptions/run-billing '{}' >/dev/null
check "paused subscription not billed" "$(ownerq "SELECT count(*) FROM sub_invoice WHERE subscription_id='$SID6'")" "$PCNT"
post "$A" "subscriptions/$SID6/resume" '{}' >/dev/null
check "resume → ACTIVE with future billing" "$(ownerq "SELECT status='ACTIVE' AND next_billing_at > now() FROM subscription WHERE id='$SID6'")" "t"

echo "== feature gating + tenant isolation =="
curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Sub Starter\",\"adminEmail\":\"admin@substarter.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"starter\"}" >/dev/null
STA=$(login "admin@substarter.test")
check "starter plan → subscriptions feature gated (403)" "$(codeauth "$STA" subscriptions/metrics)" "403"
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Sub Two\",\"adminEmail\":\"admin@substwo.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" >/dev/null; login "admin@substwo.test")
check "other tenant sees none of tenant 1's subscriptions" "$(get "$T2" subscriptions | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "0"
check "other tenant cannot read tenant 1's subscription" "$(codeauth "$T2" "subscriptions/$SID1")" "404"

echo ""
echo "──────── $pass passed, $fail failed ────────"
[ "$fail" -eq 0 ]
