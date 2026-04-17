import os
from pathlib import Path, PurePosixPath

from ssh_common import connect_license_server, exec_checked

REMOTE_PATH = "/var/www/rheolab.site"
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
LOCAL_DIST_PATH = PROJECT_ROOT / "website" / "dist"

def validate_remote_path(remote_path):
    normalized = remote_path.rstrip("/")
    if normalized in {"", "/", "/var", "/var/www"}:
        raise ValueError(f"Refusing to run destructive deploy operations against unsafe path: {remote_path}")
    return normalized

def upload_dir(sftp, local_dir, remote_dir):
    uploaded_files = 0
    for root, dirs, files in os.walk(local_dir):
        rel_path = os.path.relpath(root, local_dir)
        rel_parts = [] if rel_path == "." else rel_path.split(os.sep)
        remote_root = str(PurePosixPath(remote_dir, *rel_parts))

        try:
            sftp.stat(remote_root)
        except FileNotFoundError:
            sftp.mkdir(remote_root)

        for file in sorted(files):
            local_file = os.path.join(root, file)
            remote_file = str(PurePosixPath(remote_root, file))
            print(f"Uploading {local_file} -> {remote_file}")
            sftp.put(local_file, remote_file)
            uploaded_files += 1

    return uploaded_files

def main():
    if not LOCAL_DIST_PATH.exists():
        print(f"Error: Local dist folder not found at {LOCAL_DIST_PATH}")
        print("Run 'npm run build' in website/ directory first.")
        return

    remote_path = validate_remote_path(REMOTE_PATH)
    ssh = None
    try:
        ssh = connect_license_server()
        sftp = ssh.open_sftp()

        # 1. Backup existing site
        print("\n--- Backing up existing site ---")
        exec_checked(
            ssh,
            f"if [ -d {remote_path} ]; then cp -r {remote_path} {remote_path}_backup_$(date +%Y%m%d_%H%M%S); fi",
        )

        print("\n--- Cleaning remote directory ---")
        exec_checked(ssh, f"find {remote_path} -mindepth 1 -maxdepth 1 -exec rm -rf {{}} +")

        # 3. Upload new site
        print("\n--- Uploading new site ---")
        uploaded_files = upload_dir(sftp, str(LOCAL_DIST_PATH), remote_path)
        if uploaded_files == 0:
            raise RuntimeError(f"No files were uploaded from {LOCAL_DIST_PATH}")

        # 4. Set permissions
        print("\n--- Setting permissions ---")
        exec_checked(ssh, f"chown -R www-data:www-data {remote_path}")
        exec_checked(ssh, f"chmod -R 755 {remote_path}")

        # 5. Reload Apache
        print("\n--- Reloading Apache ---")
        exec_checked(ssh, "systemctl reload apache2")

        print("\nDeployment Complete!")
        print(f"Visit https://rheolab.site to verify.")

    except Exception as e:
        print(f"\nDeployment Failed: {e}")
    finally:
        if 'sftp' in locals():
            sftp.close()
        if ssh is not None:
            ssh.close()

if __name__ == "__main__":
    main()
