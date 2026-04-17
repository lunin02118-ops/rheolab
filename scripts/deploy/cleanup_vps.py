from ssh_common import connect_license_server, exec_checked


def main():
    ssh = None
    try:
        ssh = connect_license_server()

        print("Starting cleanup...")

        print("\n[1/4] Removing old website backups...")
        exec_checked(ssh, "rm -rf /var/www/rheolab.site.backup_*")
        exec_checked(ssh, "rm -rf /var/www/rheolab.site_backup_*")

        print("\n[2/4] Cleaning Apt cache...")
        exec_checked(ssh, "apt-get clean")
        exec_checked(ssh, "apt-get autoremove -y")

        print("\n[3/4] Vacuuming system journals...")
        exec_checked(ssh, "journalctl --vacuum-time=2d")

        print("\n[4/4] Truncating large logs...")
        exec_checked(ssh, "truncate -s 0 /var/log/btmp")

        print("\nFinal Disk Usage:")
        exec_checked(ssh, "df -h /")
    except Exception as e:
        print(f"Cleanup failed: {e}")
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    main()
