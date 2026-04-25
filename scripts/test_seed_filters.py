"""Exhaustive filter test against the seed DB in the app data directory.

Simulates the SQL queries the Rust backend builds for every filter
combination the frontend can produce.  Each test mirrors a real user
action: selecting a threshold pill, toggling hasCrossing, typing a
crossing-time range, etc.
"""
import sqlite3
import os
import sys

db = os.path.join(os.environ["APPDATA"], "com.rheolab.enterprise", "rheolab.db")
c = sqlite3.connect(db)

total = c.execute("SELECT COUNT(*) FROM Experiment").fetchone()[0]
print(f"=== SEED DB FILTER TESTS ({total} experiments) ===\n")

passed = 0
failed = 0


def test(name, query, check, params=None):
    global passed, failed
    try:
        result = c.execute(query, params or []).fetchone()[0]
        ok = check(result)
        tag = "PASS" if ok else "FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
        print(f"  [{tag}] {name}: {result}")
    except Exception as e:
        failed += 1
        print(f"  [ERROR] {name}: {e}")


# ── 1. Base data ──────────────────────────────────────────────
print("--- 1. Base Data ---")
test("Total experiments", "SELECT COUNT(*) FROM Experiment", lambda x: x == 11172)
test("Total TPP rows", "SELECT COUNT(*) FROM TouchPointPrecompute", lambda x: x == 89376)
test("Total ExperimentData", "SELECT COUNT(*) FROM ExperimentData", lambda x: x == 11172)

# ── 2. Per-threshold crossings ────────────────────────────────
print("\n--- 2. Per-Threshold Crossings ---")
THRESHOLDS = [5, 10, 50, 100, 200, 300, 500, 700]
for t in THRESHOLDS:
    test(
        f"Threshold {t} cP crossings",
        f"SELECT COUNT(*) FROM TouchPointPrecompute WHERE thresholdCp={t} AND hasCrossing=1",
        lambda x, t=t: x > 0 if t > 5 else x >= 0,
    )

# ── 3. hasCrossing=yes (fast path) ───────────────────────────
print("\n--- 3. Fast-Path: hasCrossing=yes ---")
for t in THRESHOLDS:
    test(
        f"hasCrossing=yes @ {t}cP",
        f"""SELECT COUNT(DISTINCT e.id) FROM Experiment e
            LEFT JOIN TouchPointPrecompute tpp
              ON tpp.experimentId=e.id AND tpp.thresholdCp={t}
            WHERE tpp.hasCrossing=1""",
        lambda x, t=t: x > 0 if t > 5 else x >= 0,
    )

# ── 4. hasCrossing=no ────────────────────────────────────────
print("\n--- 4. Fast-Path: hasCrossing=no ---")
for t in [50, 500]:
    test(
        f"hasCrossing=no @ {t}cP",
        f"""SELECT COUNT(DISTINCT e.id) FROM Experiment e
            LEFT JOIN TouchPointPrecompute tpp
              ON tpp.experimentId=e.id AND tpp.thresholdCp={t}
            WHERE tpp.hasCrossing=0 AND tpp.hasCrossing IS NOT NULL""",
        lambda x: x > 0,
    )

# ── 5. crossingTimeMin range ─────────────────────────────────
print("\n--- 5. Crossing Time Range ---")
test(
    "crossingTimeMin 0-5 @ 50cP",
    """SELECT COUNT(*) FROM TouchPointPrecompute
       WHERE thresholdCp=50 AND hasCrossing=1
         AND crossingTimeMin >= 0.0 AND crossingTimeMin <= 5.0""",
    lambda x: x > 0,
)
test(
    "crossingTimeMin 3-5 @ 50cP",
    """SELECT COUNT(*) FROM TouchPointPrecompute
       WHERE thresholdCp=50 AND hasCrossing=1
         AND crossingTimeMin >= 3.0 AND crossingTimeMin <= 5.0""",
    lambda x: x > 0,
)
test(
    "crossingTimeMin > 100 @ 50cP",
    """SELECT COUNT(*) FROM TouchPointPrecompute
       WHERE thresholdCp=50 AND hasCrossing=1
         AND crossingTimeMin >= 100.0""",
    lambda x: x > 0,
)

