import shlex

from ssh_common import connect_license_server, exec_checked


def main():
    ssh = None
    try:
        ssh = connect_license_server()

        print("\n--- Nginx Sites Enabled ---")
        exec_checked(ssh, "ls -la /etc/nginx/sites-enabled/")

        print("\n--- Nginx Configs ---")
        sites = exec_checked(ssh, "ls /etc/nginx/sites-enabled/").split()
        for site in sites:
            print(f"\nContent of {site}:")
            exec_checked(ssh, f"cat /etc/nginx/sites-enabled/{shlex.quote(site)}")
    except Exception as e:
        print(f"Connection failed: {e}")
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    main()
