# Memory Performance Report — Tauri Soak

- Generated at (UTC): 2026-04-27T21:47:48.653696+00:00
- Source: `tauri-soak`
- Input glob: `soak-*.json`
- Playwright command: `npx playwright test --config playwright.tauri-soak.config.ts --workers=1`
- Playwright status: `skipped` — Skipped by --skip-playwright flag.
- Runs analyzed: `20`
- Pass/Fail by thresholds: `20` / `0`
- Machine-readable summary: `outputs/e2e/perf/tauri-soak-summary-20260427-214748.json`

## Aggregate Stats

| Metric | Min | Median | Mean | P95 | Max |
|---|---:|---:|---:|---:|---:|
| Peak heap (MB) | 7.56 | 7.97 | 7.96 | 8.24 | 8.42 |
| Peak nodes | 528 | 847 | 865 | 1349 | 1377 |
| Slope (MB/round) | 0.01 | 0.05 | 0.07 | 0.12 | 0.13 |
| Nodes ratio | 0.98 | 1.00 | 0.99 | 1.00 | 1.02 |

## Run Table

| File | Scenario | Generated | PeakHeap MB | PeakNodes | Slope MB/round | Nodes Ratio | Gate |
|---|---|---|---:|---:|---:|---:|---|
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
| `soak-upload-analyze-1777284049904.json` | `leak-soak-upload-analyze` | 2026-04-27T10:00:49.904Z | 7.96 | 749 | 0.06 | 0.99 | PASS |
| `soak-comparison-nav-1777284057653.json` | `leak-soak-comparison-nav` | 2026-04-27T10:00:57.653Z | 8.42 | 1377 | 0.06 | 1.00 | PASS |
| `soak-upload-analyze-1777326074051.json` | `leak-soak-upload-analyze` | 2026-04-27T21:41:14.051Z | 8.10 | 748 | 0.13 | 0.99 | PASS |
| `soak-comparison-nav-1777326081931.json` | `leak-soak-comparison-nav` | 2026-04-27T21:41:21.931Z | 8.23 | 1349 | 0.04 | 1.00 | PASS |
| `soak-upload-analyze-1777326097590.json` | `leak-soak-upload-analyze` | 2026-04-27T21:41:37.590Z | 8.10 | 748 | 0.11 | 0.99 | PASS |
| `soak-comparison-nav-1777326105431.json` | `leak-soak-comparison-nav` | 2026-04-27T21:41:45.431Z | 8.23 | 1348 | 0.04 | 1.00 | PASS |
| `soak-upload-analyze-1777326120900.json` | `leak-soak-upload-analyze` | 2026-04-27T21:42:00.900Z | 8.02 | 748 | 0.01 | 0.98 | PASS |
| `soak-comparison-nav-1777326128776.json` | `leak-soak-comparison-nav` | 2026-04-27T21:42:08.776Z | 8.24 | 1349 | 0.04 | 1.00 | PASS |

## Notes

- Aggregated from `outputs/e2e/perf/soak-*.json`.
- Worst run: `soak-upload-analyze-1777326074051.json`.

