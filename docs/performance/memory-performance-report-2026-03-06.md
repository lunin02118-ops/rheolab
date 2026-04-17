# Memory Performance Report — Tauri Soak

- Generated at (UTC): 2026-03-06T16:20:42.097891+00:00
- Source: `tauri-soak`
- Input glob: `soak-*.json`
- Playwright command: `npx playwright test --config playwright.tauri-soak.config.ts --workers=1`
- Playwright status: `skipped` — Skipped by --skip-playwright flag.
- Runs analyzed: `28`
- Pass/Fail by thresholds: `28` / `0`
- Machine-readable summary: `outputs/e2e/perf/tauri-soak-summary-20260306-162042.json`

## Aggregate Stats

| Metric | Min | Median | Mean | P95 | Max |
|---|---:|---:|---:|---:|---:|
| Peak heap (MB) | 5.19 | 6.33 | 6.65 | 10.66 | 11.20 |
| Peak nodes | 386 | 620 | 1319 | 6343 | 6898 |
| Slope (MB/round) | -0.05 | 0.08 | 0.07 | 0.10 | 0.15 |
| Nodes ratio | 0.99 | 1.00 | 1.00 | 1.00 | 1.01 |

## Run Table

| File | Scenario | Generated | PeakHeap MB | PeakNodes | Slope MB/round | Nodes Ratio | Gate |
|---|---|---|---:|---:|---:|---:|---|
| `soak-upload-analyze-1772000158024.json` | `leak-soak-upload-analyze` | 2026-02-25T06:15:58.024Z | 6.31 | 620 | 0.08 | 1.00 | PASS |
| `soak-comparison-nav-1772000166443.json` | `leak-soak-comparison-nav` | 2026-02-25T06:16:06.443Z | 5.19 | 386 | 0.10 | 1.00 | PASS |
| `soak-upload-analyze-1772000181232.json` | `leak-soak-upload-analyze` | 2026-02-25T06:16:21.232Z | 6.32 | 620 | 0.08 | 1.00 | PASS |
| `soak-comparison-nav-1772000189624.json` | `leak-soak-comparison-nav` | 2026-02-25T06:16:29.624Z | 5.20 | 386 | 0.10 | 1.00 | PASS |
| `soak-upload-analyze-1772000204194.json` | `leak-soak-upload-analyze` | 2026-02-25T06:16:44.194Z | 6.32 | 620 | 0.08 | 1.00 | PASS |
| `soak-comparison-nav-1772000212555.json` | `leak-soak-comparison-nav` | 2026-02-25T06:16:52.555Z | 5.20 | 386 | 0.10 | 1.00 | PASS |
| `soak-upload-analyze-1772000469086.json` | `leak-soak-upload-analyze` | 2026-02-25T06:21:09.086Z | 6.33 | 620 | 0.08 | 1.00 | PASS |
| `soak-comparison-nav-1772000477488.json` | `leak-soak-comparison-nav` | 2026-02-25T06:21:17.488Z | 5.19 | 386 | 0.10 | 1.00 | PASS |
| `soak-upload-analyze-1772000492816.json` | `leak-soak-upload-analyze` | 2026-02-25T06:21:32.816Z | 6.33 | 620 | 0.08 | 1.00 | PASS |
| `soak-comparison-nav-1772000501201.json` | `leak-soak-comparison-nav` | 2026-02-25T06:21:41.201Z | 5.22 | 386 | 0.10 | 1.00 | PASS |
| `soak-upload-analyze-1772000516288.json` | `leak-soak-upload-analyze` | 2026-02-25T06:21:56.288Z | 6.38 | 620 | 0.09 | 1.00 | PASS |
| `soak-comparison-nav-1772000524792.json` | `leak-soak-comparison-nav` | 2026-02-25T06:22:04.792Z | 5.20 | 386 | 0.10 | 1.00 | PASS |
| `soak-upload-analyze-1772000781822.json` | `leak-soak-upload-analyze` | 2026-02-25T06:26:21.822Z | 6.32 | 620 | 0.07 | 1.00 | PASS |
| `soak-comparison-nav-1772000790274.json` | `leak-soak-comparison-nav` | 2026-02-25T06:26:30.274Z | 5.19 | 386 | 0.10 | 1.00 | PASS |
| `soak-upload-analyze-1772000804944.json` | `leak-soak-upload-analyze` | 2026-02-25T06:26:44.944Z | 6.33 | 620 | 0.07 | 1.00 | PASS |
| `soak-comparison-nav-1772000813409.json` | `leak-soak-comparison-nav` | 2026-02-25T06:26:53.409Z | 5.20 | 386 | 0.10 | 1.00 | PASS |
| `soak-upload-analyze-1772000828634.json` | `leak-soak-upload-analyze` | 2026-02-25T06:27:08.634Z | 6.34 | 620 | 0.15 | 1.01 | PASS |
| `soak-comparison-nav-1772000837015.json` | `leak-soak-comparison-nav` | 2026-02-25T06:27:17.015Z | 5.20 | 386 | 0.10 | 1.00 | PASS |
| `soak-upload-analyze-1772046788951.json` | `leak-soak-upload-analyze` | 2026-02-25T19:13:08.951Z | 6.74 | 620 | 0.05 | 1.00 | PASS |
| `soak-comparison-nav-1772046796864.json` | `leak-soak-comparison-nav` | 2026-02-25T19:13:16.864Z | 6.86 | 1152 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1772048366593.json` | `leak-soak-upload-analyze` | 2026-02-25T19:39:26.593Z | 6.74 | 620 | 0.06 | 1.00 | PASS |
| `soak-comparison-nav-1772048374431.json` | `leak-soak-comparison-nav` | 2026-02-25T19:39:34.431Z | 6.86 | 1153 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1772315007066.json` | `leak-soak-upload-analyze` | 2026-02-28T21:43:27.066Z | 6.09 | 662 | 0.03 | 0.99 | PASS |
| `soak-comparison-nav-1772315014908.json` | `leak-soak-comparison-nav` | 2026-02-28T21:43:34.908Z | 6.70 | 1244 | 0.04 | 1.00 | PASS |
| `soak-upload-analyze-1772776498972.json` | `leak-soak-upload-analyze` | 2026-03-06T05:54:58.972Z | 10.56 | 6343 | -0.03 | 1.00 | PASS |
| `soak-comparison-nav-1772776506845.json` | `leak-soak-comparison-nav` | 2026-03-06T05:55:06.845Z | 10.14 | 6898 | 0.01 | 1.00 | PASS |
| `soak-upload-analyze-1772805625698.json` | `leak-soak-upload-analyze` | 2026-03-06T14:00:25.698Z | 11.20 | 4311 | -0.05 | 1.00 | PASS |
| `soak-comparison-nav-1772805633463.json` | `leak-soak-comparison-nav` | 2026-03-06T14:00:33.463Z | 10.66 | 4866 | 0.01 | 1.00 | PASS |

## Notes

- Aggregated from `outputs/e2e/perf/soak-*.json`.
- Worst run: `soak-upload-analyze-1772000828634.json`.

