# RC Performance Scorecard

**Date:** 2026-04-29  
**Branch:** `codex/hardening-remove-legacy-comparison-ipc`  
**Scope:** local RC hardening measurement pass after Sprints 1-6 and removal of
the legacy comparison payload IPC.

## Verdict

The refactor did **not** show an app-wide RAM increase in the fresh local
workflow run. The comparable workflow native-memory peak is lower than the
stored local baseline for total working set, while the Rust process working set
is slightly higher by about 1-3 MB. The comparison smoke run has a higher
renderer peak than the workflow run, but it is still inside the p95 memory
budget.

The strongest proven wins are:

- the large comparison IPC exception is gone: `audit:large-ipc` reports zero
  violations and zero suppressions;
- comparison PDF/XLSX render microbenchmarks are well inside their budgets;
- DB-level list/facet projection timings are single-digit milliseconds.

The uncomfortable findings are:

- UI-level library filter/search timings are still around 1.8-1.9 s in the
  Playwright runner, despite DB-level projection queries being 2-3 ms;
- comparison setup UI timing is still not inside the aspirational `L-CMP-*`
  budgets;
- chart first paint, pan/zoom latency, long-task count, and scheduler CPU/RSS
  are still not fully instrumented.

## Memory

Baseline below is the local AlphaBaseline workflow sidecar family
`1777393597912`-`1777393679981` (4 runs). Current is a single fresh RC workflow
run. Treat current as a spot-check, not a statistically stable p50/p95.

| Metric | Local baseline p50 | Local baseline p95 | Current workflow peak | Delta vs baseline p50 | Budget | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Total RSS / working set | 673.82 MB | 747.66 MB | 624.70 MB | -7.3% | <= 700 / <= 750 MB | Pass |
| WebView2 renderer RSS | 200.05 MB | 206.79 MB | 201.81 MB | +0.9% | <= 220 / <= 250 MB | Pass |
| Tauri RSS | 66.45 MB | 67.58 MB | 68.75 MB | +3.5% | <= 500 / <= 540 MB | Pass |
| Tauri CPU peak | 5.73 s | 6.05 s | 5.44 s | -5.1% | <= 7.0 / <= 8.0 s | Pass |

Comparison smoke native-memory spot-check:

| Metric | Current comparison peak | Budget | Status |
| --- | ---: | ---: | --- |
| Total RSS / working set | 677.64 MB | <= 700 / <= 750 MB | Pass |
| WebView2 renderer RSS | 233.57 MB | <= 220 / <= 250 MB | Warn: above p50 budget, under p95 |
| Tauri RSS | 66.05 MB | <= 500 / <= 540 MB | Pass |
| Tauri CPU peak | 2.69 s | n/a | Observational |

Interpretation: there is no evidence of app-wide RAM growth from the current
workflow run. The only memory watch item is comparison renderer RSS, which is
still within p95 but above the p50 target in this one smoke run.

## Workflow

Source: `outputs/e2e/perf/workflow-1777484164118-tauri.json` and
`outputs/e2e/perf/native-memory-1777484159802.jsonl`.

| Metric | Current | Budget | Status |
| --- | ---: | ---: | --- |
| `L-WORKFLOW` total wall | 18,966 ms | <= 22,000 / <= 25,000 ms | Pass |
| Peak JS heap | 9.79 MB | <= 12 / <= 16 MB | Pass |
| Peak DOM nodes | 1,637 | <= 2,400 / <= 3,000 | Pass |
| Comparison 4 loaded step | 3,970 ms | no stable N=4 budget | Observational |
| Single PDF step, Chandler | 1,233 ms | `L-PDF` <= 5,000 / <= 8,000 ms | Pass |
| Single PDF step, Grace | 1,793 ms | `L-PDF` <= 5,000 / <= 8,000 ms | Pass |

## Library And Filters

Sources:

- `outputs/e2e/perf/db-scale-1777485351884-small-tauri.json`
- `outputs/e2e/perf/db-scale-1777485378537-large-tauri.json`

The DB-scale runner was repaired during this pass: collapsed filter groups are
opened before interacting with hidden controls, and date-range inputs now have
stable test IDs. Older failed/partial runs from this pass are intentionally not
used below.

| Metric | Small DB, 12 exp | Large DB, 7,056 exp | Budget | Status |
| --- | ---: | ---: | ---: | --- |
| Total DB-scale scenario wall | 13,534 ms | 13,524 ms | n/a | Observational |
| Peak JS heap | 8.52 MB | 8.58 MB | `M-HEAP-LIB-10K` <= 128 / <= 160 MB | Pass |
| `L-LIB-OPEN` | 1,544 ms | 1,542 ms | <= 2,000 / <= 3,000-3,500 ms | Pass |
| Search by name | 1,858 ms | 1,857 ms | `L-FILTER` <= 1,500 / <= 2,500 ms | Warn: p50 miss, p95 pass |
| Fluid type filter | 1,893 ms | 1,920 ms | `L-FILTER` <= 1,500 / <= 2,500 ms | Warn: p50 miss, p95 pass |
| Date range filter | 1,444 ms | 1,446 ms | `L-FILTER` <= 1,500 / <= 2,500 ms | Pass |
| Detail card open | 1,317 ms | 1,310 ms | `L-EXP-DETAIL` <= 1,800 / <= 3,000 ms | Pass |

