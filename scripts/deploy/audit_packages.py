from ssh_common import connect_license_server, exec_checked


def main():
    ssh = None
    try:
        ssh = connect_license_server()

        print("Starting Package & Service Audit...")

        print("\n[1/6] Checking Listening Ports...")
        exec_checked(ssh, "ss -tuln")

        print("\n[2/6] Checking Running Services...")
        exec_checked(
            ssh,
            "systemctl list-units --type=service --state=running | grep -E 'apache|nginx|mysql|mariadb|docker|php|node|python' || true",
        )

        print("\n[3/6] Checking Web Servers...")
        exec_checked(ssh, "dpkg -l | grep -E 'apache2|nginx' || true")

        print("\n[4/6] Checking PHP...")
        exec_checked(ssh, "dpkg -l | grep php || true")
        exec_checked(ssh, "php -v")

        print("\n[5/6] Checking Database...")
        exec_checked(ssh, "dpkg -l | grep -E 'mysql|mariadb' || true")

        print("\n[6/6] Checking Runtimes (Node, Docker, Python)...")
        exec_checked(ssh, "dpkg -l | grep -E 'nodejs|npm|docker|containerd' || true")
        exec_checked(ssh, "docker --version 2>/dev/null || echo 'Docker not found'")
        exec_checked(ssh, "node -v 2>/dev/null || echo 'Node not found'")
    except Exception as e:
        print(f"Audit failed: {e}")
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    main()
