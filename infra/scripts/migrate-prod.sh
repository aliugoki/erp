#!/usr/bin/env bash
# Run pending TypeORM migrations against the PROD-compose database.
#
#   bash infra/scripts/migrate-prod.sh
#
# The prod Postgres (infra/docker-compose.prod.yml) is published only on the internal `erp-prod`
# network, and the prod app images are distroless (no pnpm/ts-node). So this spins up a throwaway
# node container ON that network with the repo's existing node_modules MOUNTED (no install needed —
# the container has no internet egress on an internal network) and invokes the TypeORM CLI directly,
# bypassing pnpm's pre-run dependency check. Idempotent: a second run prints "No migrations are pending".
#
# Overrides (env):
#   NETWORK                 docker network to join (default: erp-prod)
#   MIGRATION_DATABASE_URL  owner connection as seen FROM the container (default: the in-network URL)
#   NODE_IMAGE              node image to run (default: node:22-bookworm-slim)
set -euo pipefail
cd "$(dirname "$0")/../.." # repo root

NETWORK="${NETWORK:-erp-prod}"
NODE_IMAGE="${NODE_IMAGE:-node:22-bookworm-slim}"
# Owner connection by the compose service name `postgres` on the internal network.
MIGRATION_DATABASE_URL="${MIGRATION_DATABASE_URL:-postgresql://metaxperts:metaxperts@postgres:5432/metaxperts}"

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "[migrate-prod] docker network '$NETWORK' not found — is the prod stack up? (docker network ls)" >&2
  exit 1
fi

echo "[migrate-prod] applying pending migrations on network '$NETWORK' …"
docker run --rm \
  --network "$NETWORK" \
  -v "$PWD":/repo -w /repo/apps/api \
  -e MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" \
  -e TS_NODE_TRANSPILE_ONLY=1 \
  "$NODE_IMAGE" \
  bash -lc "node -r ts-node/register ./node_modules/typeorm/cli.js migration:run -d src/database/data-source.ts"

echo "[migrate-prod] done. (Re-run to confirm: it should report 'No migrations are pending'.)"
