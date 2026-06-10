#!/usr/bin/env bash
# CRM module e2e (Chunk 3.4): feature/role gates, clients/contacts/deals, pipeline grouping+totals,
# and crm.deal_closed -> outbox on reaching CLOSED_WON (once).
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
jlen() { python3 -c "import sys,json
d=json.load(sys.stdin); d=d.get('data',d) if isinstance(d,dict) else d
print(len(d) if isinstance(d,list) else 0)" 2>/dev/null; }
# pull stage field from a pipeline response: stagefield <stage> <field>
stagefield() { python3 -c "import sys,json
d=json.load(sys.stdin)['data']
s=[x for x in d if x['stage']==sys.argv[1]]
print(s[0][sys.argv[2]] if s else 'missing')" "$1" "$2" 2>/dev/null; }
stagetotal() { python3 -c "import sys,json
d=json.load(sys.stdin)['data']
s=[x for x in d if x['stage']==sys.argv[1]]
print(s[0]['total']['amountMinor'] if s else 'missing')" "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('crmsa@acme.test','crmrep@crmco.test','crmview@crmco.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('crm-co','crm-two'));
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug IN ('crm-co','crm-two'));
DELETE FROM tenants WHERE slug IN ('crm-co','crm-two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','crmsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/crm-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }

SA=$(login "crmsa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"CRM Co","adminEmail":"admin@crmco.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
T2=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"CRM Two","adminEmail":"admin@crmtwo.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES
 ('$T1','crmrep@crmco.test','$HASH',true,'{SALES_REP}'),
 ('$T1','crmview@crmco.test','$HASH',true,'{VIEWER}');
SQL
REP=$(login "crmrep@crmco.test"); VIEW=$(login "crmview@crmco.test"); ADMIN2=$(login "admin@crmtwo.test")
echo "tenant CRM Co=$T1"

echo "== feature + role gates =="
check "GET /crm/clients -> 200" "$(code "$B/crm/clients" -H "Authorization: Bearer $REP")" "200"
check "VIEWER POST client -> 403" "$(code -XPOST "$B/crm/clients" -H "Authorization: Bearer $VIEW" -H 'Content-Type: application/json' -d '{"companyName":"X"}')" "403"

echo "== client + contact + deals =="
CLIENT=$(post "$REP" crm/clients '{"companyName":"Acme Traders","industry":"Retail","status":"ACTIVE"}' | jget data.id)
check "create contact -> 201" "$(code -XPOST "$B/crm/contacts" -H "Authorization: Bearer $REP" -H 'Content-Type: application/json' -d "{\"clientId\":\"$CLIENT\",\"name\":\"Imran\",\"isPrimary\":true}")" "201"
D1=$(post "$REP" crm/deals "{\"clientId\":\"$CLIENT\",\"title\":\"Deal A\",\"valueMinor\":500000,\"stage\":\"LEAD\"}" | jget data.id)
D2=$(post "$REP" crm/deals "{\"clientId\":\"$CLIENT\",\"title\":\"Deal B\",\"valueMinor\":300000,\"stage\":\"LEAD\"}" | jget data.id)
D3=$(post "$REP" crm/deals "{\"clientId\":\"$CLIENT\",\"title\":\"Deal C\",\"valueMinor\":1000000,\"stage\":\"PROPOSAL\"}" | jget data.id)
[ -n "$D1" ] && [ -n "$D2" ] && [ -n "$D3" ] && echo "  ✅ 3 deals created" && pass=$((pass+1)) || { echo "  ❌ deal create failed"; fail=$((fail+1)); }

echo "== pipeline grouping + Money totals =="
PIPE=$(curl -s "$B/crm/deals/pipeline" -H "Authorization: Bearer $REP")
check "pipeline has all 6 stages" "$(echo "$PIPE" | jlen)" "6"
check "LEAD count == 2" "$(echo "$PIPE" | stagefield LEAD count)" "2"
check "LEAD total == 800000" "$(echo "$PIPE" | stagetotal LEAD)" "800000"
check "PROPOSAL total == 1000000" "$(echo "$PIPE" | stagetotal PROPOSAL)" "1000000"
check "CLOSED_WON total == 0 (empty stage)" "$(echo "$PIPE" | stagetotal CLOSED_WON)" "0"

echo "== close a deal -> crm.deal_closed outbox (once) =="
check "move Deal C -> CLOSED_WON -> 200" "$(code -XPATCH "$B/crm/deals/$D3/stage" -H "Authorization: Bearer $REP" -H 'Content-Type: application/json' -d '{"stage":"CLOSED_WON"}')" "200"
check "crm.deal_closed written to OUTBOX (pending)" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T1' AND type='crm.deal_closed.v1' AND published_at IS NULL")" "1"
echo "  -- re-applying CLOSED_WON must NOT emit again --"
code -XPATCH "$B/crm/deals/$D3/stage" -H "Authorization: Bearer $REP" -H 'Content-Type: application/json' -d '{"stage":"CLOSED_WON"}' >/dev/null
check "still exactly 1 deal_closed event (idempotent transition)" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T1' AND type='crm.deal_closed.v1'")" "1"

echo "== pipeline reflects the win =="
check "CLOSED_WON total == 1000000 after close" "$(curl -s "$B/crm/deals/pipeline" -H "Authorization: Bearer $REP" | stagetotal CLOSED_WON)" "1000000"

echo "== tenant isolation =="
check "CRM Two sees no clients" "$(curl -s "$B/crm/clients" -H "Authorization: Bearer $ADMIN2" | jlen)" "0"
check "CRM Two GET CRM Co deal -> 404" "$(code "$B/crm/deals/$D3" -H "Authorization: Bearer $ADMIN2")" "404"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
