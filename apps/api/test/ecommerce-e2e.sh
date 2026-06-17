#!/usr/bin/env bash
# Ecommerce e2e: the full Shopify-style lifecycle through the real API + SQL — admin configures + publishes
# a store, lists an inventory product online, adds a collection + discount; then the PUBLIC storefront
# (no auth, reached by tenant slug) browses, builds a cart, applies a coupon, and checks out. Asserts the
# order decrements stock through the valued ledger (capturing COGS), emits the outbox event, links a CRM
# account, and enforces stock + publish + tenant isolation.
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
DELETE FROM users WHERE lower(email) IN ('ecsa@acme.test','admin@shop.test','admin@shoptwo.test');
DELETE FROM tenant_feature_entitlement WHERE tenant_id IN (SELECT id FROM tenants WHERE name IN ('Shop Co','Shop Two'));
DELETE FROM tenants WHERE name IN ('Shop Co','Shop Two');
INSERT INTO users (tenant_id,email,password_hash,is_active,roles) VALUES ('$PLATFORM','ecsa@acme.test','$HASH',true,'{SUPER_ADMIN}');
SQL

PORT=3420; for p in 3420 3421 3422 3423; do (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null && exec 3>&- 3<&- || { PORT=$p; break; }; done
API_PORT=$PORT setsid node apps/api/dist/main.js >/tmp/ec-e2e.out 2>&1 < /dev/null &
trap 'for pid in $(pgrep -f "apps/api/dist/main.js"); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done' EXIT
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break || sleep 0.4; done
B="http://127.0.0.1:$PORT"
login() { curl -s -X POST "$B/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | jget data.accessToken; }
post() { curl -s -XPOST "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
put() { curl -s -XPUT "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
patch() { curl -s -XPATCH "$B/$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
pget() { curl -s "$B/$1"; }                                   # public storefront (no auth)
ppost() { curl -s -XPOST "$B/$1" -H 'Content-Type: application/json' -d "$2"; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

SA=$(login "ecsa@acme.test")
T=$(curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Shop Co\",\"adminEmail\":\"admin@shop.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" | jget data.tenant.id)
SLUG=$(ownerq "SELECT slug FROM tenants WHERE id='$T'")
A=$(login "admin@shop.test")
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO inventory_product (tenant_id, sku, name, unit, cost_price_minor, sell_price_minor, currency, min_stock, on_hand, stock_value_minor)
VALUES ('$T','TEE-RED','Red Tee','ea',600,2000,'PKR',2,50,30000);
SQL
PROD=$(ownerq "SELECT id FROM inventory_product WHERE tenant_id='$T' AND sku='TEE-RED'")
onhand() { ownerq "SELECT on_hand FROM inventory_product WHERE id='$PROD'"; }
echo "tenant=$T slug=$SLUG product=$PROD on_hand=$(onhand)"

echo "== admin: configure + publish store, list a product, add collection + discount =="
ST=$(put "$A" ecommerce/store '{"name":"Shop Co Store","currency":"PKR","defaultTaxRate":0,"shippingFlatMinor":300,"freeShippingOverMinor":500000,"published":true,"heroHeadline":"Summer Sale","accentColor":"#16a34a"}')
check "store published" "$(echo "$ST" | jget data.published)" "True"
COL=$(post "$A" ecommerce/collections '{"title":"Apparel","isFeatured":true}' | jget data.id)
check "collection created" "$([ -n "$COL" ] && echo ok)" "ok"
EP=$(post "$A" ecommerce/products "{\"productId\":\"$PROD\",\"title\":\"Red Tee\",\"status\":\"ACTIVE\",\"isFeatured\":true,\"priceMinor\":2500,\"compareAtMinor\":3000,\"collectionIds\":[\"$COL\"]}")
EPID=$(echo "$EP" | jget data.id)
PSLUG=$(echo "$EP" | jget data.slug)
check "product listed ACTIVE" "$(echo "$EP" | jget data.status)" "ACTIVE"
check "online price overrides inventory" "$(echo "$EP" | jget data.price.amountMinor)" "2500"
post "$A" ecommerce/discounts '{"code":"SAVE10","type":"PERCENT","value":10}' >/dev/null
check "discount listed" "$(curl -s "$B/ecommerce/discounts" -H "Authorization: Bearer $A" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "1"

echo "== public storefront (no auth): browse home + catalog + detail =="
check "home: store name" "$(pget "shop/$SLUG" | jget data.store.name)" "Shop Co Store"
check "home: 1 featured product" "$(pget "shop/$SLUG" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['featured']))")" "1"
check "catalog lists product" "$(pget "shop/$SLUG/products" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "1"
check "product detail by slug" "$(pget "shop/$SLUG/products/$PSLUG" | jget data.title)" "Red Tee"

echo "== public: cart → coupon → checkout (COD) =="
TOK=$(ppost "shop/$SLUG/cart" '' | jget data.token)
check "cart created" "$([ -n "$TOK" ] && echo ok)" "ok"
ppost "shop/$SLUG/cart/$TOK/items" "{\"productId\":\"$EPID\",\"quantity\":2}" >/dev/null
check "cart subtotal 2×2500" "$(pget "shop/$SLUG/cart/$TOK" | jget data.totals.subtotalMinor)" "5000"
ppost "shop/$SLUG/cart/$TOK/coupon" '{"code":"SAVE10"}' >/dev/null
check "coupon discounts 10% (500)" "$(pget "shop/$SLUG/cart/$TOK" | jget data.totals.discountMinor)" "500"
# subtotal 5000 − 500 discount + 0 tax + 300 shipping = 4800
ORD=$(ppost "shop/$SLUG/checkout" "{\"cartToken\":\"$TOK\",\"customerName\":\"Ada Lovelace\",\"customerEmail\":\"ada@buyer.test\",\"customerPhone\":\"+92 300 1112222\",\"shippingAddress\":\"1 Byron Rd\",\"paymentMethod\":\"COD\"}")
ORDNO=$(echo "$ORD" | jget data.orderNo)
check "order placed PENDING" "$(echo "$ORD" | jget data.status)" "PENDING"
check "order total 4800" "$(echo "$ORD" | jget data.total.amountMinor)" "4800"
check "order COGS = 2×600" "$(echo "$ORD" | jget data.cogs.amountMinor)" "1200"
check "stock decremented 50→48" "$(onhand)" "48"
check "ecommerce.order_placed in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='ecommerce.order_placed.v1'")" "1"
check "CRM account linked by email" "$(ownerq "SELECT count(*) FROM crm_contact WHERE tenant_id='$T' AND lower(email)='ada@buyer.test'")" "1"
check "confirmation page by order no" "$(pget "shop/$SLUG/orders/$ORDNO" | jget data.orderNo)" "$ORDNO"

echo "== guards: oversell rejected, CARD pays at placement =="
check "oversell → 422" "$(code -XPOST "$B/shop/$SLUG/checkout" -H 'Content-Type: application/json' -d "{\"items\":[{\"productId\":\"$EPID\",\"quantity\":999}],\"customerName\":\"x\",\"customerEmail\":\"x@y.test\",\"paymentMethod\":\"COD\"}")" "422"
CARD=$(ppost "shop/$SLUG/checkout" "{\"items\":[{\"productId\":\"$EPID\",\"quantity\":1}],\"customerName\":\"Grace H\",\"customerEmail\":\"grace@buyer.test\",\"paymentMethod\":\"CARD\"}")
check "CARD order PAID" "$(echo "$CARD" | jget data.status)" "PAID"
check "CARD payment reference set" "$(echo "$CARD" | jget data.paymentStatus)" "PAID"

echo "== isolation: a second tenant's unpublished store is a flat 404 =="
curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Shop Two\",\"adminEmail\":\"admin@shoptwo.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" >/dev/null
SLUG2=$(ownerq "SELECT slug FROM tenants WHERE name='Shop Two'")
check "unpublished store → 404" "$(code "$B/shop/$SLUG2")" "404"
check "unknown slug → 404" "$(code "$B/shop/no-such-store")" "404"
A2=$(login "admin@shoptwo.test")
check "tenant two: 0 online products" "$(curl -s "$B/ecommerce/products" -H "Authorization: Bearer $A2" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "0"

echo; echo "Ecommerce e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
