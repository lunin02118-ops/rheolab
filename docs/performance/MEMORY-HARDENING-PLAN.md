# Memory Hardening Track

**Status:** MEM-0 through MEM-7 implemented in stacked PRs; validation scorecard recorded.
**Date:** 2026-04-30.
**Scope:** RC hardening after Sprints 1-6.
**Base:** after the legacy comparison payload IPC removal lane.

## Mission

Move the app-controlled memory model to bounded hot paths:

- UI stores experiment IDs, metadata, and the current viewport/page.
- Rust and SQLite own heavy scientific arrays.
- IPC sends bounded payloads.
- Charts consume binary/downsampled series.
- Raw tables request pages.
- Analysis runs by experiment ID and uses `AnalysisArtifact`.
- Reports use the existing by-IDs native path.

The expected win is not that WebView2 becomes magically small. The win is that
saved-experiment detail views stop retaining full raw scientific arrays in
renderer state when the UI only needs metadata, a chart viewport, or a table
page.

## Non-goals

- No UX downgrade.
- No forced full preload before the user can inspect a chart.
- No removal of the unsaved upload / in-memory AoS path.
- No stable release without an alpha fallback soak.
- No overclaim from one perf run.

## Current memory hotspot

The main remaining app-controlled memory risk is saved experiment detail open:

1. `experiments_get` returns a full saved experiment.
2. `load_experiment_by_id` can read `ExperimentData.dataBlob`, decode the
   columnar blob, and materialize decoded points back into `raw_points`.
3. Dashboard code can still hold a full parse-shaped object even though the
   chart can already use Sprint 6 binary overview data.
4. `RawDataTable` receives full `RheoDataPoint[]` and slices in the renderer.
5. The binary chart path currently decodes `Float64Array`, converts through
   `number[]`, then creates typed arrays again in the chart hook.

The track removes that dependency step by step while keeping alpha rollback
flags around the risky UI transitions.

## Track map

| Phase | Theme | Primary result |
| --- | --- | --- |
| MEM-0 | Measurement baseline | Comparable 3-5 run p50/p95 before refactor |
| MEM-1 | Detail metadata by ID | Default chart-first detail open does not call `experiments_get` |
| MEM-2 | By-ID analysis | Analysis tab uses Rust data load + `AnalysisArtifact` cache |
| MEM-3 | Raw table paging | Saved raw table loads only the requested page |
| MEM-4 | Typed chart pipeline | Binary chart path avoids `Float64Array -> number[] -> Float64Array` |
| MEM-5 | Viewport windows | Zoom/pan uses `experiments_series_window` |
| MEM-6 | Retention and cache policy | Jobs, caches, and large buffers have bounded retention |
| MEM-7 | RC validation | Repeated p50/p95 scorecard proves the result |

## MEM-0 - measurement baseline before memory refactor

### Mission

Create a comparable baseline so memory conclusions do not rely on a single
spot-check.

### Deliverables

- `MEMORY-HARDENING-BASELINE.md`
- 3-5 comparable current workflow runs.
- 3-5 DB-scale runs.
- 3-5 comparison smoke runs.
- Dashboard detail and chart runs once the dedicated runners exist.
- p50/p95 for memory, heap, long tasks, and latency.

### Metrics

- Total RSS / working set.
- WebView2 renderer RSS.
- Tauri RSS.
- JS heap peak.
- Long-task count and longest long task.
- Detail open wall time.
- Chart first paint.
- Raw table tab open.
- Report tab open.

### Commands

```powershell
npm run build:ci
npm test
npm run version:validate
npm run audit:large-ipc
npm run perf:workflow:tauri
npm run perf:db:small
npm run perf:db:large
npm run perf:comparison:tauri
```

### DoD

- 3-5 comparable current runs collected.
- p50/p95 calculated from the same metric family.
- Scorecard wording says "single-run spot-check" when only one current run
  exists.
- Hard budgets stay soft until post-refactor repeated runs are available.

## MEM-1 - detail metadata by ID

### Mission

Saved experiment chart-first open must not require full raw points.

### New backend command

```rust
experiments_detail_meta_by_id(experiment_id: String) -> ExperimentDetailMetaResponse
```

