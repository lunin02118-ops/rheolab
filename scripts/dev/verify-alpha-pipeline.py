"""
Pre-flight check for the Superuser / alpha update channel pipeline.

Simulates what a beta.8+ client does:
  1. Read ALPHA_CHANNEL_SECRET from scripts/dev/.env.keys (the same env
     file that the Rust build embeds at compile time — so the client
     and this script compute *identical* tokens).
  2. Compute HMAC-SHA256 over "alpha:<window>" where
     window = floor(unix_seconds/300) (5-minute rolling bucket — the
     server accepts current + previous window, i.e. a 5-10 min skew).
  3. Issue three requests against the updater endpoint:
        a) X-Update-Channel: alpha  + valid X-Update-Token  → expect alpha.json
        b) X-Update-Channel: alpha  + NO token              → expect stable.json (downgrade)
        c) no X-Update-Channel header                       → expect stable.json
  4. Print each response's version and diagnostic `X-Channel-Served`
     header so we can tell at a glance whether Apache routing, PHP
     validation, and the alpha manifest are all wired up.

Exit codes:
  0  alpha manifest reachable and returns the expected version
  1  network / config problem (couldn't read secret, HTTP error, …)
  2  pipeline misconfigured (alpha request landed on stable manifest,
     or returned version is older than the baseline client)

Usage:
  python scripts/dev/verify-alpha-pipeline.py
  python scripts/dev/verify-alpha-pipeline.py --expect-version 0.2.0-beta.8
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import sys
import time
import urllib.request
from pathlib import Path

ENV_KEYS = Path(__file__).resolve().parent / ".env.keys"
UPDATER_URL = (
    "https://license.vizbuka.ru/releases/v1/update/windows-x86_64/update"
)
USER_AGENT = "rheolab-alpha-pipeline-verifier/1"


def load_alpha_secret() -> str:
    """
    Minimal .env parser — avoids pulling python-dotenv as a dep for a
    single-file diagnostic script. Strips surrounding quotes because the
    secret can contain `=` / `+` / `/` (it's a base64 string).
    """
    if not ENV_KEYS.exists():
        print(f"ERROR: {ENV_KEYS} not found.")
        print("  Run prepare-production.js once or create the file manually.")
        sys.exit(1)
    for raw in ENV_KEYS.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() != "ALPHA_CHANNEL_SECRET":
            continue
        value = value.strip().strip('"').strip("'")
        if not value:
            continue
        return value
    print(f"ERROR: ALPHA_CHANNEL_SECRET not set in {ENV_KEYS}")
    sys.exit(1)


def make_alpha_token(secret: str) -> str:
    """
    Mirrors `make_channel_token("alpha", ALPHA_CHANNEL_KEY)` from
    src-tauri/src/commands/licensing/mod.rs. If this function ever
    drifts from the Rust implementation the server will silently
    downgrade alpha clients to stable (i.e. *this script's purpose*).
    """
    window = int(time.time()) // 300
    message = f"alpha:{window}".encode("ascii")
    mac = hmac.new(secret.encode("utf-8"), message, hashlib.sha256)
    return mac.hexdigest()


def fetch(headers: dict[str, str]) -> tuple[int, str, dict[str, str]]:
    """
    Always reads status, body, and the `X-Channel-Served` diagnostic
    header that update-channel.php emits for visibility. Swallows the
    404/204 body distinction by treating 204 as empty-but-ok.
    """
    req = urllib.request.Request(UPDATER_URL, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode("utf-8"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace"), dict(e.headers or {})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--expect-version",
        default="0.2.0-beta.8",
        help="version string that alpha.json must advertise (default: %(default)s)",
    )
    args = parser.parse_args()

    secret = load_alpha_secret()
    token = make_alpha_token(secret)
    print(f"Alpha secret: {secret[:4]}…{secret[-4:]} (len={len(secret)})")
    print(f"Alpha token : {token[:8]}…{token[-8:]}")
    print(f"Endpoint    : {UPDATER_URL}\n")

    # ── (a) Alpha + valid token — the happy path a Superuser client hits.
    print("─── [A] X-Update-Channel: alpha  +  valid X-Update-Token")
    status_a, body_a, hdrs_a = fetch({
        "User-Agent": USER_AGENT,
        "X-Update-Channel": "alpha",
        "X-Update-Token": token,
    })
    served_a = hdrs_a.get("X-Channel-Served", "?")
    print(f"  HTTP {status_a}   X-Channel-Served: {served_a}")
    version_a = "<no body>"
    if status_a == 200 and body_a:
        try:
            manifest_a = json.loads(body_a)
            version_a = manifest_a.get("version", "<missing>")
            print(f"  manifest.version = {version_a}")
            print(f"  pub_date         = {manifest_a.get('pub_date', '-')}")
            print(f"  platforms        = {sorted((manifest_a.get('platforms') or {}).keys())}")
        except json.JSONDecodeError as e:
            print(f"  ERROR: alpha response is not JSON: {e}")
            print(f"  body (first 200): {body_a[:200]!r}")
            return 1

    # ── (b) Alpha header but no token — server must refuse (downgrade).
    print("\n─── [B] X-Update-Channel: alpha  +  NO token (expect downgrade)")
    status_b, body_b, hdrs_b = fetch({
        "User-Agent": USER_AGENT,
        "X-Update-Channel": "alpha",
    })
    served_b = hdrs_b.get("X-Channel-Served", "?")
    print(f"  HTTP {status_b}   X-Channel-Served: {served_b}")

    # ── (c) No channel header — plain stable path (what beta.5 sends today).
    print("\n─── [C] no X-Update-Channel header (stable path)")
    status_c, body_c, hdrs_c = fetch({"User-Agent": USER_AGENT})
    served_c = hdrs_c.get("X-Channel-Served", "?")
    print(f"  HTTP {status_c}   X-Channel-Served: {served_c}")
    version_c = "<no body>"
    if status_c == 200 and body_c:
        try:
            version_c = json.loads(body_c).get("version", "<missing>")
            print(f"  manifest.version = {version_c}")
        except json.JSONDecodeError:
            pass

    # Parse [B] body so we can compare channels by version, not by a
    # header that the frontend HTTP stack (mod_php / FPM / CDN) may drop.
    version_b = "<no body>"
    if status_b == 200 and body_b:
        try:
            version_b = json.loads(body_b).get("version", "<missing>")
            print(f"  manifest.version = {version_b}  (expected: same as stable)")
        except json.JSONDecodeError:
            pass

    # ── Verdict
    print("\n" + "=" * 60)
    problems: list[str] = []

    # The ONLY authoritative signal: what version did the server hand out.
    # X-Channel-Served is a debug-only header and is treated as a hint.
    if version_a != args.expect_version:
        problems.append(
            f"[A] alpha manifest version is '{version_a}', "
            f"expected '{args.expect_version}'. Re-run publish-update.js."
        )
    if served_a not in ("alpha", "?", ""):
        # Only flag if header was set *and* wrong — missing is normal.
        problems.append(
            f"[A] X-Channel-Served='{served_a}' but we requested alpha."
        )
    # [B] must NOT hand out the privileged manifest. If the versions match,
    # the attacker successfully bypassed auth.
    if version_b == version_a and version_a != version_c:
        problems.append(
            "[B] SECURITY: alpha manifest served without a token — "
            "update-channel.php is missing the HMAC guard."
        )
    if served_b == "alpha":
        problems.append(
            "[B] SECURITY: alpha served without a token — PHP must downgrade."
        )
    if served_c == "alpha":
        problems.append(
            "[C] SECURITY: alpha served without any channel header — "
            "default-fallthrough is broken."
        )

    if problems:
        print("FAIL — pipeline issues:")
        for p in problems:
            print(f"  ✗ {p}")
        return 2

    print(f"OK — alpha pipeline works end-to-end.")
    print(f"     alpha  → {version_a}")
    print(f"     stable → {version_c}")
    print(f"     Superuser clients on beta.8+ will get alpha updates on next poll.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
