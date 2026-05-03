# Comparison UX Latency Baseline

- **Date:** 2026-05-03
- **Scenario:** Comparison smoke, N=5, direct Tauri export save mode, memory steps disabled.
- **Status:** first user-visible Comparison latency baseline after the GPU/RSS attribution closeout.
- **Generated:** 2026-05-03T13:00:18.464Z
- **Runs:** 3
- Source sidecars:
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777813134455-tauri.json`
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777813167089-tauri.json`
  - `D:/Development/Rheolab/outputs/e2e/perf/comparison-smoke-1777813195127-tauri.json`
- Summary artifact:
  - `outputs/e2e/perf/comparison-latency-summary-n5-direct-latest3.json`

## Method

The run intentionally uses `COMPARISON_SMOKE_MEMORY_STEPS=0`. Memory-step RSS
sampling remains useful for attribution, but it is not a UX latency gate.

The perf runner now also skips the old memory-diagnostic compositor/DOM settle
waits on non-memory runs. That removes 800 ms of diagnostic padding per add
operation while preserving those waits for memory-step attribution runs.

```powershell
$env:COMPARISON_SMOKE_MEMORY_STEPS='0'
$env:COMPARISON_SMOKE_N='5'
$env:COMPARISON_SMOKE_EXPORT_SAVE_MODE='direct'
$env:COMPARISON_SMOKE_ADD5_EXPERIMENT='baseline'
npm run perf:comparison:tauri
```

The sidecar now records a `latency` block with route-open timing, per-add
selector/search/add-ready timings, report-tab timing, long-task totals and
series overview/window request counts/duration/bytes.

## P50/P95

| Metric | Meaning | p50 | p95 | min | max | samples |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `cmp_ready_ms` | Comparison workflow ready | 4302 | 4339.8 | 4276 | 4344 | 3 |
| `comparison_open_ms` | Comparison route/page ready | 49 | 52.6 | 43 | 53 | 3 |
| `selector_open_ms` | Selector open, p50 within run | 22 | 25.6 | 19 | 26 | 3 |
| `selector_search_ms` | Selector search result, p50 within run | 528 | 529.8 | 526 | 530 | 3 |
| `add_1_ready_ms` | Add 1 click to line ready | 224 | 242 | 219 | 244 | 3 |
| `add_2_ready_ms` | Add 2 click to line ready | 235 | 239.5 | 221 | 240 | 3 |
| `add_3_ready_ms` | Add 3 click to line ready | 220 | 228.1 | 208 | 229 | 3 |
| `add_4_ready_ms` | Add 4 click to line ready | 222 | 224.7 | 220 | 225 | 3 |
| `add_5_ready_ms` | Add 5 click to line ready | 223 | 226.6 | 221 | 227 | 3 |
| `chart_first_visible_ms` | Chart visible and canvas painted | 46 | 52.3 | 41 | 53 | 3 |
| `chart_ready_ms` | Chart legend/ready settle | 48 | 55.2 | 44 | 56 | 3 |
| `report_tab_open_ms` | Report tab loaded | 410 | 413.6 | 392 | 414 | 3 |
| `pdf_export_ms` | PDF direct-save export | 22 | 28.3 | 20 | 29 | 3 |
| `xlsx_export_ms` | XLSX direct-save export | 50 | 50 | 49 | 50 | 3 |
| `series_request_count` | Series overview/window request count | 10 | 10 | 10 | 10 | 3 |
| `series_request_total_ms` | Series request total duration | 178.7 | 196.34 | 173 | 198.3 | 3 |
| `series_request_total_bytes` | Series response bytes | 303600 | 303600 | 303600 | 303600 | 3 |
| `long_tasks_count` | Browser long task count | 0 | 0 | 0 | 0 | 3 |
| `long_tasks_total_ms` | Browser long task total duration | 0 | 0 | 0 | 0 | 3 |

## Readout

- Composite workflow ready is `4302 ms` p50 / `4339.8 ms` p95.
- The largest actionable repeated phase is selector search: `528 ms` p50 per
  add. Across five adds this contributes about `2640 ms` of the workflow.
- Add-to-chart is stable and small: add-ready timings are about `220-235 ms`
  p50 per line, including the fifth add.
- Series IPC is not the current dominant latency source: 10 overview/window
  requests total `178.7 ms` p50 and `303,600 B`.
- uPlot/chart visible/ready is not dominant: chart first visible is `46 ms`
  p50 and chart ready is `48 ms` p50 after the add path.
- Report tab and debug direct-save exports are not dominant in this mocked
  runner: report tab open is `410 ms` p50, PDF `22 ms`, XLSX `50 ms`.
- Browser long tasks were `0` in the three measured runs.

## Decision

GO: keep this non-memory latency baseline as the UX-performance reference for
Comparison N=5 direct-save work.

NO-GO: use memory-step phase runs as user-visible latency gates. They include
diagnostic sampling and, historically, explicit settle padding.

NO-GO: restart RAM refactors from this data. The memory policy remains
`docs/performance/COMPARISON-GPU-RSS-CLOSEOUT.md`: app-owned Comparison memory
is bounded, while Total/GPU RSS are soft WebView2/runtime metrics.

## Next Optimization Candidate

Recommended next PR:

```text
perf(comparison): reduce experiment selector search latency
```

Why:

- Selector search is the largest repeated user-visible latency in the N=5
  workflow.
- Add-to-chart, series IPC, uPlot paint, report-tab open and debug direct-save
  export are all smaller in this baseline.

First verify whether the `~528 ms` p50 is product debounce/render latency or
runner wait strategy from `ComparisonPage.searchExperiment()`. If it is mostly
test wait strategy, replace the fixed wait with result-based readiness before
claiming a product win. If product search/render still dominates after that,
then tune selector debounce/rendering or precomputed search fields.
