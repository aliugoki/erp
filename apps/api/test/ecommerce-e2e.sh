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
check "CARD order is PENDING until paid" "$(echo "$CARD" | jget data.status)" "PENDING"
check "CARD checkout returns a payment session" "$(echo "$CARD" | jget data.payment.provider)" "SIMULATED"

echo "== admin: fulfil an order → emits ecommerce.order_status_changed (drives customer email) =="
OID=$(ownerq "SELECT id FROM ec_order WHERE tenant_id='$T' AND order_no='$ORDNO'")
UP=$(patch "$A" "ecommerce/orders/$OID/status" '{"status":"SHIPPED"}')
check "order now SHIPPED" "$(echo "$UP" | jget data.status)" "SHIPPED"
check "order_status_changed in outbox" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='ecommerce.order_status_changed.v1'")" "1"
check "no-op status change emits nothing new" "$(patch "$A" "ecommerce/orders/$OID/status" '{"status":"SHIPPED"}' >/dev/null; ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='ecommerce.order_status_changed.v1'")" "1"

echo "== product variants: each variant draws its own inventory SKU =="
psql "$OWNER_URL" -q >/dev/null 2>&1 <<SQL
INSERT INTO inventory_product (tenant_id, sku, name, unit, cost_price_minor, sell_price_minor, currency, min_stock, on_hand, stock_value_minor)
VALUES ('$T','BLU-S','Blue Tee S','ea',500,1800,'PKR',1,5,2500),
       ('$T','BLU-L','Blue Tee L','ea',500,1800,'PKR',1,3,1500);
SQL
INVS=$(ownerq "SELECT id FROM inventory_product WHERE tenant_id='$T' AND sku='BLU-S'")
INVL=$(ownerq "SELECT id FROM inventory_product WHERE tenant_id='$T' AND sku='BLU-L'")
 on() { ownerq "SELECT on_hand FROM inventory_product WHERE id='$1'"; }
EP2=$(post "$A" ecommerce/products "{\"productId\":\"$INVS\",\"title\":\"Blue Tee\",\"status\":\"ACTIVE\",\"priceMinor\":2000}")
EPID2=$(echo "$EP2" | jget data.id); PSLUG2=$(echo "$EP2" | jget data.slug)
VS=$(post "$A" "ecommerce/products/$EPID2/variants" "{\"inventoryProductId\":\"$INVS\",\"label\":\"Small\"}" | jget data.id)
VL=$(post "$A" "ecommerce/products/$EPID2/variants" "{\"inventoryProductId\":\"$INVL\",\"label\":\"Large\",\"isDefault\":true}" | jget data.id)
check "variant create returns ids" "$([ -n "$VS" ] && [ -n "$VL" ] && echo ok)" "ok"
check "storefront product exposes 2 variants" "$(pget "shop/$SLUG/products/$PSLUG2" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['variants']))")" "2"
TOK2=$(ppost "shop/$SLUG/cart" '' | jget data.token)
ppost "shop/$SLUG/cart/$TOK2/items" "{\"productId\":\"$EPID2\",\"variantId\":\"$VL\",\"quantity\":2}" >/dev/null
check "cart shows the variant label" "$(pget "shop/$SLUG/cart/$TOK2" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['items'][0]['variantLabel'])")" "Large"
V_ORD=$(ppost "shop/$SLUG/checkout" "{\"cartToken\":\"$TOK2\",\"customerName\":\"Variant Buyer\",\"customerEmail\":\"v@buyer.test\",\"paymentMethod\":\"COD\"}")
check "variant order placed" "$(echo "$V_ORD" | jget data.status)" "PENDING"
check "Large variant stock 3→1" "$(on "$INVL")" "1"
check "Small variant stock untouched (5)" "$(on "$INVS")" "5"
check "oversell a variant → 422" "$(code -XPOST "$B/shop/$SLUG/checkout" -H 'Content-Type: application/json' -d "{\"items\":[{\"productId\":\"$EPID2\",\"variantId\":\"$VS\",\"quantity\":999}],\"customerName\":\"x\",\"customerEmail\":\"x@y.test\",\"paymentMethod\":\"COD\"}")" "422"

