# Comparison GPU/RSS Closeout

**Date:** 2026-05-03
**Status:** accepted closeout for the Comparison N=5 GPU/RSS attribution track.
**Latest evidence commit:** `208a74d` (`perf(memory): classify comparison add-click compositor burst`).

## Decision

GO: keep the SPRINT-MEM-GPU-4 diagnostic instrumentation and readouts.

NO-GO: do another immediate memory refactor for the fifth-add GPU/RSS burst.

The remaining fifth-add RSS/GPU movement is classified as chart commit /
WebView2 GPU compositor allocation. It is not selector close, warm navigation,
Comparison store retention, parse cache, report/export retention, Rust decoded
series cache retention, visible-metrics loading, or uPlot teardown ownership.

## Evidence Chain

- `docs/performance/COMPARISON-RSS-ATTRIBUTION-DECISION.md`
- `docs/performance/SPRINT-MEM-GPU-1-SCORECARD.md`
- `docs/performance/SPRINT-MEM-GPU-2-SCORECARD.md`
- `docs/performance/SPRINT-MEM-GPU-3-SCORECARD.md`
- `docs/performance/SPRINT-MEM-GPU-4-SCORECARD.md`
- `docs/performance/COMPARISON-MEMORY-PHASE-READOUT-selector-close-only.md`
- `docs/performance/COMPARISON-MEMORY-PHASE-READOUT-commit-without-close.md`
- `docs/performance/COMPARISON-MEMORY-PHASE-READOUT-defer-chart-commit.md`

The final SPRINT-MEM-GPU-4 classifier split the remaining fifth-add boundary
into selector close, selection/store commit, and delayed chart commit.

| Experiment | Delta | Total RSS | GPU RSS | Readout |
| --- | --- | ---: | ---: | --- |
| selector-close-only | before close -> close click | -12.91 MB | -12.15 MB | Selector close alone does not create the positive burst. |
| commit-without-close | before commit -> commit | +65.03 MB | +60.46 MB | The burst appears while the selector remains open. |
| defer-chart-commit | selector search -> click | +0.26 MB | +0.24 MB | Selection/chip update is flat without chart commit. |
| defer-chart-commit | before chart commit -> chart commit | +86.93 MB | +85.45 MB | The burst follows chart commit. |

## App-Owned Invariants

The measured N=5 direct-save workflows keep app-owned Comparison memory bounded:

| Signal | Accepted Guard |
| --- | ---: |
| Comparison store raw/columnar after add | 0 / 0 |
| Rust parse cache entries after add | 0 |
| Frontend seriesWindowCache after add | 265,160 B in the closeout run |
| Rust decoded series cache after add | 784,418 B in the closeout run |
| JS heap after second GC | about 11.2 MB |
| Comparison uPlot/canvas after route leave | 0 / 0 |
| Direct-save export recovery | near existing baseline |

These are the guardrails for future chart work. They are more meaningful than a
hard Total RSS target for this specific path because WebView2, GPU, and runtime
allocators can retain or move memory outside app-owned state.

## Release Claim

Use this wording:

```text
Comparison app-owned memory remains bounded in the measured N=5 workflow. The renderer does not retain raw/full-columnar Comparison payloads, parse cache is clear, frontend/Rust series caches stay small, and route leave releases Comparison chart ownership. The remaining fifth-add RSS movement is concentrated in WebView2/GPU compositor allocation at chart commit, so Total RSS/GPU RSS remain tracked as soft runtime metrics rather than hard release claims.
```

Avoid this wording:

```text
Total RSS is fixed.
GPU memory is fixed.
The fifth-add burst is gone.
Selector close caused the remaining burst.
Deferring chart commit is a memory optimization.
Warm-navigation was the source of the current RSS issue.
Report/export was the source of the current RSS issue.
```

## Guard For Future Chart Changes

For future PRs touching Comparison chart layout, uPlot lifecycle, series
loading, selector/chip layout, or report-tab interaction, run at least one
direct-save diagnostic smoke:

```powershell
$env:COMPARISON_SMOKE_MEMORY_STEPS='1'
$env:COMPARISON_SMOKE_N='5'
$env:COMPARISON_SMOKE_EXPORT_SAVE_MODE='direct'
npm run perf:comparison:tauri
```

For memory-sensitive chart changes, run it three times and summarize latest3:

```powershell
node scripts\test\summarize-comparison-memory-phases.mjs --n 5 --latest 3 --export-save-mode direct --only-ok --json outputs\e2e\perf\comparison-memory-phase-summary-n5-direct-latest3.json --write-md
```

## No-Go Zones For This Issue

Do not start another immediate RAM refactor for:

- warm navigation;
- Comparison store retention;
- parse cache;
- report/export;
- Rust decoded series cache;
- visible metrics;
- uPlot teardown;
- selector close;
- deferred chart commit as a product memory optimization.

A new memory PR is justified only if there is user-visible memory pressure or a
fresh measurement points to app-owned growth.

## Next Work

Move to non-memory release hardening. The recommended next audit target is:

```text
security(tauri): narrow filesystem scope and remove $HOME/** if still present
```

Keep that security work separate from this memory closeout.