# ── 6. crossingViscosity range ───────────────────────────────
print("\n--- 6. Crossing Viscosity Range ---")
test(
    "crossingViscosity 30-60 @ 50cP",
    """SELECT COUNT(*) FROM TouchPointPrecompute
       WHERE thresholdCp=50 AND hasCrossing=1
         AND crossingViscosityCp >= 30 AND crossingViscosityCp <= 60""",
    lambda x: x > 0,
)

# ── 7. viscosityAtTarget range ───────────────────────────────
print("\n--- 7. Viscosity At Target ---")
test(
    "viscosityAtTarget 10-200 @ 50cP",
    """SELECT COUNT(*) FROM TouchPointPrecompute
       WHERE thresholdCp=50
         AND viscosityAtTargetCp >= 10 AND viscosityAtTargetCp <= 200""",
    lambda x: x > 0,
)

# ── 8. Composite filters ─────────────────────────────────────
print("\n--- 8. Composite Filters ---")
test(
    "crossing + time 0-5 + visc 30-60 @ 50cP",
    """SELECT COUNT(*) FROM Experiment e
       LEFT JOIN TouchPointPrecompute tpp
         ON tpp.experimentId=e.id AND tpp.thresholdCp=50
       WHERE tpp.hasCrossing=1
         AND tpp.crossingTimeMin >= 0.0 AND tpp.crossingTimeMin <= 5.0
         AND tpp.crossingViscosityCp >= 30 AND tpp.crossingViscosityCp <= 60""",
    lambda x: x > 0,
)
for t in [100, 300, 500, 700]:
    test(
        f"hasCrossing + time present @ {t}cP",
        f"""SELECT COUNT(*) FROM TouchPointPrecompute
            WHERE thresholdCp={t} AND hasCrossing=1
              AND crossingTimeMin IS NOT NULL""",
        lambda x: x > 0,
    )

# ── 9. Version integrity ─────────────────────────────────────
print("\n--- 9. Version Integrity ---")
test(
    "All TPP rows version=4",
    "SELECT COUNT(*) FROM TouchPointPrecompute WHERE precomputeVersion != 4",
    lambda x: x == 0,
)
test(
    "All legacy version=4",
    "SELECT COUNT(*) FROM Experiment WHERE touchPrecomputeVersion != 4",
    lambda x: x == 0,
)

# ── 10. Metadata filters ─────────────────────────────────────
print("\n--- 10. Metadata Filters ---")
test("Distinct instruments", "SELECT COUNT(DISTINCT instrumentType) FROM Experiment", lambda x: x > 3)
test("Distinct fluid types", "SELECT COUNT(DISTINCT fluidType) FROM Experiment", lambda x: x >= 1)
test(
    "Distinct operators",
    "SELECT COUNT(DISTINCT operatorName) FROM Experiment WHERE operatorName IS NOT NULL",
    lambda x: x >= 1,
)

# ── 11. Threshold switching ──────────────────────────────────
print("\n--- 11. Threshold Switching (every preset) ---")
for t in THRESHOLDS:
    yes = c.execute(
        f"SELECT COUNT(*) FROM TouchPointPrecompute WHERE thresholdCp={t} AND hasCrossing=1"
    ).fetchone()[0]
    no = c.execute(
        f"SELECT COUNT(*) FROM TouchPointPrecompute WHERE thresholdCp={t} AND hasCrossing=0"
    ).fetchone()[0]
    total_t = yes + no
    ok = total_t == 11172
    tag = "PASS" if ok else "FAIL"
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"  [{tag}] {t:>3} cP: yes={yes:>5}  no={no:>5}  total={total_t}")

# ── 12. TIME RANGE: exact backend query simulation ────────────
#
# The Rust backend builds:
#   SELECT … FROM Experiment e
#   LEFT JOIN TouchPointPrecompute tpp
#     ON tpp.experimentId = e.id AND tpp.thresholdCp = ?
#   WHERE tpp.hasCrossing = 1
#     AND tpp.crossingTimeMin >= ?   -- crossingTimeMin
#     AND tpp.crossingTimeMin <= ?   -- crossingTimeMax
#   ORDER BY e.createdAt DESC LIMIT ? OFFSET ?
#
# We replicate exactly this query for every real user scenario.

print("\n--- 12. TIME RANGE Filters (per threshold) ---")