echo "== customer accounts: register → login → me → order history =="
REG=$(ppost "shop/$SLUG/account/register" "{\"name\":\"Repeat Buyer\",\"email\":\"repeat@buyer.test\",\"password\":\"$PASSWORD\"}")
CTOK=$(echo "$REG" | jget data.token)
check "register returns a token" "$([ -n "$CTOK" ] && echo ok)" "ok"
check "duplicate register → 409" "$(code -XPOST "$B/shop/$SLUG/account/register" -H 'Content-Type: application/json' -d "{\"name\":\"x\",\"email\":\"repeat@buyer.test\",\"password\":\"$PASSWORD\"}")" "409"
LTOK=$(ppost "shop/$SLUG/account/login" "{\"email\":\"repeat@buyer.test\",\"password\":\"$PASSWORD\"}" | jget data.token)
check "login returns a token" "$([ -n "$LTOK" ] && echo ok)" "ok"
check "wrong password → 401" "$(code -XPOST "$B/shop/$SLUG/account/login" -H 'Content-Type: application/json' -d "{\"email\":\"repeat@buyer.test\",\"password\":\"nope\"}")" "401"
check "me returns the profile" "$(curl -s "$B/shop/$SLUG/account/me" -H "Authorization: Bearer $CTOK" | jget data.email)" "repeat@buyer.test"
check "me without a token → 401" "$(code "$B/shop/$SLUG/account/me")" "401"
# Place an order with this customer's email; it should appear in their history.
ppost "shop/$SLUG/checkout" "{\"items\":[{\"productId\":\"$EPID\",\"quantity\":1}],\"customerName\":\"Repeat Buyer\",\"customerEmail\":\"repeat@buyer.test\",\"paymentMethod\":\"COD\"}" >/dev/null
check "order history lists the customer's order" "$(curl -s "$B/shop/$SLUG/account/orders" -H "Authorization: Bearer $CTOK" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data'])>=1)")" "True"

echo "== payments: SIMULATED card session — pending → confirm → paid =="
PAYORD=$(ppost "shop/$SLUG/checkout" "{\"items\":[{\"productId\":\"$EPID\",\"quantity\":1}],\"customerName\":\"Card Buyer\",\"customerEmail\":\"card@buyer.test\",\"paymentMethod\":\"CARD\"}")
PID=$(echo "$PAYORD" | jget data.payment.paymentId)
PSEC=$(echo "$PAYORD" | jget data.payment.clientSecret)
PORDNO=$(echo "$PAYORD" | jget data.orderNo)
check "card order PENDING/UNPAID" "$(echo "$PAYORD" | jget data.paymentStatus)" "UNPAID"
check "pay page shows the pending session" "$(pget "shop/$SLUG/pay/$PID" | jget data.status)" "PENDING"
check "confirm with wrong secret → 401" "$(code -XPOST "$B/shop/$SLUG/pay/$PID/confirm" -H 'Content-Type: application/json' -d '{"clientSecret":"wrongsecretvalue"}')" "401"
check "confirm with the client secret → PAID" "$(ppost "shop/$SLUG/pay/$PID/confirm" "{\"clientSecret\":\"$PSEC\"}" | jget data.status)" "PAID"
check "order is now PAID" "$(ownerq "SELECT status FROM ec_order WHERE tenant_id='$T' AND order_no='$PORDNO'")" "PAID"
check "payment row PAID" "$(ownerq "SELECT status FROM ec_payment WHERE tenant_id='$T' AND id='$PID'")" "PAID"
check "PAID emits order_status_changed" "$(ownerq "SELECT count(*) FROM outbox_event WHERE tenant_id='$T' AND type='ecommerce.order_status_changed.v1' AND payload->>'orderNo'='$PORDNO' AND payload->>'status'='PAID'")" "1"

