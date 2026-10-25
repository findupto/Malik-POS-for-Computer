#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
MAX_AGE_SECONDS="${BACKUP_MAX_AGE_SECONDS:-90000}"

case "$MAX_AGE_SECONDS" in
  ''|*[!0-9]*) echo "BACKUP_MAX_AGE_SECONDS must be a positive integer" >&2; exit 1 ;;
esac
if [ "$MAX_AGE_SECONDS" -le 0 ]; then
  echo "BACKUP_MAX_AGE_SECONDS must be a positive integer" >&2
  exit 1
fi

latest=""
for file in "$BACKUP_DIR"/malik-pos-*.dump; do
  [ -f "$file" ] || continue
  if [ -z "$latest" ] || [ "$file" -nt "$latest" ]; then
    latest="$file"
  fi
done

if [ -z "$latest" ]; then
  echo "No completed Malik POS database backup found in $BACKUP_DIR" >&2
  exit 1
fi

now="$(date +%s)"
modified="$(stat -c %Y "$latest")"
age=$((now - modified))
if [ "$age" -lt 0 ] || [ "$age" -gt "$MAX_AGE_SECONDS" ]; then
  echo "Latest backup is stale: age=${age}s limit=${MAX_AGE_SECONDS}s" >&2
  exit 1
fi

checksum="$(basename "$latest").sha256"
if [ ! -f "$BACKUP_DIR/$checksum" ]; then
  echo "Backup checksum is missing: $checksum" >&2
  exit 1
fi
(cd "$BACKUP_DIR" && sha256sum -c "$checksum" >/dev/null)
pg_restore --list "$latest" >/dev/null
printf 'Backup health OK: %s (age %ss)\n' "$(basename "$latest")" "$age"
