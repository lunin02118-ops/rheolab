"""Quick integrity smoke-test for the generated seed database.

Usage:
    python scripts/dev/verify-seed-db.py [path/to/rheolab-seed.db]

Checks that the DB matches the production schema at version 3:
 - schema_meta.schema_version == 3
 - PRAGMA user_version == 3
 - Experiment row count + touch-point crossing distribution
 - FTS5 shadow is populated (sanity for downstream search UI)
 - testCategory / testType coverage across the taxonomy
 - Presence of the V2 partial indexes that the fast-path filter relies on

Exit code is non-zero on any structural mismatch so the script can be
dropped into a CI lane later without further plumbing.
"""
import sys
import sqlite3
from pathlib import Path


EXPECTED_SCHEMA_VERSION = 3


def main() -> int:
    db = Path(sys.argv[1] if len(sys.argv) > 1 else "outputs/seed/rheolab-seed.db")
    if not db.exists():
        print(f"[FAIL] DB not found: {db}")
        return 1

    conn = sqlite3.connect(str(db))
    cur = conn.cursor()

    # Schema version checks: both the PRAGMA and the schema_meta row must
    # agree with the fixture generator's current production schema.
    cur.execute("PRAGMA user_version")
    pragma_version = cur.fetchone()[0]
    cur.execute("SELECT schema_version, app_version FROM schema_meta WHERE id = 1")
    meta_row = cur.fetchone()

    # Counts
    cur.execute("SELECT COUNT(*) FROM Experiment")
    experiments = cur.fetchone()[0]
    cur.execute("""
        SELECT
            SUM(CASE WHEN touchHasCrossing = 1 THEN 1 ELSE 0 END),
            SUM(CASE WHEN touchHasCrossing = 0 THEN 1 ELSE 0 END),
            SUM(CASE WHEN touchHasCrossing IS NULL THEN 1 ELSE 0 END)
        FROM Experiment
    """)
    crossing_yes, crossing_no, crossing_null = cur.fetchone()

    cur.execute("SELECT MIN(testDate), MAX(testDate) FROM Experiment")
    min_date, max_date = cur.fetchone()
    cur.execute("SELECT COUNT(DISTINCT instrumentType) FROM Experiment")
    distinct_instruments = cur.fetchone()[0]
    cur.execute("SELECT COUNT(DISTINCT testCategory) FROM Experiment WHERE testCategory IS NOT NULL")
    distinct_categories = cur.fetchone()[0]
    cur.execute("SELECT COUNT(DISTINCT testType) FROM Experiment WHERE testType IS NOT NULL")
    distinct_types = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM fts_experiment")
    fts_rows = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM ExperimentData")
    data_blobs = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM ExperimentReagent")
    reagent_links = cur.fetchone()[0]

    cur.execute("""
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_experiment_touch_%'
        ORDER BY name
    """)
    touch_indexes = [r[0] for r in cur.fetchall()]

    # Report
    print(f"DB path: {db}")
    print(f"  size: {db.stat().st_size / 1_048_576:.1f} MB")
    print(f"  PRAGMA user_version: {pragma_version}")
    print(f"  schema_meta: {meta_row}")
    print()
    print(f"Experiments: {experiments}")
    print(f"  crossing=1: {crossing_yes}")
    print(f"  crossing=0: {crossing_no}")
    print(f"  crossing=NULL: {crossing_null}")
    print(f"  date range: {min_date} -> {max_date}")
    print(f"  distinct instrument types: {distinct_instruments}")
    print(f"  distinct testCategory: {distinct_categories}")
    print(f"  distinct testType: {distinct_types}")
    print(f"  FTS5 rows: {fts_rows}")
    print(f"  ExperimentData blobs: {data_blobs}")
    print(f"  ExperimentReagent links: {reagent_links}")
    print()
    print("Touch-point partial indexes:")
    for name in touch_indexes:
        print(f"  - {name}")

    # Hard assertions
    ok = True
    if pragma_version != EXPECTED_SCHEMA_VERSION:
        print(
            f"[FAIL] PRAGMA user_version = {pragma_version}, "
            f"expected {EXPECTED_SCHEMA_VERSION}"
        )
        ok = False
    if meta_row is None or meta_row[0] != EXPECTED_SCHEMA_VERSION:
        print(
            f"[FAIL] schema_meta row wrong: {meta_row}, "
            f"expected version {EXPECTED_SCHEMA_VERSION}"
        )
        ok = False
    if experiments == 0:
        print("[FAIL] No experiments generated")
        ok = False
    if crossing_null != 0:
        print(f"[FAIL] {crossing_null} experiments have NULL touchHasCrossing")
        ok = False
    if fts_rows != experiments:
        print(f"[FAIL] FTS5 row count {fts_rows} != Experiment {experiments}")
        ok = False
    if data_blobs != experiments:
        print(f"[FAIL] ExperimentData blobs {data_blobs} != Experiment {experiments}")
        ok = False
    expected_touch_indexes = {
        "idx_experiment_touch_crossing_time",
        "idx_experiment_touch_crossing_viscosity",
        "idx_experiment_touch_has_crossing",
        "idx_experiment_touch_precompute_pending",
        "idx_experiment_touch_viscosity_at_target",
    }
    missing = expected_touch_indexes - set(touch_indexes)
    if missing:
        print(f"[FAIL] missing touch-point indexes: {sorted(missing)}")
        ok = False

    print()
    print("[PASS]" if ok else "[FAIL]", "schema + data look", "consistent" if ok else "broken")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
