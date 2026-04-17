from ssh_common import connect_license_server, exec_checked


def main():
    ssh = None
    try:
        ssh = connect_license_server()

        print("Deep Garbage Inspection...")

        print("\n[1/5] Checking Temporary Directories...")
        exec_checked(ssh, "du -sh /tmp /var/tmp 2>/dev/null")
        exec_checked(ssh, "ls -lh /tmp | head -n 5")

        print("\n[2/5] Checking /var/cache...")
        exec_checked(ssh, "du -sh /var/cache/* | sort -hr | head -n 10")

        print("\n[3/5] Checking User Caches...")
        exec_checked(ssh, "du -sh /root/.cache /home/*/.cache 2>/dev/null")

        print("\n[4/5] Checking PHP Sessions...")
        exec_checked(ssh, "ls -1 /var/lib/php/sessions/ | wc -l")
        exec_checked(ssh, "du -sh /var/lib/php/sessions/")

        print("\n[5/5] Checking MySQL Data...")
        exec_checked(ssh, "du -sh /var/lib/mysql/* | sort -hr | head -n 10")
    except Exception as e:
        print(f"Inspection failed: {e}")
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    main()
