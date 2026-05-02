# Comparison RSS Attribution Decision

**Date:** 2026-05-02
**Build under test:** 0.2.2-alpha.19 diagnostic candidate
**Commit:** 33aa167 plus diagnostic polish

This note records the first post-WN RSS attribution decision. It is based on
the phase-decomposed Comparison smoke runner, not on user-facing latency
budgets.

## Evidence

Command:

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

## Key P50 Phases

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

## Decision

GO: keep the WN/Comparison session architecture. The current RSS issue is not
caused by retained raw or full columnar Comparison state.

NO-GO: do another warm-navigation or Comparison-store memory refactor right now.
The app-owned signals are bounded and small in this scenario.

The next targeted optimization should start with report/export and GPU/WebView2
attribution, because the largest P50 peak is after PDF/XLSX export:

- `after_pdf` p50 total RSS: 728.14 MB
- `after_xlsx` p50 total RSS: 718.85 MB
- `after_xlsx - after_export_gc_hint`: about 101 MB reclaimable total RSS,
  mostly GPU RSS in this run

The save pipeline remains a secondary suspect because fixture save phases also
produce large GPU-heavy peaks, but export is the larger and more isolated next
target.

## Next Refactor Candidate

`perf(reports): attribute and release comparison export buffers`

Scope:

- add report/export-specific phase markers around byte creation, Blob/object URL
  creation, save dialog/write, and cleanup;
- verify object URLs and Uint8Array/Blob references are released immediately
  after save;
- check whether mocked export still triggers renderer/GPU allocations through
  preview/download plumbing;
- keep report bytes out of long-lived React/Zustand state;
- do not change Comparison warm cache policy unless a new measurement points
  there.

Success metrics:

- lower `after_pdf` / `after_xlsx` renderer or GPU RSS;
- lower `after_export_gc_hint` p50 without increasing export latency materially;
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
