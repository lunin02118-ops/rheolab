import os
from ssh_common import connect_license_server, exec_checked

def main():
    new_password = os.environ.get("NEW_VPS_PASS")
    if not new_password:
        print("Error: Set NEW_VPS_PASS to the new password before running this script")
        return

    if len(new_password) < 16:
        print("Error: NEW_VPS_PASS must be at least 16 characters")
        return

    ssh = None
    try:
        ssh = connect_license_server()
        username = os.environ.get("LICENSE_SERVER_USER", "")
        exec_checked(ssh, "chpasswd", stdin_data=f"{username}:{new_password}\n")
        print("Password changed successfully.")
        print("Update your secret store and LICENSE_SERVER_PASS before the next deploy.")
    except Exception as e:
        print(f"Failed: {e}")
    finally:
        if ssh is not None:
            ssh.close()

if __name__ == "__main__":
    main()
