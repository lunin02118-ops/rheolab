# Sprint 2 retrospective — native comparison reports by IDs

**Sprint window:** 2026-04-29  
**Status:** closed for alpha with explicit rollback-window deferrals  
**Mission:** replace the default comparison report export path with native by-IDs commands so the frontend no longer assembles large per-experiment report payloads.

## Verdict

Sprint 2 delivered the main ROI lever: comparison PDF/XLSX exports now default to native by-IDs IPC. The frontend sends experiment IDs plus settings; Rust loads experiments from SQLite, runs analysis, and renders PDF/XLSX without the heavy TypeScript payload assembly on the default path.

The legacy TypeScript payload path remains available only as a rollback lane for one alpha/beta cycle. That means the historical `LARGE-IPC-EXCEPTION` marker is still present on `reports_generate_comparison_pdf`, but it is no longer the default production path.

## What shipped

| Area | Result |
| --- | --- |
| Lead-in docs | ADR-0013 no-large-IPC rule and V1 DDL contract landed. |
| Perf tooling | Library budget extractor, fixture DB microbench orchestration, comparison smoke runner, PDF/XLSX fixture microbench targets. |
| Backend | `reports_generate_comparison_pdf_by_ids` and `reports_generate_comparison_excel_by_ids` generate real native reports. |
| Validation | Request validation, license gating, duplicate/missing ID handling, order preservation, parity/golden tests. |
| Frontend | `useComparisonReportExport` routes default PDF/XLSX downloads through by-IDs wrappers. |
| Fallback | Emergency `localStorage['rheolab.comparisonReports.forceLegacy']='1'` path retained. |
| DB lifetime | Pooled SQLite connection is released immediately after loading experiments, before analysis/rendering. |

## Key commits on the feature branch

| Commit | Subject |
| --- | --- |
| `1c3a438` | `feat(reports): Use by-ids comparison export` |
| `fcdbc04` | `ref(reports): Release DB connection before by-ids render` |
| `8e8d2db` | `feat(perf): Add fixture mode to comparison PDF bench` |
| `d58690b` | `feat(perf): Add XLSX comparison microbench target` |

Earlier backend by-IDs and parity coverage landed on `main` before the UI-switch branch and are referenced from `REPORTS-NATIVE-BY-IDS-VALIDATION.md`.

## Validation summary

| Check | Status |
| --- | --- |
| Rust reports focused tests | Passed |
| Full Rust lib tests | Passed |
| Focused hook/client Vitest | Passed |
| Full `npm test` for UI switch | Passed |
| TypeScript `tsc --noEmit` | Passed |
| `npm run version:validate` | Passed |
| `npm run audit:large-ipc` | Passed with expected legacy suppression |
| `git diff --check` | Passed |
| `bench_comparison_pdf` fixture DB PDF N=5/N=10 | Passed |
| `bench_comparison_pdf --format xlsx` fixture DB XLSX N=5/N=10 | Passed |

## Performance closeout

The fixture-backed microbench numbers are recorded in `REPORTS-NATIVE-BY-IDS-VALIDATION.md`.

| Budget | Measured p50 | Current soft budget | Status |
| --- | ---: | ---: | --- |
| `L-CMP-PDF-5` | 230.8 ms | 12,000 ms | Within |
| `L-CMP-XLSX-5` | 2,399.8 ms | 5,000 ms | Within |
| `L-CMP-PDF-10` | 252.3 ms | optional in S2 | Captured |
| `L-CMP-XLSX-10` | 2,657.9 ms | optional in S2 | Captured |

The UI-level `L-CMP-3/5/10` setup budgets still depend on a comparison smoke runner with a license override for N=5/N=10. Sprint 2 shipped the runner, but the override itself is deferred.

## Explicit deferrals

| Deferred item | Why | Owner sprint |
| --- | --- | --- |
| Remove legacy comparison payload path | Rollback lane required for one alpha/beta cycle. | Sprint 3 close / release hardening |
| Remove `LARGE-IPC-EXCEPTION` marker | Same rollback lane; marker belongs to legacy command only. | Sprint 3 close / release hardening |
| Per-report JS heap peak | Current fixture microbench is Rust-only and does not attach browser heap sampling. | Sprint 3/4 instrumentation |
| Per-report Rust RSS peak | Needs process-level RSS sampling around handler/job spans. | Sprint 4 scheduler/instrumentation |
| UI `L-CMP-5/10` smoke | Demo license cap still blocks N > 3 in Playwright flow. | Sprint 3 license test helper |

## Lessons learned

1. Native by-IDs should be treated as the stable architecture, not a feature flag experiment. The fallback exists for rollback only.
2. Golden parity at the Rust layer was the right proof surface because it avoids browser/Tauri dialog noise.
3. Connection lifetime matters even when work is already inside `spawn_blocking`; holding a pool slot during render is unnecessary.
4. The microbench harness should support both PDF and XLSX because XLSX output size is materially larger and has different scaling behavior.
5. Closeout documents must distinguish hard blockers from intentional release-window deferrals.

## See also

- `docs/performance/SPRINT-2-PLANNING.md`
- `docs/performance/REPORTS-NATIVE-BY-IDS-VALIDATION.md`
- `docs/performance/SPRINT-3-PLANNING.md`
- `docs/performance/BUDGETS.md`
- `docs/adr/ADR-0010-comparison-report-generation.md`
- `docs/adr/ADR-0013-no-large-ipc-rule.md`
