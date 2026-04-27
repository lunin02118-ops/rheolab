# Phase 4 — Database deep-dive (read-only audit)

**Date:** 2026-04-27
**Branch:** `main` @ `ea8c1e5`
**Scope:** SQLite schema (3 migrations), production query patterns, index coverage
**Methodology:** static analysis only — schema parse + grep over `WHERE`/`ORDER BY` clauses in `src-tauri/src/`. No runtime EXPLAIN QUERY PLAN was executed (deferred until a representative seed DB is available).

---

## 1. Schema inventory

### 1.1 Tables (23)

| Table | Purpose |
|---|---|
| `schema_meta` | migration bookkeeping |
| `User`, `Settings`, `APIKey`, `SystemState` | identity & app state |
| `ReagentCatalog`, `Laboratory`, `Operator`, `WaterSourceCatalog` | reference data |
| `Experiment`, `ExperimentData`, `Calibration`, `ExperimentReagent` | core domain |
| `ImportBatch`, `ExperimentPayload`, `ParserArtifact`, `ReportArtifact`, `SearchProjectionLog` | data flow / artifacts |
| `SyncOutbox`, `SyncInbox`, `MergeEvent`, `ConflictRecord` | sync engine |
| `TouchPointPrecompute` | rheology metric cache |

### 1.2 Indexes (45 total — 36 in v0001, 5 in v0002, 4 in v0003)

Heaviest-indexed tables:

* `Experiment` — **17** indexes (12 in v0001 + 5 partial in v0002)
* `TouchPointPrecompute` — 4 indexes (v0003)
* `ExperimentPayload`, `MergeEvent` — 3 indexes each
* All other tables: 1–2 indexes (mostly FK + status)

### 1.3 Foreign-key coverage matrix

SQLite does **not** create indexes on FK columns automatically. Verified that every FK that is used in `WHERE` / `JOIN` paths is index-backed:

| FK column | Backing index | Status |
|---|---|---|
| `APIKey.userId` | `idx_apikey_userid` | ✅ |
| `Experiment.userId` | `idx_experiment_user_created` (composite, covers prefix) | ✅ |
| `Experiment.laboratoryId` | `idx_experiment_lab_created` (composite, covers prefix) | ✅ |
| `ExperimentData.experimentId` | PK | ✅ |
| `Calibration.experimentId` | `UNIQUE` constraint | ✅ |
| `ExperimentReagent.experimentId` | `idx_experiment_reagent_pair` (composite, covers prefix) | ✅ |
| `ExperimentReagent.reagentId` | composite secondary — fine for `(exp, reagent)` lookup, **slow for `WHERE reagentId = ?` alone** | ⚠️ low impact |
| `ExperimentPayload.importBatchId` | none | ⚠️ |
| `ParserArtifact.importBatchId` | none | ⚠️ |
| `ReportArtifact.importBatchId` | none | ⚠️ |
| `MergeEvent.importBatchId` | `idx_merge_import` | ✅ |

Scoring: **3 dangling FKs** in artifact tables (used only for cleanup paths after batch deletion — low severity).

---

## 2. Production query inventory

### 2.1 Hot-path queries (live IPC)

Looked at: `commands/experiments/list/{mod,query}.rs`, `db/repositories/experiments/{read,write,delete}.rs`, `commands/sync_engine.rs`, `db/touch_point_precompute.rs`.

| Query family | Backing index | Notes |
|---|---|---|
| `Experiment WHERE id = ?` | PK | ✅ |
| `Experiment WHERE id IN (...)` | PK | ✅ |
| `Experiment WHERE originalFilename = ? AND testDate = ? AND name = ? COLLATE NOCASE` (dedup on save) | `idx_experiment_dedup` | ✅ exact match |
| `Experiment WHERE updatedAt > ? ORDER BY updatedAt` (sync delta) | `idx_experiment_updated_at` | ✅ |
| `Experiment WHERE testType = ?` (list filter) | `idx_experiment_test_type` | ✅ |
| `Experiment` list with `ORDER BY createdAt DESC, id DESC` (default) + dynamic WHERE | various single-column indexes | ✅ — query.rs uses keyset pagination on `(createdAt, id)` to avoid `OFFSET` blowup |
| `ExperimentData WHERE experimentId = ?` | PK | ✅ |
| `ExperimentReagent WHERE experimentId = ?` | `idx_experiment_reagent_pair` | ✅ (prefix match) |
| `ExperimentReagent WHERE experimentId IN (...)` | `idx_experiment_reagent_pair` | ✅ |
| `TouchPointPrecompute WHERE thresholdCp = ? AND hasCrossing = ?` | `idx_tpp_threshold_crossing` | ✅ partial index |
| `TouchPointPrecompute WHERE thresholdCp = ? AND crossingTimeMin <op> ?` | `idx_tpp_threshold_crossing_time` | ✅ partial index |
| `Experiment LEFT JOIN TouchPointPrecompute ON … WHERE tpp.experimentId IS NULL` (backfill) | `idx_tpp_experiment` | ✅ |

**Verdict:** the hot path is solidly indexed. The recent v0002/v0003 partial-index strategy is a textbook example of how to keep storage small while accelerating sparse columns.

### 2.2 Filter-metadata queries (Library page sidebar)

`commands/experiments/list/mod.rs::experiments_filter_metadata` runs **8 `SELECT DISTINCT … FROM Experiment WHERE col IS NOT NULL ORDER BY col COLLATE NOCASE`** queries on every Library page open:

* `instrumentType`, `fluidType`, `geometry`, `fieldName`, `waterSource`, `testCategory`, `testType`, plus the `Laboratory` and `ReagentCatalog` joins.

