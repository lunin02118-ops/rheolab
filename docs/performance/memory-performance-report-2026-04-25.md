# Memory Performance Report — Tauri Soak

- Generated at (UTC): 2026-04-25T23:21:33.072948+00:00
- Source: `tauri-soak`
- Input glob: `soak-*.json`
- Playwright command: `npx playwright test --config playwright.tauri-soak.config.ts --workers=1`
- Playwright status: `skipped` — Skipped by --skip-playwright flag.
- Runs analyzed: `20`
- Pass/Fail by thresholds: `20` / `0`
- Machine-readable summary: `outputs/e2e/perf/tauri-soak-summary-20260425-232133.json`

## Aggregate Stats

| Metric | Min | Median | Mean | P95 | Max |
|---|---:|---:|---:|---:|---:|
| Peak heap (MB) | 7.56 | 7.96 | 8.71 | 15.26 | 15.47 |
| Peak nodes | 528 | 945 | 1698 | 10034 | 10448 |
| Slope (MB/round) | -0.08 | 0.05 | 0.05 | 0.11 | 0.12 |
| Nodes ratio | 0.98 | 1.00 | 1.00 | 1.01 | 1.02 |

## Run Table

| File | Scenario | Generated | PeakHeap MB | PeakNodes | Slope MB/round | Nodes Ratio | Gate |
|---|---|---|---:|---:|---:|---:|---|
| `soak-upload-analyze-1776804339271.json` | `leak-soak-upload-analyze` | 2026-04-21T20:45:39.271Z | 7.89 | 591 | 0.11 | 1.00 | PASS |
| `soak-comparison-nav-1776804347025.json` | `leak-soak-comparison-nav` | 2026-04-21T20:45:47.025Z | 8.14 | 1029 | 0.04 | 1.00 | PASS |
| `soak-upload-analyze-1777111670461.json` | `leak-soak-upload-analyze` | 2026-04-25T10:07:50.461Z | 7.73 | 536 | 0.06 | 0.98 | PASS |
| `soak-comparison-nav-1777111679263.json` | `leak-soak-comparison-nav` | 2026-04-25T10:07:59.263Z | 10.02 | 953 | -0.08 | 1.00 | PASS |
| `soak-upload-analyze-1777112324236.json` | `leak-soak-upload-analyze` | 2026-04-25T10:18:44.236Z | 15.47 | 10034 | -0.05 | 1.00 | PASS |
| `soak-comparison-nav-1777112332256.json` | `leak-soak-comparison-nav` | 2026-04-25T10:18:52.256Z | 15.26 | 10448 | 0.04 | 1.00 | PASS |
| `soak-upload-analyze-1777155676332.json` | `leak-soak-upload-analyze` | 2026-04-25T22:21:16.332Z | 7.67 | 528 | 0.11 | 1.01 | PASS |
| `soak-comparison-nav-1777155684053.json` | `leak-soak-comparison-nav` | 2026-04-25T22:21:24.053Z | 7.98 | 945 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1777157339414.json` | `leak-soak-upload-analyze` | 2026-04-25T22:48:59.414Z | 7.70 | 537 | 0.08 | 0.98 | PASS |
| `soak-comparison-nav-1777157347137.json` | `leak-soak-comparison-nav` | 2026-04-25T22:49:07.137Z | 7.97 | 946 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1777157360733.json` | `leak-soak-upload-analyze` | 2026-04-25T22:49:20.733Z | 7.56 | 537 | 0.05 | 0.98 | PASS |
| `soak-comparison-nav-1777157368476.json` | `leak-soak-comparison-nav` | 2026-04-25T22:49:28.476Z | 7.97 | 945 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1777157382495.json` | `leak-soak-upload-analyze` | 2026-04-25T22:49:42.495Z | 7.72 | 537 | 0.08 | 0.98 | PASS |
| `soak-comparison-nav-1777157390220.json` | `leak-soak-comparison-nav` | 2026-04-25T22:49:50.220Z | 7.97 | 945 | 0.04 | 1.00 | PASS |
| `soak-upload-analyze-1777158896481.json` | `leak-soak-upload-analyze` | 2026-04-25T23:14:56.481Z | 7.72 | 528 | 0.12 | 1.02 | PASS |
| `soak-comparison-nav-1777158904181.json` | `leak-soak-comparison-nav` | 2026-04-25T23:15:04.181Z | 7.97 | 946 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1777158918191.json` | `leak-soak-upload-analyze` | 2026-04-25T23:15:18.191Z | 7.72 | 537 | 0.11 | 0.98 | PASS |
| `soak-comparison-nav-1777158925943.json` | `leak-soak-comparison-nav` | 2026-04-25T23:15:25.943Z | 7.96 | 946 | 0.04 | 1.00 | PASS |
| `soak-upload-analyze-1777158940014.json` | `leak-soak-upload-analyze` | 2026-04-25T23:15:40.014Z | 7.73 | 537 | 0.10 | 0.98 | PASS |
| `soak-comparison-nav-1777158947749.json` | `leak-soak-comparison-nav` | 2026-04-25T23:15:47.749Z | 7.98 | 946 | 0.05 | 1.00 | PASS |

## Notes

- Aggregated from `outputs/e2e/perf/soak-*.json`.
- Worst run: `soak-upload-analyze-1777158896481.json`.

