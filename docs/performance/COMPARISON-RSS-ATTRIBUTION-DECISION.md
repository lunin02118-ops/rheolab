# Comparison RSS Attribution Decision

**Date:** 2026-05-02
**Build under test:** 0.2.2-alpha.19 diagnostic candidate
**Commit:** f29f96b (`perf(memory): attribute comparison save and series cache phases`)

This note records the first post-WN RSS attribution decision. It is based on
the phase-decomposed Comparison smoke runner, not on user-facing latency
budgets.

## Evidence

Initial browser-download diagnostic command:

```powershell
$env:COMPARISON_SMOKE_MEMORY_STEPS='1'
$env:COMPARISON_SMOKE_N='5'
npm run perf:comparison:tauri
```

Repeated 3 times, then summarized with:

```powershell
node scripts\test\summarize-comparison-memory-phases.mjs --n 5 --latest 3 --json outputs\e2e\perf\comparison-memory-phase-summary-n5-latest3.json
```

Source sidecars:

- `outputs/e2e/perf/comparison-smoke-1777717837153-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777717948788-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777718066667-tauri.json`

This first readout used the normal E2E browser-download fallback. It was useful,
but it also measured WebView2/Playwright download behavior that the installed
Tauri app does not use for normal report saves.

Production-like direct-save diagnostic command:

```powershell
$env:COMPARISON_SMOKE_MEMORY_STEPS='1'
$env:COMPARISON_SMOKE_N='5'
$env:COMPARISON_SMOKE_EXPORT_SAVE_MODE='direct'
npm run perf:comparison:tauri
```

Direct-save source sidecars:

- `outputs/e2e/perf/comparison-smoke-1777718909627-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777721261634-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777721388719-tauri.json`

Direct-save summary:

```powershell
node scripts\test\summarize-comparison-memory-phases.mjs --n 5 --latest 3 --export-save-mode direct --only-ok --json outputs\e2e\perf\comparison-memory-phase-summary-n5-direct-latest3.json
```

Instrumented save/chart direct-save diagnostic command:

```powershell
$env:COMPARISON_SMOKE_MEMORY_STEPS='1'
$env:COMPARISON_SMOKE_N='5'
$env:COMPARISON_SMOKE_EXPORT_SAVE_MODE='direct'
npm run perf:comparison:tauri
```

Instrumented source sidecars:

- `outputs/e2e/perf/comparison-smoke-1777741845183-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777742916586-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777743134402-tauri.json`

Instrumented summary:

```powershell
node scripts\test\summarize-comparison-memory-phases.mjs --n 5 --latest 3 --export-save-mode direct --only-ok --json outputs\e2e\perf\comparison-memory-phase-summary-n5-direct-instrumented-latest3.json
```

## Browser-Download P50 Phases

| Phase | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_4_save | 648.07 MB | 169.54 MB | 246.43 MB | 65.84 MB |
| after_fixture_5_cleanup | 603.90 MB | 160.79 MB | 234.80 MB | 65.68 MB |
| after_add_5 | 626.84 MB | 130.70 MB | 257.22 MB | 67.78 MB |
| after_chart_visible | 633.61 MB | 135.13 MB | 261.75 MB | 67.78 MB |
| after_pdf | 728.14 MB | 197.79 MB | 260.91 MB | 68.69 MB |
| after_xlsx | 718.85 MB | 198.62 MB | 251.03 MB | 68.74 MB |
| after_export_gc_hint | 617.74 MB | 188.99 MB | 160.04 MB | 68.57 MB |
| after_route_leave | 639.59 MB | 192.92 MB | 177.45 MB | 69.25 MB |
| after_second_gc_hint | 624.86 MB | 187.40 MB | 169.39 MB | 69.25 MB |

## Direct-Save P50 Phases

