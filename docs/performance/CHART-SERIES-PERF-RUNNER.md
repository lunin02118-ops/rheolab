# Chart Series Perf Runner

This runner validates the saved-experiment chart hot path after the binary
series work:

- saved detail open renders the chart from metadata + binary series overview;
- zoom selection triggers `experiments_series_window`;
- overview/window payload bytes stay bounded by `maxPoints`;
- JS heap, long tasks, and optional Win32 RSS phase markers are captured.

Run:

```bash
npm run perf:chart:tauri
npm run perf:chart:tauri:memory
```

Output sidecar:

```text
outputs/e2e/perf/chart-series-<runId>.json
```

Schema:

```text
rheolab.e2e.perf.chart_series.v1
```

The runner is measurement-only. It should not be used to claim a hard total RSS
win by itself; WebView2/GPU/runtime memory still needs repeated p50/p95 runs.
The useful claims are bounded app payloads, default binary chart adoption, and
phase-level evidence for where chart memory is retained.
