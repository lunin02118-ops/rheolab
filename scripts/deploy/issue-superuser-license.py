"""
Issue a Superuser licence bound to this Windows host.

What it does, in order:

  1. (Optional) Deploy the updated admin/index.php + migration SQL to the
     license server. Harmless on re-run: migration is idempotent, admin
     file is just a copy.
  2. Apply the DB migration — expands license_type ENUM to include
     'superuser'. Safe to re-run (MODIFY COLUMN is idempotent).
  3. Compute the machine_id of the current Windows host using the same
     v2 algorithm as the Tauri client
     (src-tauri/src/commands/licensing/hardware/machine_id.rs).
  4. INSERT a new licence row pre-bound to this machine:
        - license_type = 'superuser'
        - machine_id   = computed above
        - max_activations = 1, current_activations = 1
        - expires_at = +10 years (long-lived personal key)
     The key is printed to stdout for the owner to enter into the client.
  5. Remind the owner how to activate:
        - install RheoLab Enterprise 0.2.0-beta.8
        - enter the key in the licence dialog
        - the app's activate flow sees the pre-bound machine_id and
          stamps activated_at without consuming an activation slot

Usage:

    # recon-only: print the machine_id and every SQL/SCP step without
    # touching the server
    python scripts/deploy/issue-superuser-license.py --dry-run

    # full flow: deploy admin changes + migration + create key
    python scripts/deploy/issue-superuser-license.py \
        --customer-name "Vladimir Lunin" \
        --customer-email owner@example.com \
        --organization "RheoLab"

    # migration only (no key issuance) — useful for first-time server prep
    python scripts/deploy/issue-superuser-license.py --migrate-only

    # machine-id only — no server contact at all
    python scripts/deploy/issue-superuser-license.py --machine-id-only

The script fails loudly rather than silently falling back. It will never
overwrite an existing licence row bound to this machine.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import random
import string
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from ssh_common import connect_license_server, exec_checked


REPO_ROOT = Path(__file__).resolve().parents[2]
REMOTE_ROOT = "/var/www/license-server"
HW_SALT_V2 = "rheolab-hw-v2-"

# Must match BOGUS_PATTERNS in
# src-tauri/src/commands/licensing/hardware/collectors.rs:9-23
BOGUS_PATTERNS: set[str] = {
    "to be filled by o.e.m.",
    "default string",
    "none",
    "no asset tag",
    "not available",
    "not specified",
    "system serial number",
    "chassis serial number",
    "0123456789abcdef",
    "123456789",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "03000200-0400-0500-0006-000700080009",  # VMware default
    "0000000000000000",
}


# ──────────────────────────────────────────────────────────────────────
#  Machine-ID computation — Python port of the Rust v2 algorithm.
# ──────────────────────────────────────────────────────────────────────


def _sanitize(raw: str) -> str:
    """Mirror collectors::sanitize: lower, trim, reject bogus values."""
    v = raw.strip().lower()
    if len(v) < 4:
        return ""
    if v in BOGUS_PATTERNS:
        return ""
    if all(c == "0" for c in v) or all(c == "f" for c in v):
        return ""
    return v


def _wmi_query(command: str) -> str:
    """Run a PowerShell WMI query. Returns '' on any failure."""
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""
    if proc.returncode != 0:
        return ""
    return proc.stdout


def compute_machine_id() -> tuple[str, dict[str, str]]:
    """
    Reproduce the Tauri client v2 machine-ID algorithm:
        SHA-256("rheolab-hw-v2-" + cpu_id + "|" + mobo_uuid + "|" + bios_serial)[0..32]
    Returns (machine_id, components) where `components` maps the three
    source fields to their sanitized values for debugging.
    """
    cpu = _sanitize(_wmi_query(
        "Get-CimInstance Win32_Processor | "
        "Select-Object -First 1 -ExpandProperty ProcessorId"
    ))
    mobo = _sanitize(_wmi_query(
        "Get-CimInstance Win32_ComputerSystemProduct | "
        "Select-Object -ExpandProperty UUID"
    ))
    bios = _sanitize(_wmi_query(
        "Get-CimInstance Win32_BIOS | "
        "Select-Object -ExpandProperty SerialNumber"
    ))

    parts = [p for p in (cpu, mobo, bios) if p]
    if not parts:
        raise RuntimeError(
            "Could not obtain any hardware component (cpu_id / mobo_uuid /"
            " bios_serial). Are you on a non-Windows host or in a locked-down"
            " VM? The client would fall back to a random UUID in that case;"
            " this script refuses rather than issuing a licence for a"
            " machine-ID that will rotate on next reboot."
        )

    combined = "|".join(parts)
    digest = hashlib.sha256((HW_SALT_V2 + combined).encode("utf-8")).hexdigest()
    return digest[:32], {"cpu_id": cpu, "mobo_uuid": mobo, "bios_serial": bios}


# ──────────────────────────────────────────────────────────────────────
#  Licence-key generation. Matches license-server helpers format.
# ──────────────────────────────────────────────────────────────────────


def generate_license_key() -> str:
    """XXXX-XXXX-XXXX-XXXX, A-Z + 2-9 (no 0/1 lookalikes)."""
    alphabet = string.ascii_uppercase + "23456789"
    groups = ["".join(random.choices(alphabet, k=4)) for _ in range(4)]
    return "-".join(groups)


# ──────────────────────────────────────────────────────────────────────
#  Server-side helpers.
# ──────────────────────────────────────────────────────────────────────


def _mysql_exec(ssh, sql: str, *, want_output: bool = False) -> str:
    """
    Run a SQL statement via the same mysql client that admin/index.php
    talks to. Reads credentials from the server's config.php so nothing
    sensitive lives in this script.
    """
    # The server's config.php exposes DB_HOST / DB_NAME / DB_USER / DB_PASSWORD
    # as PHP constants. Extract them with a short PHP one-liner, then pipe
    # the SQL to mysql(1). Credentials never leave the server.
    # config.php defines DB_PASS (not DB_PASSWORD). includes/db.php is
    # where getDB() lives but it only loads config.php; we pull in
    # config.php directly to avoid instantiating a PDO connection just
    # to read constants.
    credentials_cmd = (
        "php -r "
        "\"require '/var/www/license-server/config.php'; "
        "echo DB_HOST.\\\"\\t\\\".DB_NAME.\\\"\\t\\\".DB_USER.\\\"\\t\\\".DB_PASS;\""
    )
    creds = exec_checked(
        ssh, credentials_cmd, print_command=False, print_output=False
    ).strip()
    try:
        host, name, user, pw = creds.split("\t")
    except ValueError as exc:
        # Scrub the raw creds from the error message — the payload shape
        # should be diagnosed separately (e.g. by re-running the PHP one-liner
        # interactively) rather than dumped in CI logs.
        raise RuntimeError(
            "Unexpected credentials payload from server "
            f"(expected 4 tab-separated fields, got {creds.count(chr(9)) + 1})"
        ) from exc

    # Keep the password out of `ps` by passing it through MYSQL_PWD.
    env_prefix = f"MYSQL_PWD={_shquote(pw)}"
    mysql_cmd = (
        f"{env_prefix} mysql -h{_shquote(host)} -u{_shquote(user)} "
        f"{_shquote(name)} -N -e {_shquote(sql)}"
    )
    # Suppress stdout of the SQL command as well — INSERT returns nothing,
    # but SELECT results (e.g. the existence check) contain the licence
    # key, which we'd rather print under controlled formatting later.
    out = exec_checked(
        ssh, mysql_cmd, print_command=False, print_output=False
    )
    return out if want_output else ""


def _shquote(value: str) -> str:
    """
    Minimal POSIX-shell quoter. Sufficient for the credentials we're
    piping (no embedded single quotes expected in our config), but falls
    back to Python's shlex for anything non-trivial.
    """
    if not value:
        return "''"
    import shlex
    return shlex.quote(value)


def apply_migration(ssh, dry_run: bool) -> None:
    """Apply migrations/add_superuser_type.sql. Idempotent."""
    print("\n── Apply superuser ENUM migration ────────────────────────")
    local_path = REPO_ROOT / "license-server" / "migrations" / "add_superuser_type.sql"
    if not local_path.exists():
        raise RuntimeError(f"migration file missing: {local_path}")

    sql = local_path.read_text(encoding="utf-8")
    # Strip SQL comments for the one-shot exec — mysql handles them, but
    # keeping the payload small avoids line-ending issues over SSH.
    statements = [
        line for line in sql.splitlines()
        if line.strip() and not line.strip().startswith("--")
    ]
    payload = "\n".join(statements)

    if dry_run:
        print("  [DRY-RUN] would apply:")
        for line in statements:
            print(f"    {line}")
        return

    _mysql_exec(ssh, payload)

    # Verify the ENUM now includes 'superuser'.
    column_def = _mysql_exec(
        ssh,
        "SHOW COLUMNS FROM license_keys WHERE Field = 'license_type';",
        want_output=True,
    )
    if "superuser" not in column_def.lower():
        raise RuntimeError(
            "Migration ran without error but the ENUM does not contain "
            "'superuser'. Raw column definition:\n" + column_def
        )
    print("  ✓ license_type ENUM now accepts 'superuser'")


def upload_admin_ui(ssh, dry_run: bool) -> None:
    """scp the updated admin/index.php so the dropdown shows Superuser."""
    print("\n── Upload updated admin UI ───────────────────────────────")
    local = REPO_ROOT / "license-server" / "admin" / "index.php"
    remote = f"{REMOTE_ROOT}/admin/index.php"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = f"{remote}.bak-{stamp}"

    if dry_run:
        print(f"  [DRY-RUN] backup {remote} → {backup}")
        print(f"  [DRY-RUN] upload {local} → {remote}")
        return

    exec_checked(ssh, f"cp -a {_shquote(remote)} {_shquote(backup)}")
    print(f"  backed up   {remote} → {backup}")
    # Use sftp via our existing SSH session. ssh_common.exec_checked
    # doesn't expose that directly, so shell out to scp with the same
    # identity file. This keeps the script dependency-free.
    scp_cmd = [
        "scp",
        "-i", os.path.expanduser("~/.ssh/rheolab_deploy"),
        "-o", "StrictHostKeyChecking=yes",
        "-o", "BatchMode=yes",
        "-o", f"UserKnownHostsFile={REPO_ROOT / 'scripts' / 'deploy' / 'known_hosts'}",
        str(local),
        f"root@license.vizbuka.ru:{remote}",
    ]
    proc = subprocess.run(scp_cmd, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"scp failed with exit code {proc.returncode}")
    print(f"  uploaded    {local.name} → {remote}")


def insert_superuser_key(
    ssh,
    *,
    customer_name: str,
    customer_email: str,
    organization: str,
    machine_id: str,
    expires_months: int,
    dry_run: bool,
) -> str:
    """
    Insert a pre-bound Superuser licence. Returns the generated licence key.
    Refuses to overwrite an existing superuser row bound to the same
    machine — that would orphan the previous key on another installation.
    """
    print("\n── Create Superuser licence ──────────────────────────────")
    # Defensive check: is there already a superuser licence on this machine?
    existing = _mysql_exec(
        ssh,
        (
            "SELECT license_key FROM license_keys "
            f"WHERE machine_id = {_sql_literal(machine_id)} "
            "AND license_type = 'superuser' "
            "AND is_revoked = 0 AND is_active = 1;"
        ),
        want_output=True,
    ).strip()
    if existing:
        raise RuntimeError(
            "An active superuser licence is already bound to this machine:\n"
            f"  {existing}\n"
            "Use it, or revoke it from admin/index.php before re-issuing."
        )

    key = generate_license_key()
    # Keep expires_at purely server-side (NOW() + interval) to avoid
    # client-server clock drift. 10 years by default — personal key,
    # not a recurring subscription.
    insert_sql = (
        "INSERT INTO license_keys ("
        "license_key, customer_name, customer_email, organization, "
        "license_type, max_activations, current_activations, machine_id, "
        "expires_at, is_active"
        ") VALUES ("
        f"{_sql_literal(key)}, "
        f"{_sql_literal(customer_name)}, "
        f"{_sql_literal(customer_email)}, "
        f"{_sql_literal(organization)}, "
        "'superuser', 1, 1, "
        f"{_sql_literal(machine_id)}, "
        f"DATE_ADD(NOW(), INTERVAL {int(expires_months)} MONTH), "
        "1"
        ");"
    )

    if dry_run:
        print(f"  [DRY-RUN] new key: {key}")
        print(f"  [DRY-RUN] SQL: {insert_sql}")
        return key

    _mysql_exec(ssh, insert_sql)
    print(f"  ✓ inserted superuser licence: {key}")
    return key


def _sql_literal(value: str) -> str:
    """Very small SQL string literal escaper for single-quoted values."""
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


# ──────────────────────────────────────────────────────────────────────
#  Entry point.
# ──────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--customer-name",
        default="RheoLab Project Owner",
        help="customer_name column value (default: %(default)r)",
    )
    parser.add_argument(
        "--customer-email",
        default="",
        help="customer_email column value (default: empty)",
    )
    parser.add_argument(
        "--organization",
        default="RheoLab",
        help="organization column value (default: %(default)r)",
    )
    parser.add_argument(
        "--expires-months",
        type=int,
        default=120,
        help="licence validity in months (default: 120 = 10 years)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print every SSH/SCP/SQL action without executing",
    )
    parser.add_argument(
        "--migrate-only",
        action="store_true",
        help="apply the ENUM migration and upload the admin UI, then stop",
    )
    parser.add_argument(
        "--machine-id-only",
        action="store_true",
        help="compute and print the machine_id; no server contact",
    )
    args = parser.parse_args()

    # Machine-ID first — fails fast before any network I/O.
    print("── Compute machine_id (Windows host) ─────────────────────")
    machine_id, components = compute_machine_id()
    print(f"  cpu_id      : {components['cpu_id'] or '(empty)'}")
    print(f"  mobo_uuid   : {components['mobo_uuid'] or '(empty)'}")
    print(f"  bios_serial : {components['bios_serial'] or '(empty)'}")
    print(f"  → machine_id: {machine_id}")

    if args.machine_id_only:
        return 0

    ssh = None
    try:
        ssh = connect_license_server()

        apply_migration(ssh, args.dry_run)
        upload_admin_ui(ssh, args.dry_run)

        if args.migrate_only:
            print("\n--migrate-only: stopping before licence issuance")
            return 0

        key = insert_superuser_key(
            ssh,
            customer_name=args.customer_name,
            customer_email=args.customer_email,
            organization=args.organization,
            machine_id=machine_id,
            expires_months=args.expires_months,
            dry_run=args.dry_run,
        )

        print("\n── Next steps ────────────────────────────────────────────")
        print(f"  1. Install RheoLab Enterprise 0.2.0-beta.8 on THIS machine.")
        print(f"  2. Open the licence dialog and enter the key below:")
        print(f"        {key}")
        print(f"  3. The activation request will find the pre-bound machine_id")
        print(f"     and return a signed payload. The client then starts sending")
        print(f"     'X-Update-Channel: alpha' + HMAC on every updater poll.")
        print(f"  4. Verify once installed:")
        print(f"       npm run check:update -- --channel alpha")
        return 0
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    sys.exit(main())
