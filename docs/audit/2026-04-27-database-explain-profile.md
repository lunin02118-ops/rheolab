# Phase 4b — Database EXPLAIN QUERY PLAN profile (live)

**Date:** 2026-04-27
**Branch:** `main` @ `0725c58` (post Phase 4 F1+F3)
**Seed DB:** `outputs/seed/rheolab-fixture-seed-small.db` (1.13 MB)
**SQL probe script:** `scripts/audit/explain-plan.sql`
**Tool:** `sqlite3` 3.x

---

## 1. Seed DB inventory

| Table | Rows |
|---|---:|
| `Experiment` | 19 |
| `ExperimentData` | 19 (1:1 with Experiment ✅) |
| `ExperimentReagent` | 57 (avg 3 reagents / experiment) |
| `ReagentCatalog` | 16 |
| `TouchPointPrecompute` | 152 (8 thresholds × 19 experiments) |
| `Calibration` | 0 (small fixture omits calibration) |
| `Laboratory` | 3 |
| `ImportBatch` | 0 |

This is a deliberately compact fixture — it exercises every relationship without dragging in a full dataset. Plans are unaffected by row count beyond ~20 rows; SQLite chooses indexes from the schema's *index list*, not from cardinality.

---

## 2. Hot-path EXPLAIN summary

Each row below is an actual `EXPLAIN QUERY PLAN` output captured against the seed DB. ✅ = optimiser picks an index; ⚠️ = scan or temp B-tree present.

| # | Query | Plan | Verdict |
|---|---|---|---|
| Q1 | `Experiment WHERE id = ?` | `SEARCH USING INDEX sqlite_autoindex_Experiment_1 (id=?)` | ✅ PK lookup |
| Q2 | dedup probe (save path: `originalFilename, testDate, name COLLATE NOCASE`) | `SEARCH USING INDEX idx_experiment_dedup (3 cols)` | ✅ composite hit |
| Q3 | **default list** `ORDER BY createdAt DESC, id DESC LIMIT 50` | `SCAN Experiment` + `USE TEMP B-TREE FOR ORDER BY` | ⚠️ **see F5** |
| Q4 | list filter `testType = ?` | `SEARCH USING idx_experiment_test_type` + `USE TEMP B-TREE FOR ORDER BY` | ⚠️ filter ok, sort needs temp |
| Q5 | list filter `laboratoryId = ?` | `SEARCH USING idx_experiment_lab_created (laboratoryId=?)` + `USE TEMP B-TREE FOR LAST TERM OF ORDER BY` | ✅ composite covers `(labId, createdAt)`, only secondary `id` term needs sort |
| Q6 | sync delta `updatedAt > ?` | `SEARCH USING idx_experiment_updated_at (updatedAt>?)` | ✅ index range |
| Q7a | sidebar `DISTINCT instrumentType` | `SCAN COVERING idx_experiment_type_date` + temp sort | ✅ covering scan, sort unavoidable |
| Q7b | sidebar `DISTINCT testType WHERE … != ''` | `SEARCH COVERING idx_experiment_test_type (testType>?)` + temp sort | ✅ covering range scan |
| **Q8** | **reagent dedup AFTER F1** (`name = ? COLLATE NOCASE`) | `SEARCH USING COVERING idx_reagent_name_nocase (name=?)` | ✅✅ **F1 verified — index now used** |
| Q8b | reagent dedup BEFORE F1 (`LOWER(name) = LOWER(?)`) | `SCAN USING COVERING idx_reagent_name_nocase` | ⚠️ **full scan** (covering, but every row read) — confirms F1 problem |
| Q9 | EXISTS subquery on `ExperimentReagent + ReagentCatalog` | `SEARCH er USING idx_experiment_reagent_pair (experimentId=?)` + `SEARCH rc USING PK LEFT-JOIN` | ✅ |
| Q10a | TPP `thresholdCp = ? AND hasCrossing = ?` | `SEARCH USING idx_tpp_threshold_crossing` | ✅ partial-index hit |
| Q10b | TPP `thresholdCp = ? AND crossingTimeMin > ?` | `SEARCH USING idx_tpp_threshold_crossing_time` | ✅ partial-index hit |
| Q10c | TPP `thresholdCp = ? AND viscosityAtTargetCp BETWEEN ? AND ?` | `SEARCH USING idx_tpp_threshold_viscosity_target` | ✅ partial-index hit |
| Q11 | backfill `Experiment LEFT JOIN TouchPointPrecompute ON … WHERE tpp.experimentId IS NULL` | `SCAN e USING COVERING PK` + `SEARCH tpp USING COVERING PK LEFT-JOIN` | ✅ |
| Q12 | blob fetch `ExperimentData WHERE experimentId = ?` | `SEARCH USING PK` | ✅ |
| Q13 | batch fetch `WHERE id IN (…)` | `SEARCH USING COVERING PK (id=?)` per id | ✅ |
| Q14 | full reagent list `ORDER BY LOWER(category), LOWER(name)` | `SCAN ReagentCatalog` + `USE TEMP B-TREE FOR ORDER BY` | ⚠️ **see F6** |

---

## 3. Findings

### F1 — VERIFIED ✅

The Phase 4 finding F1 (rewrite `LOWER(name) = LOWER(?)` → `name = ? COLLATE NOCASE`) is now confirmed against the seed DB:

