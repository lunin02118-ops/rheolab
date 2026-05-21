#!/bin/bash
set -euo pipefail

BACKUP_ROOT="/var/backups/license-server"
LOG_FILE="/var/log/license-backup.log"
RETENTION_DAYS=7
MAX_LOG_SIZE_BYTES=$((20 * 1024 * 1024))
TMP_PREFIX="license-server-"

echo "[$(date)] Starting license-server cleanup..."

if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$LOG_SIZE" -gt "$MAX_LOG_SIZE_BYTES" ]; then
        ARCHIVE_PATH="${LOG_FILE}.$(date +%Y-%m-%d_%H-%M-%S).gz"
        gzip -c "$LOG_FILE" > "$ARCHIVE_PATH"
        : > "$LOG_FILE"
        echo "[$(date)] Rotated oversized log to $ARCHIVE_PATH"
    fi

    find /var/log -maxdepth 1 -type f -name 'license-backup.log.*.gz' -mtime +$RETENTION_DAYS -delete
fi

if [ -d "$BACKUP_ROOT" ]; then
    find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'backup_*.tar.gz' -mtime +$RETENTION_DAYS -delete
    find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'tmp-*' -mtime +2 -exec rm -rf {} +
fi

if [ -f /root/.my.cnf ]; then
    mysql --defaults-file=/root/.my.cnf rheolab_license <<'SQL'
DELETE FROM rate_limits WHERE expires_at < NOW();
SQL
    echo "[$(date)] Deleted expired rate_limits rows."
fi

find /tmp -maxdepth 1 -type d -name "${TMP_PREFIX}*" -mtime +2 -exec rm -rf {} +

echo "[$(date)] Cleanup completed."
