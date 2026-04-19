#!/usr/bin/env python3
"""
Deploy the alpha update channel to the RheoLab license server.

What this does (in order):

  1. Recon: connect over SSH, inspect the current state of
     /var/www/license-server/, find where RHEOLAB_BETA_CHANNEL_SECRET
     is configured today (Apache conf-enabled env file, VHost, or
     .htaccess SetEnv), and print a summary.

  2. Upload the new update-channel.php and .htaccess from the
     repo working tree to /var/www/license-server/, preserving
     www-data ownership and 644 mode. Creates a timestamped backup
     of each remote file before overwriting.

  3. Install the RHEOLAB_ALPHA_CHANNEL_SECRET env var next to the
     beta one — reuses the mechanism already in place (SetEnv in
     Apache conf, or /etc/apache2/envvars, whichever the beta
     secret uses). Refuses to fall back to an insecure location
     if recon can't locate the beta-secret mechanism.

  4. Validate Apache configuration (`apache2ctl configtest`).

  5. Reload Apache (`systemctl reload apache2`).

  6. Smoke-test: curl the /releases/v1/update/windows-x86_64/update
     endpoint three times — with no channel header (expect stable),
     with alpha header + no token (expect stable — downgrade path),
     with alpha header + valid HMAC token (expect alpha or 204).

The alpha HMAC secret is read from the local ops store, NOT from
anywhere inside the git repo:

    D:\\Development\\Workspace\\ops\\server-access\\servers\\
      04-rheolab-license\\secrets.env
      └─ RHEOLAB_ALPHA_CHANNEL_SECRET=<64 hex chars>

Override the path with --secrets-file if you keep it elsewhere.

Usage:

    # dry-run inspection, no writes to the server
    python scripts/deploy/deploy-alpha-channel.py --recon

    # full deploy (uploads + Apache reload + smoke test)
    python scripts/deploy/deploy-alpha-channel.py

    # skip the Apache reload (useful if you want to reload yourself)
    python scripts/deploy/deploy-alpha-channel.py --no-reload
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import os
import shlex
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from ssh_common import connect_license_server, exec_checked


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SECRETS_FILE = Path(
    r"D:\Development\Workspace\ops\server-access\servers\04-rheolab-license\secrets.env"
)
REMOTE_ROOT = "/var/www/license-server"
REMOTE_FILES: list[tuple[str, str]] = [
    ("license-server/api/update-channel.php", f"{REMOTE_ROOT}/api/update-channel.php"),
    ("license-server/.htaccess",              f"{REMOTE_ROOT}/.htaccess"),
]


def parse_env_file(path: Path) -> dict[str, str]:
    """Parse a KEY=VALUE .env file, stripping quotes and comments."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        out[key] = value
    return out


def timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def recon(ssh) -> dict[str, str]:
    """
    Inspect the server. Returns a dict summarising what we found so
    later steps can reuse whatever mechanism already carries the
    beta secret.
    """
    print("\n── Recon ────────────────────────────────────────────────")
    info: dict[str, str] = {}

    # 1. Do the target files even exist on the server?
    for _, remote in REMOTE_FILES:
        try:
            exec_checked(ssh, f"test -f {shlex.quote(remote)}")
            info[f"exists:{remote}"] = "yes"
        except RuntimeError:
            info[f"exists:{remote}"] = "no"

    # 2. Where is RHEOLAB_BETA_CHANNEL_SECRET configured?
    # Check the usual suspects in order of preference.
    candidates = [
        "/etc/apache2/envvars",
        "/etc/apache2/conf-enabled/rheolab-env.conf",
        "/etc/apache2/conf-available/rheolab-env.conf",
        "/etc/apache2/sites-enabled/000-default.conf",
        "/etc/apache2/sites-enabled/license-server.conf",
        f"{REMOTE_ROOT}/.htaccess",
    ]
    beta_location = None
    for candidate in candidates:
        try:
            out = exec_checked(
                ssh,
                f"grep -l RHEOLAB_BETA_CHANNEL_SECRET {shlex.quote(candidate)} 2>/dev/null || true",
                print_command=False,
            )
            if out.strip():
                beta_location = out.strip()
                break
        except RuntimeError:
            continue
    info["beta_secret_location"] = beta_location or "(not found)"

    # 3. What's the Apache service unit?
    try:
        exec_checked(ssh, "systemctl is-active apache2 >/dev/null && echo apache2 || echo httpd",
                     print_command=False)
        info["apache_service"] = "apache2"
    except RuntimeError:
        info["apache_service"] = "unknown"

    print(f"  update-channel.php present: {info.get('exists:' + f'{REMOTE_ROOT}/api/update-channel.php')}")
    print(f"  .htaccess present:          {info.get('exists:' + f'{REMOTE_ROOT}/.htaccess')}")
    print(f"  beta secret lives in:       {info['beta_secret_location']}")
    print(f"  apache service:             {info['apache_service']}")
    return info


