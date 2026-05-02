# SPRINT-MEM-GPU-1 Scorecard

**Date:** 2026-05-02
**Scenario:** Comparison smoke, N=5, direct Tauri export save mode, 3-run p50.
**Status:** Diagnostic sprint readout, not a product latency gate.

## What Changed

- Added add-to-comparison micro-phases:
  `before_add_N`, selector open/search, click, store update, series ready,
  DOM settle and legacy `after_add_N`.
- Added route ownership counters for teardown diagnosis:
  Comparison page/chart/uPlot/canvas counts and Dashboard chart/uPlot/canvas
  counts.
- Extended the summary script so the new phases and ownership counters appear
  in JSON and markdown readouts.
- Captured a fresh N=5 direct-save latest3 run.

Source sidecars:

- `outputs/e2e/perf/comparison-smoke-1777745356682-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777745667850-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777745975756-tauri.json`

Summary artifact:

- `outputs/e2e/perf/comparison-memory-phase-summary-n5-direct-gpu-instrumented-latest3.json`

## Key P50 Phases

| Phase | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_5_cleanup | 523.26 MB | 129.82 MB | 159.14 MB | 65.90 MB |
| before_add_5 | 527.19 MB | 130.12 MB | 159.54 MB | 68.90 MB |
| after_add_5_selector_search | 526.64 MB | 128.91 MB | 160.07 MB | 68.96 MB |
| after_add_5_click | 620.09 MB | 132.71 MB | 247.01 MB | 68.96 MB |
| after_add_5_store_update | 618.60 MB | 131.74 MB | 246.62 MB | 68.96 MB |
| after_add_5 | 617.54 MB | 131.77 MB | 245.11 MB | 68.90 MB |
| after_chart_canvas_painted | 624.52 MB | 136.18 MB | 247.79 MB | 68.90 MB |
| after_chart_visible | 623.15 MB | 136.19 MB | 247.48 MB | 68.90 MB |
| after_export_gc_hint | 593.32 MB | 122.38 MB | 228.25 MB | 68.42 MB |
| after_route_leave | 598.71 MB | 124.89 MB | 229.37 MB | 69.08 MB |
| after_second_gc_hint | 545.05 MB | 120.37 MB | 180.95 MB | 69.05 MB |

## Key Deltas

| Delta | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_5_cleanup -> after_add_5 | +94.28 MB | +1.95 MB | +85.97 MB | +3.00 MB |
| after_add_5 -> after_chart_canvas_painted | +6.98 MB | +4.41 MB | +2.68 MB | +0.00 MB |
| after_xlsx -> after_export_gc_hint | -11.88 MB | -11.82 MB | -2.14 MB | -0.10 MB |
| after_chart_visible -> after_route_leave | -24.44 MB | -11.30 MB | -18.11 MB | +0.18 MB |

## App-Owned Invariants

| Signal | P50 |
| --- | ---: |
| comparison store raw count | 0 |
| comparison store columnar count | 0 |
| Rust parse cache entries/points | 0 / 0 |
| frontend seriesWindowCache after_add_5 | 303,040 B |
| frontend seriesWindowCache export phases | 606,080 B |
| Rust decoded series cache | 5 entries / 784,418 B |
| JS heap after_add_5 | 15.72 MB |
| JS heap after_export_gc_hint | 11.50 MB |
| chart canvas estimate after_add_5 | 2.29 MB |

## Teardown Ownership

The earlier `uPlot count = 1` after route leave is not a Comparison chart leak
in this run. Ownership counters show:

| Phase | Comparison page | Comparison chart | Comparison uPlot | Dashboard chart | Dashboard uPlot |
| --- | ---: | ---: | ---: | ---: | ---: |
| after_route_leave | 0 | 0 | 0 | 1 | 1 |
| after_chart_unmount_settle | 0 | 0 | 0 | 1 | 1 |
| after_second_gc_hint | 0 | 0 | 0 | 1 | 1 |

So the remaining uPlot/canvas after route leave belongs to the Dashboard route.
Comparison chart DOM ownership is released.

## Decision

GO: keep the new diagnostic instrumentation.

