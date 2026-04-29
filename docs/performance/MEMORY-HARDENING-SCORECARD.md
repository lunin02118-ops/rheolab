# Memory Hardening Scorecard

**Date:** 2026-04-30.
**Branch:** `codex/memory-hardening-scorecard`.
**Scope:** MEM-0 through MEM-7 stacked memory-hardening track.

## Verdict

Memory hardening is validated as an app-controlled memory refactor:

- saved-experiment chart-first open no longer depends on full raw points;
- analysis can run by experiment id through the Rust `AnalysisArtifact` cache;
- saved raw table loads pages by id;
- binary chart data stays typed through the chart path;
- chart zoom requests bounded binary windows;
- scheduler records and runtime cache hooks are bounded;
- scheduler CPU/RSS fields are non-null on Windows.

The measured result is nuanced rather than magic:

- JS heap remains very small and stable: workflow p50/p95 is `9.84 / 9.85 MB`.
- Tauri workflow total RSS p50 improved vs the stored baseline.
- Tauri workflow total RSS p95 is one warmup/rebuild-influenced run slightly
  above the stored p95 budget: `753.28 MB` vs `750 MB`.
- Comparison renderer RSS remains the main memory watch item:
  `266.08 / 277.54 MB`, above the old renderer p95 target.

Bottom line: the refactor removed full raw scientific arrays from default hot
paths, but total Windows RSS is still partly governed by WebView2/GPU/runtime
allocation behavior. Do not claim a hard total-RSS win yet; claim bounded
payload/state ownership and stable low JS heap.

## Local Gate

