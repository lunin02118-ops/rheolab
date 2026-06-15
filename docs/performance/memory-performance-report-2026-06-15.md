# Memory Performance Report — Tauri Soak

- Generated at (UTC): 2026-06-15T09:34:47.942203+00:00
- Source: `tauri-soak`
- Input glob: `soak-*.json`
- Playwright command: `npx playwright test --config playwright.tauri-soak.config.ts --workers=1`
- Playwright status: `skipped` — Skipped by --skip-playwright flag.
- Runs analyzed: `20`
- Pass/Fail by thresholds: `20` / `0`
- Machine-readable summary: `outputs/e2e/perf/tauri-soak-summary-20260615-093447.json`

## Aggregate Stats

| Metric | Min | Median | Mean | P95 | Max |
|---|---:|---:|---:|---:|---:|
| Peak heap (MB) | 8.31 | 8.57 | 8.55 | 8.83 | 8.84 |
| Peak nodes | 983 | 1214 | 1215 | 1448 | 1448 |
| Slope (MB/round) | 0.03 | 0.06 | 0.07 | 0.12 | 0.16 |
| Nodes ratio | 0.99 | 1.00 | 1.00 | 1.01 | 1.01 |

## Run Table

| File | Scenario | Generated | PeakHeap MB | PeakNodes | Slope MB/round | Nodes Ratio | Gate |
|---|---|---|---:|---:|---:|---:|---|
| `soak-upload-analyze-1781425493176.json` | `leak-soak-upload-analyze` | 2026-06-14T08:24:53.176Z | 8.68 | 983 | 0.12 | 1.01 | PASS |
| `soak-comparison-nav-1781425500879.json` | `leak-soak-comparison-nav` | 2026-06-14T08:25:00.879Z | 8.83 | 1435 | 0.04 | 1.00 | PASS |
| `soak-upload-analyze-1781435171299.json` | `leak-soak-upload-analyze` | 2026-06-14T11:06:11.299Z | 8.58 | 984 | 0.10 | 1.00 | PASS |
| `soak-comparison-nav-1781435178977.json` | `leak-soak-comparison-nav` | 2026-06-14T11:06:18.977Z | 8.58 | 1435 | 0.07 | 1.00 | PASS |
| `soak-upload-analyze-1781435195984.json` | `leak-soak-upload-analyze` | 2026-06-14T11:06:35.984Z | 8.68 | 983 | 0.16 | 1.01 | PASS |
| `soak-comparison-nav-1781435203657.json` | `leak-soak-comparison-nav` | 2026-06-14T11:06:43.657Z | 8.84 | 1435 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1781435219466.json` | `leak-soak-upload-analyze` | 2026-06-14T11:06:59.466Z | 8.60 | 993 | 0.07 | 0.99 | PASS |
| `soak-comparison-nav-1781435227176.json` | `leak-soak-comparison-nav` | 2026-06-14T11:07:07.176Z | 8.60 | 1435 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1781458597298.json` | `leak-soak-upload-analyze` | 2026-06-14T17:36:37.299Z | 8.31 | 990 | 0.04 | 1.00 | PASS |
| `soak-comparison-nav-1781458604996.json` | `leak-soak-comparison-nav` | 2026-06-14T17:36:44.996Z | 8.49 | 1448 | 0.07 | 1.00 | PASS |
| `soak-upload-analyze-1781458620093.json` | `leak-soak-upload-analyze` | 2026-06-14T17:37:00.093Z | 8.39 | 990 | 0.06 | 1.00 | PASS |
| `soak-comparison-nav-1781458627811.json` | `leak-soak-comparison-nav` | 2026-06-14T17:37:07.811Z | 8.57 | 1447 | 0.06 | 1.00 | PASS |
| `soak-upload-analyze-1781458642504.json` | `leak-soak-upload-analyze` | 2026-06-14T17:37:22.504Z | 8.32 | 990 | 0.07 | 1.00 | PASS |
| `soak-comparison-nav-1781458650194.json` | `leak-soak-comparison-nav` | 2026-06-14T17:37:30.194Z | 8.56 | 1447 | 0.06 | 1.00 | PASS |
| `soak-upload-analyze-1781515691316.json` | `leak-soak-upload-analyze` | 2026-06-15T09:28:11.316Z | 8.44 | 990 | 0.03 | 0.99 | PASS |
| `soak-comparison-nav-1781515699081.json` | `leak-soak-comparison-nav` | 2026-06-15T09:28:19.081Z | 8.59 | 1447 | 0.06 | 1.00 | PASS |
| `soak-upload-analyze-1781515714415.json` | `leak-soak-upload-analyze` | 2026-06-15T09:28:34.415Z | 8.43 | 990 | 0.05 | 1.00 | PASS |
| `soak-comparison-nav-1781515722131.json` | `leak-soak-comparison-nav` | 2026-06-15T09:28:42.131Z | 8.56 | 1447 | 0.06 | 1.00 | PASS |
| `soak-upload-analyze-1781515736964.json` | `leak-soak-upload-analyze` | 2026-06-15T09:28:56.964Z | 8.39 | 990 | 0.06 | 1.00 | PASS |
| `soak-comparison-nav-1781515744686.json` | `leak-soak-comparison-nav` | 2026-06-15T09:29:04.686Z | 8.56 | 1448 | 0.06 | 1.00 | PASS |

## Notes

- Aggregated from `outputs/e2e/perf/soak-*.json`.
- Worst run: `soak-upload-analyze-1781435195984.json`.
