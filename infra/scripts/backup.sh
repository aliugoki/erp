#!/usr/bin/env bash
# Backup the MetaXperts Postgres database to a timestamped custom-format dump (Chunk 9.2).
#
#   bash infra/scripts/backup.sh [output_dir]
#
# Defaults to dumping the prod-compose postgres container. Override the connection with PGURL, e.g.
#   PGURL=postgresql://metaxperts:metaxperts@127.0.0.1:55433/metaxperts bash infra/scripts/backup.sh
#
# Optional offsite copy to MinIO/S3: set S3_BUCKET (+ AWS_*/S3_ENDPOINT) and have the `aws` CLI.
set -euo pipefail

OUT_DIR="${1:-${BACKUP_DIR:-./backups}}"
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"
PG_CONTAINER="${PG_CONTAINER:-metaxperts-erp-prod-postgres-1}"
DB_NAME="${DB_NAME:-metaxperts}"
DB_USER="${DB_USER:-metaxperts}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/metaxperts-$STAMP.dump"

echo "[backup] dumping $DB_NAME -> $FILE"
if [ -n "${PGURL:-}" ]; then
  # Direct connection (custom format, compressed).
  pg_dump --format=custom --no-owner --dbname="$PGURL" --file="$FILE"
else
  # Through the running postgres container (no host pg_dump needed).
  docker exec "$PG_CONTAINER" pg_dump --format=custom --no-owner -U "$DB_USER" "$DB_NAME" > "$FILE"
fi

SIZE="$(du -h "$FILE" | cut -f1)"
echo "[backup] wrote $FILE ($SIZE)"

# Optional offsite upload.
if [ -n "${S3_BUCKET:-}" ] && command -v aws >/dev/null 2>&1; then
  DEST="s3://$S3_BUCKET/backups/$(basename "$FILE")"
  echo "[backup] uploading to $DEST"
  aws ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"} s3 cp "$FILE" "$DEST"
fi

echo "[backup] done"
