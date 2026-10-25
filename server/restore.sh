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
archive_dir="$(dirname "$ARCHIVE")"
archive_name="$(basename "$ARCHIVE")"
if [ ! -f "$ARCHIVE.sha256" ]; then
  echo "Refusing to restore: checksum file not found: $ARCHIVE.sha256" >&2
  echo "Use a verified backup created by server/backup.sh, or validate the archive and generate its checksum through your approved recovery procedure." >&2
  exit 2
fi
# A checksum file must name this exact archive; otherwise sha256sum could
# validate a different file while pg_restore consumes the requested archive.
if ! awk -v expected="$archive_name" '
  NR != 1 { exit 1 }
  NF != 2 || length($1) != 64 || $1 !~ /^[[:xdigit:]]+$/ || $2 != expected { exit 1 }
  END { if (NR != 1) exit 1 }
' "$ARCHIVE.sha256"; then
  echo "Refusing to restore: checksum file must contain one SHA-256 entry for $archive_name." >&2
  exit 2
fi
(cd "$archive_dir" && sha256sum --check "$archive_name.sha256")
pg_restore --list "$ARCHIVE" >/dev/null
pg_restore --clean --if-exists --exit-on-error --no-owner --no-acl --dbname="$DATABASE_URL" "$ARCHIVE"
echo "Restore completed. Verify application health and perform a test login before reopening registers."
