# RC Memory Hardening Final Scorecard

**Date:** 2026-04-30.
**Branch:** `codex/hardening-final-scorecard`.
**Base:** `codex/hardening-report-tab-by-id` at `aa490f6`.
**Scope:** final RC validation after memory-hardening PRs #7 through #21.

## Verdict

The memory-hardening track is validated as an app-controlled memory refactor.
The main hot paths no longer need to materialize full scientific raw point
arrays in the renderer:

- saved detail chart opens from metadata plus binary series overview/window;
- zoom/pan requests call bounded `experiments_series_window` payloads;
- saved detail analysis runs by experiment id through `AnalysisArtifact`;
- saved raw table reads pages by id;
- saved Report tab exports by id;
- comparison exports are by ids only;
- large IPC audit has zero suppressions and zero violations;
- scheduler/job retention and CPU/RSS diagnostics are bounded.

Do not claim a hard Total RSS victory. Total RSS remains partly controlled by
WebView2, GPU, and runtime allocation behavior. The correct release claim is:
renderer-owned payload/state is bounded, JS heap stays low, and default saved
detail/report flows no longer require full raw points in frontend state.

## Before And After

Source for the pre-refactor comparison is
`docs/performance/MEMORY-HARDENING-SCORECARD.md`.

| Metric | Stored baseline p50 / p95 | Memory track p50 / p95 | Fresh RC single run | Read |
| --- | ---: | ---: | ---: | --- |
| Total RSS | 673.82 / 747.66 MB | 654.55 / 753.28 MB | peak 744.65 MB | p50 improved; p95/peak soft |
| Renderer RSS | 200.05 / 206.79 MB | 207.26 / 207.45 MB | peak 205.82 MB | stable, not a hard win |
| Tauri RSS | 66.45 / 67.58 MB | 68.11 / 73.36 MB | peak 70.11 MB | watch, acceptable |
| JS heap peak | 9.81 / 9.84 MB | 9.84 / 9.85 MB | 9.82 MB | flat and low |
| Workflow wall | 19,173 / 19,267 ms | 19,751 / 19,918 ms | 20,476 ms | within workflow budget |

Interpretation:

- The meaningful win is not a universal Total RSS drop.
- The meaningful win is removing full raw arrays and full report/comparison
  payloads from default renderer ownership.
- JS heap staying under 10 MB in workflow is the strongest signal that the
  renderer is no longer retaining large scientific arrays on those paths.

## Final Commands Run

Perf validation completed on the final scorecard branch:

```powershell
npm run perf:workflow:tauri
npm run perf:db:small
npm run perf:db:large
npm run perf:comparison:tauri
npm run perf:comparison:tauri:real
npm run perf:comparison:tauri:memory
npm run perf:chart:tauri
npm run perf:chart:tauri:memory
```

Top-of-stack gate also passed on this branch:

```powershell
npm run build:ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run version:validate
npm run audit:large-ipc
git diff --check
```

The chart runner was repeated after reverting temporary product zoom changes;
only the Playwright runner fix remains. This confirms the window-refetch result
comes from the existing chart behavior plus a deterministic visible drag in the
runner.

## Workflow

Artifacts:

- `outputs/e2e/perf/workflow-1777538530569-tauri.json`
- `outputs/e2e/perf/native-memory-1777538526000.jsonl`

| Metric | Value |
| --- | ---: |
| Workflow wall | 20,476 ms |
| Peak JS heap | 9.82 MB |
| Peak DOM nodes | 1,637 |
| Comparison chart load | 2,174 ms |
| Chandler PDF | 1,263 ms |
| Grace PDF | 1,808 ms |
| Native memory samples | 11 |
| Peak Total RSS | 744.65 MB |
| Peak Renderer RSS | 205.82 MB |
| Peak Tauri RSS | 70.11 MB |
| Peak GPU RSS | 266.60 MB |

The workflow run remains inside the existing wall/heap/node budgets. Total RSS
peak is close to the old p95, so it stays a soft budget.

## Library UI And Render Latency

Artifacts:

- `outputs/e2e/perf/db-scale-1777538610228-small-tauri.json`
- `outputs/e2e/perf/db-scale-1777538633879-large-tauri.json`

Small DB: 12 experiments, wall 10,601 ms, peak heap 8.52 MB.
Large DB: 7,056 experiments, wall 10,515 ms, peak heap 8.64 MB.

| Scenario | Total span | Debounce | IPC | Render commit | Settle | Runner wall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small search | 393.0 ms | 207.7 ms | 4.8 ms | 16.4 ms | 130.5 ms | 885 ms |
| Small fluid filter | 446.2 ms | 211.4 ms | 5.5 ms | 26.7 ms | 183.8 ms | 956 ms |
| Small date filter | 378.5 ms | 204.3 ms | 5.1 ms | 23.8 ms | 122.9 ms | 897 ms |
| Large search | 408.3 ms | 205.1 ms | 13.2 ms | 22.6 ms | 128.7 ms | 895 ms |
| Large fluid filter | 423.5 ms | 205.8 ms | 7.8 ms | 24.8 ms | 175.8 ms | 922 ms |
| Large date filter | 381.0 ms | 203.4 ms | 8.7 ms | 26.2 ms | 123.6 ms | 869 ms |

This is the important UI/render answer: the DB/IPC part is small. The remaining
latency is debounce, React/render commit, visual settle, and runner wait. The
next optimization target is UI scheduling and render/settle behavior, not SQL.

## Comparison

Artifacts:

