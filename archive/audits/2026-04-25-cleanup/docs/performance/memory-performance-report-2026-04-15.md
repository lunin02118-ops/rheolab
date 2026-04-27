# Memory Performance Report — Tauri Soak

- Generated at (UTC): 2026-04-15T19:46:15.614070+00:00
- Source: `tauri-soak`
- Input glob: `soak-*.json`
- Playwright command: `npx playwright test --config playwright.tauri-soak.config.ts --workers=1`
- Playwright status: `skipped` — Skipped by --skip-playwright flag.
- Runs analyzed: `10`
- Pass/Fail by thresholds: `10` / `0`
- Machine-readable summary: `outputs/e2e/perf/tauri-soak-summary-20260415-194615.json`

## Aggregate Stats

| Metric | Min | Median | Mean | P95 | Max |
|---|---:|---:|---:|---:|---:|
| Peak heap (MB) | 7.75 | 10.43 | 9.56 | 10.98 | 10.98 |
| Peak nodes | 701 | 5814 | 4086 | 6589 | 6589 |
| Slope (MB/round) | 0.01 | 0.01 | 0.04 | 0.16 | 0.16 |
| Nodes ratio | 1.00 | 1.00 | 1.00 | 1.01 | 1.01 |

## Run Table

| File | Scenario | Generated | PeakHeap MB | PeakNodes | Slope MB/round | Nodes Ratio | Gate |
|---|---|---|---:|---:|---:|---:|---|
| `soak-upload-analyze-1773578888255.json` | `leak-soak-upload-analyze` | 2026-03-15T12:48:08.255Z | 10.80 | 5832 | 0.01 | 1.00 | PASS |
| `soak-comparison-nav-1773578896131.json` | `leak-soak-comparison-nav` | 2026-03-15T12:48:16.131Z | 10.36 | 6256 | 0.01 | 1.00 | PASS |
| `soak-upload-analyze-1776281604181.json` | `leak-soak-upload-analyze` | 2026-04-15T19:33:24.181Z | 7.79 | 701 | 0.13 | 1.01 | PASS |
| `soak-comparison-nav-1776281611990.json` | `leak-soak-comparison-nav` | 2026-04-15T19:33:31.990Z | 8.00 | 1303 | 0.04 | 1.00 | PASS |
| `soak-upload-analyze-1776281995932.json` | `leak-soak-upload-analyze` | 2026-04-15T19:39:55.932Z | 10.91 | 5796 | 0.01 | 1.00 | PASS |
| `soak-comparison-nav-1776282003744.json` | `leak-soak-comparison-nav` | 2026-04-15T19:40:03.744Z | 10.49 | 6394 | 0.01 | 1.00 | PASS |
| `soak-upload-analyze-1776282121602.json` | `leak-soak-upload-analyze` | 2026-04-15T19:42:01.602Z | 10.98 | 5990 | 0.01 | 1.00 | PASS |
| `soak-comparison-nav-1776282129365.json` | `leak-soak-comparison-nav` | 2026-04-15T19:42:09.365Z | 10.53 | 6589 | 0.01 | 1.00 | PASS |
| `soak-upload-analyze-1776282194522.json` | `leak-soak-upload-analyze` | 2026-04-15T19:43:14.522Z | 7.75 | 701 | 0.16 | 1.01 | PASS |
| `soak-comparison-nav-1776282202277.json` | `leak-soak-comparison-nav` | 2026-04-15T19:43:22.277Z | 8.00 | 1302 | 0.04 | 1.00 | PASS |

## Notes

- Aggregated from `outputs/e2e/perf/soak-*.json`.
- Worst run: `soak-upload-analyze-1776282194522.json`.

