# Library Filter Regression Tracking

**Generated:** 2026-04-30T10:07:35.983Z.

This report compares DB-scale sidecars before and after the current
library filter span instrumentation. It is meant to track progress and
regression without overclaiming product wins from runner changes.

## SMALL DB

Baseline files:
- `outputs/e2e/perf/db-scale-1777538610228-small-tauri.json`

Current files:
- `outputs/e2e/perf/db-scale-1777543606748-small-tauri.json`

### Summary

| Metric | Baseline p50 | Current p50 | Delta | Status |
| --- | ---: | ---: | ---: | --- |
| Scenario wall | 10601 ms | 10683 ms | +0.8% | flat |
| Peak JS heap | 8.52 MB | 8.54 MB | +0.2% | flat |
| Peak DOM nodes | 6557 nodes | 6557 nodes | 0.0% | flat |

### Step Wall/Heap

| Metric | Baseline p50 | Current p50 | Delta | Status |
| --- | ---: | ---: | ---: | --- |
| Library open | 1558 ms | 1580 ms | +1.4% | flat |
| Search wall | 885 ms | 873 ms | -1.4% | flat |
| Fluid filter wall | 956 ms | 1041 ms | +8.9% | regress |
| Date range wall | 897 ms | 871 ms | -2.9% | flat |
| Filter reset wall | 872 ms | 767 ms | -12.0% | progress |
| Detail card open | 1338 ms | 1319 ms | -1.4% | flat |
| Library open heap | 7.09 MB | 7.10 MB | +0.1% | flat |

### Current Filter Spans

| Action | total p50 | debounce p50 | IPC p50 | render p50 | settle p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| search_by_name | 377.60 ms | 178.20 ms | 6.50 ms | 19.40 ms | 133.30 ms |
| filter_fluid_type | 544.30 ms | 58.90 ms | 7.40 ms | 25.60 ms | 138 ms |
| filter_date_range | 354.80 ms | 134.10 ms | 8 ms | 26.60 ms | 147.80 ms |
| filter_reset | 260.90 ms | 59.60 ms | 7.40 ms | 28.30 ms | 145.40 ms |

## LARGE DB

Baseline files:
- `outputs/e2e/perf/db-scale-1777538633879-large-tauri.json`

Current files:
- `outputs/e2e/perf/db-scale-1777543631570-large-tauri.json`

### Summary

| Metric | Baseline p50 | Current p50 | Delta | Status |
| --- | ---: | ---: | ---: | --- |
| Scenario wall | 10515 ms | 10830 ms | +3.0% | flat |
| Peak JS heap | 8.64 MB | 8.66 MB | +0.2% | flat |
| Peak DOM nodes | 6533 nodes | 6533 nodes | 0.0% | flat |

### Step Wall/Heap

| Metric | Baseline p50 | Current p50 | Delta | Status |
| --- | ---: | ---: | ---: | --- |
| Library open | 1557 ms | 1584 ms | +1.7% | flat |
| Search wall | 895 ms | 911 ms | +1.8% | flat |
| Fluid filter wall | 922 ms | 1028 ms | +11.5% | regress |
| Date range wall | 869 ms | 900 ms | +3.6% | flat |
| Filter reset wall | 884 ms | 817 ms | -7.6% | progress |
| Detail card open | 1322 ms | 1314 ms | -0.6% | flat |
| Library open heap | 7.13 MB | 7.14 MB | +0.1% | flat |

### Current Filter Spans

| Action | total p50 | debounce p50 | IPC p50 | render p50 | settle p50 |
| --- | ---: | ---: | ---: | ---: | ---: |
| search_by_name | 407.70 ms | 178.10 ms | 17.60 ms | 29.60 ms | 139.50 ms |
| filter_fluid_type | 522.30 ms | 58.20 ms | 8.80 ms | 26.80 ms | 147.40 ms |
| filter_date_range | 388.40 ms | 131.20 ms | 10.60 ms | 33.30 ms | 158.40 ms |
| filter_reset | 318.80 ms | 56.50 ms | 14.20 ms | 44.70 ms | 173 ms |

## Readout

- Treat `progress` / `regress` on wall times as runner-level signals when
  baseline and current use different measurement methods.
- Treat `ipc_ms` in current spans as the best available frontend-observed
  proxy for DB/IPC cost.
- If `ipc_ms` is small but wall time is high, optimize debounce/render/settle
  before touching SQL.
- Adaptive debounce is working as intended in the current sidecars:
  text search is ~178 ms, range filters are ~131-134 ms, and quick/reset
  filters are ~56-60 ms instead of the old fixed ~204-211 ms wait.
- The `filter_fluid_type` wall-time delta is not apples-to-apples: the baseline
  runner accidentally measured a search reset/no-op (`filter_keys: []`), while
  the current runner selects a real fluid dropdown value (`filter_keys:
  ["fluidType"]`). Use its current span decomposition, not the old step delta,
  as the beta-readiness signal.
- Current `filter_fluid_type` total is dominated by browser interaction before
  React receives the filter change (`input_to_filter_change_ms`: 314.4 ms small,
  281.1 ms large). Once the value changes, debounce/IPC/render/settle are
  bounded and IPC remains under 10 ms.
