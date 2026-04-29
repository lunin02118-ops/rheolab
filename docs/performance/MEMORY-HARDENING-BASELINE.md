# Memory Hardening Baseline

**Status:** baseline plan, not final scorecard.
**Date:** 2026-04-29.
**Purpose:** define how memory hardening will be measured before and after the
detail-path refactor.

## Why this exists

The current RC scorecard is useful, but it mixes two confidence levels:

- baseline workflow memory is p50/p95 from a 4-run local family;
- current RC workflow memory is a single fresh spot-check.

That means the current run can answer "did this look obviously worse right
now?", but it cannot prove a stable p50/p95 change. MEM-0 closes that gap by
collecting repeated current runs before memory-heavy code changes begin.

## Current reference points

Source: `RC-PERFORMANCE-SCORECARD.md`.

| Metric | Local baseline p50 | Local baseline p95 | Current RC spot-check | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Total RSS / working set | 673.82 MB | 747.66 MB | 624.70 MB | No evidence of app-wide growth in this one run |
| WebView2 renderer RSS | 200.05 MB | 206.79 MB | 201.81 MB | Flat vs baseline p50, inside p95 |
| Tauri RSS | 66.45 MB | 67.58 MB | 68.75 MB | Slightly higher, about 1-3 MB |
| Tauri CPU peak | 5.73 s | 6.05 s | 5.44 s | Inside envelope |

Comparison smoke spot-check:

| Metric | Current comparison peak | Status |
| --- | ---: | --- |
| Total RSS / working set | 677.64 MB | Inside p95 budget |
| WebView2 renderer RSS | 233.57 MB | Above p50 budget, inside p95 budget |
| Tauri RSS | 66.05 MB | Inside budget |

## Baseline rule

Do not compare a single current peak to a p50/p95 baseline as if both have the
same statistical weight.

Use this wording until repeated current runs exist:

```text
Current run is a spot-check. It does/does not show obvious growth, but it is
not a stable p50/p95 trend.
```

Use this wording after 3-5 comparable current runs:

```text
Current p50/p95 changed by X/Y versus the baseline p50/p95.
```

## Run matrix

| Runner | Repeats | Required before MEM-1? | Metrics |
| --- | ---: | --- | --- |
| `perf:workflow:tauri` | 3-5 | Yes | total RSS, renderer RSS, Tauri RSS, JS heap, wall |
| `perf:db:small` | 3-5 | Yes | library open, filter, detail open, heap |
| `perf:db:large` | 3-5 | Yes | same as small DB at scale |
| `perf:comparison:tauri` | 3-5 | Preferred | comparison setup, smoke export, native memory |
| dashboard detail runner | 3-5 | When available | detail open, chart first paint, heap delta |
| chart zoom/pan runner | 3-5 | When available | payload bytes, pan/zoom latency, long tasks |

## Local commands

```powershell
npm run build:ci
npm test
npm run version:validate
npm run audit:large-ipc

npm run perf:workflow:tauri
npm run perf:db:small
npm run perf:db:large
npm run perf:comparison:tauri
```

## Metric definitions

| Metric | Definition | Primary source |
| --- | --- | --- |
| Total RSS | Peak Tauri + WebView2 working set in MB | native memory sidecar |
| Renderer RSS | Peak WebView2 renderer working set in MB | native memory sidecar |
| Tauri RSS | Peak Rust process working set in MB | native memory sidecar |
| JS heap peak | Peak renderer heap in MB | Playwright perf JSON |
| Long tasks | Count and longest task over 50 ms | future PerformanceObserver runner |
| Detail open wall | Click/open saved experiment detail to ready state | DB-scale / dashboard runner |
| Chart first paint | Saved chart request to visible chart render | future chart runner |
| Raw table tab open | Table tab click to visible first page | future dashboard runner |
| Report tab open | Report tab click to ready state | future dashboard runner |

## Expected output format

Each repeated run family should be summarized like this:

| Metric | Baseline p50 | Baseline p95 | Current p50 | Current p95 | Delta p50 | Delta p95 | Status |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Total RSS | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Renderer RSS | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Tauri RSS | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| JS heap peak | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

For metrics with fewer than 3 current runs, use `spot-check` instead of
`p50/p95`.

## Baseline DoD

- At least 3 comparable current workflow runs are recorded.
- At least 3 small and large DB-scale runs are recorded.
- Output artifact paths are listed.
- p50/p95 is calculated from the same metric family.
- Any outlier is explained, not silently dropped.
- `MEMORY-HARDENING-SCORECARD.md` remains deferred until MEM-7.

## Known gaps before MEM-1

- Chart first paint and pan/zoom latency are not release-grade metrics yet.
- Long-task collection is still missing.
- Detail open still loads full raw points through the legacy detail flow.
- Scheduler CPU/RSS metrics remain nullable.
- Comparison renderer RSS needs repeated smoke runs before it can be treated as
  a trend.
