"""One-shot dev helper: inspect SystemState rows in the RheoLab app DB.

Usage (from repo root, any shell):
    python scripts/dev/inspect-license-db.py

Prints rows for `license_data_v1`, `demo_state_v4`, and `was_licensed_v1`
so we can see whether the license record is still there (just HMAC-broken)
vs. missing entirely.

Safe — read-only. No mutation, no network.
"""
from __future__ import annotations

import os
import sqlite3
import sys

DB_PATH = os.path.join(os.environ["APPDATA"], "com.rheolab.enterprise", "rheolab.db")
KEYS = ("license_data_v1", "demo_state_v4", "was_licensed_v1")


def main() -> int:
    if not os.path.isfile(DB_PATH):
        print(f"[inspect] DB not found: {DB_PATH}", file=sys.stderr)
        return 1

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    print(f"[inspect] DB: {DB_PATH}\n")

    for k in KEYS:
        cur.execute(
            "SELECT value, signature, updatedAt FROM SystemState WHERE key = ?",
            (k,),
        )
        row = cur.fetchone()
        if row is None:
            print(f"[{k}] MISSING")
            continue
        value, signature, updated_at = row
        print(f"[{k}]")
        print(f"  value (len={len(value)}): {value[:140]}{'...' if len(value) > 140 else ''}")
        print(f"  signature (len={len(signature)}): {signature[:40]}...")
        print(f"  updatedAt: {updated_at}")
        print()

    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
