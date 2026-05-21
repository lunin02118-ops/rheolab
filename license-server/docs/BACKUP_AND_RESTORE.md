# Backup and Restore Guide

This guide explains how to back up the RheoLab License Server and restore it in case of failure or migration.

## Automated Backup System

The server is configured to automatically back up the database and files every day at **3:00 AM**.

### How it works
- **Script**: `/usr/local/bin/backup-license.sh`
- **Location**: `/var/backups/license-server/`
- **Format**: `backup_YYYY-MM-DD_HH-MM-SS.tar.gz`
- **Local retention**: when S3 is configured and upload succeeds, the server keeps the latest 3 local archives and prunes older local archives only after matching S3 daily objects and `.sha256` files are confirmed. Without S3, local archives older than 7 days are deleted.
- **S3 mirror**: when `/root/.license-server-s3.env` is present, the archive is also uploaded to S3-compatible storage as `latest/backup_latest.tar.gz` and `daily/backup_<timestamp>.tar.gz`. Remote daily retention defaults to 30 days unless `S3_RETENTION_DAYS` overrides it.

### Content of Backup
Each backup archive contains:
1.  `database.sql.gz`: A compressed SQL dump of the `rheolab_license` database.
2.  `files.tar.gz`: A compressed archive of the web directory `/var/www/license-server`.

### Checking Backups
To check available backups on the server:
```bash
ls -lh /var/backups/license-server
```

To check S3 settings on the server:
```bash
sudo test -f /root/.license-server-s3.env && echo "S3 backup config exists"
```

### Manual Backup
You can trigger a backup manually at any time:
```bash
sudo /usr/local/bin/backup-license.sh
```

To verify the latest local backup and, when configured, the S3 `latest` object without overwriting the live database:
```bash
sudo /usr/local/bin/license-admin-verify-backup.sh
```

S3 storage layout:
1. `s3://<bucket>/license-server/latest/backup_latest.tar.gz` — always overwritten with the newest full backup.
2. `s3://<bucket>/license-server/daily/backup_<timestamp>.tar.gz` — daily archives for point-in-time rollback.

### Downloading a Backup to a Local PC
For Windows workstations, `license-server/download-backup.ps1` downloads the latest server backup or a DB-only dump over SSH to a local machine.

Examples:
```powershell
# Download the latest backup_*.tar.gz archive
powershell -ExecutionPolicy Bypass -File .\license-server\download-backup.ps1 -Server your.server.example -OutDir .\backups

# Trigger a fresh backup first, then download it
powershell -ExecutionPolicy Bypass -File .\license-server\download-backup.ps1 -Server your.server.example -OutDir .\backups -TriggerBackup

# Download only the SQL dump of the licensing DB
powershell -ExecutionPolicy Bypass -File .\license-server\download-backup.ps1 -Server your.server.example -OutDir .\backups -DbOnly
```

Requirements:
1. `ssh` and `scp` must be available on the local PC.
2. The selected remote user must have SSH access to the server.
3. `-DbOnly` requires remote access to `/root/.my.cnf` and `mysqldump`.

### Server Cleanup
The server now includes `/usr/local/bin/cleanup-license.sh`.

It performs conservative housekeeping:
1. Deletes expired `rate_limits` rows.
2. Rotates and truncates an oversized `/var/log/license-backup.log`.
3. Removes old compressed log archives, local backup archives older than 7 days, and stale temporary directories.

Run manually with:
```bash
sudo /usr/local/bin/cleanup-license.sh
```

---

## Restore & Migration

To restore the server from a backup (e.g., after a crash or when moving to a new VPS), follow these steps.

### Prerequisites
1.  A fresh server with the License Server installed (see [INSTALLATION.md](INSTALLATION.md)).
    *   *Note: You don't need to configure the exact same passwords, as the restore process will overwrite the database, but the `config.php` might need manual adjustment if DB credentials change.*
2.  The backup archive file (e.g., `backup_2025-12-28_12-00-00.tar.gz`).

### Restore Process

We provide a helper script `restore-license.sh` to automate the process.

#### 1. Upload the Backup and Restore Script
Upload the backup file and the restore script to the new server:
```bash
scp path/to/backup_file.tar.gz root@<NEW_IP>:/root/
scp license-server/restore.sh root@<NEW_IP>:/usr/local/bin/restore-license.sh
```

#### 2. Run the Restore Script
SSH into the server and run:
```bash
ssh root@<NEW_IP>
chmod +x /usr/local/bin/restore-license.sh
/usr/local/bin/restore-license.sh /root/backup_file.tar.gz
```

Restore directly from S3:
```bash
/usr/local/bin/restore-license.sh latest
```

Or from a specific object:
```bash
/usr/local/bin/restore-license.sh s3://<bucket>/license-server/daily/backup_2026-03-18_03-00-00.tar.gz
```

The script will:
1.  Extract the backup archive.
2.  Restore the MySQL database (overwriting existing data).
3.  Restore the web files to `/var/www/license-server`.
4.  Fix file permissions.

#### 3. Verify Configuration
After restore, check `/var/www/license-server/config.php`.
If the new server uses different database credentials than the old one (and the backup overwrote `config.php` with the old one), you must update `config.php` to match the new server's MySQL credentials.

```bash
nano /var/www/license-server/config.php
```
Ensure `DB_USER` and `DB_PASS` match the current server's MySQL setup.

If you restore from S3, also recreate `/root/.license-server-s3.env` on the new server.

### Manual Restore (If script is unavailable)

1.  **Extract Archive**:
    ```bash
    tar -xzf backup_file.tar.gz
    cd <timestamp_folder>
    ```
2.  **Restore Database**:
    ```bash
    gunzip database.sql.gz
    mysql -u license_user -p rheolab_license < database.sql
    ```
3.  **Restore Files**:
    ```bash
    tar -xzf files.tar.gz -C /var/www/license-server
    ```
4.  **Fix Permissions**:
    ```bash
    chown -R www-data:www-data /var/www/license-server
    ```
