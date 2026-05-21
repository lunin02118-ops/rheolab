#!/bin/bash
set -euo pipefail

# Configuration
BACKUP_ROOT="/var/backups/license-server"
WEB_DIR="/var/www/license-server"
DB_NAME="rheolab_license"
S3_ENV_FILE="${S3_ENV_FILE:-/root/.license-server-s3.env}"
S3_HELPER="${S3_HELPER:-/usr/local/bin/license-s3-helper.py}"
# MySQL credentials are read from /root/.my.cnf (chmod 600)
# Format:
#   [mysqldump]
#   user=license_user
#   password=YOUR_PASSWORD
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
RETENTION_DAYS=30
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-7}"
LOCAL_KEEP_COUNT="${LOCAL_KEEP_COUNT:-3}"

load_s3_env() {
    if [ -f "$S3_ENV_FILE" ]; then
        # shellcheck disable=SC1090
        . "$S3_ENV_FILE"
    fi
}

has_s3_config() {
    [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ACCESS_KEY:-}" ] && [ -n "${S3_SECRET_KEY:-}" ]
}

s3_helper() {
    S3_ENDPOINT="$S3_ENDPOINT" \
    S3_BUCKET="$S3_BUCKET" \
    S3_ACCESS_KEY="$S3_ACCESS_KEY" \
    S3_SECRET_KEY="$S3_SECRET_KEY" \
    S3_REGION="${S3_REGION:-ru-1}" \
    python3 "$S3_HELPER" "$@"
}

s3_put_object() {
    local object_key="$1"
    local source_file="$2"

    s3_helper put "$S3_BUCKET" "$object_key" "$source_file"
}

s3_list_objects() {
    local object_prefix="$1"

    s3_helper list "$S3_BUCKET" "$object_prefix"
}

s3_delete_object() {
    local object_key="$1"

    s3_helper delete "$S3_BUCKET" "$object_key"
}

cleanup_local_by_age() {
    echo "[$(date)] S3 upload is not configured; cleaning local backups older than $LOCAL_RETENTION_DAYS days..."
    find "$BACKUP_ROOT" -maxdepth 1 -name "backup_*.tar.gz" -type f -mtime +"$LOCAL_RETENTION_DAYS" -delete
}

cleanup_local_after_s3_upload() {
    local remote_prefix="$1"
    local keep_count="${2:-$LOCAL_KEEP_COUNT}"
    local remote_index
    remote_index=$(mktemp)

    if ! s3_list_objects "$remote_prefix/daily/" > "$remote_index" 2>/dev/null; then
        echo "[$(date)] WARNING: Unable to list S3 daily backups; keeping all local archives."
        rm -f "$remote_index"
        return 0
    fi

    echo "[$(date)] Cleaning local backups after confirmed S3 upload; keeping latest $keep_count local archives..."
    find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'backup_*.tar.gz' -printf '%T@ %p\n' \
        | sort -rn \
        | awk -v keep="$keep_count" 'NR > keep { sub(/^[^ ]+ /, ""); print }' \
        | while IFS= read -r archive; do
            [ -n "$archive" ] || continue
            local base
            base=$(basename "$archive")
            if grep -Fq "$remote_prefix/daily/$base" "$remote_index" && grep -Fq "$remote_prefix/daily/$base.sha256" "$remote_index"; then
                echo "[$(date)] Removing local S3-confirmed backup: $archive"
                rm -f -- "$archive"
            else
                echo "[$(date)] Keeping local backup without confirmed S3 object: $archive"
            fi
        done

    rm -f "$remote_index"
}

cleanup_remote_s3() {
    local remote_prefix="$1"
    local remote_retention_days="${2:-$RETENTION_DAYS}"
    local now_epoch
    now_epoch=$(date +%s)

    while read -r object_timestamp object_path; do
        [ -z "$object_path" ] && continue
        local object_epoch
        object_epoch=$(date -d "$object_timestamp" +%s 2>/dev/null || echo 0)
        if [ "$object_epoch" -eq 0 ]; then
            continue
        fi
        local age_days=$(( (now_epoch - object_epoch) / 86400 ))
        if [ "$age_days" -gt "$remote_retention_days" ]; then
            s3_delete_object "$object_path"
        fi
    done < <(s3_list_objects "$remote_prefix/daily/" 2>/dev/null || true)
}

load_s3_env

# Create backup directories
mkdir -p "$BACKUP_DIR"

# 1. Backup Database
echo "[$(date)] Starting Database Backup..."
if mysqldump --defaults-file=/root/.my.cnf --single-transaction --no-tablespaces --skip-comments "$DB_NAME" > "$BACKUP_DIR/database.sql"; then
    echo "[$(date)] Database backup successful."
else
    echo "[$(date)] ERROR: Database backup failed!"
    exit 1
fi

# 2. Backup Web Files
echo "[$(date)] Starting File Backup..."
if tar -czf "$BACKUP_DIR/files.tar.gz" -C "$WEB_DIR" .; then
    echo "[$(date)] File backup successful."
else
    echo "[$(date)] ERROR: File backup failed!"
    exit 1
fi

# 3. Compress Database
gzip "$BACKUP_DIR/database.sql"

# 4. Create Final Archive
FINAL_ARCHIVE="$BACKUP_ROOT/backup_$TIMESTAMP.tar.gz"
if tar -czf "$FINAL_ARCHIVE" -C "$BACKUP_ROOT" "$TIMESTAMP"; then
    echo "[$(date)] Final archive created: $FINAL_ARCHIVE"
    # Remove the temporary directory
    rm -rf "$BACKUP_DIR"
else
    echo "[$(date)] ERROR: Final archiving failed!"
    exit 1
fi

# 5. Upload to S3-compatible object storage (optional)
if has_s3_config && command -v python3 >/dev/null 2>&1 && [ -f "$S3_HELPER" ]; then
    S3_PREFIX="${S3_PREFIX:-license-server}"
    LATEST_KEY="${S3_PREFIX}/latest/backup_latest.tar.gz"
    LATEST_SHA_KEY="${S3_PREFIX}/latest/backup_latest.tar.gz.sha256"
    DAILY_KEY="${S3_PREFIX}/daily/backup_${TIMESTAMP}.tar.gz"
    DAILY_SHA_KEY="${S3_PREFIX}/daily/backup_${TIMESTAMP}.tar.gz.sha256"
    SHA_FILE="$FINAL_ARCHIVE.sha256"

    sha256sum "$FINAL_ARCHIVE" > "$SHA_FILE"

    echo "[$(date)] Uploading backup to S3: s3://$S3_BUCKET/$DAILY_KEY"
    s3_put_object "$DAILY_KEY" "$FINAL_ARCHIVE"
    s3_put_object "$DAILY_SHA_KEY" "$SHA_FILE"
    s3_put_object "$LATEST_KEY" "$FINAL_ARCHIVE"
    s3_put_object "$LATEST_SHA_KEY" "$SHA_FILE"

    cleanup_remote_s3 "$S3_PREFIX" "${S3_RETENTION_DAYS:-$RETENTION_DAYS}"
    rm -f "$SHA_FILE"
    echo "[$(date)] S3 upload completed successfully."
    cleanup_local_after_s3_upload "$S3_PREFIX" "$LOCAL_KEEP_COUNT"
else
    cleanup_local_by_age
fi

echo "[$(date)] Backup process completed successfully."
