#!/usr/bin/env sh
# Run one backup cycle, validate the newest archive, and notify an optional
# Slack-compatible incoming webhook when the backup is missing, stale, or invalid.
set -u

BACKUP_SCRIPT="${BACKUP_SCRIPT:-/usr/local/bin/malik-backup.sh}"
HEALTHCHECK_SCRIPT="${HEALTHCHECK_SCRIPT:-/usr/local/bin/malik-backup-healthcheck.sh}"
WEBHOOK_URL="${BACKUP_ALERT_WEBHOOK_URL:-}"

backup_failed=0
if ! sh "$BACKUP_SCRIPT"; then
  backup_failed=1
  echo "ERROR: Malik POS backup command failed." >&2
fi

if sh "$HEALTHCHECK_SCRIPT" && [ "$backup_failed" -eq 0 ]; then
  exit 0
fi

echo "ERROR: Malik POS backup operation failed or backup health check failed." >&2
if [ -z "$WEBHOOK_URL" ]; then
  echo "WARNING: BACKUP_ALERT_WEBHOOK_URL is not configured; no remote alert was sent." >&2
  exit 1
fi

# Keep the payload static: no secret, database URL, or user data is sent.
if ! wget -q -O /dev/null --header='Content-Type: application/json' \
  --post-data='{"text":"ALERT: Malik POS backup cycle failed or the newest backup is missing, stale, or invalid. Check the backup container logs and restore readiness."}' \
  "$WEBHOOK_URL"; then
  echo "ERROR: Failed to deliver the backup alert webhook." >&2
  exit 1
fi

echo "Backup alert delivered."
exit 1
