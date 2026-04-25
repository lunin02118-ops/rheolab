"""Inspect the local SQLite db schema relevant to touch-point filter SQL."""
import os
import sqlite3
import sys

db = os.path.join(os.environ["APPDATA"], "com.rheolab.enterprise", "rheolab.db")
if not os.path.exists(db):
    print(f"DB not found: {db}", file=sys.stderr)
    sys.exit(1)

c = sqlite3.connect(db)

print("── Tables ──")
for (name,) in c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
):
    print(f"  {name}")

print("\n── Does ExperimentData exist? ──")
row = c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='ExperimentData'"
).fetchone()
print(f"  present: {row is not None}")

print("\n── Experiment column list ──")
for row in c.execute("PRAGMA table_info(Experiment)"):
    print(f"  {row[1]}  {row[2]}")

print("\n── Touch-point precompute coverage ──")
row = c.execute(
    "SELECT COUNT(*) total, "
    "SUM(CASE WHEN touchPrecomputeVersion IS NULL THEN 1 ELSE 0 END) pending, "
    "SUM(CASE WHEN touchHasCrossing = 1 THEN 1 ELSE 0 END) with_cross, "
    "SUM(CASE WHEN touchHasCrossing = 0 THEN 1 ELSE 0 END) without_cross "
    "FROM Experiment"
).fetchone()
print(f"  total={row[0]}  pending_precompute={row[1]}  "
      f"has_crossing=1: {row[2]}  has_crossing=0: {row[3]}")
