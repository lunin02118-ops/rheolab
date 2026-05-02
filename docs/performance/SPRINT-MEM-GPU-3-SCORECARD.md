# SPRINT-MEM-GPU-3 Scorecard

**Date:** 2026-05-03
**Scenario:** Comparison smoke, N=5, direct Tauri export save mode, 3-run p50.
**Status:** Narrow chart layout stabilization readout, not a product latency gate.

## What Changed

- Added Comparison layout geometry diagnostics to the perf sidecar:
  device pixel ratio, header/chips/chart shell/chart/canvas sizes and rect
  change counters.
- Added `ComparisonPageHeader` as a stable test target for geometry snapshots.
- Stabilized the selected-experiment chip row so the fifth add does not wrap
  chips and resize the chart surface during the click boundary.
- Regenerated the N=5 direct-save comparison memory phase readout.

Source sidecars:

- `outputs/e2e/perf/comparison-smoke-1777758036879-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777758412556-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777758746067-tauri.json`

Summary artifact:

- `outputs/e2e/perf/comparison-memory-phase-summary-n5-direct-chart-layout-latest3.json`

## Why This Candidate

SPRINT-MEM-GPU-2 showed that the remaining hot moment was:

`after_add_5_selector_search -> after_add_5_click`

The jump happened before the fifth uPlot init, before setData, before first
canvas paint and without destroy/create overlap. That made the click/layout
boundary the next candidate, not warm navigation, store retention or report
export.

## Pre-Fix Exploratory Geometry

Exploratory sidecar:

- `outputs/e2e/perf/comparison-smoke-1777757496906-tauri.json`

| Phase | Total RSS | GPU RSS | Chips H | Chart Shell H | Chart H | Canvas Backing H | Size Count |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| after_add_5_selector_search | 524.88 MB | 161.28 MB | 30 px | 572 px | 458 px | 458 px | 6 |
| after_add_5_click | 614.19 MB | 245.83 MB | 64 px | 562 px | 448 px | 448 px | 7 |
| after_add_5_click_before_chart_commit | 611.67 MB | 245.33 MB | 64 px | 562 px | 448 px | 448 px | 8 |

Pre-fix readout:

- The fifth chip wrapped the selected-experiment row from 30 px to 64 px.
- The chart shell height dropped from 572 px to 562 px.
- The chart and canvas backing height dropped from 458 px to 448 px.
- uPlot `setSize` incremented at the same boundary.
- The same boundary carried an exploratory GPU jump of about +84.55 MB.

## Post-Fix Key P50 Phases

| Phase | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_add_5_selector_search | 492.26 MB | 129.10 MB | 125.01 MB | 67.43 MB |
| after_add_5_click | 556.02 MB | 130.82 MB | 186.07 MB | 67.48 MB |
| after_add_5_click_before_chart_commit | 553.55 MB | 130.51 MB | 185.12 MB | 67.48 MB |
| after_add_5_uplot_init | 553.39 MB | 130.67 MB | 184.81 MB | 67.48 MB |
| after_add_5_first_canvas_paint | 553.33 MB | 130.67 MB | 184.81 MB | 67.46 MB |
| after_add_5_compositor_settle_500ms | 553.24 MB | 130.67 MB | 184.81 MB | 67.45 MB |
| after_add_5 | 553.24 MB | 130.67 MB | 184.81 MB | 67.45 MB |
| after_chart_canvas_painted | 563.14 MB | 135.13 MB | 190.14 MB | 67.45 MB |
| after_chart_visible | 563.04 MB | 135.13 MB | 190.14 MB | 67.45 MB |
| after_export_gc_hint | 551.99 MB | 122.77 MB | 188.05 MB | 69.57 MB |
| after_route_leave | 557.01 MB | 126.16 MB | 189.09 MB | 69.57 MB |
| after_second_gc_hint | 551.72 MB | 121.97 MB | 188.58 MB | 69.54 MB |

## Post-Fix Key Deltas

| Delta | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| selector search -> add_5_click | +63.76 MB | +1.72 MB | +61.06 MB | +0.05 MB |
| add_5_click -> uPlot init | -2.63 MB | -0.15 MB | -1.26 MB | 0 MB |
| uPlot init -> first canvas paint | -0.06 MB | 0 MB | 0 MB | -0.02 MB |
| first canvas paint -> compositor settle 500ms | -0.09 MB | 0 MB | 0 MB | -0.01 MB |
| after_add_5 -> after_chart_canvas_painted | +9.90 MB | +4.46 MB | +5.33 MB | 0 MB |
| after_xlsx - after_export_gc_hint | 16.66 MB | 15.26 MB | 1.16 MB | 0.11 MB |

