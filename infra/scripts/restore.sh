#!/usr/bin/env bash
# Restore a MetaXperts Postgres dump produced by backup.sh (Chunk 9.2).
#
#   bash infra/scripts/restore.sh <dump-file>
#
# Restores into the prod-compose postgres container by default (override with PGURL). DESTRUCTIVE:
# it drops and recreates the public schema first. Requires confirmation unless FORCE=1.
set -euo pipefail

FILE="${1:?usage: restore.sh <dump-file>}"
[ -f "$FILE" ] || { echo "[restore] file not found: $FILE" >&2; exit 1; }
PG_CONTAINER="${PG_CONTAINER:-metaxperts-erp-prod-postgres-1}"
DB_NAME="${DB_NAME:-metaxperts}"
DB_USER="${DB_USER:-metaxperts}"

if [ "${FORCE:-0}" != "1" ]; then
  read -r -p "[restore] This DROPS and replaces the '$DB_NAME' schema. Type 'yes' to proceed: " ok
  [ "$ok" = "yes" ] || { echo "[restore] aborted"; exit 1; }
fi

echo "[restore] resetting schema in $DB_NAME"
RESET_SQL="DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
if [ -n "${PGURL:-}" ]; then
  psql "$PGURL" -v ON_ERROR_STOP=1 -c "$RESET_SQL"
  pg_restore --no-owner --dbname="$PGURL" "$FILE"
else
  docker exec -i "$PG_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -c "$RESET_SQL"
  docker exec -i "$PG_CONTAINER" pg_restore --no-owner -U "$DB_USER" -d "$DB_NAME" < "$FILE"
fi

echo "[restore] done — restored from $(basename "$FILE")"
