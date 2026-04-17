from ssh_common import connect_license_server, exec_checked


def main():
    ssh = None
    try:
        ssh = connect_license_server()

        print("Removing installer from VPS...")
        exec_checked(ssh, "rm -f /var/www/rheolab.site/downloads/RheoLab-Enterprise-Setup.exe")
        exec_checked(ssh, "ls -l /var/www/rheolab.site/downloads/")
        print("\nInstaller removed from VPS.")
    except Exception as e:
        print(f"Operation failed: {e}")
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    main()
