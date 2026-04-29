# Sprint 3 planning — AnalysisArtifact cache

**Status:** draft seeded from Sprint 2 closeout  
**Depends on:** Sprint 2 native comparison reports by IDs  
**Theme:** cache analysis artifacts so reports and analysis views stop recomputing stable experiment results.

## Mission

Add a persistent AnalysisArtifact cache keyed by experiment content and analysis settings. The cache should serve:

- dashboard analysis flows,
- single-experiment reports,
- native comparison PDF/XLSX by-IDs reports.

Sprint 2 moved comparison reports into Rust-side DB lookup, so Sprint 3 can check the cache before running analysis without adding new frontend IPC choreography.

## Proposed cache key

```rust
struct AnalysisCacheKey {
    experiment_id: String,
    experiment_data_hash: String,
    geometry: String,
    analysis_settings_hash: String,
    report_viscosity_rates_hash: String,
    rheolab_core_version: String,
    algorithm_version: u32,
}
```

### Key material

| Field | Source | Notes |
| --- | --- | --- |
| `experiment_id` | `Experiment.id` | Human/debug identity; not sufficient for invalidation by itself. |
| `experiment_data_hash` | decoded columnar data or stored blob hash | Must change when raw data changes. |
| `geometry` | experiment geometry/source descriptor | Required because Grace analysis depends on geometry. |
| `analysis_settings_hash` | detection + expert settings | Include schedule detection settings and other analysis knobs. |
| `report_viscosity_rates_hash` | report-specific requested viscosity rates | Comparison reports can ask for custom viscosity-rate metrics. |
| `rheolab_core_version` | app/core version | Version bump can invalidate the cache broadly. |
| `algorithm_version` | explicit constant | Increment on intentional algorithm semantics changes. |

## Main deliverables

1. **Schema migration**
   - Add `AnalysisArtifact` table.
   - Store cache key fields, serialized analysis result, created/updated timestamps, and schema version.
   - Add unique index over the effective key.

2. **Repository layer**
   - `get_analysis_artifact(key)`.
   - `put_analysis_artifact(key, artifact)`.
   - Cache invalidation helpers for experiment delete/update.

3. **Kernel integration**
   - Wrap `run_full_analysis_kernel` with cache lookup/store in command handlers.
   - Keep the pure kernel cache-free for tests and microbenching.

4. **Report integration**
   - Native by-IDs PDF/XLSX path checks cache per experiment before recomputing.
   - Single-experiment reports can adopt the same wrapper after parity tests.

5. **Perf validation**
   - Compare cold vs warm by-IDs report generation.
   - Capture `L-CMP-PDF-5`, `L-CMP-XLSX-5`, and optional N=10 warm-cache deltas.

6. **Legacy cleanup gate**
   - After one alpha/beta rollback window, remove legacy comparison payload fallback.
   - Remove the remaining `LARGE-IPC-EXCEPTION` marker with the legacy command deletion or hard-disable.

## Verification plan

- Unit tests for cache key stability and invalidation.
- Migration tests for table/index creation.
- Repository tests using in-memory SQLite.
- Rust reports tests proving cold and warm paths produce identical `ComparisonReportInput` and PDF/XLSX bytes.
- Existing reports parity suite remains green.
- `npm run audit:large-ipc` should become zero-suppression once legacy fallback is removed.

## Open questions

| Question | Default answer for planning |
| --- | --- |
| Store artifact as JSON, postcard, or zstd-compressed binary? | Start with zstd-compressed JSON for inspectability and size control. |
| Cache invalidation on app/core version bump? | Include `rheolab_core_version` and `algorithm_version` in key. |
| Scope to comparison only first? | Implement generic repository, wire comparison first, then dashboard/single reports. |
| Need background warming? | Not in Sprint 3; defer to scheduler work. |

## Out of scope

- Job queue/cancellation UI.
- Long-running background cache warmers.
- Binary viewport-series IPC.
- Projection table for library filtering.

## See also

- `docs/performance/SPRINT-2-RETROSPECTIVE.md`
- `docs/performance/REPORTS-NATIVE-BY-IDS-VALIDATION.md`
- `docs/performance/PERF-ROADMAP-SPRINTS-1-6.md`
