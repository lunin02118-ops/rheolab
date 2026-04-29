# Sprint 3 Planning - AnalysisArtifact Cache

**Status:** closed as comparison PDF/XLSX by-IDs vertical slice; dashboard/single-report adoption deferred to by-id contracts
**Depends on:** Sprint 2 native comparison reports by IDs
**Theme:** cache analysis artifacts so reports and analysis views stop recomputing stable experiment results.

## Mission

Add a persistent `AnalysisArtifact` cache keyed by experiment content and analysis settings. The cache should serve:

- dashboard analysis flows,
- single-experiment reports,
- native comparison PDF/XLSX by-IDs reports.

Sprint 2 moved comparison reports into Rust-side DB lookup, so Sprint 3 can check the cache before running analysis without adding new frontend IPC choreography.

Closeout note (2026-04-29): Sprint 3 intentionally wires the cache only into native comparison PDF/XLSX by-IDs. Dashboard and single-experiment report usage remain P2 until they have by-id contracts whose cache key reflects every mutable input, including expert overrides and manual geometry remapping.

Main runtime effect:

```text
Cold path:
  load experiment -> run analysis -> render report

Warm path:
  load experiment -> cache hit -> render report
```

## Boundaries

In scope:

- DB migration for `AnalysisArtifact`.
- Repository layer for reading/writing cache artifacts.
- Stable cache key.
- Cache wrapper around `run_full_analysis_kernel`.
- Integration into comparison PDF/XLSX by-IDs path.
- Cold vs warm parity tests.
- Cold vs warm perf validation.
- Cache invalidation on experiment update/delete.
- Documentation and budget update.

Out of scope:

- Job queue or cancellation UI.
- Background cache warmers.
- Full Rust scheduler.
- Binary viewport-series IPC.
- Library projection table.
- Facet cache.
- Deletion of legacy comparison payload fallback, unless the rollback window is already complete.

## Architecture Principle

The pure analysis kernel must stay cache-free.

`run_full_analysis_kernel(...)` must not know about SQLite, cache tables, or artifact encoding. It remains the deterministic unit used by tests, microbenchmarks, debugging, and future algorithm changes.

The cache lives in a wrapper layer:

```rust
run_full_analysis_cached(
    conn,
    experiment,
    geometry,
    expert_settings,
    detection_settings,
    report_viscosity_rates,
) -> AnalysisOutput
```

Internally:

1. Compute a stable cache key.
2. Try to load an artifact.
3. On hit, deserialize `AnalysisOutput`.
4. On miss, run `run_full_analysis_kernel`.
5. Serialize/store the artifact.
6. Return `AnalysisOutput`.

Cache store failure should not fail report generation. Cache read/decode failure should delete the bad artifact, recompute cold, and log a structured warning.

