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


def remote_db_name(ssh):
    return exec_checked(
        ssh,
        "php -r \"require '/var/www/license-server/config.php'; echo DB_NAME;\"",
        print_command=False,
        print_output=False,
    ).strip()


def run_sql(ssh, sql_file, *, required=False):
    sql = Path(sql_file).read_text(encoding="utf-8")
    print(f"Running SQL: {sql_file}")
    if DB_PASS:
        exec_checked(
            ssh,
            f"mysql --user={shlex.quote(DB_USER)} --password={shlex.quote(DB_PASS)} {shlex.quote(DB_NAME)}",
            stdin_data=sql,
            print_command=False,
        )
        return

    # DDL migrations need ALTER privileges. In the normal VPS layout the app
    # DB user is deliberately least-privilege, so fall back to the local
    # Debian maintenance account instead of requiring secrets in .env.server.
    db_name = remote_db_name(ssh)
    if not db_name:
        message = "Unable to resolve DB_NAME from remote config.php"
        if required:
            raise RuntimeError(message)
        print(f"Warning: {message}")
        return
    exec_checked(
        ssh,
        f"mysql --defaults-file=/etc/mysql/debian.cnf {shlex.quote(db_name)}",
        stdin_data=sql,
        print_command=False,
        print_output=False,
    )


def main():
    ssh = None
    try:
        ssh = connect_license_server()

        include_files = [
            ("license-server/includes/db.php", "/var/www/license-server/includes/db.php"),
            ("license-server/includes/helpers.php", "/var/www/license-server/includes/helpers.php"),
            ("license-server/includes/license_payload.php", "/var/www/license-server/includes/license_payload.php"),
            ("license-server/includes/rate_limiter.php", "/var/www/license-server/includes/rate_limiter.php"),
            ("license-server/includes/sign_rsa.php", "/var/www/license-server/includes/sign_rsa.php"),
        ]

        api_files = [
            ("license-server/api/activate.php", "/var/www/license-server/api/activate.php"),
            ("license-server/api/validate.php", "/var/www/license-server/api/validate.php"),
            ("license-server/api/status.php", "/var/www/license-server/api/status.php"),
            ("license-server/api/register_demo.php", "/var/www/license-server/api/register_demo.php"),
            ("license-server/api/find_by_machine.php", "/var/www/license-server/api/find_by_machine.php"),
            ("license-server/api/find_all_by_machine.php", "/var/www/license-server/api/find_all_by_machine.php"),
            ("license-server/api/migrate_machine.php", "/var/www/license-server/api/migrate_machine.php"),
            ("license-server/api/deactivate.php", "/var/www/license-server/api/deactivate.php"),
            ("license-server/api/update-channel.php", "/var/www/license-server/api/update-channel.php"),
        ]

        admin_files = [
            ("license-server/admin/index.php", "/var/www/license-server/admin/index.php"),
        ]

        root_files = [
            ("license-server/.htaccess", "/var/www/license-server/.htaccess"),
        ]

        run_sql(ssh, "license-server/migrations/normalize_license_types.sql", required=True)

        for local, remote in root_files + include_files + api_files + admin_files:
            if os.path.exists(local):
                deploy_file(ssh, local, remote)

        exec_checked(ssh, "rm -f /var/www/license-server/admin/demo-users.php")

        print("Deployment complete!")
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    main()
