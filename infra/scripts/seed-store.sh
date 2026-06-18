#!/usr/bin/env bash
# Make your online store viewable in one command: publishes an ec_store for a tenant, lists its existing
# inventory products on the storefront, and enables the `ecommerce` feature for the dashboard. Idempotent.
#
#   bash infra/scripts/seed-store.sh                 # uses the first active tenant
#   SEED_TENANT=my-company-slug bash infra/scripts/seed-store.sh
#
# Runs psql inside a throwaway container ON the internal `erp-prod` network (the prod Postgres isn't
# published to the host). Connects as the DB owner, so RLS is bypassed and tenant_id is set explicitly.
#
# Overrides (env): NETWORK (default erp-prod), DATABASE_URL (in-network owner URL), PG_IMAGE, SEED_TENANT,
#                  MAX_PRODUCTS (default 12).
set -euo pipefail
cd "$(dirname "$0")/../.." # repo root

NETWORK="${NETWORK:-erp-prod}"
PG_IMAGE="${PG_IMAGE:-postgres:16}"
DATABASE_URL="${DATABASE_URL:-postgresql://metaxperts:metaxperts@postgres:5432/metaxperts}"
SEED_TENANT="${SEED_TENANT:-}"
MAX_PRODUCTS="${MAX_PRODUCTS:-12}"

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "[seed-store] docker network '$NETWORK' not found — is the prod stack up? (docker network ls)" >&2
  exit 1
fi

run_psql() { docker run --rm -i --network "$NETWORK" "$PG_IMAGE" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 "$@"; }

# Resolve the target tenant (id|slug|name).
ROW="$(printf '%s' "SELECT id||'|'||slug||'|'||name FROM tenants WHERE ('${SEED_TENANT}'='' OR slug='${SEED_TENANT}') AND status='active' ORDER BY created_at LIMIT 1" | run_psql -tAq)"
if [ -z "$ROW" ]; then echo "[seed-store] no matching active tenant found (SEED_TENANT='${SEED_TENANT}')." >&2; exit 1; fi
TID="${ROW%%|*}"; REST="${ROW#*|}"; SLUG="${REST%%|*}"; NAME="${REST#*|}"
echo "[seed-store] tenant: $NAME  (slug: $SLUG)"

run_psql <<SQL
-- Publish a store (idempotent; only flips published on, keeps any existing branding).
INSERT INTO ec_store (tenant_id, name, currency, published, tagline, hero_headline, hero_subtext)
VALUES ('$TID', '$NAME', 'PKR', true, 'Quality products, fast delivery',
        'Welcome to $NAME', 'Browse our latest products')
ON CONFLICT (tenant_id) DO UPDATE SET published = true, updated_at = now();

-- List existing inventory products on the storefront (skip any already listed).
INSERT INTO ec_product (tenant_id, product_id, slug, title, status, is_featured, price_minor)
SELECT ip.tenant_id, ip.id,
       trim(both '-' from lower(regexp_replace(ip.name || '-' || ip.sku, '[^a-zA-Z0-9]+', '-', 'g'))),
       ip.name, 'ACTIVE', true, ip.sell_price_minor
FROM inventory_product ip
WHERE ip.tenant_id = '$TID' AND ip.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM ec_product ep WHERE ep.tenant_id = ip.tenant_id AND ep.product_id = ip.id AND ep.deleted_at IS NULL)
ORDER BY ip.created_at
LIMIT $MAX_PRODUCTS;

-- Enable the ecommerce feature so the dashboard shows "Online Store".
INSERT INTO tenant_feature_entitlement (tenant_id, feature_key, enabled)
SELECT '$TID', k, true
FROM unnest(ARRAY['inventory','ecommerce','ecommerce.storefront','ecommerce.catalog','ecommerce.orders','ecommerce.discounts']) AS k
ON CONFLICT (tenant_id, feature_key) DO UPDATE SET enabled = true;
SQL

COUNT="$(printf '%s' "SELECT count(*) FROM ec_product WHERE tenant_id='$TID' AND status='ACTIVE' AND deleted_at IS NULL" | run_psql -tAq)"
echo ""
echo "[seed-store] ✅ Store published with ${COUNT} active product(s)."
echo "[seed-store] 👉 View it at:  /shop/${SLUG}   (open this path on your web app's host)"
echo "[seed-store] Dashboard → Online Store lets you add images, variants, discounts, etc."
echo "[seed-store] (If 'Online Store' doesn't appear in the dashboard yet, the feature cache refreshes within ~60s,"
echo "[seed-store]  or toggle it under Settings → Features.)"