| Phase | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_3_save | 639.76 MB | 167.51 MB | 237.41 MB | 65.40 MB |
| after_fixture_4_save | 638.75 MB | 181.39 MB | 221.18 MB | 66.41 MB |
| after_fixture_5_cleanup | 566.66 MB | 150.54 MB | 197.38 MB | 65.89 MB |
| after_add_5 | 616.10 MB | 129.02 MB | 248.94 MB | 68.39 MB |
| after_chart_visible | 628.34 MB | 133.54 MB | 256.66 MB | 68.39 MB |
| after_pdf | 630.22 MB | 134.82 MB | 255.39 MB | 69.17 MB |
| after_xlsx | 621.17 MB | 131.89 MB | 250.19 MB | 69.22 MB |
| after_export_gc_hint | 606.57 MB | 122.14 MB | 245.88 MB | 69.13 MB |
| after_route_leave | 610.69 MB | 124.83 MB | 246.59 MB | 69.62 MB |
| after_second_gc_hint | 603.90 MB | 119.67 MB | 240.64 MB | 69.62 MB |

## Instrumented Direct-Save P50 Phases

The instrumented 3-run direct-save readout keeps the export conclusion intact
and adds finer save/dialog and chart lifecycle attribution.

### Save/Dialog Markers

| Phase | Total RSS | Renderer RSS | GPU RSS | JS Heap |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_1_upload | 457.56 MB | 107.29 MB | 129.12 MB | 10.67 MB |
| after_fixture_1_parse | 455.46 MB | 106.77 MB | 128.33 MB | 11.60 MB |
| before_fixture_1_save_dialog | 453.74 MB | 107.25 MB | 122.79 MB | 11.62 MB |
| after_fixture_1_save_dialog_open | 486.62 MB | 128.82 MB | 132.36 MB | 12.59 MB |
| before_fixture_1_save_commit | 510.14 MB | 147.05 MB | 132.88 MB | 16.46 MB |
| after_fixture_1_save | 510.55 MB | 146.86 MB | 133.22 MB | 15.90 MB |
| after_fixture_1_cleanup | 491.03 MB | 118.63 MB | 120.04 MB | 9.97 MB |
| after_fixture_2_upload | 494.27 MB | 129.06 MB | 130.11 MB | 16.01 MB |
| before_fixture_2_save_dialog | 492.23 MB | 127.84 MB | 129.25 MB | 12.00 MB |
| after_fixture_2_save_dialog_open | 530.63 MB | 137.39 MB | 163.86 MB | 17.89 MB |
| before_fixture_2_save_commit | 549.32 MB | 153.67 MB | 163.54 MB | 17.38 MB |
| after_fixture_2_save | 549.63 MB | 154.36 MB | 162.29 MB | 21.17 MB |
| after_fixture_2_cleanup | 497.90 MB | 121.23 MB | 143.28 MB | 10.86 MB |
| after_fixture_5_cleanup | 511.11 MB | 130.46 MB | 148.42 MB | 13.51 MB |

### Chart/Export/Lifecycle Markers

| Phase | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_add_5 | 605.22 MB | 135.40 MB | 229.75 MB | 67.96 MB |
| after_chart_canvas_painted | 611.02 MB | 138.15 MB | 234.17 MB | 67.96 MB |
| after_chart_visible | 608.83 MB | 137.56 MB | 232.75 MB | 67.96 MB |
| after_report_tab_open | 616.80 MB | 140.45 MB | 234.64 MB | 68.42 MB |
| after_pdf | 611.55 MB | 137.91 MB | 233.11 MB | 68.98 MB |
| after_xlsx | 607.94 MB | 138.01 MB | 229.39 MB | 69.01 MB |
| after_export_gc_hint | 590.77 MB | 124.27 MB | 226.67 MB | 68.91 MB |
| after_route_leave | 594.54 MB | 127.09 MB | 227.10 MB | 69.65 MB |
| after_chart_unmount_settle | 590.43 MB | 125.45 MB | 224.57 MB | 69.65 MB |
| after_second_gc_hint | 521.35 MB | 121.65 MB | 159.29 MB | 69.65 MB |

## App-Owned Memory Signals

| Signal | Result |
| --- | ---: |
| comparison store raw count | 0 |
| comparison store columnar count | 0 |
| Rust parse cache entries | 0 |
| Rust parse cache points | 0 |
| seriesWindowCache after_add_5 | 303,040 B |
| seriesWindowCache export phases | 606,080 B |
| Rust decoded series cache after_add_5 | 5 entries / 784,418 B |
| Rust decoded series cache after_second_gc_hint | 5 entries / 784,418 B |
| chart canvas estimate after_chart_visible | 2,400,384 B |
| chart canvas estimate after_second_gc_hint | 2,812,800 B |
| uPlot count after_chart_visible | 1 |
| uPlot count after_second_gc_hint | 1 |
| JS heap after_export_gc_hint | 11.50 MB |
| JS heap after_second_gc_hint | 11.16 MB |

