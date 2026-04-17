#!/bin/bash
set -euo pipefail

# Configuration
WEB_DIR="/var/www/license-server"
DB_NAME="rheolab_license"
S3_ENV_FILE="${S3_ENV_FILE:-/root/.license-server-s3.env}"
S3_HELPER="${S3_HELPER:-/usr/local/bin/license-s3-helper.py}"
# MySQL credentials are read from /root/.my.cnf (chmod 600)

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

s3_download_object() {
    local bucket_name="$1"
    local object_key="$2"
    local target_file="$3"

    s3_helper get "$bucket_name" "$object_key" "$target_file"
}

if [ -z "${1:-}" ]; then
    echo "Usage: $0 <path_to_backup_archive|latest|s3://bucket/key>"
    echo "Example: $0 /var/backups/license-server/backup_2025-12-28_12-00-00.tar.gz"
    echo "Example: $0 latest"
    exit 1
fi

ARCHIVE="$1"
load_s3_env

TEMP_DIR=$(mktemp -d -t license-server-restore-XXXXXX)
cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

validate_tar_archive() {
    local archive_path="$1"
    local archive_label="$2"

    while IFS= read -r entry; do
        [ -z "$entry" ] && continue
        case "$entry" in
            /*)
                echo "Error: ${archive_label} contains an absolute path entry: $entry"
                return 1
                ;;
            ../*|*/../*|*/..|..)
                echo "Error: ${archive_label} contains a parent-directory traversal entry: $entry"
                return 1
                ;;
        esac
    done < <(tar -tzf "$archive_path")
}

if [ "$ARCHIVE" = "latest" ]; then
    if ! has_s3_config || ! command -v python3 >/dev/null 2>&1 || [ ! -f "$S3_HELPER" ]; then
        echo "Error: S3 config, Python, or S3 helper is missing for 'latest' restore."
        exit 1
    fi
    S3_PREFIX="${S3_PREFIX:-license-server}"
    ARCHIVE="$TEMP_DIR/backup_latest.tar.gz"
    s3_download_object "$S3_BUCKET" "$S3_PREFIX/latest/backup_latest.tar.gz" "$ARCHIVE"
elif [[ "$ARCHIVE" == s3://* ]]; then
    if ! has_s3_config || ! command -v python3 >/dev/null 2>&1 || [ ! -f "$S3_HELPER" ]; then
        echo "Error: S3 config, Python, or S3 helper is missing for S3 restore."
        exit 1
    fi
    REMOTE_ARCHIVE="$ARCHIVE"
    ARCHIVE="$TEMP_DIR/$(basename "$REMOTE_ARCHIVE")"
    REMOTE_NO_SCHEME="${REMOTE_ARCHIVE#s3://}"
    REMOTE_BUCKET="${REMOTE_NO_SCHEME%%/*}"
    REMOTE_KEY="${REMOTE_NO_SCHEME#*/}"
    s3_download_object "$REMOTE_BUCKET" "$REMOTE_KEY" "$ARCHIVE"
fi

if [ ! -f "$ARCHIVE" ]; then
    echo "Error: Archive not found: $ARCHIVE"
    exit 1
fi

echo "[$(date)] Starting Restore from $ARCHIVE..."

echo "Extracting archive..."
validate_tar_archive "$ARCHIVE" "backup archive"
tar -xzf "$ARCHIVE" -C "$TEMP_DIR"

# Find the timestamp folder inside
TIMESTAMP_DIR=$(ls "$TEMP_DIR" | head -n 1)
BACKUP_CONTENT="$TEMP_DIR/$TIMESTAMP_DIR"

if [ ! -d "$BACKUP_CONTENT" ]; then
    echo "Error: Invalid backup structure. Expected a timestamp directory inside archive."
    exit 1
fi

# 1. Restore Database
if [ -f "$BACKUP_CONTENT/database.sql.gz" ]; then
    echo "Restoring Database..."
    gunzip "$BACKUP_CONTENT/database.sql.gz"
    if mysql --defaults-file=/root/.my.cnf "$DB_NAME" < "$BACKUP_CONTENT/database.sql"; then
        echo "Database restored."
    else
        echo "Error restoring database."
        exit 1
    fi
else
    echo "Error: database.sql.gz not found in backup."
    exit 1
fi

# 2. Restore Files
if [ -f "$BACKUP_CONTENT/files.tar.gz" ]; then
    echo "Restoring Files..."
    # Backup current config just in case?
    # cp "$WEB_DIR/config.php" "$WEB_DIR/config.php.bak"

    validate_tar_archive "$BACKUP_CONTENT/files.tar.gz" "files archive"
    if tar -xzf "$BACKUP_CONTENT/files.tar.gz" -C "$WEB_DIR"; then
        echo "Files restored."
    else
        echo "Error restoring files."
        exit 1
    fi
else
    echo "Error: files.tar.gz not found in backup."
    exit 1
fi

# 3. Set Permissions
echo "Setting permissions..."
chown -R www-data:www-data "$WEB_DIR"
find "$WEB_DIR" -type d -exec chmod 755 {} +
find "$WEB_DIR" -type f -exec chmod 644 {} +
if [ -f "$WEB_DIR/config.php" ]; then
    chmod 600 "$WEB_DIR/config.php"
fi
if [ -d "$WEB_DIR/keys" ]; then
    chmod 700 "$WEB_DIR/keys"
    find "$WEB_DIR/keys" -type f -exec chmod 600 {} +
fi

echo "[$(date)] Restore completed successfully."