Compared with SPRINT-MEM-GPU-2 baseline:

| Delta | SPRINT-MEM-GPU-2 | SPRINT-MEM-GPU-3 |
| --- | ---: | ---: |
| selector search -> add_5_click, Total | +87.49 MB | +63.76 MB |
| selector search -> add_5_click, GPU | +84.90 MB | +61.06 MB |

This is a p50 improvement of about 23.73 MB Total RSS and 23.84 MB GPU RSS.

## Post-Fix Geometry Evidence

| Phase | Header H | Chips H | Chart Shell | Chart | Canvas Backing | Chips Changes | Shell Changes | Chart Changes | Canvas Changes | Size Count |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| after_add_5_selector_search | 55 px | 38 px | 1264 x 572 | 1254 x 458 | 1254 x 458 | 1 | 0 | 1 | 0 | 6 |
| after_add_5_click | 55 px | 38 px | 1264 x 572 | 1254 x 458 | 1254 x 458 | 1 | 0 | 1 | 0 | 6 |
| after_add_5_click_before_chart_commit | 55 px | 38 px | 1264 x 572 | 1254 x 458 | 1254 x 458 | 1 | 0 | 1 | 0 | 7 |

Readout:

- The fifth click no longer changes chip height.
- The chart shell, chart rect and canvas backing size remain stable at the hot
  click boundary.
- uPlot no longer receives the pre-commit resize that accompanied the chip
  wrap.
- The remaining p50 GPU jump is therefore no longer explained by chart surface
  resize from chip wrapping.

## Lifecycle And Ownership

| Phase | Cmp Canvas | Cmp uPlot DOM | Active | Max Active | Creates | Destroys | setData | setSize | First Paints |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| after_add_5_selector_search | 1 | 1 | 1 | 1 | 4 | 3 | 4 | 6 | 4 |
| after_add_5_click | 1 | 1 | 1 | 1 | 4 | 3 | 4 | 6 | 4 |
| after_add_5_click_before_chart_commit | 1 | 1 | 1 | 1 | 5 | 4 | 5 | 7 | 5 |
| after_route_leave | 0 | 0 | 0 | 1 | 6 | 6 | 6 | 10 | 6 |
| after_second_gc_hint | 0 | 0 | 0 | 1 | 6 | 6 | 6 | 10 | 6 |

There is still no destroy/create overlap. Comparison ownership after route
leave remains clean.

## App-Owned Invariants

| Signal | P50 |
| --- | ---: |
| comparison store raw/columnar | 0 / 0 |
| parse cache entries/points | 0 / 0 |
| frontend seriesWindowCache after_add_5 | 265,160 B |
| frontend seriesWindowCache export phases | 530,320 B |
| Rust decoded series cache | 5 entries / 784,418 B |
| JS heap after_add_5_click | 14.29 MB |
| JS heap after_export_gc_hint | 11.56 MB |
| Comparison canvas estimate after_add_5 | 2.34 MB |

## Decision

GO: keep the layout stabilization. It removes an app-controlled fifth-chip wrap,
keeps chart geometry stable at the hot boundary and lowers the measured
selector-search-to-click GPU delta by about 23.84 MB p50.

GO: keep the geometry diagnostics. They are sidecar-only measurements and
explain why this PR helped.

NO-GO: claim that chart/GPU RSS is fully fixed. The remaining p50 click delta
is still about +61.06 MB GPU RSS.

NO-GO: return to warm-navigation, Comparison store, parse cache or report/export
refactors for this issue. The app-owned invariants remain bounded and small.

## Next Candidate

The next useful question is whether the remaining +61.06 MB GPU p50 is caused
by selector/popover close and WebView2 compositor allocation, or whether chart
creation can be made cheaper without changing user-visible behavior.

Recommended next PR shape:

`perf(comparison): classify remaining add-click compositor burst`

Candidate tactics:

- split selector close from line commit behind measured RAF markers;
- verify whether popover teardown alone moves GPU RSS;
- test chart commit deferral for the add path only;
- if the delta stays with clean ownership and stable geometry, classify the
  remainder as WebView2/GPU soft RSS and stop chasing Total RSS as the primary
  KPI.