- `outputs/e2e/perf/comparison-smoke-1777538655775-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777538690527-tauri.json`
- `outputs/e2e/perf/comparison-smoke-1777538730019-tauri.json`

| Mode | N | Setup ready | PDF | PDF bytes | XLSX | XLSX bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mocked | 3 | 3,159 ms | 42 ms | 8 | 39 ms | 4 |
| Mocked | 5 | 4,722 ms | 23 ms | 8 | 24 ms | 4 |
| Real | 3 | 3,041 ms | 147 ms | 68,108 | 638 ms | 365,494 |
| Real | 5 | 4,792 ms | 202 ms | 76,200 | 1,164 ms | 694,124 |

N=10 is skipped by the runtime comparison cap of 8. If product policy requires
N=10 UI smoke, the test license/runtime cap must be raised for that runner.

### Comparison Memory Phases

Memory-step mode is diagnostic only. It uses direct Win32 sampling and CDP GC
hints, so it must not be mixed into latency p50/p95 claims.

| N | Phase | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| ---: | --- | ---: | ---: | ---: | ---: |
| 3 | after_chart_visible | 537.93 MB | 171.66 MB | 130.48 MB | 65.52 MB |
| 3 | after_pdf | 631.25 MB | 233.59 MB | 132.79 MB | 63.94 MB |
| 3 | after_xlsx | 593.26 MB | 196.16 MB | 132.52 MB | 63.98 MB |
| 3 | after_export_gc_hint | 586.43 MB | 193.06 MB | 129.19 MB | 63.98 MB |
| 3 | after_route_leave | 596.64 MB | 198.07 MB | 131.25 MB | 65.11 MB |
| 5 | after_chart_visible | 653.88 MB | 208.37 MB | 192.34 MB | 68.25 MB |
| 5 | after_pdf | 662.72 MB | 208.46 MB | 200.58 MB | 68.27 MB |
| 5 | after_xlsx | 657.30 MB | 208.44 MB | 195.16 MB | 68.27 MB |
| 5 | after_export_gc_hint | 639.20 MB | 191.68 MB | 194.21 MB | 68.27 MB |
| 5 | after_route_leave | 638.67 MB | 192.72 MB | 193.34 MB | 66.21 MB |

Read:

- N=5 export cleanup reclaims about 16.76 MB renderer RSS after XLSX.
- The rest is WebView2/GPU/runtime retention, not proven app-level leakage.
- Comparison remains the main renderer RSS watch item.

## Chart Binary Window

Artifacts:

- `outputs/e2e/perf/chart-series-1777539605048-tauri.json`
- `outputs/e2e/perf/chart-series-1777539623222-tauri.json`

| Metric | Normal run | Memory run |
| --- | ---: | ---: |
| Detail first paint | 939 ms | 2,628 ms |
| Zoom window ready | 573 ms | 2,242 ms |
| Direct overview bytes | 33,432 | 33,432 |
| Direct window bytes | 16,792 | 16,792 |
| First app window bytes | 15,768 | 15,768 |
| App overview calls | 1 | 1 |
| App window calls | 1 | 1 |
| Final JS heap | 17.20 MB | 12.76 MB |
| Long tasks | 1 | 1 |

Memory phases in chart memory mode:

| Phase | Total RSS | Renderer RSS | GPU RSS | Tauri RSS | JS heap |
| --- | ---: | ---: | ---: | ---: | ---: |
| after_first_paint | 523.01 MB | 152.75 MB | 131.14 MB | 65.29 MB | 17.61 MB |
| after_zoom_window | 519.91 MB | 151.35 MB | 131.59 MB | 65.31 MB | 18.97 MB |
| after_route_leave | 517.83 MB | 149.79 MB | 131.48 MB | 65.27 MB | 12.48 MB |

Read:

- zoom triggers exactly one `experiments_series_window` call;
- IPC payload stays bounded by `maxPoints`;
- route leave drops JS heap back down in memory mode;
- memory mode is slower by design because of phase sampling.

## Saved Report Tab By Id

PR #21 closed the last large saved-detail Report tab export gap:

- saved metadata-only Report tab no longer calls `experiments_get` just to
  export PDF/XLSX;
- `reports_generate_pdf_by_id` and `reports_generate_excel_by_id` build report
  data in Rust from SQLite plus cached analysis;
- beginner mode by-id report export now uses the same defaults as
  `useAnalysisPipeline`;
- full water override fields are carried end-to-end:
  `fe`, `ca`, `mg`, `cl`, `so4`, `hco3`.

Targeted PR #21 gate was already green before this scorecard branch:

- targeted frontend tests: 39 passed;
- `cargo test --manifest-path src-tauri/Cargo.toml --lib commands::reports`:
  40 passed;
- `cargo test --manifest-path src-tauri/Cargo.toml export_ts_bindings`:
  passed;
- full `cargo test --manifest-path src-tauri/Cargo.toml --lib`:
  450 passed, 2 ignored;
- full `npm test`: passed;
- `npm run build:ci`: passed;
- `npm run version:validate`: passed;
- `npm run audit:large-ipc`: zero violations.

## Release Gate Read

GO for review/merge. The top-of-stack gate passed on this final scorecard
branch.

Keep these as beta/stable watch items:

- Total RSS remains soft until WebView2/GPU/runtime variability is separated
  from app-controlled state;
- comparison renderer RSS is still the main memory watch item;
- library filter latency should be tuned in UI scheduling/render/settle, not
  SQL first;
- N=10 comparison UI smoke requires an explicit runtime-cap decision;
- raw table Rust-side page decode can be optimized later if table paging on
  very large datasets becomes hot.
