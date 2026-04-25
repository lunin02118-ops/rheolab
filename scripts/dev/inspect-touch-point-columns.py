"""Read-only dev helper: report touch-point precompute coverage.

Run while the app is still open — SQLite WAL mode supports concurrent
readers, so this script doesn't fight the app for the DB lock.

Prints:
  * Total experiment count
  * Pending backfill count (touchPrecomputeVersion IS NULL)
  * hasCrossing breakdown (TRUE / FALSE / NULL)
  * Min / max / NULL-count for each touch-point numeric column
  * Five newest rows with their touch-point state for eyeballing

Use this to diagnose "filter isn't working" complaints in the library:
  * If most rows have NULL values, the backfill hasn't caught up yet.
  * If the ranges don't overlap the filter values the user typed, the
    filter IS working — it's just that no rows match.
"""
from __future__ import annotations

import os
import sqlite3
import sys

DB_PATH = os.path.join(os.environ["APPDATA"], "com.rheolab.enterprise", "rheolab.db")


def main() -> int:
    if not os.path.isfile(DB_PATH):
        print(f"[inspect] DB not found: {DB_PATH}", file=sys.stderr)
        return 1

    # Read-only URI so we never risk accidental writes.
    uri = f"file:{DB_PATH}?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    cur = con.cursor()
    print(f"[inspect] DB: {DB_PATH}\n")

    cur.execute("SELECT COUNT(*) FROM Experiment")
    total = cur.fetchone()[0]
    print(f"Total experiments: {total}")

    cur.execute("SELECT COUNT(*) FROM Experiment WHERE touchPrecomputeVersion IS NULL")
    pending = cur.fetchone()[0]
    print(f"Pending backfill  (touchPrecomputeVersion IS NULL): {pending}")

    cur.execute(
        """
        SELECT
          SUM(CASE WHEN touchHasCrossing = 1 THEN 1 ELSE 0 END),
          SUM(CASE WHEN touchHasCrossing = 0 THEN 1 ELSE 0 END),
          SUM(CASE WHEN touchHasCrossing IS NULL THEN 1 ELSE 0 END)
        FROM Experiment
        """
    )
    yes_count, no_count, null_count = cur.fetchone()
    print(
        f"hasCrossing        : yes={yes_count or 0}  no={no_count or 0}  NULL={null_count or 0}"
    )

    def range_summary(col: str) -> None:
        cur.execute(
            f"""
            SELECT MIN({col}), MAX({col}),
                   SUM(CASE WHEN {col} IS NULL THEN 1 ELSE 0 END)
            FROM Experiment
            """
        )
        lo, hi, null_cnt = cur.fetchone()
        lo_str = f"{lo:.2f}" if lo is not None else "—"
        hi_str = f"{hi:.2f}" if hi is not None else "—"
        print(f"{col:28s} : min={lo_str:>10s}  max={hi_str:>10s}  NULL={null_cnt or 0}")

    range_summary("touchCrossingTimeMin")
    range_summary("touchCrossingViscosityCp")
    range_summary("touchViscosityAtTargetCp")

    print("\nFive newest rows (touch-point state):")
    cur.execute(
        """
        SELECT id, name,
               touchHasCrossing, touchCrossingTimeMin,
               touchCrossingViscosityCp, touchViscosityAtTargetCp,
               touchPrecomputeVersion
        FROM Experiment
        ORDER BY createdAt DESC
        LIMIT 5
        """
    )
    for row in cur.fetchall():
        exp_id, name, has, t, v_cross, v_target, ver = row
        name_disp = (name[:40] + "…") if name and len(name) > 40 else (name or "—")
        has_disp = "yes" if has == 1 else ("no" if has == 0 else "NULL")
        print(
            f"  {exp_id[:8]}  {name_disp:41s}  "
            f"has={has_disp:4s}  t={t}  vC={v_cross}  vT={v_target}  ver={ver}"
        )

    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
