"""
Deploy the machine-ID auto-recovery feature to license.vizbuka.ru.

What this does
--------------
1. Uploads the two re-enabled discovery endpoints:
     license-server/api/find_by_machine.php
     license-server/api/find_all_by_machine.php
2. Runs the migration that makes `activation_log.license_id` nullable so
   discovery-miss audit rows can be inserted:
     license-server/migrations/allow_null_license_id_for_discovery_audit.sql
3. Verifies both endpoints respond (not the 410 Gone stub anymore).

Before running
--------------
Set these env vars (or put them in `scripts/deploy/.env.server`):

    LICENSE_SERVER_HOST=license.vizbuka.ru
    LICENSE_SERVER_USER=root
    LICENSE_SERVER_KEY_PATH=%USERPROFILE%\.ssh\rheolab_deploy   # or ~/.ssh/id_rsa
    LICENSE_DB_USER=license_user
    LICENSE_DB_PASS=<secret>
    LICENSE_DB_NAME=rheolab_license

Usage
-----
    python scripts/deploy/deploy-discovery-recovery.py

Or with --dry-run to show what *would* be uploaded without touching the server:
    python scripts/deploy/deploy-discovery-recovery.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import shlex
import sys
from pathlib import Path

from ssh_common import connect_license_server, exec_checked


ROOT = Path(__file__).resolve().parent.parent.parent

PHP_FILES = [
    (
        ROOT / "license-server" / "api" / "find_by_machine.php",
        "/var/www/license-server/api/find_by_machine.php",
    ),
    (
        ROOT / "license-server" / "api" / "find_all_by_machine.php",
        "/var/www/license-server/api/find_all_by_machine.php",
    ),
]

MIGRATION = (
    ROOT
    / "license-server"
    / "migrations"
    / "allow_null_license_id_for_discovery_audit.sql"
)


def upload_file(ssh, local: Path, remote: str) -> None:
    if not local.exists():
        raise SystemExit(f"Local file missing: {local}")

    sftp = ssh.open_sftp()
    try:
        print(f"Uploading {local} -> {remote}")
        sftp.put(str(local), remote)
    finally:
        sftp.close()

    exec_checked(ssh, f"chown www-data:www-data {shlex.quote(remote)}")
    exec_checked(ssh, f"chmod 644 {shlex.quote(remote)}")


def run_migration(ssh, sql_path: Path) -> None:
    db_user = os.environ.get("LICENSE_DB_USER", "license_user")
    db_pass = os.environ.get("LICENSE_DB_PASS")
    db_name = os.environ.get("LICENSE_DB_NAME", "rheolab_license")

    if not db_pass:
        print(
            "WARNING: LICENSE_DB_PASS is not set, skipping SQL migration.\n"
            "         Apply manually with:\n"
            f"         mysql -u {db_user} -p {db_name} < "
            f"{sql_path}"
        )
        return

    sql = sql_path.read_text(encoding="utf-8")
    print(f"Applying migration: {sql_path.name}")
    exec_checked(
        ssh,
        f"mysql --user={shlex.quote(db_user)} --password={shlex.quote(db_pass)} "
        f"{shlex.quote(db_name)}",
        stdin_data=sql,
        print_command=False,
    )


def verify_endpoint(ssh, path: str) -> None:
    """POST an empty body and assert we get 400 (bad request), NOT 410 (Gone)."""
    probe = (
        f"curl -sS -o /dev/null -w '%{{http_code}}' -X POST "
        f"-H 'Content-Type: application/json' -d '{{\"machineId\":\"\"}}' "
        f"https://license.vizbuka.ru{path}"
    )
    out = exec_checked(ssh, probe).strip()
    if out == "410":
        raise SystemExit(
            f"ERROR: {path} still returns 410 Gone after deploy — "
            f"upload probably didn't propagate (CDN cache? wrong path?)."
        )
    print(f"  {path} responded HTTP {out} (expected 400/404, not 410)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be deployed without touching the server.",
    )
    args = parser.parse_args()

    if args.dry_run:
        print("[dry-run] Files that WOULD be uploaded:")
        for local, remote in PHP_FILES:
            print(f"  {local} -> {remote}")
        print(f"\n[dry-run] Migration that WOULD be applied: {MIGRATION}")
        return 0

    ssh = None
    try:
        ssh = connect_license_server()

        print("\n── Phase 1: upload PHP endpoints ──")
        for local, remote in PHP_FILES:
            upload_file(ssh, local, remote)

        print("\n── Phase 2: apply DB migration ──")
        run_migration(ssh, MIGRATION)

        print("\n── Phase 3: smoke-test endpoints ──")
        verify_endpoint(ssh, "/api/find_by_machine.php")
        verify_endpoint(ssh, "/api/find_all_by_machine.php")

        print("\nDeploy complete. Machine-ID recovery is now live.")
        print(
            "Smoke test from any client with:\n"
            "  tsx scripts/test/test-license-full.ts"
        )
        return 0
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    sys.exit(main())
