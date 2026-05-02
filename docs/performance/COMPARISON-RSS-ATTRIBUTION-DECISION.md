# Comparison RSS Attribution Decision

**Date:** 2026-05-02
**Build under test:** 0.2.2-alpha.19 diagnostic candidate
**Commit:** 33aa167 plus diagnostic/export-save polish

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

Instrumented source sidecar:

- `outputs/e2e/perf/comparison-smoke-1777741845183-tauri.json`

Instrumented summary:

```powershell
node scripts\test\summarize-comparison-memory-phases.mjs --n 5 --latest 1 --export-save-mode direct --only-ok --json outputs\e2e\perf\comparison-memory-phase-summary-n5-direct-instrumented-latest1.json
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

## App-Owned Memory Signals

| Signal | Result |
| --- | ---: |
| comparison store raw count | 0 |
| comparison store columnar count | 0 |
| Rust parse cache entries | 0 |
| Rust parse cache points | 0 |
| seriesWindowCache after_add_5 | 303040 B |
| seriesWindowCache export phases | 606080 B |
| JS heap after_export_gc_hint | 11.50 MB |
| JS heap after_second_gc_hint | 11.16 MB |

Direct-save keeps the same app-owned result:

- comparison store raw/columnar counts stay at 0;
- Rust parse cache entries/points stay at 0;
- seriesWindowCache stays below 1 MB;
- JS heap after the export GC hint stays around 11.5 MB.

The instrumented direct-save run adds Rust decoded-series cache and chart/canvas
markers:

- Rust decoded series cache after adding 5 lines: 5 entries / 784,418 B;
- frontend `seriesWindowCache` after adding 5 lines: 303,040 B;
- frontend `seriesWindowCache` on report tab/export phases: 606,080 B;
- comparison store raw/columnar counts remain 0 throughout;
- parse cache entries/points remain 0 throughout;
- chart canvas estimate around `after_chart_visible`: about 2.29 MB;
- `after_add_5` to `after_chart_canvas_painted` moves total RSS from
  617.01 MB to 627.90 MB, with GPU RSS from 244.09 MB to 250.32 MB;
- `after_xlsx - after_export_gc_hint` remains production-like at 16.97 MB.

This keeps the previous conclusion intact: Rust decoded series cache is useful
and bounded here, not the main Total RSS driver.

## Decision

GO: keep the WN/Comparison session architecture. The current RSS issue is not
caused by retained raw or full columnar Comparison state.

NO-GO: do another warm-navigation or Comparison-store memory refactor right now.
The app-owned signals are bounded and small in this scenario.

NO-GO: treat the original `after_pdf` / `after_xlsx` spike as production report
memory. With browser downloads, `after_xlsx - after_export_gc_hint` was about
101 MB. With direct Tauri save, the same delta is about 14.6 MB:

- browser-download `after_pdf` p50 total RSS: 728.14 MB
- browser-download `after_xlsx` p50 total RSS: 718.85 MB
- direct-save `after_pdf` p50 total RSS: 630.22 MB
- direct-save `after_xlsx` p50 total RSS: 621.17 MB

This means the large export spike was primarily an E2E/browser-download artifact,
not the normal installed-app save path.

## Next Refactor Candidate

`perf(memory): attribute save/import and chart GPU lifecycle`

Scope:

- keep direct-save export mode as the default when memory steps are enabled;
- run direct-save N=5 before/after any memory PR;
- decompose save/import phases further around parse result, DB persistence,
  dashboard chart render, and post-save cleanup (instrumented once; repeat
  3-run summary before choosing a memory refactor);
- add chart/GPU lifecycle markers around uPlot mount, canvas paint, tab switch,
  route leave, and canvas destruction (instrumented once; repeat 3-run summary
  before choosing a chart/GPU refactor);
- include Rust decoded series cache entries/bytes/hits/misses in the memory
  sidecar;
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
