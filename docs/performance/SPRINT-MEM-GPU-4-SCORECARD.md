# SPRINT-MEM-GPU-4 Scorecard

**Date:** 2026-05-03
**Scenario:** Comparison smoke, N=5, direct Tauri export save mode, 3-run p50 per experiment.
**Status:** Diagnostic classification of the remaining fifth-add GPU/RSS burst.

## What Changed

- Added `COMPARISON_SMOKE_ADD5_EXPERIMENT` to the Tauri comparison smoke runner.
- Supported add-5 diagnostic modes:
  `baseline`, `selector-close-only`, `commit-without-close`, and
  `defer-chart-commit`.
- Added focused add-5 markers for selector close, store/selection commit and
  delayed chart commit.
- Added `--add5-experiment` filtering and add-5 deltas to
  `scripts/test/summarize-comparison-memory-phases.mjs`.
- Added a test-only chart commit delay hook. It is inert unless the perf runner
  sets `window.__rheolab_comparison_chart_commit_delay_ms`.

This PR intentionally does not touch warm navigation, Comparison store
retention, parse cache, report/export, Rust series cache, visible metrics or
uPlot teardown behavior.

## Input Baseline

SPRINT-MEM-GPU-3 left one remaining hot p50 delta:

| Delta | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| selector search -> add_5_click | +63.76 MB | +1.72 MB | +61.06 MB | +0.05 MB |

The chart geometry was already stable at that boundary, and app-owned state was
bounded. SPRINT-MEM-GPU-4 was therefore scoped to classify the remaining burst:
selector close, selection/chip commit or chart/WebView2 compositor commit.

## Commands

Each experiment was run with:

```powershell
$env:COMPARISON_SMOKE_MEMORY_STEPS='1'
$env:COMPARISON_SMOKE_N='5'
$env:COMPARISON_SMOKE_EXPORT_SAVE_MODE='direct'
$env:COMPARISON_SMOKE_ADD5_EXPERIMENT='<mode>'
npm run perf:comparison:tauri
```

For `defer-chart-commit`, the perf run also used:

```powershell
$env:COMPARISON_SMOKE_CHART_COMMIT_DELAY_MS='20000'
```

The delay is diagnostic-only. It keeps RSS snapshots before
`before_add_5_chart_commit` from racing the delayed chart update and must not be
read as a latency budget.

## Source Artifacts

Selector close only:

- `outputs/e2e/perf/comparison-smoke-1777792498032-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777792860390-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777793212630-tauri.json`
- `outputs/e2e/perf/comparison-memory-phase-summary-n5-direct-selector-close-only-latest3.json`
- `docs/performance/COMPARISON-MEMORY-PHASE-READOUT-selector-close-only.md`

Commit without selector close:

- `outputs/e2e/perf/comparison-smoke-1777793623682-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777793861242-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777794086018-tauri.json`
- `outputs/e2e/perf/comparison-memory-phase-summary-n5-direct-commit-without-close-latest3.json`
- `docs/performance/COMPARISON-MEMORY-PHASE-READOUT-commit-without-close.md`

Deferred chart commit:

- `outputs/e2e/perf/comparison-smoke-1777792129283-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777794317177-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777794559766-tauri.json`
- `outputs/e2e/perf/comparison-memory-phase-summary-n5-direct-defer-chart-commit-latest3.json`
- `docs/performance/COMPARISON-MEMORY-PHASE-READOUT-defer-chart-commit.md`

## P50 Experiment Deltas

| Experiment | Delta | Total RSS | Renderer RSS | GPU RSS | Tauri RSS | Readout |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| selector-close-only | before close -> close click | -12.91 MB | +0.04 MB | -12.15 MB | 0 MB | Selector close alone does not explain the positive burst. |
| selector-close-only | selector search -> normal add_5 click | +80.22 MB | +3.50 MB | +79.24 MB | +0.10 MB | Normal add still jumps after close-only probe. |
| commit-without-close | before commit -> commit | +65.03 MB | +3.05 MB | +60.46 MB | +0.02 MB | Burst appears even while the selector remains open. |
| commit-without-close | commit -> chart commit marker | -13.56 MB | -1.83 MB | -10.46 MB | +0.01 MB | Store commit already crossed the chart/compositor boundary. |
| defer-chart-commit | selector search -> click | +0.26 MB | +0.05 MB | +0.24 MB | 0 MB | Selection/chip update without chart commit is flat. |
| defer-chart-commit | before chart commit -> chart commit | +86.93 MB | +1.02 MB | +85.45 MB | -0.02 MB | The remaining burst follows chart commit. |

