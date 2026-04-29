# V1 schema contract — report-relevant tables

**Status:** frozen 2026-04-29 (Sprint 2 / S2-L2, commit #2 of the 14-commit critical sequence).
**Owner:** Architecture Team.
**Scope:** the 5 tables that Sprint 2's `reports_generate_comparison_*_by_ids` handler reads from. **Not** the full V1 schema — see § "Out of scope" below.
**Source of truth:** `src-tauri/src/db/migrations/v0001_initial.rs` (initial 22-table DDL) + migrations `v0002` through `v0007` (incremental column / index additions).

> Human-readable navigational layer for the schema slice the by-ids report path touches. Per-table column lists with types, primary key, FK relationships, indexes, and the migration that introduced each piece. If you write a query that joins these tables, read this doc; don't grep 7 migration files.

---

## Why this doc exists

Sprint 2's `reports_generate_comparison_pdf_by_ids` IPC command reads experiment data **directly from SQLite** inside the Rust handler instead of receiving it pre-assembled over IPC (see `ADR-0013-no-large-ipc-rule`). That handler needs a stable schema reference: which tables exist, which columns are nullable, which indexes the queries can rely on, and which migration introduced each piece.

This contract is **frozen** for the report-path slice: the by-ids handler can rely on every column / index / FK listed here, and a future migration that violates the contract triggers an audit failure (the future `audit:db-schema-drift` lint, see § "Drift detection" below).

The full V1 schema covers 22 tables, FTS5 virtual tables, and triggers. This doc covers only the 5 tables the report path touches:

| Table | Why the report path needs it |
| ----- | ---------------------------- |
| `Experiment` | Primary row — name, instrument type, geometry, metrics JSON, FK to user / laboratory / water source. |
| `ExperimentData` | Columnar-binary + zstd blob with raw rheology points. |
| `User` | Author's name for the report's "Operator" field (when `Experiment.operatorName` is missing). |
| `Laboratory` | Lab name and location for the report's header. |
| `WaterSourceCatalog` | Water-source descriptor for the report's recipe section (when `Experiment.waterSource` is just a label). |

The other 17 tables (Calibration, ExperimentReagent, ImportBatch, ExperimentPayload, ParserArtifact, ReportArtifact, SearchProjectionLog, SyncOutbox, SyncInbox, MergeEvent, Settings, APIKey, SystemState, ReagentCatalog, Operator, schema_meta, FTS5 virtual + triggers) are **out of scope** of this contract.

---

## Schema overview

```
┌──────────────────┐         ┌──────────────────────┐
│ User             │◄────────┤ Experiment           │◄─────────┐
│ id PK            │         │ id PK                │          │
│ laboratoryId FK ─┐         │ userId FK            │          │
│ ...              │         │ laboratoryId FK ─────┘          │
└──────────────────┘         │ waterSourceId FK ────────┐      │
        │                    │ ...                      │      │
        ▼                    └────────────┬───────────┐ │      │
┌──────────────────┐                      │           │ │      │
│ Laboratory       │                      ▼           ▼ │      │
│ id PK            │             ┌─────────────────┐ ┌──────────┐
│ name UNIQUE      │             │ ExperimentData  │ │ WaterSrc │
│ ...              │             │ experimentId PK │ │ Catalog  │
└──────────────────┘             │ + FK CASCADE    │ │ id PK    │
                                 │ dataBlob (BLOB) │ │ name UQ  │
                                 └─────────────────┘ └──────────┘
```

---

## `Experiment`

The primary row of the report. One per imported rheology test.

### Columns

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| `id` | TEXT | NO | — | PRIMARY KEY. UUID v4 (36 chars). |
| `createdAt` | TEXT | NO | `datetime('now')` | ISO 8601. |
| `updatedAt` | TEXT | NO | `datetime('now')` | ISO 8601. Updated on every write. |
| `originalFilename` | TEXT | NO | — | Source file name; used in dedup. |
| `testDate` | TEXT | NO | — | ISO 8601 date of the test. |
| `instrumentType` | TEXT | NO | — | e.g. `"Chandler 5550"`, `"BSL"`, `"Grace M5600"`. |
| `geometry` | TEXT | YES | NULL | Geometry descriptor (bob/cup/cone/plate). |
| `geometrySource` | TEXT | YES | NULL | Where geometry was derived from. |
| `durationSeconds` | INTEGER | YES | NULL | Total test duration. |
| `avgTemperatureC` | REAL | YES | NULL | Average temperature. |
| `maxTemperatureC` | REAL | YES | NULL | Max temperature. |
| `maxViscosity` | INTEGER | YES | NULL | Pre-computed max-viscosity for fast list. |
| `avgViscosity` | INTEGER | YES | NULL | V4: average viscosity across all points. |
| `name` | TEXT | NO | — | User-visible test name. |
| `fieldName` | TEXT | YES | NULL | Oilfield name. |
| `operatorName` | TEXT | YES | NULL | Free-text operator name (denormalised). |
| `wellNumber` | TEXT | YES | NULL | Well ID. |
| `testId` | TEXT | YES | NULL | Internal test ID. |
| `waterSource` | TEXT | NO | — | Free-text water-source label. |
| `waterParams` | TEXT | YES | NULL | JSON blob with water parameters. |
| `fluidType` | TEXT | NO | — | Fluid type (e.g. `"linear gel"`). |
| `testGroup` | TEXT | NO | — | Top-level test category. |
| `testSubGroup` | TEXT | YES | NULL | Sub-category. |
| `metrics` | TEXT | NO | — | JSON blob with derived metrics. |
| `rawPoints` | TEXT | NO | — | **Legacy JSON** — kept for backwards compat; new code reads `ExperimentData.dataBlob` instead. |
| `calibration` | TEXT | YES | NULL | JSON blob with calibration data. |
| `userId` | TEXT | NO | — | FK → `User(id)` ON DELETE RESTRICT. |
| `laboratoryId` | TEXT | YES | NULL | FK → `Laboratory(id)`. |
| `parsedBy` | TEXT | YES | NULL | V8: parser name. |
| `parseSource` | TEXT | YES | NULL | V8: parser source identifier. |
| `timeRangeMin` | REAL | YES | NULL | V8: time-axis min. |
| `timeRangeMax` | REAL | YES | NULL | V8: time-axis max. |
| `viscosityMin` | INTEGER | YES | NULL | V8: min-viscosity for chart axis. |
| `pressureMax` | REAL | YES | NULL | V8: pressure-axis max. |
| `extraFields` | TEXT | NO | `'{}'` | JSON for forward-compat extra fields. |
| `testCategory` | TEXT | YES | NULL | V4: 2-level taxonomy (Fracturing/Drilling/General). |
| `testType` | TEXT | YES | NULL | V4: specific test method. |
| `dominantPattern` | TEXT | YES | NULL | V5: dominant cycle pattern (ISO/API/SST/Custom). |
| `waterSourceId` | TEXT | YES | NULL | FK → `WaterSourceCatalog(id)`. |

### Primary key & foreign keys

- **PK**: `id` (TEXT, UUID v4).
- **FK** `userId → User(id)` ON DELETE RESTRICT (an experiment cannot be orphaned of its author).
- **FK** `laboratoryId → Laboratory(id)` (no cascade — laboratoryId becomes NULL on lab delete is *not* configured; lab deletion is restricted by referential check at app layer).
- **FK** `waterSourceId → WaterSourceCatalog(id)` (no explicit cascade; nullable).

### Indexes (10 total, by introducing migration)

**v0001 — initial:**
- `idx_experiment_user_created (userId, createdAt)`
- `idx_experiment_lab_created (laboratoryId, createdAt)`
- `idx_experiment_field_operator (fieldName, operatorName)`
- `idx_experiment_water_source (waterSource)` — note: covers the **denormalised text label**, not the FK column.
- `idx_experiment_test_date (testDate)`
- `idx_experiment_dedup (originalFilename, testDate, name COLLATE NOCASE)` — duplicate-detection on save / import.
- `idx_experiment_orig_filename (originalFilename)`
- `idx_experiment_type_date (instrumentType, testDate)` — V7 composite for filter pattern.
- `idx_experiment_water_date (waterSource, testDate)` — V7 composite.
- `idx_experiment_lab_date (laboratoryId, testDate)` — V7 composite.
- `idx_experiment_updated_at (updatedAt)` — sync_engine cursor query.
- `idx_experiment_test_type (testType)` — list/query.rs WHERE testType = ? filter.
- `idx_experiment_dominant_pattern (dominantPattern)` — V5 column lookup.

**v0004 — list-page covering index:**
- `idx_experiment_createdat_id_desc (createdAt DESC, id DESC)` — covers default Library `ORDER BY createdAt DESC, id DESC LIMIT ?` without temp sort.

**v0007 — FK partial index:**
- `idx_experiment_water_source_id (waterSourceId) WHERE waterSourceId IS NOT NULL` — DB-003 finding; covers FK enforcement on `WaterSourceCatalog` deletes.

### Notes for the by-ids handler

- The handler should `SELECT … FROM Experiment WHERE id = ?` per ID (one query per input ID) **and explicitly preserve input order** by iterating the input `Vec<id>`. SQLite's `WHERE id IN (...)` does not guarantee row order — see `SPRINT-2-PLANNING.md` § A2 (corner-case fixture: reordered IDs).
- `metrics` and `rawPoints` are JSON strings, NOT structured columns — parse with `serde_json::from_str` after fetch.
- `rawPoints` is **legacy** — read `ExperimentData.dataBlob` instead for the analysis pipeline.
- `waterSource` (text label) and `waterSourceId` (FK to catalog) coexist for historical reasons. The report path should resolve via FK first, fall back to label.

---

## `ExperimentData`

Columnar-binary + zstd blob storage. One row per `Experiment` (1:1).

### Columns

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| `experimentId` | TEXT | NO | — | PRIMARY KEY + FK → `Experiment(id)` ON DELETE/UPDATE CASCADE. |
| `dataBlob` | BLOB | NO | — | RHLC v2 columnar format, zstd-compressed. Decode via `rheolab_enterprise::db::columnar::decode_typed`. |
| `encoding` | TEXT | NO | `'columnar-v1-zstd'` | Format tag for forward-compat. |
| `pointCount` | INTEGER | NO | `0` | Pre-computed for fast count without decode. |
| `createdAt` | TEXT | NO | — | ISO 8601. |
| `updatedAt` | TEXT | NO | — | ISO 8601. |

### Primary key & foreign keys

- **PK**: `experimentId` (also FK to `Experiment.id`).
- **FK** `experimentId → Experiment(id)` **ON DELETE CASCADE / ON UPDATE CASCADE** — orphan blobs are cleaned up automatically when the parent `Experiment` is deleted (V10 cascade fix).

### Indexes

None beyond the PK index. The 1:1 relationship makes additional indexes unnecessary.

### Notes for the by-ids handler

- Use `decode_typed(&row.dataBlob)` to get a `HashMap<channel, Option<f64>>` of decoded points.
- `pointCount` is the cheap fast path for "how many points does this experiment have" without decompressing the blob.
- The decoder is performant (~10ms for 28k points on small.db's largest fixture per S1-3 measurements).

---

## `User`

Singleton row in single-user RheoLab Enterprise; multi-row in future multi-user variants.

### Columns

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| `id` | TEXT | NO | — | PRIMARY KEY. |
| `name` | TEXT | YES | NULL | Display name. |
| `email` | TEXT | YES | NULL | UNIQUE. |
| `emailVerified` | TEXT | YES | NULL | ISO 8601. |
| `image` | TEXT | YES | NULL | Avatar URL / path. |
| `password` | TEXT | YES | NULL | Hashed password. |
| `role` | TEXT | NO | `'operator'` | One of `'admin'`, `'operator'`, `'viewer'`. |
| `isActive` | INTEGER | NO | `1` | Boolean (0/1). |
| `laboratoryId` | TEXT | YES | NULL | FK → `Laboratory(id)` ON DELETE SET NULL. |
| `createdAt` | TEXT | NO | `datetime('now')` | |
| `updatedAt` | TEXT | NO | `datetime('now')` | |

### Primary key & foreign keys

- **PK**: `id`.
- **UNIQUE**: `email`.
- **FK** `laboratoryId → Laboratory(id)` ON DELETE SET NULL.

### Indexes

None on `User` table proper. (V7 audit considered indexing `laboratoryId` but skipped — single-user app, full scan of one row beats any index.)

### Notes for the by-ids handler

- The report's "Operator" header field uses, in order: `Experiment.operatorName` (denormalised free text) → `User.name` (FK lookup) → `User.email` (last resort).
- Single-user installations have exactly one `User` row; the JOIN is essentially free.

---

## `Laboratory`

Lab metadata for the report's header.

### Columns

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| `id` | TEXT | NO | — | PRIMARY KEY. |
| `name` | TEXT | NO | — | UNIQUE. |
| `description` | TEXT | YES | NULL | |
| `location` | TEXT | YES | NULL | |
| `createdAt` | TEXT | NO | `datetime('now')` | |
| `updatedAt` | TEXT | NO | `datetime('now')` | |

### Primary key & foreign keys

- **PK**: `id`.
- **UNIQUE**: `name`.
- No FKs.

### Indexes

None beyond PK + UNIQUE name.

### Notes for the by-ids handler

- Used for "Laboratory: <name>, <location>" in the report header.
- Resolved via `Experiment.laboratoryId → Laboratory.id`.

---

## `WaterSourceCatalog`

Water-source descriptors for the recipe section.

### Columns

| Column | Type | Null | Default | Notes |
| ------ | ---- | ---- | ------- | ----- |
| `id` | TEXT | NO | — | PRIMARY KEY. |
| `name` | TEXT | NO | — | UNIQUE. |
| `location` | TEXT | YES | NULL | |
| `composition` | TEXT | YES | NULL | Free text or JSON. |
| `notes` | TEXT | YES | NULL | |
| `createdAt` | TEXT | NO | — | ISO 8601 (no DEFAULT — set by inserter). |
| `updatedAt` | TEXT | NO | — | ISO 8601 (no DEFAULT — set by inserter). |

### Primary key & foreign keys

- **PK**: `id`.
- **UNIQUE**: `name`.
- No outbound FKs.
- Inbound: referenced by `Experiment.waterSourceId` (V7 partial index `idx_experiment_water_source_id` covers parent-side delete enforcement).

### Indexes

None beyond PK + UNIQUE name on this table.

### Notes for the by-ids handler

- Used for the report's "Water source: <name>; composition: <…>" section.
- Optional resolution: if `Experiment.waterSourceId` is NULL, fall back to `Experiment.waterSource` (text label).

---

## Drift detection

Future Sprint 3+ task: ship `npm run audit:db-schema-drift` lint that:

1. Spins up a fresh seed DB via the migration runner.
2. Runs `PRAGMA table_info(<table>)` and `PRAGMA index_list(<table>)` for each of the 5 tables in this contract.
3. Diffs the result against an extracted-from-this-doc canonical schema (parsed from the column tables above).
4. Exits non-zero on any drift.

Until then, manual review on PRs that touch `src-tauri/src/db/migrations/` is the only enforcement.

---

## Out of scope

This contract intentionally **does not** cover:

- `Calibration` (1:1 with Experiment) — used by report's calibration section but **only** when the calibration sub-feature is enabled in settings; future Sprint deliverable.
- `ExperimentReagent` / `ReagentCatalog` — used by report's recipe section; future Sprint deliverable.
- `ImportBatch` / `ExperimentPayload` / `ParserArtifact` / `ReportArtifact` — operational tables for import / artifact tracking; not read by report path.
- `Settings` / `APIKey` / `SystemState` — user-pref / auth / signed-state tables.
- `SearchProjectionLog` / `SyncOutbox` / `SyncInbox` / `MergeEvent` — sync-engine tables.
- `Operator` — operator catalogue (denormalised into `Experiment.operatorName`).
- `schema_meta` — migration version singleton.
- FTS5 virtual table `fts_experiment` and its triggers — used by library search, not by report path.

When Sprint 3+ work needs any of these, this contract should be **extended** (not duplicated): add a new section to this doc with the same depth as the 5 above, and update the audit drift lint to cover the new table.

---

## See also

- `src-tauri/src/db/migrations/v0001_initial.rs` — initial 22-table DDL (source of truth for the bulk of this contract).
- `src-tauri/src/db/migrations/v0004_experiment_list_default_index.rs` — V4 list-page covering index.
- `src-tauri/src/db/migrations/v0007_fk_indexes.rs` — V7 FK partial indexes (DB-003).
- `src-tauri/src/db/columnar.rs` — `decode_typed` for `ExperimentData.dataBlob`.
- `docs/adr/ADR-0013-no-large-ipc-rule.md` — why the report path reads from DB instead of accepting large IPC payloads.
- `docs/performance/SPRINT-2-PLANNING.md` v3 § "Operator decisions" A2 — order-preservation requirement on `WHERE id IN (...)`.
