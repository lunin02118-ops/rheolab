# SPRINT-MEM-GPU-2 Scorecard

**Date:** 2026-05-03
**Scenario:** Comparison smoke, N=5, direct Tauri export save mode, 3-run p50.
**Status:** Diagnostic lifecycle attribution, not a product latency gate.

## What Changed

- Added label-gated uPlot lifecycle diagnostics for perf smoke runs:
  create, destroy, setData, setSize, redraw, first-paint and active instance
  counters.
- Labeled the Comparison chart as `diagnosticsLabel="comparison"`.
- Split the fifth add path into click, React/store, uPlot init, setData,
  first canvas paint and compositor-settle markers.
- Extended the comparison memory summary with the lifecycle counters and
  focused deltas for click -> uPlot init -> first paint -> settle.

The lifecycle global is bounded and read-only: it stores counters plus up to
300 lifecycle events, and it is created only for charts with an explicit
diagnostics label.

Source sidecars:

- `outputs/e2e/perf/comparison-smoke-1777755253910-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777755597254-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777755966787-tauri.json`

Summary artifact:

- `outputs/e2e/perf/comparison-memory-phase-summary-n5-direct-chart-lifecycle-latest3.json`

## Key P50 Phases

| Phase | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_add_5_selector_search | 516.83 MB | 125.68 MB | 151.85 MB | 66.88 MB |
| after_add_5_click | 604.32 MB | 128.05 MB | 236.75 MB | 66.88 MB |
| after_add_5_click_before_chart_commit | 602.28 MB | 127.78 MB | 235.85 MB | 66.88 MB |
| after_add_5_react_commit | 602.68 MB | 127.79 MB | 235.85 MB | 66.88 MB |
| after_add_5_store_update | 602.32 MB | 127.82 MB | 235.61 MB | 66.88 MB |
| after_add_5_uplot_init | 602.44 MB | 127.91 MB | 235.61 MB | 66.88 MB |
| after_add_5_uplot_set_data | 602.29 MB | 127.95 MB | 235.61 MB | 66.82 MB |
| after_add_5_first_canvas_paint | 602.41 MB | 128.00 MB | 235.61 MB | 66.82 MB |
| after_add_5_compositor_settle_500ms | 602.88 MB | 128.12 MB | 235.65 MB | 66.82 MB |
| after_add_5 | 603.25 MB | 128.21 MB | 235.65 MB | 66.82 MB |
| after_chart_canvas_painted | 610.18 MB | 132.80 MB | 238.54 MB | 66.82 MB |
| after_chart_visible | 610.28 MB | 132.85 MB | 238.53 MB | 66.82 MB |
| after_export_gc_hint | 595.29 MB | 121.26 MB | 235.68 MB | 69.22 MB |
| after_route_leave | 603.22 MB | 125.67 MB | 237.98 MB | 69.23 MB |
| after_second_gc_hint | 549.15 MB | 120.00 MB | 187.31 MB | 69.19 MB |

## Key Deltas

| Delta | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| selector search -> add_5_click | +87.49 MB | +2.37 MB | +84.90 MB | +0.00 MB |
| add_5_click -> uPlot init | -1.88 MB | -0.14 MB | -1.14 MB | +0.00 MB |
| uPlot init -> first canvas paint | -0.03 MB | +0.09 MB | +0.00 MB | -0.06 MB |
| first canvas paint -> compositor settle 500ms | +0.47 MB | +0.12 MB | +0.04 MB | +0.00 MB |
| after_add_5 -> after_chart_canvas_painted | +6.93 MB | +4.59 MB | +2.89 MB | +0.00 MB |
| after_xlsx -> after_export_gc_hint | -18.50 MB | -14.99 MB | -1.56 MB | -0.10 MB |

## Lifecycle Evidence

| Phase | Cmp canvas | Cmp uPlot DOM | Active lifecycle | Max active | Creates | Destroys | setData | setSize | First paints |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| after_add_5_selector_search | 1 | 1 | 1 | 1 | 4 | 3 | 4 | 6 | 4 |
| after_add_5_click | 1 | 1 | 1 | 1 | 4 | 3 | 4 | 7 | 4 |
| after_add_5_click_before_chart_commit | 1 | 1 | 1 | 1 | 5 | 4 | 5 | 8 | 5 |
| after_add_5_first_canvas_paint | 1 | 1 | 1 | 1 | 5 | 4 | 5 | 8 | 5 |
| after_route_leave | 0 | 0 | 0 | 1 | 6 | 6 | 6 | 11 | 6 |
| after_second_gc_hint | 0 | 0 | 0 | 1 | 6 | 6 | 6 | 11 | 6 |

Readout:

- There is no destroy/create overlap in the measured Comparison chart path.
  `maxActiveInstances` stays at 1.
- The Comparison chart does recreate once per added line, but the main p50 GPU
  jump is already present at `after_add_5_click`, before the fifth create/end
  and setData counters appear in the snapshot.
- `after_add_5_click` adds one setSize pair on the existing chart. The native
  GPU RSS jump is therefore closer to click-triggered layout/compositor work
  than to retained frontend series data.
- Route leave remains clean for Comparison ownership: active lifecycle, DOM
  uPlot and Comparison canvas counts are all 0 after leave.

## App-Owned Invariants

| Signal | P50 |
| --- | ---: |
| comparison store raw/columnar | 0 / 0 |
| parse cache entries/points | 0 / 0 |
| frontend seriesWindowCache after_add_5 | 265,160 B |
| frontend seriesWindowCache export phases | 530,320 B |
| Rust decoded series cache | 5 entries / 784,418 B |
| JS heap after_add_5_click | 14.28 MB |
| JS heap after_export_gc_hint | 11.56 MB |
| Comparison canvas estimate after_add_5 | 2.29 MB |

## Decision

GO: keep this diagnostic instrumentation. It is bounded, label-gated and
answers the specific lifecycle question.

GO: classify the remaining hot moment as chart/GPU click/layout/compositor
attribution, not warm-navigation, store retention or report export.

NO-GO: claim that visible metrics fully fixed the memory issue. The latest3
lifecycle run still shows `selector search -> add_5_click` at about +84.90 MB
GPU p50.

NO-GO: do a blind uPlot teardown fix. The Comparison chart has no active
instance overlap and releases ownership after route leave.

NO-GO: refactor report/export in this sprint. Direct-save export still recovers
after `after_xlsx`, and app-owned export buffers remain bounded.

## Next Candidate

Do not start with another store/cache refactor. The next useful experiment is a
small chart-layout candidate:

`perf(comparison): avoid fifth-add chart resize/recreate burst`

Possible tactics to test behind one narrow PR:

- keep the chart container size stable while the selector closes and the fifth
  line commits;
- update the existing uPlot instance in place only when axis topology allows it;
- batch selector close + line commit + chart paint into one measured render;
- if those do not reduce the click delta, document the remaining RSS as
  WebView2/GPU soft RSS with bounded app-owned memory.

Success should be measured against:

- `after_add_5_selector_search -> after_add_5_click` GPU p50;
- `maxActiveInstances <= 1`;
- Comparison ownership after route leave = 0;
- comparison store raw/columnar = 0 / 0;
- parse cache entries/points = 0 / 0;
- direct-save export remains near the current baseline.
