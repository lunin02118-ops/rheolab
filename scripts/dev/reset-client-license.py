"""
Reset the RheoLab Enterprise client licence cache.

Use when:
  * a licence was revoked server-side, but the client still shows it as
    active (because the server-confirmed cache is valid for 7 days and
    the offline grace period is 30 days);
  * you want to switch between licences without going through the app's
    own deactivate flow;
  * the app has a UI bug that prevents showing the activation dialog.

What it does:
  1. Refuses to run if RheoLab Enterprise is currently launched (holds
     a write lock on the SQLite file).
  2. Makes a timestamped copy of rheolab.db next to the original so you
     can always roll back.
  3. Deletes the row keyed by `license_data_v1` from the `system_state`
     table — that is the single source of truth for the signed licence
     payload (see src-tauri/src/commands/licensing/types.rs::DB_KEY_LICENSE).
  4. Also deletes `was_licensed_v1` so the client doesn't prompt with
     "your licence expired" at next startup — the app will fall back to
     the demo/trial flow instead.
  5. Prints the rows that were removed so the action is fully auditable.

After running:
  * Launch RheoLab Enterprise — you should see the activation dialog.
  * Enter the new Superuser key printed by issue-superuser-license.py.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

DB_KEYS_TO_CLEAR = [
    # Signed licence payload — removing this forces a fresh activation.
    "license_data_v1",
    # "was ever licensed" marker — removing makes the app treat this
    # installation as pristine again.
    "was_licensed_v1",
]

DEFAULT_DB = Path(os.path.expandvars(
    r"%APPDATA%\com.rheolab.enterprise\rheolab.db"
))


def is_app_running() -> list[str]:
    """
    Return a list of RheoLab-looking process names if any are currently
    running. Using `tasklist` keeps the script dependency-free (no psutil).
    """
    import subprocess
    try:
        proc = subprocess.run(
            ["tasklist", "/FO", "CSV", "/NH"],
            capture_output=True,
            # tasklist prints in the system ANSI codepage (cp866/cp1251 on
            # Russian Windows). We only match against the ASCII substring
            # "rheolab" so replacing unmappable bytes is safe.
            text=True,
            encoding="mbcs",
            errors="replace",
            timeout=10,
            check=False,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []
    if proc.stdout is None:
        return []
    hits: list[str] = []
    for line in proc.stdout.splitlines():
        # CSV: "Image Name","PID","Session Name","Session#","Mem Usage"
        first = line.split(",", 1)[0].strip('"').lower()
        if "rheolab" in first:
            hits.append(first)
    return hits


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB,
        help=f"path to rheolab.db (default: {DEFAULT_DB})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show what would be removed without touching the DB",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="skip the timestamped .bak copy (not recommended)",
    )
    args = parser.parse_args()

    if not args.db.exists():
        print(f"ERROR: DB not found: {args.db}")
        print("  Is RheoLab Enterprise installed? Check the APPDATA path.")
        return 2

    running = is_app_running()
    if running:
        print("ERROR: RheoLab appears to be running:")
        for name in running:
            print(f"  * {name}")
        print("Close the app first — SQLite will reject writes while it has a lock.")
        return 3

    # Snapshot first — before any mutation.
    if not args.no_backup and not args.dry_run:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = args.db.with_name(f"{args.db.name}.bak-{stamp}")
        shutil.copy2(args.db, backup)
        print(f"Backup: {backup}")

    conn = sqlite3.connect(args.db)
    try:
        # Show what we're about to remove so the user sees the mask of
        # the licence key and the activation timestamp before deletion.
        for key in DB_KEYS_TO_CLEAR:
            row = conn.execute(
                "SELECT value FROM SystemState WHERE key = ?",
                (key,),
            ).fetchone()
            if row is None:
                print(f"  [skip] {key}: not present")
                continue
            value = row[0] or ""
            preview = value[:120].replace("\n", " ")
            if len(value) > 120:
                preview += "…"
            print(f"  [{'DRY' if args.dry_run else 'del'}] {key}: {preview}")

        if args.dry_run:
            print("\n--dry-run: no changes made.")
            return 0

        # Delete in a single transaction so a partial failure leaves the
        # DB in a consistent state (all keys present or all removed).
        with conn:
            placeholders = ",".join("?" * len(DB_KEYS_TO_CLEAR))
            conn.execute(
                f"DELETE FROM SystemState WHERE key IN ({placeholders})",
                DB_KEYS_TO_CLEAR,
            )
        print("\n✓ Licence cache cleared. Launch RheoLab Enterprise — the")
        print("  activation dialog should appear at startup.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