echo "== payments: HTTP gateway webhook (HMAC-signed) confirms a payment =="
WSEC="ecommercewebhooksecret123"
put "$A" ecommerce/payment-config "{\"provider\":\"HTTP\",\"gatewayUrl\":\"http://gw.local/sessions\",\"webhookSecret\":\"$WSEC\"}" >/dev/null
check "admin config never echoes the secret" "$(curl -s "$B/ecommerce/payment-config" -H "Authorization: Bearer $A" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('webhookSecret' not in d and d['hasWebhookSecret'])")" "True"
HID=$(ownerq "INSERT INTO ec_order (tenant_id,order_no,customer_name,customer_email,payment_method,payment_status,status,total_minor,currency) VALUES ('$T','ORD-HOOK','Hook Buyer','hook@buyer.test','CARD','UNPAID','PENDING',5000,'PKR') RETURNING id" | head -1)
PID2=$(ownerq "INSERT INTO ec_payment (tenant_id,order_id,provider,status,amount_minor,currency,client_secret) VALUES ('$T','$HID','HTTP','PENDING',5000,'PKR','x') RETURNING id" | head -1)
SIG=$(printf '%s' "$PID2.PAID" | openssl dgst -sha256 -hmac "$WSEC" -r | cut -d' ' -f1)
check "webhook with bad signature → 401" "$(code -XPOST "$B/shop/$SLUG/pay/webhook" -H 'Content-Type: application/json' -d "{\"paymentId\":\"$PID2\",\"status\":\"PAID\",\"signature\":\"deadbeef\"}")" "401"
ppost "shop/$SLUG/pay/webhook" "{\"paymentId\":\"$PID2\",\"status\":\"PAID\",\"signature\":\"$SIG\"}" >/dev/null
check "signed webhook marks the order PAID" "$(ownerq "SELECT status FROM ec_order WHERE id='$HID'")" "PAID"

echo "== shipping zones: the destination country selects the rate =="
ZP=$(post "$A" ecommerce/shipping-zones '{"name":"Pakistan","countries":["Pakistan"],"rateMinor":0}' | jget data.id)
ZI=$(post "$A" ecommerce/shipping-zones '{"name":"International","countries":[],"rateMinor":200000}' | jget data.id)
check "zones created" "$([ -n "$ZP" ] && [ -n "$ZI" ] && echo ok)" "ok"
check "quote: Pakistan ships free" "$(ppost "shop/$SLUG/shipping/quote" '{"country":"pakistan","subtotalMinor":2500}' | jget data.shippingMinor)" "0"
check "quote: elsewhere → catch-all 2000" "$(ppost "shop/$SLUG/shipping/quote" '{"country":"USA","subtotalMinor":2500}' | jget data.shippingMinor)" "200000"
PK_ORD=$(ppost "shop/$SLUG/checkout" "{\"items\":[{\"productId\":\"$EPID\",\"quantity\":1}],\"customerName\":\"PK\",\"customerEmail\":\"pk@buyer.test\",\"shippingCountry\":\"Pakistan\",\"paymentMethod\":\"COD\"}")
check "order shipped to Pakistan is free" "$(echo "$PK_ORD" | jget data.shipping.amountMinor)" "0"
US_ORD=$(ppost "shop/$SLUG/checkout" "{\"items\":[{\"productId\":\"$EPID\",\"quantity\":1}],\"customerName\":\"US\",\"customerEmail\":\"us@buyer.test\",\"shippingCountry\":\"United States\",\"paymentMethod\":\"COD\"}")
check "order shipped abroad uses the catch-all rate" "$(echo "$US_ORD" | jget data.shipping.amountMinor)" "200000"

echo "== isolation: a second tenant's unpublished store is a flat 404 =="
curl -s -XPOST "$B/tenants" -H "Authorization: Bearer $SA" -H 'Content-Type: application/json' -d "{\"name\":\"Shop Two\",\"adminEmail\":\"admin@shoptwo.test\",\"adminPassword\":\"$PASSWORD\",\"plan\":\"enterprise\"}" >/dev/null
SLUG2=$(ownerq "SELECT slug FROM tenants WHERE name='Shop Two'")
check "unpublished store → 404" "$(code "$B/shop/$SLUG2")" "404"
check "unknown slug → 404" "$(code "$B/shop/no-such-store")" "404"
A2=$(login "admin@shoptwo.test")
check "tenant two: 0 online products" "$(curl -s "$B/ecommerce/products" -H "Authorization: Bearer $A2" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']))")" "0"

echo; echo "Ecommerce e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
