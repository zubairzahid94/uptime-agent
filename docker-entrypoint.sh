#!/bin/sh
set -e

DB_PATH="/app/data/app.db"
BACKUP_DIR="/app/data/backups"

if [ -f "$DB_PATH" ]; then
  mkdir -p "$BACKUP_DIR"
  cp "$DB_PATH" "$BACKUP_DIR/app.db.$(date +%s).bak"
fi

npx prisma migrate deploy

exec "$@"
