from ssh_common import connect_license_server, exec_checked


def main():
    ssh = None
    try:
        ssh = connect_license_server()

        exec_checked(ssh, "df -h")
        exec_checked(ssh, "docker system df 2>/dev/null || echo 'Docker not found'")
        exec_checked(ssh, "du -sh /var/www/*")
        exec_checked(ssh, "du -sh /var/log/* | sort -hr | head -n 10")
        exec_checked(ssh, "du -sh /* 2>/dev/null | sort -hr | head -n 15")
        exec_checked(ssh, "ls -lh /var/www/ | grep backup || true")
    except Exception as e:
        print(f"Connection failed: {e}")
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    main()