All gates passed locally:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib runtime::jobs -- --nocapture
npm test -- --run tests/components/DashboardContent.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run build:ci
npm test
npm run version:validate
npm run audit:large-ipc
git diff --check
```

MEM-7 perf matrix:

```powershell
npm run perf:workflow:tauri    # 3 runs
npm run perf:db:small          # 3 runs
npm run perf:db:large          # 3 runs
npm run perf:comparison:tauri  # 3 runs
```

## Workflow Memory

Source artifacts:

- `outputs/e2e/perf/workflow-1777493611286-tauri.json`
- `outputs/e2e/perf/workflow-1777493639435-tauri.json`
- `outputs/e2e/perf/workflow-1777493667147-tauri.json`
- `outputs/e2e/perf/native-memory-1777493606792.jsonl`
- `outputs/e2e/perf/native-memory-1777493635052.jsonl`
- `outputs/e2e/perf/native-memory-1777493662593.jsonl`

| Metric | Previous baseline p50 | Previous baseline p95 | Current p50 | Current p95 | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| Total RSS / working set | 673.82 MB | 747.66 MB | 654.55 MB | 753.28 MB | p50 pass, p95 warn |
| WebView2 renderer RSS | 200.05 MB | 206.79 MB | 207.26 MB | 207.45 MB | pass |
| Tauri RSS | 66.45 MB | 67.58 MB | 68.11 MB | 73.36 MB | pass, watch p95 |
| Tauri CPU peak | 5.73 s | 6.05 s | 5.75 s | 6.05 s | pass |
| JS heap peak | 9.81 MB | 9.84 MB | 9.84 MB | 9.85 MB | flat |
| Workflow wall | 19,173 ms | 19,267 ms | 19,751 ms | 19,918 ms | pass |

Interpretation:

- Total RSS p50 is lower than the stored baseline.
- The p95 row is dominated by the first run after debug rebuild:
  total RSS samples were `753.28`, `654.55`, `629.70 MB`.
- JS heap is effectively flat, which is the best indicator that renderer-owned
  scientific arrays are not growing in the workflow path.

## Workflow Timings

| Metric | Current p50 | Current p95 | Budget / note | Status |
| --- | ---: | ---: | --- | --- |
| `L-WORKFLOW` wall | 19,751 ms | 19,918 ms | `<= 22,000 / <= 25,000 ms` | pass |
| Peak JS heap | 9.84 MB | 9.85 MB | `<= 12 / <= 16 MB` | pass |
| Peak DOM nodes | 1,649 | 1,649 | `<= 2,400 / <= 3,000` | pass |
| Comparison 4 loaded | 3,501 ms | 3,626 ms | observational | stable |
| Single PDF, Chandler | 1,387 ms | 1,633 ms | `L-PDF <= 5,000 / <= 8,000 ms` | pass |
| Single PDF, Grace | 1,801 ms | 1,865 ms | `L-PDF <= 5,000 / <= 8,000 ms` | pass |

## DB-Scale Library

Source artifacts:

- `outputs/e2e/perf/db-scale-1777493745802-small-tauri.json`
- `outputs/e2e/perf/db-scale-1777493807404-small-tauri.json`
- `outputs/e2e/perf/db-scale-1777493869154-small-tauri.json`
- `outputs/e2e/perf/db-scale-1777493892303-large-tauri.json`
- `outputs/e2e/perf/db-scale-1777493914976-large-tauri.json`
- `outputs/e2e/perf/db-scale-1777493937660-large-tauri.json`

| Metric | Small p50 | Small p95 | Large p50 | Large p95 | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| Scenario wall | 13,589 ms | 13,793 ms | 13,668 ms | 13,710 ms | observational |
| Peak JS heap | 8.54 MB | 8.54 MB | 8.60 MB | 8.62 MB | pass |
| `L-LIB-OPEN` | 1,558 ms | 1,682 ms | 1,551 ms | 1,563 ms | pass |
| Search by name | 1,856 ms | 1,870 ms | 1,875 ms | 1,883 ms | p50 warn |
| Fluid type filter | 1,909 ms | 1,932 ms | 1,945 ms | 1,954 ms | p50 warn |
| Date range filter | 1,455 ms | 1,465 ms | 1,445 ms | 1,458 ms | pass |
| Detail card open | 1,321 ms | 1,329 ms | 1,323 ms | 1,326 ms | pass |

Interpretation:

- Library memory is excellent: 10k-scale heap stays around `8.6 MB`.
- The remaining filter latency is UI/debounce/render dominated, not DB memory.

## Comparison Smoke

Source artifacts:

- `outputs/e2e/perf/comparison-smoke-1777493967162-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777494014978-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777494063692-tauri.json`
- `outputs/e2e/perf/native-memory-1777493962726.jsonl`
- `outputs/e2e/perf/native-memory-1777494010486.jsonl`
- `outputs/e2e/perf/native-memory-1777494059010.jsonl`

| Metric | Current p50 | Current p95 | Status |
| --- | ---: | ---: | --- |
| Total RSS / working set | 669.69 MB | 678.08 MB | pass |
| WebView2 renderer RSS | 266.08 MB | 277.54 MB | fail vs old renderer budget |
| Tauri RSS | 67.18 MB | 67.93 MB | pass |
| Tauri CPU peak | 3.86 s | 4.20 s | observational |
| `L-CMP-3` setup ready | 3,826 ms | 3,865 ms | fail vs aspirational UI budget |

Comparison runner caveats:

- N=3 and N=5 setup are supported by the hardened comparison smoke runner.
- Mocked payload mode is still the default fast e2e path; real PDF/XLSX
  payloads are available through `npm run perf:comparison:tauri:real`.
- For renderer-RSS diagnosis, run
  `COMPARISON_SMOKE_N=3 npm run perf:comparison:tauri:memory`. This opt-in
  mode writes per-phase `memory_steps` into the sidecar, including
  `before_setup`, `after_save_N`, `after_add_N`, `after_pdf`,
  `after_xlsx`, `after_export_gc_hint`, and `after_route_leave`. The
  `after_export_gc_hint` phase runs only in memory-step mode after a
  best-effort renderer cleanup hint plus CDP `HeapProfiler.collectGarbage`;
  use it to separate reclaimable export buffers from true post-export
  retention. This mode intentionally adds measurement overhead and should not
  be mixed into latency p50/p95 claims.
- N=10 is skipped by the runtime comparison cap of 8.

## Runtime Hardening Validation

MEM-6 closed the previous runtime metric gap:

- `runtime::jobs::metrics::tests::process_snapshot_reports_windows_process_metrics`
  proves scheduler RSS/CPU snapshots are non-null on Windows.
- completed terminal jobs are bounded to 100 records;
- terminal jobs older than 60 minutes are pruned;
- active jobs are retained;
- cancel requests emit immediate progress events.

The remaining scheduler item is architectural rather than memory leak related:
gated queued jobs still wait inside `spawn_blocking`. That should be a later
runtime queue refactor, not a blocker for this memory track.

## Final DoD

| Item | Status |
| --- | --- |
| Default saved chart path avoids full raw points | done |
| By-id analysis with artifact cache | done |
| Saved raw table page-by-id | done |
| Typed binary chart pipeline | done |
| Binary window refetch on zoom | done |
| Runtime job retention | done |
| Windows scheduler CPU/RSS sampler | done |
| Repeated workflow p50/p95 | done |
| Repeated DB-scale p50/p95 | done |
| Repeated comparison smoke p50/p95 | done; N=5 and real-payload runner hardened |
| Comparison renderer RSS phase markers | done; opt-in diagnostic runner |

## Release Read

This track is ready for review/merge as a memory-architecture hardening track.
For beta/stable, keep these as follow-up release gates:

- keep running `npm run perf:comparison:tauri` and
  `npm run perf:comparison:tauri:real` during release candidates;
- use `npm run perf:comparison:tauri:memory` when investigating comparison
  renderer RSS; keep it separate from latency scorecards because the direct
  Win32 sampling adds overhead;
- add chart first-paint / pan-zoom latency runner around
  `experiments_series_window`;
- keep total RSS budget soft until WebView2/GPU variability is separated from
  app-controlled heap/state;
- decide whether to implement async gate queues before `spawn_blocking`.
