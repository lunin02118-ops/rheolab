#!/bin/bash
set -euo pipefail

BACKUP_ROOT="/var/backups/license-server"
S3_ENV_FILE="${S3_ENV_FILE:-/root/.license-server-s3.env}"
S3_HELPER="${S3_HELPER:-/usr/local/bin/license-s3-helper.py}"
TEMP_DIR=$(mktemp -d -t license-verify-XXXXXX)

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

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

find_latest_local_backup() {
    ls -1t "$BACKUP_ROOT"/backup_*.tar.gz 2>/dev/null | head -n 1 || true
}

validate_backup_archive() {
    local archive_path="$1"
    local label="$2"
    local extract_root="$TEMP_DIR/$label"
    local files_listing

    [ -f "$archive_path" ] || {
        echo "[$label] Archive not found: $archive_path" >&2
        exit 1
    }

    mkdir -p "$extract_root"
    tar -xzf "$archive_path" -C "$extract_root"

    local backup_dir
    backup_dir=$(find "$extract_root" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)
    [ -n "$backup_dir" ] || {
        echo "[$label] Backup archive does not contain a timestamp directory." >&2
        exit 1
    }

    [ -f "$backup_dir/database.sql.gz" ] || {
        echo "[$label] database.sql.gz is missing." >&2
        exit 1
    }
    [ -f "$backup_dir/files.tar.gz" ] || {
        echo "[$label] files.tar.gz is missing." >&2
        exit 1
    }

    gzip -t "$backup_dir/database.sql.gz"
    files_listing=$(tar -tzf "$backup_dir/files.tar.gz")

    printf '%s\n' "$files_listing" | grep -Fxq './config.php' || {
        echo "[$label] config.php is missing in files.tar.gz." >&2
        exit 1
    }

    printf '%s\n' "$files_listing" | grep -Fxq './keys/license_private.pem' || {
        echo "[$label] keys/license_private.pem is missing in files.tar.gz." >&2
        exit 1
    }

    local db_size
    db_size=$(gzip -dc "$backup_dir/database.sql.gz" | wc -c)
    [ "$db_size" -gt 0 ] || {
        echo "[$label] database.sql.gz is empty after decompression." >&2
        exit 1
    }

    echo "[$label] OK: archive structure, SQL dump, config.php, and RSA key are valid."
}

verify_s3_latest() {
    local remote_archive="$TEMP_DIR/backup_latest.tar.gz"
    local remote_sha="$TEMP_DIR/backup_latest.tar.gz.sha256"
    local expected_sha
    local actual_sha

    [ -f "$S3_HELPER" ] || {
        echo "[s3] Helper not found: $S3_HELPER" >&2
        exit 1
    }

    s3_helper get "$S3_BUCKET" "${S3_PREFIX:-license-server}/latest/backup_latest.tar.gz" "$remote_archive"
    s3_helper get "$S3_BUCKET" "${S3_PREFIX:-license-server}/latest/backup_latest.tar.gz.sha256" "$remote_sha"

    expected_sha=$(awk '{print $1}' "$remote_sha")
    actual_sha=$(sha256sum "$remote_archive" | awk '{print $1}')

    [ "$expected_sha" = "$actual_sha" ] || {
        echo "[s3] SHA256 mismatch for latest backup object." >&2
        exit 1
    }

    validate_backup_archive "$remote_archive" "s3-latest"
    echo "[s3] OK: latest object matches SHA256 and is restorable."
}

load_s3_env

LOCAL_ARCHIVE=$(find_latest_local_backup)
[ -n "$LOCAL_ARCHIVE" ] || {
    echo "[local] No local backup archive found in $BACKUP_ROOT." >&2
    exit 1
}

validate_backup_archive "$LOCAL_ARCHIVE" "local-latest"

if has_s3_config; then
    verify_s3_latest
else
    echo "[s3] Skipped: /root/.license-server-s3.env is not configured."
fi

echo "Restore verification completed successfully. A fresh deploy on another host can restore this backup via restore-license.sh."