# Comparison Memory Phase Readout

**Generated:** 2026-04-30T10:30:04.237Z.

Diagnostic comparison-smoke memory run summary. These runs use direct Win32
RSS sampling and CDP GC hints, so use them for memory phase diagnosis, not
for user-facing latency budgets.

- N: 5
- Runs: 3
- Modes: tauri-debug-mocked
- Source sidecars:
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777544745393-tauri.json`
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777544811048-tauri.json`
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777544874822-tauri.json`

## Phase RSS

| Phase | Total p50 | Total p95 | Renderer p50 | Renderer p95 | GPU p50 | GPU p95 | Tauri p50 | Tauri p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| after_chart_visible | 644.33 MB | 649.19 MB | 143.27 MB | 145.55 MB | 261.14 MB | 265.15 MB | 67.43 MB | 67.55 MB |
| after_pdf | 736.34 MB | 748.93 MB | 207.28 MB | 207.48 MB | 259.71 MB | 272.53 MB | 67.81 MB | 67.92 MB |
| after_xlsx | 726.19 MB | 731.43 MB | 209.05 MB | 209.19 MB | 248 MB | 253.93 MB | 67.85 MB | 67.96 MB |
| after_export_gc_hint | 626.07 MB | 627.92 MB | 192.82 MB | 193.18 MB | 164.18 MB | 165.57 MB | 67.85 MB | 67.92 MB |
| after_route_leave | 631.44 MB | 631.94 MB | 192.14 MB | 195.08 MB | 166.32 MB | 167.59 MB | 67.83 MB | 68 MB |

## P50 Deltas

| Delta | Total | Renderer | GPU | Tauri |
| --- | ---: | ---: | ---: | ---: |
| after_xlsx - after_export_gc_hint | 100.12 MB | 16.23 MB | 83.82 MB | 0 MB |
| after_export_gc_hint - after_route_leave | -5.37 MB | 0.68 MB | -2.14 MB | 0.02 MB |
| after_route_leave - after_chart_visible | -12.89 MB | 48.87 MB | -94.82 MB | 0.40 MB |

## Readout

- `after_xlsx - after_export_gc_hint` estimates reclaimable post-export RSS
  after product-side buffer cleanup plus a diagnostic GC hint.
- `after_export_gc_hint - after_route_leave` shows whether navigation releases
  additional app-controlled state. Near-zero renderer deltas here suggest the
  remaining RSS is mostly WebView2/runtime retention.
- `after_route_leave - after_chart_visible` should not be interpreted as a
  leak by itself; WebView2/GPU memory may shift across phases and processes.

