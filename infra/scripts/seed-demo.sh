#!/usr/bin/env bash
# Seed a demo tenant + sample data across every module (Chunk 9.2).
#
#   API_URL=http://127.0.0.1:3300 OWNER_URL=postgresql://metaxperts:metaxperts@127.0.0.1:55433/metaxperts \
#     bash infra/scripts/seed-demo.sh
#
# Idempotent: if the demo admin already exists it exits without changes. Bootstraps a SUPER_ADMIN via
# SQL, provisions the demo tenant (enterprise plan) through the API, then seeds HR / Finance /
# Inventory / CRM via the real endpoints. Demo login: admin@acme.test / Password123!.
set -uo pipefail
cd "$(dirname "$0")/../.." # repo root

API_URL="${API_URL:-http://127.0.0.1:3300}"
OWNER_URL="${OWNER_URL:-${MIGRATION_DATABASE_URL:-postgresql://metaxperts:metaxperts@127.0.0.1:55433/metaxperts}}"
PW="Password123!"            # demo tenant admin
SAPW="SuperAdmin123!"        # platform super admin
DEMO_EMAIL="admin@acme.test"
SA_EMAIL="superadmin@metaxperts.local"
PLATFORM_TENANT="00000000-0000-0000-0000-000000000001"

jget() { python3 -c "import sys,json,functools
d=json.load(sys.stdin)
v=functools.reduce(lambda o,k:(o or {}).get(k) if isinstance(o,dict) else None, sys.argv[1].split('.'), d)
print('' if v is None else v)" "$1" 2>/dev/null; }

# ── Idempotency guard ────────────────────────────────────────────────────────
if psql "$OWNER_URL" -tAc "SELECT 1 FROM users WHERE lower(email)=lower('$DEMO_EMAIL') LIMIT 1" 2>/dev/null | grep -q 1; then
  echo "[seed] $DEMO_EMAIL already exists — nothing to do."
  exit 0
fi

echo "[seed] bootstrapping SUPER_ADMIN"
SA_HASH="$(cd apps/api && node -e "require('argon2').hash(process.argv[1]).then(h=>process.stdout.write(h))" "$SAPW")"
psql "$OWNER_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
INSERT INTO users (tenant_id, email, password_hash, is_active, roles)
VALUES ('$PLATFORM_TENANT', '$SA_EMAIL', '$SA_HASH', true, '{SUPER_ADMIN}')
ON CONFLICT DO NOTHING;
SQL

login() { curl -s -X POST "$API_URL/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | jget data.accessToken; }
SA=$(login "$SA_EMAIL" "$SAPW")
[ -n "$SA" ] || { echo "[seed] super-admin login failed (is the API up at $API_URL?)" >&2; exit 1; }

echo "[seed] provisioning demo tenant (enterprise plan)"
curl -s -X POST "$API_URL/tenants" -H "authorization: Bearer $SA" -H 'content-type: application/json' \
  -d "{\"name\":\"Acme Demo Co\",\"adminEmail\":\"$DEMO_EMAIL\",\"adminPassword\":\"$PW\",\"plan\":\"enterprise\"}" >/dev/null

TOK=$(login "$DEMO_EMAIL" "$PW")
[ -n "$TOK" ] || { echo "[seed] demo-admin login failed" >&2; exit 1; }
post() { curl -s -X POST "$API_URL/$1" -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d "$2"; }
idof() { jget data.id; }

echo "[seed] HR"
DEPT=$(post hr/departments '{"name":"Engineering"}' | idof)
post hr/employees "{\"firstName\":\"Ayesha\",\"lastName\":\"Khan\",\"email\":\"ayesha@acme.test\",\"departmentId\":\"$DEPT\",\"salary\":{\"amountMinor\":25000000,\"currency\":\"PKR\"}}" >/dev/null
post hr/employees "{\"firstName\":\"Bilal\",\"lastName\":\"Ahmed\",\"email\":\"bilal@acme.test\",\"departmentId\":\"$DEPT\",\"salary\":{\"amountMinor\":18000000,\"currency\":\"PKR\"}}" >/dev/null

echo "[seed] Finance — currencies + 4-level chart of accounts + vouchers"
post finance/currencies '{"code":"PKR","name":"Pak Rupee","symbol":"Rs","isBase":true}' >/dev/null
post finance/currencies '{"code":"USD","name":"US Dollar","symbol":"$"}' >/dev/null
post finance/exchange-rates '{"currencyCode":"USD","rate":278.5}' >/dev/null
facc() { post finance/accounts "$1" | idof; }
A=$(facc '{"code":"1","name":"Assets","type":"ASSET","isGroup":true}')
A1=$(facc "{\"code\":\"1-01\",\"name\":\"Current Assets\",\"parentId\":\"$A\",\"isGroup\":true}")
A11=$(facc "{\"code\":\"1-01-001\",\"name\":\"Cash & Bank\",\"parentId\":\"$A1\",\"isGroup\":true}")
CASH=$(facc "{\"code\":\"1-01-001-0001\",\"name\":\"Cash in Hand\",\"parentId\":\"$A11\",\"controlType\":\"CASH\"}")
BANK=$(facc "{\"code\":\"1-01-001-0002\",\"name\":\"Bank - Main\",\"parentId\":\"$A11\",\"controlType\":\"BANK\",\"bankName\":\"HBL\"}")
I=$(facc '{"code":"4","name":"Income","type":"REVENUE","isGroup":true}')
I1=$(facc "{\"code\":\"4-01\",\"name\":\"Operating Income\",\"parentId\":\"$I\",\"isGroup\":true}")
I11=$(facc "{\"code\":\"4-01-001\",\"name\":\"Sales\",\"parentId\":\"$I1\",\"isGroup\":true}")
SALES=$(facc "{\"code\":\"4-01-001-0001\",\"name\":\"Product Sales\",\"parentId\":\"$I11\"}")
X=$(facc '{"code":"5","name":"Expenses","type":"EXPENSE","isGroup":true}')
X1=$(facc "{\"code\":\"5-01\",\"name\":\"Operating Expenses\",\"parentId\":\"$X\",\"isGroup\":true}")
X11=$(facc "{\"code\":\"5-01-001\",\"name\":\"Administrative\",\"parentId\":\"$X1\",\"isGroup\":true}")
RENT=$(facc "{\"code\":\"5-01-001-0001\",\"name\":\"Rent\",\"parentId\":\"$X11\"}")
post finance/transactions "{\"voucherType\":\"BRV\",\"description\":\"Cash sale banked\",\"entries\":[{\"accountId\":\"$BANK\",\"debitMinor\":120000000},{\"accountId\":\"$SALES\",\"creditMinor\":120000000}]}" >/dev/null
post finance/transactions "{\"voucherType\":\"CPV\",\"description\":\"Office rent\",\"entries\":[{\"accountId\":\"$RENT\",\"debitMinor\":30000000},{\"accountId\":\"$CASH\",\"creditMinor\":30000000}]}" >/dev/null
post finance/invoices '{"number":"INV-1001","lineItems":[{"description":"Consulting","quantity":1,"unitPriceMinor":50000000}],"dueDate":"2026-07-15"}' >/dev/null

echo "[seed] Inventory"
WH=$(post inventory/warehouses '{"name":"Main Warehouse","code":"WH-1","location":"Karachi"}' | idof)
P1=$(post inventory/products '{"sku":"SKU-001","name":"Widget","unit":"pcs","costPriceMinor":10000,"sellPriceMinor":15000,"minStock":20}' | idof)
post inventory/products '{"sku":"SKU-002","name":"Gadget","unit":"pcs","costPriceMinor":25000,"sellPriceMinor":40000,"minStock":10}' >/dev/null
post inventory/movements "{\"productId\":\"$P1\",\"type\":\"IN\",\"quantity\":100,\"warehouseId\":\"$WH\"}" >/dev/null

echo "[seed] CRM"
CL=$(post crm/clients '{"companyName":"Globex Corp","industry":"Manufacturing","status":"ACTIVE"}' | idof)
post crm/contacts "{\"clientId\":\"$CL\",\"name\":\"Sara Malik\",\"email\":\"sara@globex.test\",\"isPrimary\":true}" >/dev/null
post crm/deals "{\"clientId\":\"$CL\",\"title\":\"Annual supply contract\",\"valueMinor\":500000000,\"stage\":\"PROPOSAL\"}" >/dev/null

echo ""
echo "[seed] done. Demo tenant 'Acme Demo Co' seeded across HR / Finance / Inventory / CRM."
echo "       Web login: $DEMO_EMAIL / $PW    (platform: $SA_EMAIL / $SAPW)"
