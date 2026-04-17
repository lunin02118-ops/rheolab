#!/bin/bash
set -euo pipefail

BACKUP_SCRIPT="/usr/local/bin/backup-license.sh"
BACKUP_ROOT="/var/backups/license-server"

if [ ! -x "$BACKUP_SCRIPT" ]; then
    echo "Backup script not found: $BACKUP_SCRIPT" >&2
    exit 1
fi

mkdir -p "$BACKUP_ROOT"

"$BACKUP_SCRIPT"

LATEST_ARCHIVE=$(ls -1t "$BACKUP_ROOT"/backup_*.tar.gz 2>/dev/null | head -n 1 || true)
if [ -z "$LATEST_ARCHIVE" ]; then
    echo "Backup finished, but archive was not found in $BACKUP_ROOT" >&2
    exit 1
fi

echo "Backup created: $LATEST_ARCHIVE"