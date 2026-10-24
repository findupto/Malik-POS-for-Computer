#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL connection string}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/malik-pos}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
umask 077

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$BACKUP_DIR/.malik-pos-$timestamp.dump.tmp"
archive="$BACKUP_DIR/malik-pos-$timestamp.dump"
trap 'rm -f "$tmp"' EXIT HUP INT TERM

pg_dump --format=custom --no-owner --no-acl --file="$tmp" "$DATABASE_URL"
# Validate the archive before making it available as a completed backup.
pg_restore --list "$tmp" >/dev/null
mv "$tmp" "$archive"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'malik-pos-*.dump' -mtime +"$RETENTION_DAYS" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'malik-pos-*.dump.sha256' -mtime +"$RETENTION_DAYS" -print -delete
printf 'Backup verified: %s\n' "$archive"