## Cache Key Contract

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AnalysisCacheKey {
    pub experiment_id: String,
    pub experiment_data_hash: String,
    pub geometry: String,
    pub analysis_settings_hash: String,
    pub report_viscosity_rates_hash: String,
    pub rheolab_core_version: String,
    pub algorithm_version: u32,
}
```

`experiment_id` is useful identity/debug material, but it is not sufficient for validity. The effective validity comes from data, settings, version, and algorithm material.

| Field | Why |
| --- | --- |
| `experiment_id` | Identity/debugging and delete-by-experiment cleanup. |
| `experiment_data_hash` | Invalidates cache when raw/columnar data changes. |
| `geometry` | Grace analysis depends on geometry. Normalize missing legacy geometry to explicit `R1B5`, not an empty string. |
| `analysis_settings_hash` | Detection/expert settings can change the result. |
| `report_viscosity_rates_hash` | Report-specific shear-rate metrics can change derived output. |
| `rheolab_core_version` | Broad invalidation when the core/app version changes. |
| `algorithm_version` | Explicit breaker for semantic algorithm changes without a core version change. |

Implementation notes:

- Prefer hashing the original `ExperimentData.dataBlob` bytes at the repository boundary. If a by-IDs path only has decoded points, hash a canonicalized representation.
- Hash settings from canonical JSON, never `Debug` formatting.
- Normalize report viscosity rates before hashing. Preserve semantic order if order matters; otherwise validation should define the accepted shape.
- Start with `pub const ANALYSIS_CACHE_ALGORITHM_VERSION: u32 = 1;`.
- Bump algorithm version when cycle detection, Grace calculations, default detection settings, or `AnalysisOutput` mapping semantics change.

## DB Schema

Sprint 3 should add an additive `v0008` migration. No existing data is rewritten.

```sql
CREATE TABLE IF NOT EXISTS AnalysisArtifact (
    id TEXT PRIMARY KEY,

    experimentId TEXT NOT NULL,
    experimentDataHash TEXT NOT NULL,
    geometry TEXT NOT NULL,
    analysisSettingsHash TEXT NOT NULL,
    reportViscosityRatesHash TEXT NOT NULL,
    rheolabCoreVersion TEXT NOT NULL,
    algorithmVersion INTEGER NOT NULL,

    artifactEncoding TEXT NOT NULL,
    artifactBlob BLOB NOT NULL,
    artifactBytes INTEGER NOT NULL,

    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    lastAccessedAt TEXT,
    hitCount INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (experimentId)
        REFERENCES Experiment(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_artifact_key
ON AnalysisArtifact (
    experimentId,
    experimentDataHash,
    geometry,
    analysisSettingsHash,
    reportViscosityRatesHash,
    rheolabCoreVersion,
    algorithmVersion
);

CREATE INDEX IF NOT EXISTS idx_analysis_artifact_experiment_updated
ON AnalysisArtifact (experimentId, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_artifact_last_accessed
ON AnalysisArtifact (lastAccessedAt);
```

Default encoding:

```rust
const ANALYSIS_ARTIFACT_ENCODING: &str = "analysis-output.json+zstd:v1";
```

Store serialized `AnalysisOutput` artifacts, not rendered PDF/XLSX bytes. Reports still render fresh output from cached analysis data.

## Repository API

Suggested module:

```text
src-tauri/src/db/repositories/analysis_artifacts/
  mod.rs
  types.rs
  read.rs
  write.rs
  tests.rs
```

Core record:

```rust
pub struct AnalysisArtifactRecord {
    pub id: String,
    pub experiment_id: String,
    pub experiment_data_hash: String,
    pub geometry: String,
    pub analysis_settings_hash: String,
    pub report_viscosity_rates_hash: String,
    pub rheolab_core_version: String,
    pub algorithm_version: u32,
    pub artifact_encoding: String,
    pub artifact_blob: Vec<u8>,
    pub artifact_bytes: i64,
    pub created_at: String,
    pub updated_at: String,
    pub last_accessed_at: Option<String>,
    pub hit_count: i64,
}
```

Read API:

```rust
pub fn get_analysis_artifact(
    conn: &rusqlite::Connection,
    key: &AnalysisCacheKey,
) -> Result<Option<AnalysisArtifactRecord>>;
```

On hit, update `lastAccessedAt` and increment `hitCount`. This read-with-side-effect is acceptable for desktop SQLite in Sprint 3; tests must cover it.

Write API:

```rust
pub fn put_analysis_artifact(
    conn: &rusqlite::Connection,
    key: &AnalysisCacheKey,
    output: &AnalysisOutput,
) -> Result<AnalysisArtifactRecord>;
```

Use `INSERT ... ON CONFLICT (...) DO UPDATE` and update the blob, byte count, encoding, and `updatedAt`.

Maintenance APIs:

```rust
pub fn delete_analysis_artifacts_for_experiment(
    conn: &rusqlite::Connection,
    experiment_id: &str,
) -> Result<usize>;

pub fn prune_analysis_artifacts_by_version(
    conn: &rusqlite::Connection,
    rheolab_core_version: &str,
    algorithm_version: u32,
) -> Result<usize>;

pub fn prune_analysis_artifacts_lru(
    conn: &rusqlite::Connection,
    max_total_bytes: i64,
) -> Result<usize>;
```

`ON DELETE CASCADE` handles experiment deletion, but explicit helpers are still useful for tests and maintenance.

## Artifact Codec

Start with JSON plus zstd compression for inspectability and reasonable DB size.

```rust
pub fn encode_analysis_artifact(output: &AnalysisOutput) -> Result<Vec<u8>> {
    let json = serde_json::to_vec(output)?;
    zstd::bulk::compress(&json, 3)
}

pub fn decode_analysis_artifact(bytes: &[u8]) -> Result<AnalysisOutput> {
    let json = zstd::bulk::decompress(bytes, MAX_ANALYSIS_ARTIFACT_BYTES)?;
    serde_json::from_slice(&json)
}
```

Guard decompression size:

```rust
const MAX_ANALYSIS_ARTIFACT_BYTES: usize = 50 * 1024 * 1024;
```

Lower the guard after real measurements if artifacts are much smaller.

## Cached Analysis Service

Suggested module:

```text
src-tauri/src/analysis_cache/
  mod.rs
  key.rs
  artifact_codec.rs
  service.rs
```

Service input:

```rust
pub struct CachedAnalysisInput<'a> {
    pub experiment_id: &'a str,
    pub experiment_data_hash: &'a str,
    pub rheo_points: Vec<RheoPoint>,
    pub geometry: &'a str,
    pub expert_settings: ExpertSettings,
    pub detection_settings: ScheduleConfig,
    pub report_viscosity_rates: Vec<f64>,
}
```

Return:

```rust
pub struct CachedAnalysisResult {
    pub output: AnalysisOutput,
    pub cache_status: AnalysisCacheStatus,
}

pub enum AnalysisCacheStatus {
    Hit,
    MissStored,
    MissStoreFailed,
    Bypass,
}
```

For alpha safety:

- Analysis success plus cache write failure logs warning and continues.
- Cache decode failure deletes the bad row, recomputes, and continues.
- DB corruption or migration failure remains fatal through the existing DB error path.

## Integration Order

### 1. Comparison by-IDs Reports

Wire comparison PDF/XLSX first because Sprint 2 already moved this path to Rust-side by-IDs lookup.

Do not hold a DB connection during analysis or render. Preserve the Sprint 2 pool-lifetime improvement with short DB scopes:

```text
spawn_blocking:
  conn scope:
    load experiments
    compute keys
    read cache hits
    collect misses
  drop conn

  run analysis for misses

  conn scope:
    store newly computed artifacts
  drop conn

  build report input from resolved analysis outputs
  render PDF/XLSX
```

This is the required architecture even if it adds more plumbing.

### 2. Dashboard Analysis Flow

Wire dashboard analysis only if the command has stable experiment identity. If `analysis_analyze_full` receives only direct points over IPC, do not force persistent cache into it.

Preferred future shape:

```rust
analysis_analyze_experiment_by_id(experiment_id, settings) -> AnalysisResult
```

That would align dashboard analysis with the by-IDs architecture and avoid large IPC.

### 3. Single-Experiment Reports

Adopt the same cache wrapper after comparison report parity is green.

## Invalidation Matrix

| Change | Expected behaviour |
| --- | --- |
| Experiment delete | `ON DELETE CASCADE` removes artifacts. |
| Experiment raw/columnar data changes | `experimentDataHash` changes; old rows become misses. Optionally delete rows for the experiment on save/update. |
| Geometry changes | `geometry` changes; old rows become misses. |
| Analysis settings change | `analysisSettingsHash` changes; old rows remain usable for old settings. |
| Report viscosity rates change | `reportViscosityRatesHash` changes; comparison reports miss only for rate-sensitive output. |
| Core/app version change | `rheolabCoreVersion` changes; old rows become inert. |
| Algorithm semantics change | Bump `ANALYSIS_CACHE_ALGORITHM_VERSION`. |
| Cache deserialize failure | Delete the bad artifact, recompute cold, and log warning. |
| DB restore/import overwrite | Prune rows whose `experimentId` no longer exists. |

## Observability

Per experiment:

```rust
tracing::info!(
    experiment_id,
    cache_status = "hit" | "miss" | "store_failed" | "decode_failed",
    artifact_bytes,
    "analysis artifact cache"
);
```

Per report span:

```text
reports::cmp::pdf::by_ids
  n_experiments
  cache_hits
  cache_misses
  artifact_bytes_read
  artifact_bytes_written
```

These counters feed Sprint 4 scheduler/job instrumentation.

## Performance Validation

Required scenarios:

| Scenario | Shape |
| --- | --- |
| PDF N=5 cold | by-IDs comparison PDF after clearing cache. |
| PDF N=5 warm | Same request immediately repeated. |
| XLSX N=5 cold | by-IDs comparison XLSX after clearing cache. |
| XLSX N=5 warm | Same request immediately repeated. |
| PDF/XLSX N=10 optional | Capture if fixture/license override is available. |

Minimum metrics:

- `wall_ms` p50/p95.
- `cache_hits`.
- `cache_misses`.
- `artifact_bytes_total`.
- `artifact_write_ms`.
- `artifact_read_ms`.
- `analysis_ms_saved_estimate`.

If practical:

- Rust RSS peak.
- DB size growth.
- WAL growth.
- Full UI workflow JS heap.

Expected warm-cache improvement should stay conservative until measured:

| Budget | Expected warm improvement |
| --- | --- |
| `L-CMP-PDF-5` | 5-25% |
| `L-CMP-XLSX-5` | 5-20% |
| N=10 | More visible if analysis scales. |

If render dominates and warm improvement is small, document that honestly. The cache still helps dashboard repeat analysis and gives Sprint 4 durable work artifacts.

## Test Plan

Cache key tests:

- Same inputs produce the same key.
- Different raw data hash changes key.
- Different geometry changes key.
- Different expert settings change key.
- Different detection settings change key.
- Different viscosity rates change key.
- Different core version changes key.
- Different algorithm version changes key.

Repository tests:

- Put then get returns artifact.
- Put same key overwrites artifact.
- Different key stores second artifact.
- Hit increments `hitCount`.
- Hit sets `lastAccessedAt`.
- Delete experiment cascades artifact.
- Prune old versions works.
- Bad encoding returns error.

Codec tests:

- Encode/decode roundtrip.
- Invalid zstd rejected.
- Invalid JSON rejected.
- Oversized decompressed payload rejected.

Report integration tests:

- Cold by-IDs PDF and warm by-IDs PDF are structurally equivalent.
- Cold by-IDs XLSX and warm by-IDs XLSX are structurally equivalent.
- Cache hit avoids kernel call when instrumentation/mock allows proving it.
- Corrupt cache recomputes and repairs/deletes.

Regression tests:

- Missing experiment ID still returns BadRequest.
- Duplicate IDs still rejected.
- Order preservation still holds.
- License cap is rejected before cache work.

## Risk Register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Cache returns stale analysis | High | Key includes data hash, settings hash, core version, and algorithm version. |
| DB connection held during render again | High | Use short DB scopes for cache read and miss writeback. |
| Hash instability | High | Canonical JSON hashing tests. |
| Cache corrupts report output | Medium/High | Decode failure deletes artifact and recomputes; parity tests cover cold/warm output. |
| Cache table grows forever | Medium | Store byte count and add LRU prune helper. |
| Warm path is not much faster | Medium | Measure and document; cache still supports dashboard and Sprint 4. |
| JSON artifact schema evolves | Medium | Encoding carries version; core version and algorithm version are in key. |
| Sprint 3 scope expands too far | High | Wire comparison reports first; dashboard/single reports after parity. |

## Recommended Commit Sequence

1. `docs(perf): Finalize Sprint 3 AnalysisArtifact cache plan`
   - Lock schema, key contract, integration order, DoD, risk register, and cold/warm metrics.
2. `feat(db): Add AnalysisArtifact migration`
   - Add `v0008`, table, indexes, schema docs, and migration tests.
3. `feat(analysis): Add AnalysisArtifact repository`
   - Add types, `get`, `put`, delete-by-experiment, and prune helpers.
4. `feat(analysis): Compute stable analysis cache key`
   - Add canonical hash helpers, algorithm version constant, and key tests.
5. `feat(analysis): Add artifact codec`
   - Add JSON+zstd encode/decode, size guard, and codec tests.
6. `feat(reports): Use AnalysisArtifact cache in comparison by-ids reports`
   - Keep DB connection scopes short.
7. `test(reports): Cover cold and warm by-ids report parity`
   - Cover PDF and XLSX.
8. `perf(reports): Validate cold vs warm AnalysisArtifact reports`
   - Add `docs/performance/ANALYSIS-ARTIFACT-CACHE-VALIDATION.md`.
9. `docs(perf): Update budgets and Sprint 3 retrospective`
   - Record measured warm-cache numbers or explicit "no material win" note.
10. Optional: `chore(reports): Prepare legacy comparison fallback removal gate`
   - Only after rollback window status permits it.

## Definition of Done

- [x] `AnalysisArtifact` migration exists and is registered.
- [x] `cargo test --lib` includes migration/repository tests.
- [x] Cache key stability tests cover every key field.
- [x] Artifact codec roundtrip and corrupt-data tests pass.
- [x] Comparison PDF by-IDs uses cache.
- [x] Comparison XLSX by-IDs uses cache.
- [x] Cold and warm outputs are structurally equivalent at report-input/cache behavior level.
- [x] Cold vs warm validation report exists.
- [x] `BUDGETS.md` is updated with measured warm-cache numbers and explicit no-material-win note.
- [x] Cache invalidation on delete/update is tested.
- [x] Legacy fallback removal issue exists with date/gate: https://github.com/10lunin021189-max/rheolab/issues/2.
- [x] `npm run version:validate` is green.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` is green.
- [x] `npm test` is green.
- [x] `npm run audit:large-ipc` is green with only the expected legacy suppression.

## Sprint Board

P0:

- DB migration.
- Repository.
- Cache key.
- Comparison by-IDs integration.
- Cold/warm parity.

P1:

- Codec hardening.
- Perf validation.
- Cache pruning helper.
- `BUDGETS.md` update.

P2:

- Dashboard analysis integration.
- Single-report integration.
- JS heap/Rust RSS sampling.
- Legacy fallback removal.

## Decisions

| Decision | Sprint 3 default |
| --- | --- |
| Artifact format | `analysis-output.json+zstd:v1`. |
| First integration target | Comparison by-IDs first; dashboard/single reports second. |
| DB connection policy | Never hold DB connection during analysis/render. |
| Cache write failure | Analysis/report succeeds; log warning. |
| Corrupt cache | Delete corrupt artifact, recompute, continue. |

## After Sprint 3

If Sprint 3 succeeds, Sprint 4 scheduler work can queue report jobs, cache warm jobs, import jobs, and maintenance prune jobs around durable analysis artifacts.

Sprint 4 owns:

- cancel report generation,
- progress display,
- concurrent job limits,
- Rust RSS/job metrics,
- background pruning.

Sprint 5 remains `ExperimentListProjection` plus facet cache. Sprint 6 remains binary viewport-series IPC.

## See Also

- `docs/performance/SPRINT-2-RETROSPECTIVE.md`
- `docs/performance/REPORTS-NATIVE-BY-IDS-VALIDATION.md`
- `docs/performance/PERF-ROADMAP-SPRINTS-1-6.md`
- Legacy removal issue: https://github.com/10lunin021189-max/rheolab/issues/2