FAST_QUERY = """
    SELECT COUNT(DISTINCT e.id) FROM Experiment e
    LEFT JOIN TouchPointPrecompute tpp
      ON tpp.experimentId = e.id AND tpp.thresholdCp = ?
    WHERE tpp.hasCrossing = 1
      {time_clause}
"""

# First, discover the actual time ranges per threshold
print("\n  Time distribution per threshold:")
for t in THRESHOLDS:
    row = c.execute(
        """SELECT MIN(crossingTimeMin), MAX(crossingTimeMin), COUNT(*)
           FROM TouchPointPrecompute
           WHERE thresholdCp=? AND hasCrossing=1 AND crossingTimeMin IS NOT NULL""",
        [t],
    ).fetchone()
    if row[2] > 0:
        print(f"    {t:>3} cP: min={row[0]:.4f} max={row[1]:.4f} count={row[2]}")
    else:
        print(f"    {t:>3} cP: no crossings")

# 12a. Only crossingTimeMin (lower bound)
print()
for t in [50, 100, 300, 500]:
    # "Show experiments that crossed AFTER 1 minute"
    cnt_all = c.execute(
        "SELECT COUNT(*) FROM TouchPointPrecompute WHERE thresholdCp=? AND hasCrossing=1", [t]
    ).fetchone()[0]
    cnt_after1 = c.execute(
        FAST_QUERY.format(time_clause="AND tpp.crossingTimeMin >= 1.0"), [t]
    ).fetchone()[0]
    test(
        f"crossingTimeMin>=1 @ {t}cP (subset of {cnt_all})",
        FAST_QUERY.format(time_clause="AND tpp.crossingTimeMin >= 1.0"),
        lambda x, ca=cnt_all: 0 <= x <= ca,
        [t],
    )

# 12b. Only crossingTimeMax (upper bound)
print()
for t in [50, 100, 300, 500]:
    # "Show experiments that crossed WITHIN the first 5 minutes"
    cnt_all = c.execute(
        "SELECT COUNT(*) FROM TouchPointPrecompute WHERE thresholdCp=? AND hasCrossing=1", [t]
    ).fetchone()[0]
    test(
        f"crossingTimeMax<=5 @ {t}cP (subset of {cnt_all})",
        FAST_QUERY.format(time_clause="AND tpp.crossingTimeMin <= 5.0"),
        lambda x, ca=cnt_all: 0 <= x <= ca,
        [t],
    )

# 12c. Both min AND max (time window)
print()
for t in [50, 100, 300, 500, 700]:
    cnt_all = c.execute(
        "SELECT COUNT(*) FROM TouchPointPrecompute WHERE thresholdCp=? AND hasCrossing=1", [t]
    ).fetchone()[0]
    if cnt_all == 0:
        continue
    # Get actual min/max to build a meaningful window
    lo, hi = c.execute(
        """SELECT MIN(crossingTimeMin), MAX(crossingTimeMin)
           FROM TouchPointPrecompute
           WHERE thresholdCp=? AND hasCrossing=1""",
        [t],
    ).fetchone()
    # Window covering the first half of time range
    mid = (lo + hi) / 2.0
    test(
        f"time window [{lo:.2f}, {mid:.2f}] @ {t}cP",
        FAST_QUERY.format(time_clause="AND tpp.crossingTimeMin >= ? AND tpp.crossingTimeMin <= ?"),
        lambda x, ca=cnt_all: 0 < x <= ca,
        [t, lo, mid],
    )
    # Window covering the second half
    test(
        f"time window [{mid:.2f}, {hi:.2f}] @ {t}cP",
        FAST_QUERY.format(time_clause="AND tpp.crossingTimeMin >= ? AND tpp.crossingTimeMin <= ?"),
        lambda x, ca=cnt_all: 0 < x <= ca,
        [t, mid, hi],
    )
    # Full range — must equal cnt_all
    test(
        f"full time window [{lo:.2f}, {hi:.2f}] @ {t}cP = {cnt_all}",
        FAST_QUERY.format(time_clause="AND tpp.crossingTimeMin >= ? AND tpp.crossingTimeMin <= ?"),
        lambda x, ca=cnt_all: x == ca,
        [t, lo - 0.001, hi + 0.001],
    )