DB-level projection check:

```text
SPRINT5_PROJECTION_BENCH n=1000 filter=fieldName:North
legacy_ms=3 projection_ms=3 facet_rebuild_ms=2 facet_rows=8
```

Interpretation: the remaining library/filter latency is not explained by the
SQLite projection query itself. The UI runner includes debounce, IPC, React
render, and fixed waits. The next instrumentation step is to split those spans
instead of tightening DB budgets further.

## Comparison Reports

Sources:

- `outputs/perf/microbench/dbsweep-pdf-rc-scorecard-pdf5-1777485149699.json`
- `outputs/perf/microbench/dbsweep-pdf-rc-scorecard-pdf10-1777485155843.json`
- `outputs/perf/microbench/dbsweep-xlsx-rc-scorecard-xlsx5-1777485160715.json`
- `outputs/perf/microbench/dbsweep-xlsx-rc-scorecard-xlsx10-1777485172896.json`
- `outputs/e2e/perf/comparison-smoke-1777485565262-tauri.json`

Render microbenchmarks:

| Metric | p50 | p95 | Mean bytes | Budget | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| `L-CMP-PDF-5` | 215.9 ms | 241.0 ms | 66,091 | <= 12,000 / <= 20,000 ms | Pass |
| `L-CMP-PDF-10` | 245.8 ms | 280.4 ms | 88,626 | no hard row yet | Pass |
| `L-CMP-XLSX-5` | 2,292.8 ms | 2,298.6 ms | 9,034,076 | <= 5,000 / <= 8,000 ms | Pass |
| `L-CMP-XLSX-10` | 2,665.1 ms | 2,819.7 ms | 10,118,570 | no hard row yet | Pass |

Comparison UI smoke:

| Metric | Current | Budget | Status |
| --- | ---: | ---: | --- |
| `L-CMP-3` setup UI ready | 4,315 ms | <= 600 / <= 1,000 ms | Fail |
| `L-CMP-5` setup UI ready | not captured | <= 1,000 / <= 1,800 ms | Blocked by runner state after N=3 |
| `L-CMP-10` setup UI ready | skipped | <= 2,500 / <= 4,000 ms | Runtime cap was 8 |

The e2e export download timings from `comparison-smoke` are not used for PDF or
XLSX render budgets because the e2e environment returned tiny 8-byte/4-byte
debug payloads. The release-shaped Rust microbenchmarks above are the trusted
report-render numbers for this scorecard.

## AnalysisArtifact Cache

Source: `outputs/perf/microbench/analysis-artifact-cache-20260429T175829.011026800+0000.json`.

| Format | Cold mean | Warm mean | Delta | Warm hits | Artifact bytes | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| PDF | 2,352.8 ms | 2,338.0 ms | -0.6% | 15 | 15,664 | Functional, no material full-render win |
| XLSX | 10,137.8 ms | 10,139.5 ms | +0.0% | 15 | 15,653 | Functional, no material full-render win |

Interpretation: cache correctness is proven for comparison by-IDs, but the full
PDF/XLSX report path remains render-dominated.

## Binary Series IPC

Sprint 6's binary chart series path is implemented, but this scorecard does not
claim a measured chart first-paint or pan/zoom win yet.

Known payload shape for a typical overview request:

```text
maxPoints=1500, columns=7
align8(20 + 7 * 8) + 1500 * 7 * 8 = 84,080 bytes
```

Status:

- `experiments_series_meta`, `experiments_series_overview`, and
  `experiments_series_window` exist;
- dashboard can use binary overview for DB-loaded charts;
- full detail-open still loads `rawPoints` through `experiments_get`;
- chart first paint, long tasks, JS heap delta, and pan/zoom window refetch are
  still follow-up metrics.

## Large IPC

Current hardening result:

```text
npm run audit:large-ipc
OK - no large-IPC contract violations.
```

Status: pass. The historical comparison payload suppression and
`LARGE-IPC-EXCEPTION` marker are removed.

## Measurement Gaps

These rows remain not release-grade:

| Area | Gap | Required next step |
| --- | --- | --- |
| Cold start | `L-COLDSTART` still TBD | Add launch-to-first-usable runner |
| Long tasks | count and longest task still TBD | Add PerformanceObserver long-task collection |
| Chart | first paint, pan/zoom latency, heap delta not measured | Add chart Playwright runner around binary overview/window |
| Detail open | default detail still loads `rawPoints` | Add by-id detail meta, by-id analysis, paged raw table |
| Scheduler | job CPU/RSS fields remain nullable | Add loader-safe process sampler |
| Comparison UI N=5/N=10 | e2e smoke did not capture stable setup timings | Fix runner state/reset and unlock cap >= 10 |

## Bottom Line

The refactor achieved the architectural goals and removed the risky large IPC
path. Current local evidence does **not** support the claim that overall RAM
usage grew. The remaining performance debt is concentrated in UI-level
filter/search latency, comparison setup latency, detail-open rawPoints removal,
and missing chart/long-task/job-resource instrumentation.