Direct-save keeps the same app-owned result:

- comparison store raw/columnar counts stay at 0;
- Rust parse cache entries/points stay at 0;
- seriesWindowCache stays below 1 MB;
- JS heap after the export GC hint stays around 11.5 MB.

The instrumented direct-save 3-run summary adds Rust decoded-series cache and
chart/canvas markers:

- Rust decoded series cache stays at 5 entries / 784,418 B;
- frontend `seriesWindowCache` is 303,040 B after adding 5 lines and 606,080 B
  on report/export phases;
- comparison store raw/columnar counts remain 0 throughout;
- parse cache entries/points remain 0 throughout;
- chart canvas estimates stay in the low single-digit MB range;
- `after_add_5` to `after_chart_canvas_painted` moves total RSS from
  605.22 MB to 611.02 MB, with GPU RSS from 229.75 MB to 234.17 MB;
- `after_xlsx - after_export_gc_hint` remains production-like at 17.17 MB.

This keeps the previous conclusion intact: Rust decoded series cache is useful
and bounded here, not the main Total RSS driver.

## Decision

GO: keep the WN/Comparison session architecture. The current RSS issue is not
caused by retained raw or full columnar Comparison state.

NO-GO: do another warm-navigation or Comparison-store memory refactor right now.
The app-owned signals are bounded and small in this scenario.

NO-GO: treat the original `after_pdf` / `after_xlsx` spike as production report
memory. With browser downloads, `after_xlsx - after_export_gc_hint` was about
101 MB. With direct Tauri save, the same delta is about 14.6-17.2 MB:

- browser-download `after_pdf` p50 total RSS: 728.14 MB
- browser-download `after_xlsx` p50 total RSS: 718.85 MB
- direct-save `after_pdf` p50 total RSS: 630.22 MB
- direct-save `after_xlsx` p50 total RSS: 621.17 MB
- instrumented direct-save `after_pdf` p50 total RSS: 611.55 MB
- instrumented direct-save `after_xlsx` p50 total RSS: 607.94 MB

This means the large export spike was primarily an E2E/browser-download artifact,
not the normal installed-app save path.

## Next Refactor Candidate

`perf(memory): target save-dialog/dashboard and chart lifecycle`

Scope:

- keep direct-save export mode as the default when memory steps are enabled;
- run direct-save N=5 before/after any memory PR;
- investigate the save-dialog/save-commit burst: fixture 1 moves from
  453.74 MB before save dialog to 510.55 MB after save, then drops to
  491.03 MB after cleanup; fixture 2 moves from 492.23 MB to 549.63 MB, then
  drops to 497.90 MB;
- investigate the chart/GPU phase separately: adding 5 lines moves total RSS to
  605.22 MB, while first canvas paint is 611.02 MB and chart visible is
  608.83 MB;
- verify why a canvas/uPlot marker remains visible after route leave in the
  sidecar before doing a cleanup refactor;
- keep Rust decoded series cache entries/bytes/hits/misses in the memory
  sidecar for before/after comparisons;
- do not change Comparison warm cache policy unless a new measurement points
  there.

Success metrics:

- lower save/import or chart/GPU peaks without increasing Comparison ready time
  materially;
- direct-save export stays near current p50 levels;
- `comparison_store_raw_count`, `comparison_store_columnar_count`, and parse
  cache stats remain zero.

## Release Claim Boundary

Use this wording:

> Comparison app-owned memory is bounded in the N=5 diagnostic run: selected
> DB-backed lines do not retain raw or full columnar data in the Comparison
> store, and warm series cache size stays below 1 MB.

Avoid this wording:

> Total RSS is fixed.

Total RSS remains a soft metric because WebView2, GPU, allocator, and runtime
retention can move memory between processes even after app-owned buffers are
released.
