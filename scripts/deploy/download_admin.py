"""
Download Admin Panel from License Server

Usage:
    Set environment variables:
    - LICENSE_SERVER_HOST
    - LICENSE_SERVER_USER
    - LICENSE_SERVER_PASS

    Then run: python download_admin.py
"""
import os

from ssh_common import connect_license_server


def download_file(remote_path, local_path):
    client = None
    sftp = None
    try:
        client = connect_license_server()
        sftp = client.open_sftp()

        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        sftp.get(remote_path, local_path)
        print(f"Downloaded {remote_path} to {local_path}")
    finally:
        if sftp is not None:
            sftp.close()
        if client is not None:
            client.close()


if __name__ == "__main__":
    download_file("/var/www/license-server/admin/index.php", "server_update/admin_index_original.php")
