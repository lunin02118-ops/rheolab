# Memory Performance Report — Tauri Soak

- Generated at (UTC): 2026-06-14T05:08:17.191238+00:00
- Source: `tauri-soak`
- Input glob: `soak-*.json`
- Playwright command: `npx playwright test --config playwright.tauri-soak.config.ts --workers=1`
- Playwright status: `skipped` — Skipped by --skip-playwright flag.
- Runs analyzed: `18`
- Pass/Fail by thresholds: `18` / `0`
- Machine-readable summary: `outputs/e2e/perf/tauri-soak-summary-20260614-050817.json`

## Aggregate Stats

| Metric | Min | Median | Mean | P95 | Max |
|---|---:|---:|---:|---:|---:|
| Peak heap (MB) | 7.95 | 8.59 | 8.56 | 8.81 | 8.81 |
| Peak nodes | 980 | 1214 | 1212 | 1441 | 1441 |
| Slope (MB/round) | 0.04 | 0.07 | 0.07 | 0.14 | 0.14 |
| Nodes ratio | 0.98 | 1.00 | 1.00 | 1.01 | 1.01 |

## Run Table

| File | Scenario | Generated | PeakHeap MB | PeakNodes | Slope MB/round | Nodes Ratio | Gate |
|---|---|---|---:|---:|---:|---:|---|
| `soak-upload-analyze-1781347357292.json` | `leak-soak-upload-analyze` | 2026-06-13T10:42:37.292Z | 8.43 | 987 | 0.12 | 1.01 | PASS |
| `soak-comparison-nav-1781347365012.json` | `leak-soak-comparison-nav` | 2026-06-13T10:42:45.012Z | 8.51 | 1440 | 0.07 | 1.00 | PASS |
| `soak-upload-analyze-1781347386412.json` | `leak-soak-upload-analyze` | 2026-06-13T10:43:06.412Z | 7.95 | 980 | 0.10 | 1.00 | PASS |
| `soak-comparison-nav-1781347394651.json` | `leak-soak-comparison-nav` | 2026-06-13T10:43:14.651Z | 8.69 | 1441 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1781347424593.json` | `leak-soak-upload-analyze` | 2026-06-13T10:43:44.593Z | 8.50 | 987 | 0.12 | 1.01 | PASS |
| `soak-comparison-nav-1781347433505.json` | `leak-soak-comparison-nav` | 2026-06-13T10:43:53.505Z | 8.68 | 1440 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1781407727637.json` | `leak-soak-upload-analyze` | 2026-06-14T03:28:47.637Z | 8.59 | 993 | 0.05 | 0.98 | PASS |
| `soak-comparison-nav-1781407735351.json` | `leak-soak-comparison-nav` | 2026-06-14T03:28:55.351Z | 8.60 | 1436 | 0.07 | 1.00 | PASS |
| `soak-upload-analyze-1781407750268.json` | `leak-soak-upload-analyze` | 2026-06-14T03:29:10.268Z | 8.58 | 984 | 0.07 | 1.00 | PASS |
| `soak-comparison-nav-1781407757968.json` | `leak-soak-comparison-nav` | 2026-06-14T03:29:17.968Z | 8.58 | 1435 | 0.07 | 1.00 | PASS |
| `soak-upload-analyze-1781407772731.json` | `leak-soak-upload-analyze` | 2026-06-14T03:29:32.732Z | 8.52 | 993 | 0.05 | 0.99 | PASS |
| `soak-comparison-nav-1781407780417.json` | `leak-soak-comparison-nav` | 2026-06-14T03:29:40.417Z | 8.59 | 1435 | 0.06 | 1.00 | PASS |
| `soak-upload-analyze-1781413306598.json` | `leak-soak-upload-analyze` | 2026-06-14T05:01:46.598Z | 8.58 | 984 | 0.09 | 1.00 | PASS |
| `soak-comparison-nav-1781413314278.json` | `leak-soak-comparison-nav` | 2026-06-14T05:01:54.278Z | 8.59 | 1435 | 0.07 | 1.00 | PASS |
| `soak-upload-analyze-1781413328537.json` | `leak-soak-upload-analyze` | 2026-06-14T05:02:08.537Z | 8.61 | 984 | 0.06 | 1.00 | PASS |
| `soak-comparison-nav-1781413336206.json` | `leak-soak-comparison-nav` | 2026-06-14T05:02:16.206Z | 8.66 | 1435 | 0.05 | 1.00 | PASS |
| `soak-upload-analyze-1781413351009.json` | `leak-soak-upload-analyze` | 2026-06-14T05:02:31.009Z | 8.65 | 984 | 0.14 | 1.00 | PASS |
| `soak-comparison-nav-1781413358695.json` | `leak-soak-comparison-nav` | 2026-06-14T05:02:38.695Z | 8.81 | 1435 | 0.04 | 1.00 | PASS |

## Notes

- Aggregated from `outputs/e2e/perf/soak-*.json`.
- Worst run: `soak-upload-analyze-1781413351009.json`.

