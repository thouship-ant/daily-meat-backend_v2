#!/bin/sh
# Daily database backup (cron: 0 2 * * * /path/to/infra/backup.sh). Copy BACKUP_DIR off the server too.
#   Restore: docker compose -f docker-compose.prod.yml --env-file .env exec -T db pg_restore -U daily_meat -d daily_meat --clean --if-exists < db-XXXX.dump
# DB_USER / DB_NAME must match the user and database name inside DATABASE_URL.
set -eu
cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-/var/backups/daily-meat}"
DB_USER="${DB_USER:-daily_meat}"
DB_NAME="${DB_NAME:-daily_meat}"
mkdir -p "$DEST"
docker compose -f docker-compose.prod.yml --env-file .env exec -T db pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$DEST/db-$(date +%F_%H%M).dump"
find "$DEST" -type f -name 'db-*.dump' -mtime +35 -delete
