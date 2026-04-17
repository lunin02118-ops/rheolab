"""
Deploy Admin Panel to License Server

Usage:
    Set environment variables:
    - LICENSE_SERVER_HOST
    - LICENSE_SERVER_USER
    - LICENSE_SERVER_PASS

    Then run: python deploy_admin.py
"""
import shlex

from ssh_common import connect_license_server, exec_checked


def deploy():
    ssh = None
    try:
        ssh = connect_license_server()
        sftp = ssh.open_sftp()

        local_file = "server_update/admin_index.php"
        remote_file = "/var/www/license-server/admin/index.php"

        try:
            print(f"Uploading {local_file} to {remote_file}...")
            sftp.put(local_file, remote_file)
        finally:
            sftp.close()

        exec_checked(ssh, f"chown www-data:www-data {shlex.quote(remote_file)}")
        exec_checked(ssh, f"chmod 644 {shlex.quote(remote_file)}")
        print("Admin panel updated!")
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    deploy()
