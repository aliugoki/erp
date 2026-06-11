#!/usr/bin/env bash
# Order-to-cash saga e2e (Chunk 7.3): the happy path commits (stock consumed, invoice paid, on_hand
# down); injecting a failure at EACH step runs compensations that restore a consistent state — no
# orphaned reservation, no orphaned invoice, stock untouched.
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PASSWORD="Password123!"; TENANT_A="11111111-1111-1111-1111-111111111111"

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d))" "$1" 2>/dev/null; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email)='sagasa@acme.test';
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='saga-co');
DELETE FROM users WHERE tenant_id IN (SELECT id FROM tenants WHERE slug='saga-co');
DELETE FROM tenants WHERE slug='saga-co';
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$TENANT_A','sagasa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3400; for p in 3400 3401 3402 3403; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/orders-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }

SA=$(login "sagasa@acme.test")
T1=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d '{"name":"Saga Co","adminEmail":"admin@saga.test","adminPassword":"Password123!","plan":"business"}' | jget data.tenant.id)
A=$(login "admin@saga.test")
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO inventory_product (tenant_id, sku, name, unit, cost_price_minor, sell_price_minor, currency, min_stock, on_hand)
VALUES ('$T1','SO-PROD','Saga Product','ea',1000,5000,'PKR',5,100);
SQL
PROD=$(ownerq "SELECT id FROM inventory_product WHERE tenant_id='$T1' AND sku='SO-PROD'")
echo "tenant=$T1 product=$PROD on_hand=100"
order() { curl -s -XPOST "$B/orders" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "$1"; }
onhand() { ownerq "SELECT on_hand FROM inventory_product WHERE id='$PROD'"; }

echo "== happy path: reserve -> invoice -> pay =="
O=$(order "{\"productId\":\"$PROD\",\"quantity\":10,\"unitPriceMinor\":5000}")
OID=$(echo "$O" | jget data.id); RES=$(echo "$O" | jget data.reservation_id); INV=$(echo "$O" | jget data.invoice_id)
check "order PAID" "$(echo "$O" | jget data.status)" "PAID"
check "reservation CONSUMED" "$(ownerq "SELECT status FROM inventory_reservation WHERE id='$RES'")" "CONSUMED"
check "invoice PAID" "$(ownerq "SELECT status FROM finance_invoice WHERE id='$INV'")" "PAID"
check "stock decremented 100->90" "$(onhand)" "90"
check "order_completed event in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T1' AND type='orders.order_completed.v1'")" "1"

echo "== fail at RESERVE -> compensate (nothing held/invoiced) =="
O=$(order "{\"productId\":\"$PROD\",\"quantity\":5,\"unitPriceMinor\":5000,\"failAt\":\"reserve\"}")
check "order COMPENSATED" "$(echo "$O" | jget data.status)" "COMPENSATED"
check "failure step = reserve" "$(echo "$O" | jget data.failure_step)" "reserve"
check "no reservation" "$(echo "$O" | jget data.reservation_id)" "None"
check "no invoice" "$(echo "$O" | jget data.invoice_id)" "None"
check "stock unchanged (90)" "$(onhand)" "90"

echo "== fail at INVOICE -> compensate (reservation released, no invoice) =="
O=$(order "{\"productId\":\"$PROD\",\"quantity\":5,\"unitPriceMinor\":5000,\"failAt\":\"invoice\"}")
RES=$(echo "$O" | jget data.reservation_id)
check "order COMPENSATED" "$(echo "$O" | jget data.status)" "COMPENSATED"
check "failure step = invoice" "$(echo "$O" | jget data.failure_step)" "invoice"
check "reservation RELEASED (not orphaned)" "$(ownerq "SELECT status FROM inventory_reservation WHERE id='$RES'")" "RELEASED"
check "no invoice" "$(echo "$O" | jget data.invoice_id)" "None"
check "stock unchanged (90)" "$(onhand)" "90"

echo "== fail at PAY -> compensate (invoice voided, reservation released) =="
O=$(order "{\"productId\":\"$PROD\",\"quantity\":5,\"unitPriceMinor\":5000,\"failAt\":\"pay\"}")
RES=$(echo "$O" | jget data.reservation_id); INV=$(echo "$O" | jget data.invoice_id)
check "order COMPENSATED" "$(echo "$O" | jget data.status)" "COMPENSATED"
check "failure step = pay" "$(echo "$O" | jget data.failure_step)" "pay"
check "reservation RELEASED" "$(ownerq "SELECT status FROM inventory_reservation WHERE id='$RES'")" "RELEASED"
check "invoice VOID (not orphaned/paid)" "$(ownerq "SELECT status FROM finance_invoice WHERE id='$INV'")" "VOID"
check "stock unchanged (90)" "$(onhand)" "90"

echo "== insufficient stock -> compensate at reserve =="
O=$(order "{\"productId\":\"$PROD\",\"quantity\":9999,\"unitPriceMinor\":5000}")
check "oversell order COMPENSATED" "$(echo "$O" | jget data.status)" "COMPENSATED"
check "stock still 90 (no overcommit)" "$(onhand)" "90"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