GO: treat chart/GPU add-to-comparison as the primary optimization candidate.
The p50 jump is concentrated at `after_add_5_click`: GPU moves from about
160.07 MB after selector search to 247.01 MB after the fifth add click.

NO-GO: refactor warm-navigation or Comparison store retention. App-owned
Comparison data remains bounded and small.

NO-GO: refactor report/export memory in this sprint. Direct-save export remains
near baseline and recovers around 11.88 MB from `after_xlsx` to
`after_export_gc_hint`.

## Next Candidate

`perf(comparison): request visible chart series metrics`

This should be attempted only as a focused chart path PR. The expected win is
lower renderer/GPU pressure around `after_add_5_click`,
`after_chart_canvas_painted` and `after_chart_visible`, while preserving:

- comparison store raw/columnar counts at 0;
- parse cache entries/points at 0;
- frontend/Rust series caches bounded;
- direct-save export near the current baseline.

Note: `cmp_ready_ms` in this diagnostic run is inflated by many Win32 RSS phase
samples. Use it only to confirm the runner completed, not as a user-facing
latency measurement.

## Visible Metrics Follow-Up

**Date:** 2026-05-02
**Scenario:** Comparison smoke, N=5, direct Tauri export save mode, 3-run p50.
**Change under test:** chart binary series requests now use the visible chart
metrics plus minimal support columns for viscosity-based selection/downsampling
and smart/touch-point shear-rate handling.

Source sidecars:

- `outputs/e2e/perf/comparison-smoke-1777750030719-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777750299113-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777750564015-tauri.json`

Summary artifact:

- `outputs/e2e/perf/comparison-memory-phase-summary-n5-direct-visible-metrics-latest3.json`

### P50 Phase Comparison

| Phase | Baseline Total | Visible Total | Baseline GPU | Visible GPU |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_5_cleanup | 523.26 MB | 488.81 MB | 159.14 MB | 123.28 MB |
| after_add_5_selector_search | 526.64 MB | 509.92 MB | 160.07 MB | 146.40 MB |
| after_add_5_click | 620.09 MB | 591.41 MB | 247.01 MB | 219.48 MB |
| after_add_5 | 617.54 MB | 588.35 MB | 245.11 MB | 218.25 MB |
| after_chart_canvas_painted | 624.52 MB | 596 MB | 247.79 MB | 221.46 MB |
| after_chart_visible | 623.15 MB | 588.86 MB | 247.48 MB | 214.46 MB |
| after_export_gc_hint | 593.32 MB | 577.78 MB | 228.25 MB | 214 MB |

### P50 Deltas

| Delta | Baseline | Visible metrics |
| --- | ---: | ---: |
| selector search -> add_5_click, Total | +93.45 MB | +81.49 MB |
| selector search -> add_5_click, GPU | +86.94 MB | +73.08 MB |
| fixture cleanup -> after_add_5, Total | +94.28 MB | +99.54 MB |
| fixture cleanup -> after_add_5, GPU | +85.97 MB | +94.97 MB |
| after_xlsx -> after_export_gc_hint, Total | -11.88 MB | -10.90 MB |

### App-Owned Comparison

| Signal | Baseline | Visible metrics |
| --- | ---: | ---: |
| comparison store raw/columnar | 0 / 0 | 0 / 0 |
| parse cache entries/points | 0 / 0 | 0 / 0 |
| frontend seriesWindowCache after_add_5 | 303,040 B | 265,160 B |
| frontend seriesWindowCache export phases | 606,080 B | 530,320 B |
| Rust decoded series cache | 5 / 784,418 B | 5 / 784,418 B |
| JS heap after_add_5 | 15.72 MB | 15.03 MB |
| JS heap after_export_gc_hint | 11.50 MB | 11.51 MB |

### Follow-Up Decision

GO: keep the visible-metrics request change. It narrows chart series requests
and reduces frontend series cache bytes without touching WN/store/export
architecture.

NO-GO: claim that this fixes the GPU/RSS issue. The hot moment remains
GPU-dominated: `after_add_5_selector_search -> after_add_5_click` still adds
about 73 MB GPU p50.

Next investigation, if more RAM work is approved, should target uPlot/WebView2
chart creation and canvas texture lifecycle rather than Comparison store or
report/export memory.
