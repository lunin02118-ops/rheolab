import os

from ssh_common import connect_license_server, exec_checked


license_key = os.environ.get("LICENSE_SERVER_TEST_KEY", "TEST-1234-5678-ABCD").replace("'", "''")

script = f"""
mysql -uroot rheolab_license <<'ENDSQL'
UPDATE license_keys SET current_activations=0, machine_id=NULL, activated_at=NULL
  WHERE license_key='{license_key}';
DELETE FROM activation_log WHERE license_id=(SELECT id FROM license_keys WHERE license_key='{license_key}');
SELECT id, license_key, current_activations, machine_id, is_active FROM license_keys WHERE license_key='{license_key}';
ENDSQL
"""

ssh = connect_license_server()
try:
    exec_checked(ssh, script)
finally:
    ssh.close()

print("Done.")
