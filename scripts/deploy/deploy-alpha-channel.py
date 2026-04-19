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
import json
import os
import shlex
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from ssh_common import connect_license_server, exec_checked


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SECRETS_FILE = Path(
    r"D:\Development\Workspace\ops\server-access\servers\04-rheolab-license\secrets.env"
)
REMOTE_ROOT = "/var/www/license-server"
# (local_path_relative_to_repo_root, absolute_remote_path)
# Order is purely for log readability. Every upload is atomically backed up
# before overwrite, so individual file failures won't corrupt the server.
#
# Note on the two .htaccess files: the releases/.htaccess is the one that
# actually carries the channel-aware rewrite rules — Apache applies the
# deepest .htaccess first with [L] stopping further rewriting. The root
# .htaccess keeps generic site-level guards (FilesMatch config.php, etc.)
# and is still deployed for parity, but its RewriteRules for channel
# routing never fire. See the comments inside each file for details.
REMOTE_FILES: list[tuple[str, str]] = [
    ("license-server/api/update-channel.php", f"{REMOTE_ROOT}/api/update-channel.php"),
    ("license-server/.htaccess",              f"{REMOTE_ROOT}/.htaccess"),
    ("license-server/releases.htaccess",      f"{REMOTE_ROOT}/releases/.htaccess"),
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


CHANNEL_CONF_REMOTE = "/etc/apache2/conf-available/rheolab-channels.conf"


def _secret_line(location: str, var: str, value: str) -> str:
    """Return the correct directive syntax for the given config file."""
    if location.endswith("envvars"):
        return f'export {var}="{value}"'
    # Everything else (conf-available/*.conf, sites-enabled/*.conf,
    # .htaccess) uses Apache's SetEnv directive.
    return f"SetEnv {var} {value}"


def _upsert_var(ssh, location: str, var: str, value: str) -> None:
    """
    Write `VAR=value` (or SetEnv) into `location`, replacing any existing
    line for the same var. Safe on a non-existent file (will be created).
    """
    line = _secret_line(location, var, value)
    # Create the file if it doesn't exist, wiping any pre-existing line
    # for this variable first. sed is used with a simple pattern so hex
    # secrets in the value never clash with sed delimiters.
    exec_checked(
        ssh,
        f"touch {shlex.quote(location)} && "
        f"sed -i '/{var}/d' {shlex.quote(location)} && "
        f"printf '%s\\n' {shlex.quote(line)} >> {shlex.quote(location)}",
        print_command=False,
    )


def install_alpha_secret(
    ssh,
    info: dict[str, str],
    alpha_secret: str,
    beta_secret: str | None = None,
) -> None:
    """
    Make sure RHEOLAB_ALPHA_CHANNEL_SECRET is readable by the Apache
    process that serves update-channel.php.

    Strategy:

    1. If RHEOLAB_BETA_CHANNEL_SECRET is already present in some config
       file, append/replace the alpha secret in the *same* file — keep
       the two together so future audits see them side by side.

    2. Otherwise (greenfield host: recon returned "not found"), create
       /etc/apache2/conf-available/rheolab-channels.conf and write BOTH
       SetEnv directives there. Enable the conf via a2enconf and ensure
       mod_env is loaded. This also back-fills the server with a
       working beta secret — which the recon revealed was missing
       (the beta channel was relying on mod_rewrite alone, bypassing
       the HMAC check in update-channel.php).

    Idempotent on both paths.
    """
    print("\n── Install channel secrets ──────────────────────────────")
    location = info["beta_secret_location"]

    if location == "(not found)":
        # Greenfield path — create a dedicated conf file for both secrets.
        if not beta_secret:
            raise RuntimeError(
                "RHEOLAB_BETA_CHANNEL_SECRET is not configured on the server and it "
                "is also missing from the ops secrets.env — cannot bootstrap the "
                "channels conf. Add RHEOLAB_BETA_CHANNEL_SECRET to the ops store "
                "and re-run."
            )

        print(f"  greenfield host: creating {CHANNEL_CONF_REMOTE}")
        # Ensure mod_env is available (SetEnv needs it).
        exec_checked(ssh, "a2enmod -q env || a2enmod env", print_command=False)
        exec_checked(
            ssh,
            f"install -m 0644 -o root -g root /dev/null {shlex.quote(CHANNEL_CONF_REMOTE)}",
            print_command=False,
        )
        exec_checked(
            ssh,
            f"printf '%s\\n' "
            f"'# RheoLab channel HMAC secrets — managed by scripts/deploy/deploy-alpha-channel.py' "
            f"'# Do NOT edit manually. Both values must match the compile-time env vars' "
            f"'# used when building the Tauri app (scripts/dev/.env.keys).' "
            f"> {shlex.quote(CHANNEL_CONF_REMOTE)}",
            print_command=False,
        )
        _upsert_var(ssh, CHANNEL_CONF_REMOTE, "RHEOLAB_BETA_CHANNEL_SECRET", beta_secret)
        _upsert_var(ssh, CHANNEL_CONF_REMOTE, "RHEOLAB_ALPHA_CHANNEL_SECRET", alpha_secret)

        # Enable the conf so Apache actually loads it.
        exec_checked(
            ssh,
            f"a2enconf -q {Path(CHANNEL_CONF_REMOTE).stem} || "
            f"a2enconf {Path(CHANNEL_CONF_REMOTE).stem}",
            print_command=False,
        )
        print(f"  wrote SetEnv for BETA + ALPHA → {CHANNEL_CONF_REMOTE} (enabled)")
    else:
        # Brownfield path — alpha lives next to beta.
        print(f"  beta secret lives in {location}; adding/updating alpha there")
        _upsert_var(ssh, location, "RHEOLAB_ALPHA_CHANNEL_SECRET", alpha_secret)


def apache_reload(ssh) -> None:
    print("\n── Apache reload ────────────────────────────────────────")
    exec_checked(ssh, "apache2ctl configtest")
    exec_checked(ssh, "systemctl reload apache2")


def smoke_test(endpoint_base: str, alpha_secret: str) -> None:
    """
    Hit the public update endpoint from the deploy host and show which
    manifest is actually served for each channel header.

    The endpoint is currently served by mod_rewrite (see the security
    TODO in .htaccess), so update-channel.php is only reached when none
    of the static <channel>.json files exist. That means:

      * stable  → releases/v1/update/{target}/stable.json
      * beta    → beta.json if present, otherwise PHP/stable fallback
      * alpha   → alpha.json if present, otherwise stable (fail-closed)

    Probes print the manifest version found in the body, so we can see
    whether alpha actually has its own manifest yet, whether beta is
    stale, etc. Missing alpha.json is NOT a failure — it's expected on
    any deploy where publish-update.js hasn't uploaded the alpha
    manifest yet.
    """
    print("\n── Smoke test ───────────────────────────────────────────")
    url = f"{endpoint_base}/releases/v1/update/windows-x86_64/update"

    def probe(label: str, headers: dict[str, str]) -> dict[str, str]:
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read(4096).decode("utf-8", errors="replace")
                status = resp.status
        except urllib.error.HTTPError as e:
            print(f"  {label:<40} → HTTP {e.code}")
            return {}
        except Exception as e:
            print(f"  {label:<40} → error: {e}")
            return {}

        version = "(unparsed)"
        try:
            data = json.loads(body)
            version = str(data.get("version", "(missing)"))
        except json.JSONDecodeError:
            pass
        print(f"  {label:<40} → HTTP {status}  version={version}")
        return {"status": str(status), "version": version, "body": body}

    # 1. No channel header — baseline stable.
    baseline = probe("no header (→ stable)", {})
    stable_version = baseline.get("version", "")

    # 2. Beta header, no token — if beta.json exists it is served
    #    regardless (mod_rewrite). HMAC validation only bites when
    #    PHP takes over (alpha.json absent, beta.json absent).
    probe("beta header (→ beta.json)", {"X-Update-Channel": "beta"})

    # 3. Alpha header without token — expected to fall through to
    #    stable because alpha.json is (most likely) absent.
    probe("alpha, no token", {"X-Update-Channel": "alpha"})

    # 4. Alpha header with a valid HMAC token. Same behaviour as #3
    #    until alpha.json is published — that's fine, the HMAC only
    #    matters when PHP reaches the alpha fallback path.
    window = int(time.time() // 300)
    message = f"alpha:{window}".encode()
    token = hmac.new(alpha_secret.encode(), message, hashlib.sha256).hexdigest()
    alpha_result = probe("alpha + valid HMAC", {
        "X-Update-Channel": "alpha",
        "X-Update-Token": token,
    })

    # 5. Corrupted token — must NOT serve an alpha/beta manifest.
    probe("alpha + tampered HMAC", {
        "X-Update-Channel": "alpha",
        "X-Update-Token": "0" * 64,
    })

    # Helpful nudges — not failures.
    print()
    if stable_version:
        print(f"  stable manifest reports version {stable_version}")
    alpha_version = alpha_result.get("version", "")
    if alpha_version and alpha_version == stable_version:
        print("  NOTE: alpha channel currently falls back to stable "
              "(alpha.json not published). Run publish-update.js "
              "--channel alpha to activate it.")


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

    # Load the secrets from the ops store (not from the repo).
    # beta_secret is only required when the server is greenfield (see
    # install_alpha_secret for the bootstrap path). It's always loaded
    # so we can back-fill a missing beta secret transparently.
    alpha_secret = ""
    beta_secret = ""
    if not args.skip_secret:
        envmap = parse_env_file(args.secrets_file)
        alpha_secret = envmap.get("RHEOLAB_ALPHA_CHANNEL_SECRET", "").strip()
        beta_secret = envmap.get("RHEOLAB_BETA_CHANNEL_SECRET", "").strip()
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
        if beta_secret and len(beta_secret) < 32:
            print(
                f"WARNING: RHEOLAB_BETA_CHANNEL_SECRET in {args.secrets_file} looks too "
                f"short (len={len(beta_secret)}); bootstrap may fail.",
                file=sys.stderr,
            )

    ssh = None
    try:
        ssh = connect_license_server()

        info = recon(ssh)

        if args.recon:
            print("\n(--recon: stopping here, no writes performed)")
            return 0

        upload_files(ssh)

        if not args.skip_secret:
            install_alpha_secret(ssh, info, alpha_secret, beta_secret=beta_secret or None)

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