# 12d. Empty window — absurd range returns 0
print()
test(
    "empty window [9999, 10000] @ 50cP = 0",
    FAST_QUERY.format(time_clause="AND tpp.crossingTimeMin >= 9999 AND tpp.crossingTimeMin <= 10000"),
    lambda x: x == 0,
    [50],
)
test(
    "inverted window [10, 1] @ 50cP = 0",
    FAST_QUERY.format(time_clause="AND tpp.crossingTimeMin >= 10 AND tpp.crossingTimeMin <= 1"),
    lambda x: x == 0,
    [50],
)

# 12e. hasCrossing=no + time range → must always be 0
# (if there's no crossing, crossingTimeMin IS NULL → never satisfies range)
print()
test(
    "hasCrossing=no + time range → 0",
    """SELECT COUNT(*) FROM Experiment e
       LEFT JOIN TouchPointPrecompute tpp
         ON tpp.experimentId = e.id AND tpp.thresholdCp = 50
       WHERE tpp.hasCrossing = 0
         AND tpp.crossingTimeMin >= 0 AND tpp.crossingTimeMin <= 999""",
    lambda x: x == 0,
)

# 12f. Composite: threshold + hasCrossing + time range + viscosity range
print()
print("  Composite: threshold + crossing + time + viscosity:")
for t in [50, 100, 300, 500]:
    cnt_cross = c.execute(
        "SELECT COUNT(*) FROM TouchPointPrecompute WHERE thresholdCp=? AND hasCrossing=1", [t]
    ).fetchone()[0]
    if cnt_cross == 0:
        continue
    # Get crossing viscosity range for the threshold
    vlo, vhi = c.execute(
        """SELECT MIN(crossingViscosityCp), MAX(crossingViscosityCp)
           FROM TouchPointPrecompute
           WHERE thresholdCp=? AND hasCrossing=1""",
        [t],
    ).fetchone()
    tlo, thi = c.execute(
        """SELECT MIN(crossingTimeMin), MAX(crossingTimeMin)
           FROM TouchPointPrecompute
           WHERE thresholdCp=? AND hasCrossing=1""",
        [t],
    ).fetchone()
    test(
        f"composite @ {t}cP: time[{tlo:.1f},{thi:.1f}]+visc[{vlo:.0f},{vhi:.0f}]",
        """SELECT COUNT(DISTINCT e.id) FROM Experiment e
           LEFT JOIN TouchPointPrecompute tpp
             ON tpp.experimentId = e.id AND tpp.thresholdCp = ?
           WHERE tpp.hasCrossing = 1
             AND tpp.crossingTimeMin >= ? AND tpp.crossingTimeMin <= ?
             AND tpp.crossingViscosityCp >= ? AND tpp.crossingViscosityCp <= ?""",
        lambda x, cc=cnt_cross: x == cc,
        [t, tlo - 0.001, thi + 0.001, vlo - 0.01, vhi + 0.01],
    )

# 12g. Pagination with time range
print()
for t in [50, 300]:
    cnt = c.execute(
        FAST_QUERY.format(time_clause="AND tpp.crossingTimeMin >= 0"),
        [t],
    ).fetchone()[0]
    if cnt == 0:
        continue
    # Page 1 (limit 30)
    page1 = c.execute(
        """SELECT COUNT(*) FROM (
             SELECT e.id FROM Experiment e
             LEFT JOIN TouchPointPrecompute tpp
               ON tpp.experimentId = e.id AND tpp.thresholdCp = ?
             WHERE tpp.hasCrossing = 1 AND tpp.crossingTimeMin >= 0
             ORDER BY e.createdAt DESC LIMIT 30
           )""",
        [t],
    ).fetchone()[0]
    test(
        f"page1 (limit=30) @ {t}cP with time>=0 ({cnt} total)",
        """SELECT COUNT(*) FROM (
             SELECT e.id FROM Experiment e
             LEFT JOIN TouchPointPrecompute tpp
               ON tpp.experimentId = e.id AND tpp.thresholdCp = ?
             WHERE tpp.hasCrossing = 1 AND tpp.crossingTimeMin >= 0
             ORDER BY e.createdAt DESC LIMIT 30
           )""",
        lambda x, total_cnt=cnt: x == min(30, total_cnt),
        [t],
    )

# ── Summary ───────────────────────────────────────────────────
print(f"\n{'='*50}")
print(f"  TOTAL: {passed} passed, {failed} failed")
print(f"{'='*50}")
sys.exit(1 if failed else 0)
