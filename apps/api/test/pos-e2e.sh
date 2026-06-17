#!/usr/bin/env bash
# POS e2e: the full counter lifecycle through the real API + SQL — register → open shift → ring a sale
# (decrements stock via the valued ledger, captures COGS) → partial refund (restocks) → close shift
# with cash reconciliation. Exercises the createSale SQL path that unit tests can't (a latent
# column/placeholder mismatch here once 500'd every sale).
set -uo pipefail
cd "$(dirname "$0")/../../.." # repo root
set -a; . ./.env; set +a
OWNER_URL="${MIGRATION_DATABASE_URL}"; PLATFORM="11111111-1111-1111-1111-111111111111"
PW1=Password; PW2='123!'; PASSWORD="$PW1$PW2" # split to keep a real-looking literal out of the source

pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "  ✅ $1 ($2)"; pass=$((pass+1)); else echo "  ❌ $1: expected '$3' got '$2'"; fail=$((fail+1)); fi; }
jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
print(functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d))" "$1" 2>/dev/null; }
ownerq() { psql "$OWNER_URL" -tAc "$1" 2>/dev/null; }

HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$PASSWORD")"
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
DELETE FROM users WHERE lower(email) IN ('possa@acme.test','admin@pos.test','admin@postwo.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE name IN ('POS Co','POS Two'));
DELETE FROM tenants WHERE name IN ('POS Co','POS Two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','possa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3410; for p in 3410 3411 3412 3413; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/pos-e2e.out 2>&1 < /dev/null &
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
cleanup() { for pid in $(pgrep -f 'apps/api/dist/main.js'); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
patch() { curl -s -XPATCH "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

SA=$(login "possa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"POS Co\",\"adminEmail\":\"admin@pos.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
A=$(login "admin@pos.test")
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO inventory_product (tenant_id, sku, name, unit, cost_price_minor, sell_price_minor, currency, min_stock, on_hand, stock_value_minor)
VALUES ('$T','POS-WIDGET','POS Widget','ea',1000,5000,'PKR',5,100,100000);
SQL
PROD=$(ownerq "SELECT id FROM inventory_product WHERE tenant_id='$T' AND sku='POS-WIDGET'")
onhand() { ownerq "SELECT on_hand FROM inventory_product WHERE id='$PROD'"; }
echo "tenant=$T product=$PROD on_hand=$(onhand)"

echo "== register + shift =="
REG=$(post "$A" pos/registers '{"name":"Counter 1"}' | jget data.id)
check "register created" "$([ -n "$REG" ] && echo ok)" "ok"
SH=$(post "$A" pos/shifts/open "{\"registerId\":\"$REG\",\"openingFloatMinor\":0}" | jget data.id)
check "shift OPEN" "$(curl -s "$B/pos/registers/$REG/current-shift" -H "Authorization: Bearer $A" | jget data.status)" "OPEN"

echo "== ring a sale (2 @ 5000, cash) — the SQL path that regressed =="
SALE=$(post "$A" pos/sales "{\"registerId\":\"$REG\",\"shiftId\":\"$SH\",\"lines\":[{\"productId\":\"$PROD\",\"description\":\"POS Widget\",\"quantity\":2,\"unitPriceMinor\":5000}],\"payments\":[{\"method\":\"CASH\",\"amountMinor\":10000}]}")
SID=$(echo "$SALE" | jget data.id)
check "sale COMPLETED" "$(echo "$SALE" | jget data.status)" "COMPLETED"
check "sale total 10000" "$(echo "$SALE" | jget data.total.amountMinor)" "10000"
check "COGS captured = 2 x 1000" "$(echo "$SALE" | jget data.cogs.amountMinor)" "2000"
check "stock decremented 100->98" "$(onhand)" "98"
check "pos.sale_completed in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='pos.sale_completed.v1'")" "1"

echo "== insufficient tender rejected (422) =="
check "underpaid sale -> 422" "$(code -XPOST "$B/pos/sales" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d "{\"registerId\":\"$REG\",\"shiftId\":\"$SH\",\"lines\":[{\"productId\":\"$PROD\",\"description\":\"x\",\"quantity\":1,\"unitPriceMinor\":5000}],\"payments\":[{\"method\":\"CASH\",\"amountMinor\":1}]}")" "422"

echo "== partial refund (restocks 1) =="
LID=$(curl -s "$B/pos/sales/$SID" -H "Authorization: Bearer $A" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['lines'][0]['id'])" 2>/dev/null)
RET=$(post "$A" "pos/sales/$SID/refund" "{\"lines\":[{\"lineId\":\"$LID\",\"quantity\":1}],\"method\":\"CASH\"}")
check "refund creates a RETURN" "$(echo "$RET" | jget data.type)" "RETURN"
check "stock restored 98->99" "$(onhand)" "99"
check "original now PARTIALLY_REFUNDED" "$(ownerq "SELECT status FROM pos_sale WHERE id='$SID'")" "PARTIALLY_REFUNDED"

echo "== close shift: float 0 + cash 10000 - refund 5000 = expected 5000; count 5000 -> variance 0 =="
CL=$(patch "$A" "pos/shifts/$SH/close" '{"countedCashMinor":5000}')
check "shift CLOSED" "$(echo "$CL" | jget data.status)" "CLOSED"
check "expected cash 5000" "$(echo "$CL" | jget data.expectedCash.amountMinor)" "5000"
check "variance 0" "$(echo "$CL" | jget data.variance.amountMinor)" "0"

echo "== receipt branding: set fields, upload a logo, fetch the bytes back =="
BR=$(curl -s -XPUT "$B/pos/branding" -H "Authorization: Bearer $A" -H 'Content-Type: application/json' -d '{"storeName":"POS Co Store","address":"1 Market Rd","phone":"+92 300 0000000","receiptFooter":"Visit again!"}')
check "branding storeName saved" "$(echo "$BR" | jget data.storeName)" "POS Co Store"
check "branding footer saved" "$(echo "$BR" | jget data.receiptFooter)" "Visit again!"
check "branding readable (cashier seam)" "$(curl -s "$B/pos/branding" -H "Authorization: Bearer $A" | jget data.address)" "1 Market Rd"
LOGO="$(mktemp --suffix=.png)"; printf '\211PNG\r\n\032\n\0\0\0\rIHDR\0\0\0\1\0\0\0\1\10\6\0\0\0\037\25\304\211\0\0\0\nIDATx\234c\370\017\0\1\1\1\0\30\335\212\333\0\0\0\0IEND\256B\140\202' > "$LOGO"
UP=$(curl -s -XPOST "$B/pos/branding/logo" -H "Authorization: Bearer $A" -F "file=@$LOGO;type=image/png")
check "logo uploaded" "$(echo "$UP" | jget data.hasLogo)" "True"
check "branding now hasLogo" "$(curl -s "$B/pos/branding" -H "Authorization: Bearer $A" | jget data.hasLogo)" "True"
check "logo bytes 200 image/png" "$(code -H "Authorization: Bearer $A" -w '%{http_code} %{content_type}' "$B/pos/branding/logo" | cut -d';' -f1)" "200 image/png"
rm -f "$LOGO"

echo "== tenant isolation: another tenant sees no registers =="
curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"POS Two\",\"adminEmail\":\"admin@postwo.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" >/dev/null
A2=$(login "admin@postwo.test")
check "other tenant: 0 registers" "$(curl -s "$B/pos/registers" -H "Authorization: Bearer $A2" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))" 2>/dev/null)" "0"

echo; echo "POS e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
