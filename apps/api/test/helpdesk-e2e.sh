#!/usr/bin/env bash
# Help Desk e2e: the full ticket lifecycle through the real API + SQL — create → assign → agent reply
# (meets first-response SLA) → internal note → PENDING pauses the SLA clock → resume shifts the due date
# → resolve → CSAT; an SLA breach sweep flags an overdue ticket; the customer portal (storefront auth)
# raises + tracks a ticket and never sees internal notes; feature-gating + tenant isolation hold.
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
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('hdsa@acme.test','admin@help.test','agent@help.test','admin@helptwo.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE name IN ('Help Co','Help Two'));
DELETE FROM tenants WHERE name IN ('Help Co','Help Two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','hdsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3430; for p in 3430 3431 3432 3433; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/hd-e2e.out 2>&1 < /dev/null &
trap 'for pid in $(pgrep -f "apps/api/dist/main.js"); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done' EXIT
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
put() { curl -s -XPUT "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
patch() { curl -s -XPATCH "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
ppost() { curl -s -XPOST "$B/$1" -H 'Content-Type: application/json' -d "$2"; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

SA=$(login "hdsa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Help Co\",\"adminEmail\":\"admin@help.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
SLUG=$(ownerq "SELECT slug FROM tenants WHERE id='$T'")
A=$(login "admin@help.test")
# A support agent (role-based).
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$T','agent@help.test','$HASH',true,'{SUPPORT_AGENT}');
SQL
AGENT_ID=$(ownerq "SELECT id FROM users WHERE tenant_id='$T' AND email='agent@help.test'")
echo "tenant=$T slug=$SLUG agent=$AGENT_ID"

echo "== SLA policy + ticket creation =="
put "$A" helpdesk/sla-policies '{"priority":"HIGH","firstResponseMins":60,"resolutionMins":480}' >/dev/null
TK=$(post "$A" helpdesk/tickets '{"subject":"Login fails","body":"I cannot log in","requesterName":"Dana Scully","requesterEmail":"dana@buyer.test","priority":"HIGH","channel":"WEB"}')
TID=$(echo "$TK" | jget data.id); TNO=$(echo "$TK" | jget data.ticketNo)
check "ticket created NEW" "$(echo "$TK" | jget data.status)" "NEW"
check "first message captured" "$(echo "$TK" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['messages']))")" "1"
check "SLA due dates set" "$(ownerq "SELECT first_response_due_at IS NOT NULL AND resolution_due_at IS NOT NULL FROM hd_ticket WHERE id='$TID'")" "t"
check "ticket.created in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='helpdesk.ticket_created.v1'")" "1"

echo "== assignment =="
check "agent listed for assignment" "$(curl -s "$B/helpdesk/agents" -H "Authorization: Bearer $A" | python3 -c "import sys,json;print(any(a['email']=='agent@help.test' for a in json.load(sys.stdin)['data']))")" "True"
AS=$(post "$A" "helpdesk/tickets/$TID/assign" "{\"assignedTo\":\"$AGENT_ID\"}")
check "assign moves NEW→OPEN" "$(echo "$AS" | jget data.status)" "OPEN"
check "ticket.assigned in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='helpdesk.ticket_assigned.v1'")" "1"

echo "== agent reply meets first-response SLA; internal note stays private =="
AGT=$(login "agent@help.test")
post "$AGT" "helpdesk/tickets/$TID/reply" '{"body":"Hi Dana, can you try a password reset?"}' >/dev/null
check "first_responded_at recorded" "$(ownerq "SELECT first_responded_at IS NOT NULL FROM hd_ticket WHERE id='$TID'")" "t"
check "agent reply emits ticket.replied" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='helpdesk.ticket_replied.v1'")" "1"
post "$AGT" "helpdesk/tickets/$TID/reply" '{"body":"internal: customer is on the enterprise plan","isInternal":true}' >/dev/null
check "internal note not counted public" "$(curl -s "$B/helpdesk/tickets/$TID" -H "Authorization: Bearer $A" | jget data.messageCount)" "2"

echo "== SLA pause on PENDING, resume shifts the due date =="
R0=$(ownerq "SELECT resolution_due_at FROM hd_ticket WHERE id='$TID'")
post "$AGT" "helpdesk/tickets/$TID/status" '{"status":"PENDING"}' >/dev/null
check "PENDING pauses the SLA clock" "$(ownerq "SELECT sla_paused_at IS NOT NULL FROM hd_ticket WHERE id='$TID'")" "t"
ownerq "UPDATE hd_ticket SET sla_paused_at = now() - interval '20 minutes' WHERE id='$TID'" >/dev/null
post "$AGT" "helpdesk/tickets/$TID/status" '{"status":"OPEN"}' >/dev/null
check "resume clears the pause" "$(ownerq "SELECT sla_paused_at IS NULL FROM hd_ticket WHERE id='$TID'")" "t"
check "resume pushed the resolution due date out" "$(ownerq "SELECT resolution_due_at > '$R0'::timestamptz FROM hd_ticket WHERE id='$TID'")" "t"

echo "== resolve + CSAT =="
post "$AGT" "helpdesk/tickets/$TID/status" '{"status":"RESOLVED"}' >/dev/null
check "resolved_at set" "$(ownerq "SELECT resolved_at IS NOT NULL FROM hd_ticket WHERE id='$TID'")" "t"
check "ticket.resolved in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='helpdesk.ticket_resolved.v1'")" "1"
post "$A" "helpdesk/tickets/$TID/csat" '{"rating":5,"comment":"Quick help"}' >/dev/null
check "CSAT recorded" "$(ownerq "SELECT csat_rating FROM hd_ticket WHERE id='$TID'")" "5"

echo "== SLA breach sweep flags an overdue ticket =="
BK=$(post "$A" helpdesk/tickets '{"subject":"Urgent outage","body":"site down","requesterName":"Fox Mulder","requesterEmail":"fox@buyer.test","priority":"URGENT"}')
BID=$(echo "$BK" | jget data.id)
ownerq "UPDATE hd_ticket SET first_response_due_at = now() - interval '1 hour' WHERE id='$BID'" >/dev/null
check "sweep reports a breach" "$(post "$A" helpdesk/sla/sweep '{}' | jget data.breached)" "1"
check "first_response_breached flagged" "$(ownerq "SELECT first_response_breached FROM hd_ticket WHERE id='$BID'")" "t"
check "sla.breached in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='helpdesk.sla_breached.v1'")" "1"
check "overview counts the breach" "$(curl -s "$B/helpdesk/overview" -H "Authorization: Bearer $A" | jget data.breached)" "1"

echo "== customer portal (storefront auth): raise + track, internal notes hidden =="
put "$A" ecommerce/store '{"name":"Help Co Store","published":true}' >/dev/null
CTOK=$(ppost "shop/$SLUG/account/register" "{\"name\":\"Dana Scully\",\"email\":\"dana@buyer.test\",\"password\":\"$PASSWORD\"}" | jget data.token)
PTK=$(curl -s -XPOST "$B/shop/$SLUG/support" -H "Authorization: Bearer $CTOK" -H 'Content-Type: application/json' -d '{"subject":"Where is my order?","body":"It has not arrived","priority":"MEDIUM"}')
PNO=$(echo "$PTK" | jget data.ticketNo)
check "portal ticket created" "$([ -n "$PNO" ] && echo ok)" "ok"
check "portal submit needs auth → 401" "$(code -XPOST "$B/shop/$SLUG/support" -H 'Content-Type: application/json' -d '{"subject":"x","body":"y"}')" "401"
check "portal lists the customer's tickets" "$(curl -s "$B/shop/$SLUG/support" -H "Authorization: Bearer $CTOK" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data'])>=1)")" "True"
# Agent adds a public reply + an internal note to the portal ticket; the customer must see only the public one.
PID=$(ownerq "SELECT id FROM hd_ticket WHERE tenant_id='$T' AND ticket_no='$PNO'")
post "$A" "helpdesk/tickets/$PID/reply" '{"body":"It ships tomorrow"}' >/dev/null
post "$A" "helpdesk/tickets/$PID/reply" '{"body":"internal: check courier","isInternal":true}' >/dev/null
check "portal hides internal notes" "$(curl -s "$B/shop/$SLUG/support/$PNO" -H "Authorization: Bearer $CTOK" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['messages']))")" "2"
check "customer reply reopens after pending" "$(post "$A" "helpdesk/tickets/$PID/status" '{"status":"PENDING"}' >/dev/null; curl -s -XPOST "$B/shop/$SLUG/support/$PNO/reply" -H "Authorization: Bearer $CTOK" -H 'Content-Type: application/json' -d '{"body":"thanks"}' | jget data.status)" "OPEN"

echo "== feature gating + tenant isolation =="
curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Help Two\",\"adminEmail\":\"admin@helptwo.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"starter\"}" >/dev/null
A2=$(login "admin@helptwo.test")
check "starter plan: helpdesk feature-gated → 403" "$(code "$B/helpdesk/tickets" -H "Authorization: Bearer $A2")" "403"
check "tenant isolation: Help Co has its own tickets only" "$(curl -s "$B/helpdesk/tickets" -H "Authorization: Bearer $A" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "3"

echo; echo "Help Desk e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
