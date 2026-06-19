#!/usr/bin/env bash
# CRM CRUD e2e: exercises the newly-added update/delete endpoints + the camelCase response fix through
# the real API — account create/read(camelCase)/update/delete, contact create/update/delete, lead
# create/update/status/convert, deal create/update/stage/delete, activity create/update/complete/delete.
# Tenant isolation holds (another tenant gets 404). Mirrors subscriptions-e2e.sh.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PLATFORM="11111111-1111-1111-1111-111111111111"
PW1=Password; PW2='123!'; PASSWORD="$PW1$PW2"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d))" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('crmsa@acme.test','admin@crmco.test','admin@crmtwo.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE name IN ('CRM Co','CRM Two'));
DELETE FROM tenants WHERE name IN ('CRM Co','CRM Two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','crmsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3450; for p in 3450 3451 3452 3453; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/crm-e2e.out 2>&1 < /dev/null &
trap 'for pid in $(pgrep -f "apps/api/dist/main.js"); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done' EXIT
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
patch() { curl -s -XPATCH "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
del() { curl -s -XDELETE "$B/$2" -H "Authorization: Bearer $1"; }
get() { curl -s "$B/$2" -H "Authorization: Bearer $1"; }
codeauth() { curl -s -o /dev/null -w "%{http_code}" "$B/$2" -H "Authorization: Bearer $1"; }

SA=$(login "crmsa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"CRM Co\",\"adminEmail\":\"admin@crmco.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
A=$(login "admin@crmco.test")
echo "tenant=$T"

echo "== accounts: create → camelCase read → update → delete =="
ACC=$(post "$A" crm/clients '{"companyName":"Acme Inc","industry":"SaaS","status":"PROSPECT","city":"Lahore"}')
AID=$(echo "$ACC" | jget data.id)
check "account create returns camelCase companyName" "$(echo "$ACC" | jget data.companyName)" "Acme Inc"
check "list returns camelCase companyName" "$(get "$A" crm/clients | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['companyName'])")" "Acme Inc"
check "get single account (new endpoint)" "$(get "$A" "crm/clients/$AID" | jget data.companyName)" "Acme Inc"
UPD=$(patch "$A" "crm/clients/$AID" '{"companyName":"Acme Corp","status":"ACTIVE"}')
check "update account companyName" "$(echo "$UPD" | jget data.companyName)" "Acme Corp"
check "update account status" "$(echo "$UPD" | jget data.status)" "ACTIVE"

echo "== contacts: create → update(primary) → delete =="
C=$(post "$A" crm/contacts "{\"clientId\":\"$AID\",\"name\":\"Dana Scully\",\"email\":\"dana@acme.test\"}")
CID=$(echo "$C" | jget data.id)
check "contact create camelCase isPrimary" "$(echo "$C" | jget data.isPrimary)" "False"
check "contact update sets primary" "$(patch "$A" "crm/contacts/$CID" '{"isPrimary":true}' | jget data.isPrimary)" "True"
check "contact delete" "$(del "$A" "crm/contacts/$CID" | jget data.ok)" "True"
check "deleted contact gone from list" "$(get "$A" "crm/clients/$AID/contacts" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "0"

echo "== leads: create → update → status → convert =="
L=$(post "$A" crm/leads '{"name":"Fox Mulder","company":"Trustno1","rating":"WARM","estValueMinor":500000}')
LID=$(echo "$L" | jget data.id)
check "lead update rating" "$(patch "$A" "crm/leads/$LID" '{"rating":"HOT","notes":"keen"}' | jget data.rating)" "HOT"
check "lead status → QUALIFIED" "$(patch "$A" "crm/leads/$LID/status" '{"status":"QUALIFIED"}' | jget data.status)" "QUALIFIED"
CONV=$(post "$A" "crm/leads/$LID/convert" '{"createDeal":true,"dealTitle":"Trustno1 deal","dealValueMinor":500000}')
check "convert creates account" "$(echo "$CONV" | jget data.clientId | grep -c '-')" "1"
check "convert creates deal" "$(echo "$CONV" | jget data.dealId | grep -c '-')" "1"
check "converted lead is CONVERTED" "$(get "$A" "crm/leads/$LID" | jget data.status)" "CONVERTED"
check "lead delete (new endpoint)" "$(del "$A" "crm/leads/$LID" | jget data.ok)" "True"

echo "== deals: create → update → stage → delete =="
D=$(post "$A" crm/deals "{\"clientId\":\"$AID\",\"title\":\"Big deal\",\"valueMinor\":1000000,\"stage\":\"LEAD\"}")
DID=$(echo "$D" | jget data.id)
check "deal update title + value" "$(patch "$A" "crm/deals/$DID" '{"title":"Bigger deal","valueMinor":2000000}' | jget data.title)" "Bigger deal"
check "deal updated value weighted recomputed" "$(get "$A" "crm/deals/$DID" | jget data.value.amountMinor)" "2000000"
check "deal stage → NEGOTIATION" "$(patch "$A" "crm/deals/$DID/stage" '{"stage":"NEGOTIATION"}' | jget data.stage)" "NEGOTIATION"
check "deal delete (new endpoint)" "$(del "$A" "crm/deals/$DID" | jget data.ok)" "True"
check "deleted deal → 404" "$(codeauth "$A" "crm/deals/$DID")" "404"

echo "== activities: create → update → complete → delete =="
ACT=$(post "$A" crm/activities "{\"type\":\"CALL\",\"subject\":\"Intro call\",\"clientId\":\"$AID\"}")
ACTID=$(echo "$ACT" | jget data.id)
check "activity update subject" "$(patch "$A" "crm/activities/$ACTID" '{"subject":"Follow-up call","type":"MEETING"}' | jget data.subject)" "Follow-up call"
check "activity complete" "$(patch "$A" "crm/activities/$ACTID/complete" '{"outcome":"went well"}' | jget data.completed)" "True"
check "activity filtered by client" "$(get "$A" "crm/activities?clientId=$AID" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "1"
check "activity delete (new endpoint)" "$(del "$A" "crm/activities/$ACTID" | jget data.ok)" "True"

echo "== delete account + tenant isolation =="
check "account delete (new endpoint)" "$(del "$A" "crm/clients/$AID" | jget data.ok)" "True"
check "deleted account → 404" "$(codeauth "$A" "crm/clients/$AID")" "404"
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"CRM Two\",\"adminEmail\":\"admin@crmtwo.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" >/dev/null; login "admin@crmtwo.test")
ACC2=$(post "$A" crm/clients '{"companyName":"Visible Only To T1"}')
AID2=$(echo "$ACC2" | jget data.id)
check "other tenant cannot read tenant 1's account" "$(codeauth "$T2" "crm/clients/$AID2")" "404"

echo ""
echo "──────── $pass passed, $fail failed ────────"
[ "$fail" -eq 0 ]
