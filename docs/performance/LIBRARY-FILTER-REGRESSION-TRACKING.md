# Library Filter Regression Tracking

**Generated:** 2026-04-29T22:08:30.289Z.

This report compares DB-scale sidecars before and after the current
library filter span instrumentation. It is meant to track progress and
regression without overclaiming product wins from runner changes.

## SMALL DB

Baseline files:
- `outputs/e2e/perf/db-scale-1777493745802-small-tauri.json`
- `outputs/e2e/perf/db-scale-1777493807404-small-tauri.json`
- `outputs/e2e/perf/db-scale-1777493869154-small-tauri.json`

Current files:
- `outputs/e2e/perf/db-scale-1777499733496-small-tauri.json`
- `outputs/e2e/perf/db-scale-1777499855960-small-tauri.json`

> Note: current sidecars are span-aware while baseline sidecars are coarse
> step wall measurements. Wall-time deltas are useful regression signals,
> but should not be claimed as pure product latency wins.

### Summary

| Metric | Baseline p50 | Current p50 | Delta | Status |
| --- | ---: | ---: | ---: | --- |
| Scenario wall | 13589 ms | 10764.50 ms | -20.8% | progress |
| Peak JS heap | 8.54 MB | 8.55 MB | +0.1% | flat |
| Peak DOM nodes | 6557 nodes | 6557 nodes | 0.0% | flat |

### Step Wall/Heap

| Metric | Baseline p50 | Current p50 | Delta | Status |
| --- | ---: | ---: | ---: | --- |
| Library open | 1558 ms | 1617 ms | +3.8% | flat |
| Search wall | 1856 ms | 915.50 ms | -50.7% | progress |
| Fluid filter wall | 1909 ms | 989 ms | -48.2% | progress |
| Date range wall | 1455 ms | 924 ms | -36.5% | progress |
| Filter reset wall | 1442 ms | 887 ms | -38.5% | progress |
| Detail card open | 1321 ms | 1320 ms | -0.1% | flat |
| Library open heap | 7.13 MB | 7.12 MB | -0.1% | flat |

### Current Filter Spans

| Action | total p50 | debounce p50 | IPC p50 | render p50 | settle p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| search_by_name | 409.65 ms | 204.75 ms | 5.45 ms | 18.50 ms | 133.90 ms |
| filter_fluid_type | 479.55 ms | 210.45 ms | 7.15 ms | 32.85 ms | 207.10 ms |
| filter_date_range | 420.60 ms | 205.85 ms | 7.45 ms | 29.25 ms | 139.45 ms |
| filter_reset | 390.40 ms | 207.60 ms | 5.90 ms | 24 ms | 128.55 ms |

## LARGE DB

Baseline files:
- `outputs/e2e/perf/db-scale-1777493892303-large-tauri.json`
- `outputs/e2e/perf/db-scale-1777493914976-large-tauri.json`
- `outputs/e2e/perf/db-scale-1777493937660-large-tauri.json`

Current files:
- `outputs/e2e/perf/db-scale-1777500191036-large-tauri.json`

> Note: current sidecars are span-aware while baseline sidecars are coarse
> step wall measurements. Wall-time deltas are useful regression signals,
> but should not be claimed as pure product latency wins.

### Summary

| Metric | Baseline p50 | Current p50 | Delta | Status |
| --- | ---: | ---: | ---: | --- |
| Scenario wall | 13668 ms | 10730 ms | -21.5% | progress |
| Peak JS heap | 8.60 MB | 8.58 MB | -0.2% | flat |
| Peak DOM nodes | 6533 nodes | 6533 nodes | 0.0% | flat |

### Step Wall/Heap

| Metric | Baseline p50 | Current p50 | Delta | Status |
| --- | ---: | ---: | ---: | --- |
| Library open | 1551 ms | 1566 ms | +1.0% | flat |
| Search wall | 1875 ms | 945 ms | -49.6% | progress |
| Fluid filter wall | 1945 ms | 990 ms | -49.1% | progress |
| Date range wall | 1445 ms | 915 ms | -36.7% | progress |
| Filter reset wall | 1462 ms | 894 ms | -38.9% | progress |
| Detail card open | 1323 ms | 1328 ms | +0.4% | flat |
| Library open heap | 7.13 MB | 7.08 MB | -0.7% | flat |

### Current Filter Spans

| Action | total p50 | debounce p50 | IPC p50 | render p50 | settle p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| search_by_name | 448.60 ms | 208.70 ms | 15.70 ms | 26.50 ms | 150.90 ms |
| filter_fluid_type | 482.10 ms | 205.80 ms | 8.60 ms | 33.90 ms | 214.60 ms |
| filter_date_range | 414.40 ms | 208.80 ms | 8.90 ms | 30.30 ms | 138.90 ms |
| filter_reset | 399.70 ms | 207.20 ms | 9.70 ms | 23.20 ms | 125.20 ms |

## Readout

- Treat `progress` / `regress` on wall times as runner-level signals when
  baseline and current use different measurement methods.
- Treat `ipc_ms` in current spans as the best available frontend-observed
  proxy for DB/IPC cost.
- If `ipc_ms` is small but wall time is high, optimize debounce/render/settle
  before touching SQL.
