# SPRINT-MEM-GPU-1 Baseline

**Date:** 2026-05-02
**Baseline commit:** aaca641 (`docs(perf): record comparison rss latest3 attribution`)
**Runtime diagnostic commit:** f29f96b (`perf(memory): attribute comparison save and series cache phases`)
**Scenario:** Comparison smoke, N=5, direct Tauri export save mode, 3-run p50.

This baseline freezes the starting point for the chart/GPU lifecycle sprint. It
does not change the release claim: app-owned Comparison memory is bounded, while
Total RSS remains a soft metric affected by WebView2, GPU, allocator and runtime
retention.

## Commands

```powershell
$env:COMPARISON_SMOKE_MEMORY_STEPS='1'
$env:COMPARISON_SMOKE_N='5'
$env:COMPARISON_SMOKE_EXPORT_SAVE_MODE='direct'
npm run perf:comparison:tauri
```

Repeated 3 times, then summarized with:

```powershell
node scripts\test\summarize-comparison-memory-phases.mjs --n 5 --latest 3 --export-save-mode direct --only-ok --json outputs\e2e\perf\comparison-memory-phase-summary-n5-direct-instrumented-latest3.json
```

Source sidecars:

- `outputs/e2e/perf/comparison-smoke-1777741845183-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777742916586-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777743134402-tauri.json`

## Key P50 Phases

| Phase | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_5_cleanup | 511.11 MB | 130.46 MB | 148.42 MB | 65.66 MB |
| after_add_5 | 605.22 MB | 135.40 MB | 229.75 MB | 67.96 MB |
| after_chart_canvas_painted | 611.02 MB | 138.15 MB | 234.17 MB | 67.96 MB |
| after_chart_visible | 608.83 MB | 137.56 MB | 232.75 MB | 67.96 MB |
| after_report_tab_open | 616.80 MB | 140.45 MB | 234.64 MB | 68.42 MB |
| after_export_gc_hint | 590.77 MB | 124.27 MB | 226.67 MB | 68.91 MB |
| after_route_leave | 594.54 MB | 127.09 MB | 227.10 MB | 69.65 MB |
| after_chart_unmount_settle | 590.43 MB | 125.45 MB | 224.57 MB | 69.65 MB |
| after_second_gc_hint | 521.35 MB | 121.65 MB | 159.29 MB | 69.65 MB |

## Baseline Deltas

| Delta | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_5_cleanup -> after_add_5 | +94.11 MB | +4.94 MB | +81.33 MB | +2.30 MB |
| after_add_5 -> after_chart_canvas_painted | +5.80 MB | +2.75 MB | +4.42 MB | +0.00 MB |
| after_xlsx -> after_export_gc_hint | -17.17 MB | -13.74 MB | -2.72 MB | -0.10 MB |
| after_chart_visible -> after_route_leave | -14.29 MB | -10.47 MB | -5.65 MB | +1.69 MB |

## App-Owned Invariants

| Signal | Baseline |
| --- | ---: |
| comparison store raw count | 0 |
| comparison store columnar count | 0 |
| Rust parse cache entries/points | 0 / 0 |
| frontend seriesWindowCache after_add_5 | 303,040 B |
| frontend seriesWindowCache report/export phases | 606,080 B |
| Rust decoded series cache | 5 entries / 784,418 B |
| chart canvas estimate after_chart_visible | 2,400,384 B |
| JS heap after_export_gc_hint | 11.50 MB |
| JS heap after_second_gc_hint | 11.16 MB |

## Sprint Decision

Candidate #1 is chart/GPU add-to-comparison lifecycle:

- `after_fixture_5_cleanup -> after_add_5` is +94.11 MB total RSS;
- GPU accounts for about +81.33 MB of that movement;
- app-owned stores and caches remain small.

Candidate #2 is save-dialog/save-commit burst:

- fixture 1: 453.74 MB before save dialog -> 510.55 MB after save -> 491.03 MB after cleanup;
- fixture 2: 492.23 MB before save dialog -> 549.63 MB after save -> 497.90 MB after cleanup.

Do not refactor warm-navigation, Comparison store retention, by-id export or
direct-save export path in this sprint unless new measurements point there.