The response includes experiment metadata, reagents, user/lab display data,
summary stats, available metrics, and time/value ranges. It must not include
`rawPoints`, `raw_points`, or `data`.

### Frontend flow

Default saved experiment detail:

```text
experiments_detail_meta_by_id(id)
experiments_series_overview(id, metrics, maxPoints)
```

Legacy full-load fallback remains alpha-only behind:

```text
localStorage['RHEOLAB_DETAIL_LEGACY_RAWPOINTS'] = '1'
```

### Tests

- `experiments_detail_meta_by_id` returns no raw point arrays.
- Metadata matches the legacy `experiments_get` shape for shared fields.
- Missing ID returns a typed error.
- Dashboard chart tab renders from metadata plus binary overview.

### DoD

- Saved chart tab does not call `experiments_get`.
- Default detail open does not create `ParseResult.data[]`.
- Chart UX is unchanged or faster.
- Legacy fallback is alpha-only.
- Memory comparison is captured against MEM-0.

## MEM-2 - by-ID analysis and detail/report decoupling

### Mission

Analysis must not require frontend full raw points. Rust should load the
experiment data by ID, compute the data hash, use `AnalysisArtifact`, and return
the same analysis result shape the UI expects.

### New backend command

```rust
analysis_analyze_experiment_by_id(
    experiment_id: String,
    geometry_override: Option<String>,
    expert_settings: ExpertSettingsDto,
    detection_settings: ScheduleConfigDto,
    report_viscosity_rates: Vec<f64>,
) -> AnalysisOutput
```

### Frontend flow

Dashboard analysis state becomes:

```text
detailMeta + analysisOutput + seriesWindow
```

not:

```text
parseResult.data[] + frontend-derived cycles
```

Report UI compatibility can be handled with a view-model adapter before a
broader report tab rewrite.

### Tests

- Same experiment/settings hits `AnalysisArtifact` on the second call.
- Geometry/settings/data hash changes miss the cache.
- Missing or corrupt `ExperimentData` returns a typed error.
- Dashboard analysis renders from by-ID output.

### DoD

- Analysis tab no longer requires renderer-held raw points.
- Cache hit/miss is visible in backend metrics/logs.
- Chart and analysis tabs work with metadata-only detail open.
- Report tab works through adapter or has an explicit alpha fallback.

## MEM-3 - raw table paging by ID

### Mission

Saved experiment raw table should request only the visible page instead of
receiving full `RheoDataPoint[]`.

### New backend command

```rust
experiments_raw_table_page_by_id(
    experiment_id: String,
    page: u32,
    page_size: u32,
    columns: Option<Vec<String>>,
) -> RawTablePage
```

`page_size` must be capped. The unsaved upload flow can keep the old
`RawDataTable(data)` path.

### Frontend flow

```text
open table tab -> request page 1
next/prev -> request page N
optional: prefetch next page
```

### Tests

- First page, middle page, and last page are correct.
- Page size cap is enforced.
- Missing data returns a typed error.
- Unsaved parse workflow still uses the legacy in-memory table.

### DoD

- Saved raw table does not require full `data[]`.
- Table tab memory is bounded by `pageSize`.
- User-facing table behavior remains unchanged.

## MEM-4 - typed arrays end to end for chart

### Mission

Keep the Sprint 6 binary IPC advantage all the way to uPlot.

Current binary path:

```text
RHEOSR1 bytes -> Float64Array -> number[] -> Float64Array
```

Target path:

```text
RHEOSR1 bytes -> Float64Array -> uPlot data
```

### Work

- Add a typed columnar data shape for chart input.
- Make `decodeRheoSeriesV1` expose typed columns without `Array.from`.
- Teach `useRheologyData` to accept typed columns directly.
- Preserve `NaN`/gap semantics with explicit masks only when needed.

### Tests

- Optional columns absent or all-NaN do not crash the chart.
- Null/gap semantics are preserved.
- All uPlot series have equal lengths.
- Binary chart path has no `Array.from` roundtrip.

### DoD

- Binary chart path avoids the extra full-array copy.
- JS heap delta is measured before and after.
- Chart output is structurally unchanged.