def upload_files(ssh) -> None:
    """Upload the repo versions of update-channel.php and .htaccess."""
    print("\n── Upload ───────────────────────────────────────────────")
    sftp = ssh.open_sftp()
    try:
        for local_rel, remote in REMOTE_FILES:
            local = REPO_ROOT / local_rel
            if not local.exists():
                raise RuntimeError(f"local file missing: {local}")

            # Remote backup before overwrite.
            backup = f"{remote}.bak-{timestamp()}"
            try:
                exec_checked(ssh, f"cp -a {shlex.quote(remote)} {shlex.quote(backup)}",
                             print_command=False)
                print(f"  backed up   {remote} → {backup}")
            except RuntimeError:
                # File didn't exist yet — not a backup failure, just a first deploy.
                print(f"  (no existing {remote} to back up)")

            print(f"  uploading   {local.name} → {remote}")
            sftp.put(str(local), remote)
            exec_checked(ssh, f"chown www-data:www-data {shlex.quote(remote)}", print_command=False)
            exec_checked(ssh, f"chmod 644 {shlex.quote(remote)}", print_command=False)
    finally:
        sftp.close()


def install_alpha_secret(ssh, info: dict[str, str], alpha_secret: str) -> None:
    """
    Add RHEOLAB_ALPHA_CHANNEL_SECRET to the same configuration file
    that currently carries RHEOLAB_BETA_CHANNEL_SECRET. If that's
    /etc/apache2/envvars we use `export VAR="…"`. Otherwise we use
    Apache's SetEnv directive.
    """
    print("\n── Install alpha secret ─────────────────────────────────")
    location = info["beta_secret_location"]
    if location == "(not found)":
        raise RuntimeError(
            "Cannot find where RHEOLAB_BETA_CHANNEL_SECRET is configured on the server. "
            "Add RHEOLAB_ALPHA_CHANNEL_SECRET manually to your Apache env source, then "
            "re-run with --skip-secret."
        )

    # Is it already there?
    try:
        out = exec_checked(
            ssh,
            f"grep -c RHEOLAB_ALPHA_CHANNEL_SECRET {shlex.quote(location)} || true",
            print_command=False,
        )
        already = int((out.strip() or "0").splitlines()[0]) > 0
    except (RuntimeError, ValueError):
        already = False

    if already:
        print(f"  RHEOLAB_ALPHA_CHANNEL_SECRET already present in {location}")
        print("  → updating value in place")
        # Replace existing line.
        if location.endswith("envvars"):
            line = f'export RHEOLAB_ALPHA_CHANNEL_SECRET="{alpha_secret}"'
        else:
            line = f'SetEnv RHEOLAB_ALPHA_CHANNEL_SECRET {alpha_secret}'
        # sed in place with delimiters that don't clash with hex chars.
        exec_checked(
            ssh,
            "sed -i '/RHEOLAB_ALPHA_CHANNEL_SECRET/d' " + shlex.quote(location),
            print_command=False,
        )
        exec_checked(
            ssh,
            f"echo {shlex.quote(line)} >> {shlex.quote(location)}",
            print_command=False,
        )
    else:
        if location.endswith("envvars"):
            line = f'export RHEOLAB_ALPHA_CHANNEL_SECRET="{alpha_secret}"'
        else:
            line = f'SetEnv RHEOLAB_ALPHA_CHANNEL_SECRET {alpha_secret}'
        print(f"  appending new line to {location}")
        exec_checked(
            ssh,
            f"echo {shlex.quote(line)} >> {shlex.quote(location)}",
            print_command=False,
        )