## Key P50 Phases

| Experiment | Phase | Total RSS | Renderer RSS | GPU RSS | JS Heap | Series Cache | Rust Series Cache |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| selector-close-only | after_add_5_selector_search | 508.63 MB | 127.34 MB | 142.44 MB | 14.13 MB | 210,504 B | 674,960 B |
| selector-close-only | after_add_5_click | 588.85 MB | 130.84 MB | 221.68 MB | 13.80 MB | 210,504 B | 784,418 B |
| selector-close-only | after_add_5 | 573.46 MB | 131.47 MB | 207.14 MB | 14.98 MB | 265,160 B | 784,418 B |
| commit-without-close | before_add_5_commit_without_close | 519.56 MB | 126.93 MB | 152.95 MB | 14.63 MB | 210,504 B | 674,960 B |
| commit-without-close | after_add_5_commit_without_close_click | 584.59 MB | 129.98 MB | 213.41 MB | 14.14 MB | 210,504 B | 784,418 B |
| commit-without-close | after_add_5 | 571.04 MB | 128.35 MB | 202.88 MB | 15.66 MB | 265,160 B | 784,418 B |
| defer-chart-commit | after_add_5_selector_search | 518.52 MB | 128.64 MB | 152.19 MB | 14.04 MB | 210,504 B | 674,960 B |
| defer-chart-commit | after_add_5_click | 518.78 MB | 128.69 MB | 152.43 MB | 14.31 MB | 210,504 B | 674,960 B |
| defer-chart-commit | before_add_5_chart_commit | 518.39 MB | 128.37 MB | 152.30 MB | 14.62 MB | 210,504 B | 674,960 B |
| defer-chart-commit | after_add_5_chart_commit | 605.32 MB | 129.39 MB | 237.75 MB | 15.01 MB | 265,160 B | 784,418 B |
| defer-chart-commit | after_add_5 | 594.88 MB | 129.93 MB | 227.41 MB | 15.26 MB | 265,160 B | 784,418 B |

## App-Owned Invariants

| Signal | Selector Close Only | Commit Without Close | Defer Chart Commit |
| --- | ---: | ---: | ---: |
| comparison store raw/columnar after_add_5 | 0 / 0 | 0 / 0 | 0 / 0 |
| parse cache entries after_add_5 | 0 | 0 | 0 |
| frontend seriesWindowCache after_add_5 | 265,160 B | 265,160 B | 265,160 B |
| Rust decoded series cache after_add_5 | 784,418 B | 784,418 B | 784,418 B |
| JS heap after_add_5 | 14.98 MB | 15.66 MB | 15.26 MB |
| JS heap after_second_gc_hint | 11.21 MB | 11.24 MB | 11.26 MB |
| Comparison uPlot/canvas after route leave | 0 / 0 | 0 / 0 | 0 / 0 |
| Comparison lifecycle active after route leave | 0 | 0 | 0 |

Direct-save export remains near the existing baseline. The measured
`after_xlsx - after_export_gc_hint` p50 deltas were 11.42 MB, 14.09 MB and
14.64 MB across the three experiment groups.

## Decision

GO: keep the SPRINT-MEM-GPU-4 diagnostic instrumentation. It cleanly separates
selector close, selection/store commit and delayed chart commit.

GO: classify the remaining fifth-add burst as chart commit / WebView2 GPU
compositor allocation, not selector close and not retained app-owned data.

NO-GO: optimize selector/popover close for this RSS issue. Closing the selector
alone produced no positive GPU jump in the measured runs.

NO-GO: claim that deferring chart commit fixes memory. It moves the burst from
the click marker to the chart commit marker; it does not eliminate the
eventual chart/GPU allocation.

NO-GO: return to warm-navigation, Comparison store, parse cache, report/export
or Rust series cache refactors for this issue. The app-owned invariants remain
bounded and small.

## Release Claim Boundary

The honest claim is:

> Comparison app-owned memory remains bounded. The remaining fifth-add RSS
> movement is concentrated in chart commit / WebView2 GPU compositor
> allocation, not retained scientific payload, not selector close and not
> report/export buffers.

Do not claim:

- Total RSS fixed.
- GPU memory fixed.
- Selector close was the source of the remaining burst.
- Deferring chart commit is a memory optimization.

## Next Step

No immediate memory refactor is justified by this scorecard. The next decision
should be policy unless there is user-visible pressure:

- Track app-owned memory, repeated-run stability and route-leave ownership.
- Treat Total RSS/GPU RSS as soft WebView2/runtime metrics.
- Keep direct-save N=5 latest3 as the guard for future chart changes.
