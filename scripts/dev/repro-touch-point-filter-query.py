"""
Reproduce the exact SQL the Rust dynamic touch-point path runs when the
library filter sets `viscosityThreshold = 50`, and print which step (if
any) fails.  Isolates whether:
    (a) the DB schema is still missing something,
    (b) the JOIN shape is broken (e.g. ExperimentData.experimentId
        column name drift), or
    (c) the query succeeds server-side and the failure is elsewhere.
"""
import os
import sqlite3
import sys
import time

DB = os.path.join(os.environ["APPDATA"], "com.rheolab.enterprise", "rheolab.db")
if not os.path.exists(DB):
    print(f"DB not found: {DB}", file=sys.stderr)
    sys.exit(1)

c = sqlite3.connect(DB)
c.row_factory = sqlite3.Row

print(f"── DB: {DB}")

# ── Step 1: ExperimentData schema ──
print("\n── Step 1: ExperimentData columns ──")
cols = [r[1] for r in c.execute("PRAGMA table_info(ExperimentData)")]
print(f"  {cols}")

# ── Step 2: ExperimentData row count + blob length distribution ──
print("\n── Step 2: ExperimentData row count + blob length ──")
row = c.execute(
    "SELECT COUNT(*) total, "
    "SUM(CASE WHEN dataBlob IS NULL OR length(dataBlob)=0 THEN 1 ELSE 0 END) blob_empty, "
    "MIN(length(dataBlob)) blob_min, MAX(length(dataBlob)) blob_max, "
    "AVG(length(dataBlob)) blob_avg "
    "FROM ExperimentData"
).fetchone()
print(f"  total_rows={row['total']}  "
      f"empty={row['blob_empty']}  "
      f"blob length min/avg/max = "
      f"{row['blob_min']}/{int(row['blob_avg'] or 0)}/{row['blob_max']}")

# ── Step 3: replay the exact dynamic-threshold SQL ──
print("\n── Step 3: dynamic-threshold query (threshold=50 cP) ──")
threshold = 50.0
sql_count = """
    SELECT COUNT(*)
    FROM Experiment e
    LEFT JOIN User u ON e.userId = u.id
    LEFT JOIN Laboratory l ON e.laboratoryId = l.id
    WHERE (e.maxViscosity IS NULL OR e.maxViscosity >= ?)
"""
start = time.perf_counter()
try:
    total = c.execute(sql_count, (threshold,)).fetchone()[0]
    elapsed = (time.perf_counter() - start) * 1000
    print(f"  COUNT(*) after maxViscosity prune = {total}  ({elapsed:.1f} ms)")
except sqlite3.Error as e:
    print(f"  [!!] COUNT FAILED: {e}")
    sys.exit(1)

# ── Step 4: the actual SELECT with LEFT JOIN ExperimentData ──
sql_full = """
    SELECT e.id, e.name, length(ed.dataBlob) as blob_len
    FROM Experiment e
    LEFT JOIN User u ON e.userId = u.id
    LEFT JOIN Laboratory l ON e.laboratoryId = l.id
    LEFT JOIN ExperimentData ed ON ed.experimentId = e.id
    WHERE (e.maxViscosity IS NULL OR e.maxViscosity >= ?)
"""
print(
    "\n── Step 4: LEFT JOIN ExperimentData (this is what dynamic path does) ──"
)
start = time.perf_counter()
try:
    rows = c.execute(sql_full, (threshold,)).fetchall()
    elapsed = (time.perf_counter() - start) * 1000
    print(f"  rows={len(rows)}  ({elapsed:.1f} ms)")

    null_count = sum(1 for r in rows if r["blob_len"] is None)
    zero_count = sum(1 for r in rows if r["blob_len"] == 0)
    with_blob = sum(1 for r in rows if r["blob_len"] and r["blob_len"] > 0)
    print(
        f"  blob NULL (no ExperimentData row) = {null_count}\n"
        f"  blob empty (0 bytes)              = {zero_count}\n"
        f"  blob present (> 0 bytes)          = {with_blob}"
    )

    # Show the first 5 experiments that WOULD go through decode_typed()
    sample = [r for r in rows if r["blob_len"] and r["blob_len"] > 0][:5]
    if sample:
        print("\n  sample experiments with blob (first 5):")
        for r in sample:
            print(f"    {r['id']}  {r['blob_len']} bytes  name={r['name']!r}")
    else:
        print("\n  [!!] ZERO experiments have a populated ExperimentData.dataBlob")
        print("       Dynamic path would produce empty-touch-point results for ALL 11k rows.")
        print("       That alone SHOULDN'T error, though — it just produces empty output.")
except sqlite3.Error as e:
    print(f"  [!!] SELECT FAILED: {e}")
    sys.exit(1)

# ── Step 5: does ExperimentData have an `experimentId` column? ──
print("\n── Step 5: sanity-check ExperimentData.experimentId column ──")
if "experimentId" not in cols:
    print(
        "  [!!] ExperimentData has NO `experimentId` column — this is the FK the "
        "dynamic path uses to JOIN blobs.  The LEFT JOIN would return NULL for "
        "every row, which is benign, but check if a rename happened."
    )
else:
    print("  OK — experimentId present")
