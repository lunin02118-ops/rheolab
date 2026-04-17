"""
Deploy License Server Updates

Usage:
    Set environment variables:
    - LICENSE_SERVER_HOST
    - LICENSE_SERVER_USER
    - LICENSE_SERVER_PASS
    - LICENSE_DB_USER (optional)
    - LICENSE_DB_PASS (optional)
    - LICENSE_DB_NAME (optional, default: rheolab_license)

    Then run: python scripts/deploy-license-server.py
"""
import os
import shlex
from pathlib import Path

from ssh_common import connect_license_server, exec_checked


DB_USER = os.environ.get("LICENSE_DB_USER", "license_user")
DB_PASS = os.environ.get("LICENSE_DB_PASS")
DB_NAME = os.environ.get("LICENSE_DB_NAME", "rheolab_license")


def deploy_file(ssh, local_path, remote_path):
    sftp = ssh.open_sftp()
    try:
        print(f"Uploading {local_path} -> {remote_path}")
        sftp.put(local_path, remote_path)
    finally:
        sftp.close()

    exec_checked(ssh, f"chown www-data:www-data {shlex.quote(remote_path)}")
    exec_checked(ssh, f"chmod 644 {shlex.quote(remote_path)}")


def run_sql(ssh, sql_file):
    if not DB_PASS:
        print("Warning: LICENSE_DB_PASS not set, skipping SQL execution")
        return

    sql = Path(sql_file).read_text(encoding="utf-8")
    print(f"Running SQL: {sql_file}")
    exec_checked(
        ssh,
        f"mysql --user={shlex.quote(DB_USER)} --password={shlex.quote(DB_PASS)} {shlex.quote(DB_NAME)}",
        stdin_data=sql,
        print_command=False,
    )


def main():
    ssh = None
    try:
        ssh = connect_license_server()

        api_files = [
            ("license-server/api/activate.php", "/var/www/license-server/api/activate.php"),
            ("license-server/api/validate.php", "/var/www/license-server/api/validate.php"),
            ("license-server/api/status.php", "/var/www/license-server/api/status.php"),
            ("license-server/api/register_demo.php", "/var/www/license-server/api/register_demo.php"),
            ("license-server/api/find_by_machine.php", "/var/www/license-server/api/find_by_machine.php"),
            ("license-server/api/find_all_by_machine.php", "/var/www/license-server/api/find_all_by_machine.php"),
            ("license-server/api/migrate_machine.php", "/var/www/license-server/api/migrate_machine.php"),
            ("license-server/api/deactivate.php", "/var/www/license-server/api/deactivate.php"),
        ]

        for local, remote in api_files:
            if os.path.exists(local):
                deploy_file(ssh, local, remote)

        if os.path.exists("server_update/admin_index.php"):
            deploy_file(ssh, "server_update/admin_index.php", "/var/www/license-server/admin/index.php")

        print("Deployment complete!")
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    main()
