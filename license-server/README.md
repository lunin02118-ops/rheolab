# RheoLab License Server

This directory contains the source code and documentation for the RheoLab License Server.

## Documentation

Please refer to the `docs/` directory for comprehensive documentation:

- **[README (Russian)](docs/README_RU.md)** - Main entry point.
- **[Installation Guide](docs/INSTALLATION_RU.md)**
- **[Administration Guide](docs/ADMINISTRATION_RU.md)**
- **[Backup & Restore](docs/BACKUP_AND_RESTORE_RU.md)**
- **[Migration Guide](docs/MIGRATION_GUIDE_RU.md)**

## Directory Structure

- `admin/` - Admin panel source code.
- `api/` - API endpoints (`activate.php`, `validate.php`, etc.).
- `includes/` - Helper functions and DB connection.
- `docs/` - Documentation.
- `install.sh` - Auto-installation script for VPS.
- `backup.sh` - Backup script (deployed to server).
- `cleanup.sh` - Log and stale-data cleanup script (deployed to server).
- `download-backup.ps1` - Windows helper to download the latest server backup or DB dump to a local PC.
- `restore.sh` - Restore script (used for migration).
