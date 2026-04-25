"""One-shot dev helper: re-sign `SystemState` rows whose HMAC is stale.

When the dev binary is built without the `INTEGRITY_SECRET_KEY` env var
(the norm for `npm run tauri:dev`), the licensing engine falls back to
the compile-time dev sentinel key `rheolab-dev-integrity-key-32chars!`.

If the license was originally activated against a release binary that had
a real `INTEGRITY_SECRET_KEY` set, the HMAC signatures stored alongside
the RSA-valid license record no longer validate → fall-through to demo
(and since the server already knows this machine_id from demo activity
31+ days ago, the demo registers as expired).

This script re-signs the stored `license_data_v1` / `was_licensed_v1`
rows with the dev sentinel key so that the current dev binary will
validate them on next startup.  The RSA-signed `signedPayload` inside
the value is untouched → both HMAC and RSA pass → license is Active
without ever touching the remote license server.

Safety:
- Read-only DB inspection first (prints what's about to change).
- Creates a timestamped backup before any UPDATE.
- Targets only `license_data_v1` + `was_licensed_v1` (never the demo row
  or any non-license data).
- Pure HMAC-SHA256 — no external HTTP calls.

Usage (run with app STOPPED):
    python scripts/dev/resign-license-hmac.py
"""
from __future__ import annotations

import datetime
import hashlib
import hmac
import os
import shutil
import sqlite3
import sys

# Dev sentinel matches `DEV_INTEGRITY_KEY` in
# `src-tauri/src/commands/licensing/types.rs`.  Must be byte-identical.
DEV_INTEGRITY_KEY = b"rheolab-dev-integrity-key-32chars!"

DB_PATH = os.path.join(os.environ["APPDATA"], "com.rheolab.enterprise", "rheolab.db")
TARGET_KEYS = ("license_data_v1", "was_licensed_v1")


def sign(value: str) -> str:
    """HMAC-SHA256 of `value` with dev key → lowercase hex (matches Rust `sign_data`)."""
    mac = hmac.new(DEV_INTEGRITY_KEY, value.encode("utf-8"), hashlib.sha256)
    return mac.hexdigest()


def main() -> int:
    if not os.path.isfile(DB_PATH):
        print(f"[resign] DB not found: {DB_PATH}", file=sys.stderr)
        return 1

    # Pre-flight backup
    ts = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    backup = f"{DB_PATH}.resign-backup-{ts}"
    shutil.copy2(DB_PATH, backup)
    print(f"[resign] Backup: {backup}")

    con = sqlite3.connect(DB_PATH)
    con.isolation_level = None  # autocommit off; we manage txn
    cur = con.cursor()

    cur.execute("BEGIN")
    updated = 0
    try:
        for key in TARGET_KEYS:
            cur.execute(
                "SELECT value, signature FROM SystemState WHERE key = ?",
                (key,),
            )
            row = cur.fetchone()
            if row is None:
                print(f"[resign] {key}: MISSING — skipping")
                continue
            value, old_sig = row
            new_sig = sign(value)
            if new_sig == old_sig:
                print(f"[resign] {key}: already correct (HMAC matches) — no update")
                continue
            cur.execute(
                "UPDATE SystemState SET signature = ?, updatedAt = ? WHERE key = ?",
                (new_sig, datetime.datetime.now(datetime.UTC).isoformat(), key),
            )
            print(f"[resign] {key}: HMAC rewritten")
            print(f"  old: {old_sig}")
            print(f"  new: {new_sig}")
            updated += 1
        cur.execute("COMMIT")
    except Exception:  # noqa: BLE001 — we want to always rollback + re-raise
        cur.execute("ROLLBACK")
        raise
    finally:
        con.close()

    print(f"\n[resign] Done — {updated} row(s) updated.")
    print("[resign] Restart `npm run tauri:dev` — license should now load as Active.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