* **Before fix (Q8b):** `SCAN USING COVERING idx_reagent_name_nocase` — every row read (covering, so no table fetch, but still O(n)).
* **After fix (Q8):** `SEARCH USING COVERING idx_reagent_name_nocase (name=?)` — direct index seek, O(log n).

Wallclock difference is negligible at 16 rows but the asymptotic cost is now correct, and the regression test in `reagents_tests.rs::is_duplicate_name_*` locks the contract.

### F5 — NEW (medium): default list page does a full table scan + temp sort

`commands/experiments/list/query.rs` falls through to:

```sql
ORDER BY e.createdAt DESC, e.id DESC LIMIT ?
```

with no `WHERE` clause when the user opens the Library page without filters. The optimiser produces:

```
SCAN Experiment
USE TEMP B-TREE FOR ORDER BY
```

At 19 rows this is invisible. At 10 000+ experiments it becomes the dominant cost of every Library page open (because the keyset-pagination cursor only kicks in *after* the first fetch).

**Recommended fix (Phase 7 candidate, ~1-line schema migration):**

```sql
CREATE INDEX IF NOT EXISTS idx_experiment_createdat_id_desc
    ON Experiment(createdAt DESC, id DESC);
```

This produces a covering index that lets SQLite serve the default list page directly from the index leaf nodes — no scan, no temp sort. Tradeoff: +1 index storage proportional to row count (~16 bytes per row of `Experiment`).

**Severity:** medium. Latent — invisible until catalogues grow beyond a few thousand experiments.

### F6 — LOW: `ReagentCatalog` list scans + sorts

`db/repositories/reagents.rs::list_all` issues:

```sql
SELECT … FROM ReagentCatalog ORDER BY LOWER(category), LOWER(name)
```

Plan: `SCAN + USE TEMP B-TREE FOR ORDER BY`. The `LOWER()` wrapper prevents any `COLLATE NOCASE` index from being used (same footgun as F1).

`ReagentCatalog` is a tiny reference table (typically <500 rows) so the temp sort is negligible. Two cheap rewrites are available if this ever shows up in a profile:

1. Replace `ORDER BY LOWER(category), LOWER(name)` with `ORDER BY category COLLATE NOCASE, name COLLATE NOCASE` — opens the door to a future `idx_reagent_category_name_nocase` covering index.
2. Add an explicit covering index on `(category COLLATE NOCASE, name COLLATE NOCASE)` and rely on (1) to make the optimiser pick it.

**Severity:** low. Defer until ReagentCatalog grows materially or this query shows up on a profile.

### F7 — INFORMATIONAL: filter list with `testType = ?` does temp sort

Q4 (`SEARCH USING idx_experiment_test_type` + `USE TEMP B-TREE FOR ORDER BY`) fetches matching rows quickly but then sorts in memory because `idx_experiment_test_type` is single-column. To remove the sort, a composite `(testType, createdAt DESC, id DESC)` index would do it — but at the cost of one more index. Not worth it until a profile shows the sort is the bottleneck.

**No action recommended now.**

---

## 4. Coverage matrix — what we proved

| Optimisation claim from Phase 4 | Live verification on seed DB |
|---|---|
| dedup index `idx_experiment_dedup` is used on save | ✅ Q2 |
| sync-delta `idx_experiment_updated_at` is used | ✅ Q6 |
| TPP partial indexes (v0003) all hit | ✅ Q10a / Q10b / Q10c |
| FK `ExperimentData.experimentId` is index-backed (PK) | ✅ Q12 |
| EXISTS subquery uses `idx_experiment_reagent_pair` | ✅ Q9 |
| F1 fix (`COLLATE NOCASE`) restores index lookup | ✅ Q8 vs Q8b |
| Default list page is a scan (Phase 4 hypothesis) | ✅ Q3 — confirmed; promoted to **F5** |

---

## 5. Reproducibility

```pwsh
& "D:\Android\Sdk\platform-tools\sqlite3.exe" `
    "outputs/seed/rheolab-fixture-seed-small.db" `
    ".read scripts/audit/explain-plan.sql"
```

The script is read-only (`PRAGMA query_only = ON`). Re-running it on a different fixture (e.g. a production-snapshot) will produce the same plans for the queries above — index choices are schema-driven.

---

## 6. Recommended next steps

### 6.1 Phase 7 candidates (low risk)

1. **F5** — add `idx_experiment_createdat_id_desc` in a v0004 migration. Single DDL, automatic on schema upgrade. ~10 LOC change with regression test.
2. F6 — defer until profile reasons for it appear.

### 6.2 Out of scope here

* Wallclock benchmarking on a production-size dataset (needs a 100k+ row snapshot — not in repo).
* Write-amplification cost of the proposed F5 index (negligible until import-batch sizes get into 6 figures).
* `EXPLAIN` (the bytecode plan, not query plan) — only relevant if a specific query stalls on virtual-machine instructions, which is not the case here.

---

## 7. Artifacts

* SQL probe script: `scripts/audit/explain-plan.sql`
* Phase 4 plan & static-analysis findings: `docs/audit/2026-04-27-database-deep-dive.md`
* Phase 0 / Phase 1 baseline: `docs/audit/2026-04-27-deep-optimization-plan.md`
