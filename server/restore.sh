#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?Set DATABASE_URL to the target PostgreSQL connection string}"
ARCHIVE="${1:?Usage: CONFIRM_RESTORE=YES DATABASE_URL=... server/restore.sh /path/to/backup.dump}"
if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo "Refusing to restore. This replaces objects in the target database." >&2
  echo "After verifying the target and backup, rerun with CONFIRM_RESTORE=YES." >&2
  exit 2
fi
[ -f "$ARCHIVE" ] || { echo "Backup archive not found: $ARCHIVE" >&2; exit 2; }
if [ -f "$ARCHIVE.sha256" ]; then
  archive_dir="$(dirname "$ARCHIVE")"
  archive_name="$(basename "$ARCHIVE")"
  (cd "$archive_dir" && sha256sum --check "$archive_name.sha256")
fi
pg_restore --list "$ARCHIVE" >/dev/null
pg_restore --clean --if-exists --exit-on-error --no-owner --no-acl --dbname="$DATABASE_URL" "$ARCHIVE"
echo "Restore completed. Verify application health and perform a test login before reopening registers."