## MEM-5 - viewport series windows on zoom/pan

### Mission

The chart should keep only overview/current viewport data, not full experiment
series.

Sprint 6 already added `experiments_series_window`; this phase wires it into
chart interactions.

### Work

- Expose uPlot visible-range callback.
- Add `useExperimentSeriesWindow`.
- Debounce viewport requests by 75-120 ms.
- Ignore stale responses with a request sequence ID.
- Add a small LRU cache of 3-5 windows keyed by experiment/data hash/range.

### Tests

- Zoom triggers a window request.
- Pan triggers a debounced window request.
- Stale responses are ignored.
- Overview fallback is used if a window request fails.

### DoD

- Pan/zoom does not require full raw points.
- IPC payload is bounded by `maxPoints`.
- Pan/zoom latency is measured.

## MEM-6 - buffers, retention, and cache policy

### Mission

Remove slow memory growth from retained records and large transient buffers.

### Work

- Add job registry retention:
  - keep running/queued jobs;
  - prune terminal jobs by TTL and max count;
  - suggested defaults: 100 terminal jobs or 60 minutes.
- Document and test `AnalysisArtifact` cache size policy.
- Call parse/cache release hooks at safe lifecycle points:
  - dashboard close;
  - route leave;
  - successful save/import;
  - large report export complete.
- Add optional file-output report commands for large exports to avoid an extra
  `Vec<u8> -> IPC -> Uint8Array -> Blob` chain when the user is saving to disk.

### DoD

- `jobs_list` remains bounded over long sessions.
- Cache prune policy is documented and test-covered.
- Safe lifecycle points release parse caches.
- Optional report-to-file path is benchmarked before becoming default.

## MEM-7 - final memory validation / RC gate

### Mission

Prove the memory hardening result with repeated measurements, not anecdotes.

### Deliverable

`MEMORY-HARDENING-SCORECARD.md`

### Measurements

- 3-5 workflow runs.
- 3-5 DB-scale runs.
- Dashboard detail runs.
- Chart zoom/pan runs.
- Comparison smoke.

### DoD

- Current p50/p95 is comparable with MEM-0 baseline p50/p95.
- No single-run overclaim.
- Detail-open no-rawPoints default is verified.
- Chart binary window behavior is verified.
- Raw table page-by-ID behavior is verified.
- Full local release gate is green.

## Recommended PR structure

| PR | Suggested title |
| --- | --- |
| MEM-0 | `docs(perf): add memory hardening baseline plan` |
| MEM-1 | `feat(experiments): add detail metadata by id` |
| MEM-2 | `feat(analysis): analyze experiment by id with cache` |
| MEM-3 | `feat(raw-table): page raw data by id` |
| MEM-4 | `refactor(chart): preserve typed binary series pipeline` |
| MEM-5 | `feat(chart): fetch viewport series windows` |
| MEM-6 | `chore(runtime): bound retained jobs and buffers` |
| MEM-7 | `perf(rc): add memory hardening scorecard` |

## Risks

| Risk | Phase | Mitigation |
| --- | --- | --- |
| Analysis/report tab still expects `parseResult.data[]` | MEM-1/2 | Adapter view model plus alpha fallback |
| Raw table paging feels slower | MEM-3 | Page cache, next-page prefetch, skeleton state |
| Touch-point workflows need full data | MEM-2/4 | Server-side analysis output and cached artifacts |
| Typed arrays break null/gap behavior | MEM-4 | Explicit gap tests and masks only where needed |
| Zoom/pan becomes noisy | MEM-5 | Debounce, stale-response ignore, viewport cache |
| More small IPC calls replace one big payload | MEM-3/5 | Cache pages/windows and cap payload size |
| Total RSS win is modest | MEM-7 | Track app-controlled arrays/heap and avoid overclaim |

## Local gate

GitHub Actions are not the release gate for this track. Each PR must include the
relevant local validation results. The minimum gate for docs-only planning is:

```powershell
npm run version:validate
git diff --check
```

Code PRs must add the relevant Rust/TS test slice plus:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run build:ci
npm test
npm run version:validate
npm run audit:large-ipc
git diff --check
```