def apache_reload(ssh) -> None:
    print("\n── Apache reload ────────────────────────────────────────")
    exec_checked(ssh, "apache2ctl configtest")
    exec_checked(ssh, "systemctl reload apache2")


def smoke_test(endpoint_base: str, alpha_secret: str) -> None:
    """
    Hit the public update endpoint from the deploy host. We only
    verify status-code shape, not manifest content — the goal is to
    catch misconfiguration (Apache not reloaded, env var not picked
    up, etc.), not to exercise Tauri parsing.
    """
    print("\n── Smoke test ───────────────────────────────────────────")
    url = f"{endpoint_base}/releases/v1/update/windows-x86_64/update"

    def probe(label: str, headers: dict[str, str]) -> None:
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                served = resp.headers.get("X-Channel-Served", "(none)")
                print(f"  {label:<40} → HTTP {resp.status}  X-Channel-Served={served}")
        except urllib.error.HTTPError as e:
            print(f"  {label:<40} → HTTP {e.code}")
        except Exception as e:
            print(f"  {label:<40} → error: {e}")

    # 1. No channel header — baseline stable.
    probe("no header", {})

    # 2. Alpha header without token — must downgrade to stable.
    probe("alpha, no token", {"X-Update-Channel": "alpha"})

    # 3. Alpha header with a valid HMAC token.
    window = int(time.time() // 300)
    message = f"alpha:{window}".encode()
    token = hmac.new(alpha_secret.encode(), message, hashlib.sha256).hexdigest()
    probe("alpha + valid HMAC", {
        "X-Update-Channel": "alpha",
        "X-Update-Token": token,
    })

    # 4. Same but with a corrupted token — must downgrade.
    probe("alpha + tampered HMAC", {
        "X-Update-Channel": "alpha",
        "X-Update-Token": "0" * 64,
    })


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--recon", action="store_true",
                        help="only inspect the server; no uploads, no Apache reload")
    parser.add_argument("--no-reload", action="store_true",
                        help="upload files and set the env var but don't reload Apache")
    parser.add_argument("--no-smoke", action="store_true",
                        help="skip the HTTP smoke test at the end")
    parser.add_argument("--skip-secret", action="store_true",
                        help="don't install RHEOLAB_ALPHA_CHANNEL_SECRET on the server "
                             "(useful if you're managing Apache env vars out-of-band)")
    parser.add_argument("--secrets-file", type=Path, default=DEFAULT_SECRETS_FILE,
                        help=f"path to ops secrets.env (default: {DEFAULT_SECRETS_FILE})")
    parser.add_argument("--endpoint-base", default="https://license.vizbuka.ru",
                        help="base URL to probe during smoke-test (default: https://license.vizbuka.ru)")
    args = parser.parse_args()

    # Load the alpha secret from the ops store (not from the repo).
    alpha_secret = ""
    if not args.skip_secret:
        envmap = parse_env_file(args.secrets_file)
        alpha_secret = envmap.get("RHEOLAB_ALPHA_CHANNEL_SECRET", "").strip()
        if not alpha_secret:
            print(
                f"ERROR: RHEOLAB_ALPHA_CHANNEL_SECRET is missing from {args.secrets_file}\n"
                "Run the secret-generation step first, or pass --skip-secret if the env var "
                "is managed out-of-band.",
                file=sys.stderr,
            )
            return 1
        if len(alpha_secret) < 32:
            print(
                f"ERROR: RHEOLAB_ALPHA_CHANNEL_SECRET looks too short "
                f"(len={len(alpha_secret)}, expected ≥ 32 hex chars).",
                file=sys.stderr,
            )
            return 1

    ssh = None
    try:
        ssh = connect_license_server()

        info = recon(ssh)

        if args.recon:
            print("\n(--recon: stopping here, no writes performed)")
            return 0

        upload_files(ssh)

        if not args.skip_secret:
            install_alpha_secret(ssh, info, alpha_secret)

        if not args.no_reload:
            apache_reload(ssh)
        else:
            print("\n(--no-reload: Apache NOT reloaded, remember to reload manually)")

        if not args.no_smoke and alpha_secret:
            smoke_test(args.endpoint_base, alpha_secret)

        print("\n✓ alpha-channel deploy complete")
        return 0
    finally:
        if ssh is not None:
            ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