Each individual `DISTINCT` over a single column with an existing index can be served by the index, but doing eight back-to-back per pageload is wasteful. **Optimisation opportunity** (Phase 7): cache the result on the frontend with TTL invalidation on save / delete events. This is a frontend-cache change, not a schema change.

### 2.3 Reagent name lookup — minor footgun

`db/repositories/reagents.rs::is_duplicate_name`:

```sql
SELECT COUNT(*) FROM ReagentCatalog WHERE LOWER(name) = LOWER(?1)
SELECT COUNT(*) FROM ReagentCatalog WHERE id != ?1 AND LOWER(name) = LOWER(?2)
```

The schema has `idx_reagent_name_nocase ON ReagentCatalog(name COLLATE NOCASE)` — but SQLite cannot use a `COLLATE NOCASE` index for a `LOWER(name) = LOWER(?)` predicate; the expression doesn't match the index key. The query falls back to a full table scan.

**Impact:** very low. `ReagentCatalog` is a small reference table (typically <500 rows). Still flagged because it is a 1-line fix and other reagent matchers in the codebase do use `COLLATE NOCASE` correctly (`name = ? COLLATE NOCASE`).

**Suggested patch (Phase 7):**

```rust
// before
"SELECT COUNT(*) FROM ReagentCatalog WHERE LOWER(name) = LOWER(?1)"
// after
"SELECT COUNT(*) FROM ReagentCatalog WHERE name = ?1 COLLATE NOCASE"
```

### 2.4 EXISTS subqueries with `LIKE … COLLATE NOCASE`

`commands/experiments/list/query.rs` uses three `EXISTS (SELECT 1 FROM ExperimentReagent er LEFT JOIN ReagentCatalog rc … WHERE … LIKE ? COLLATE NOCASE)` subqueries for reagent / batch search.

`LIKE ? COLLATE NOCASE` with a leading wildcard (`%foo%`) cannot use any index — this is inherent to SQLite. For the FTS-eligible portion, the code already routes through `fts_experiment MATCH ?` (`e.rowid IN (SELECT rowid FROM fts_experiment WHERE fts_experiment MATCH ?)`) which is the right call.

**Verdict:** acceptable. Reagent EXISTS subqueries only fire when the user types a reagent / batch filter, which is bounded by the resultset already filtered on `Experiment` indexes.

---

## 3. Migration health

| File | Size | Notes |
|---|---:|---|
| `v0001_initial.rs` | 485 LOC | initial schema |
| `v0002_touch_point_metrics.rs` | ~80 LOC for the index DDL alone | adds 5 partial indexes — clean |
| `v0003_multi_threshold_touch_point.rs` | adds `TouchPointPrecompute` table + 4 indexes | clean |

The `migration.rs` runner uses transactional `IF NOT EXISTS` DDL — safe to re-run. `migration_tests.rs` (618 LOC) covers V1→V3 upgrade paths and idempotency. **No migration-related issues found.**

---

## 4. Findings summary

| # | Severity | Area | Finding | Suggested fix |
|---|---|---|---|---|
| F1 | low | reagent dedup | `LOWER(name) = LOWER(?)` bypasses `idx_reagent_name_nocase` | rewrite to `name = ? COLLATE NOCASE` (1-line patch in `reagents.rs::is_duplicate_name`) |
| F2 | low | artifact cleanup | 3 FK columns (`importBatchId` on `ExperimentPayload` / `ParserArtifact` / `ReportArtifact`) lack indexes | add 3 partial indexes in a v0004 migration if cleanup-by-batch becomes a pain-point |
| F3 | low–medium | filter metadata | 8 `DISTINCT` queries fired per Library pageload | frontend memoise with cache-key = `[lastExperimentSaveTimestamp]` |
| F4 | informational | overall | 17 indexes on `Experiment`, 4 on `TouchPointPrecompute` — schema is **over-indexed** by traditional standards but every index is justified by a documented WHERE-path | none — keep as is, monitor write latency on bulk imports |

**No high/critical findings.** No missing index on a hot path, no slow queries identified by static analysis, no broken FKs, no schema-level bugs.

---

## 5. Recommended next steps

### 5.1 Lightweight (Phase 7 fine-tune candidates)

1. Fix F1 (reagents `LOWER` → `COLLATE NOCASE`) — 1 commit, full test pass.
2. Cache the filter-metadata result on the frontend (F3) — saves 8 `DISTINCT` scans per Library navigation.

### 5.2 Heavier (separate session — needs runtime profiling)

1. Run `EXPLAIN QUERY PLAN` against a representative seed DB (`outputs/seed/rheolab-fixture-seed-small.db`) on each of the documented hot-path queries to verify the index choices the optimiser actually makes.
2. Measure write-amplification on bulk import — if it becomes a problem, evaluate dropping rarely-queried single-column `Experiment` indexes (`idx_experiment_water_source`, `idx_experiment_test_type`) since they are partly subsumed by composite ones.
3. Add a test fixture that simulates 10 000+ `TouchPointPrecompute` rows and validates that v0003 partial indexes still beat the full table scan in the worst case.

### 5.3 Out of scope here

* Schema-altering migrations.
* Performance benchmarking (runtime cost / wallclock).
* WASM / `rheolab-core` SQL paths (none — `rheolab-core` is pure compute).

---

## 6. Artifacts referenced

* `runtime/audit/20260427-deep-opt-baseline/db-schema-baseline.txt` — schema dump
* `src-tauri/src/db/migrations/{v0001_initial,v0002_touch_point_metrics,v0003_multi_threshold_touch_point}.rs`
* `src-tauri/src/commands/experiments/list/{mod,query}.rs`
* `src-tauri/src/db/repositories/{experiments,reagents}/*.rs`

Tracking link: see `docs/audit/2026-04-27-deep-optimization-plan.md` Phase 4.
