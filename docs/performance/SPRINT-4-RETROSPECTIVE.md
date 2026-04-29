# Sprint 4 Retrospective - Job Scheduler

**Sprint window:** 2026-04-29
**Status:** closed; release gate green on the Sprint 4 branch
**Mission:** route heavy report/cache work through a Rust runtime scheduler with job state, progress, cancellation hooks, and per-job metrics.

## Verdict

Sprint 4 now has the runtime architecture that Sprint 3 needed as its next layer: a scheduler in `AppState`, job status IPC, progress events, comparison PDF/XLSX by-IDs running through the scheduler, and AnalysisArtifact prune maintenance through the same runtime path.

The local Rust test-binary loader issue found during implementation is resolved. The final branch gate passes with `cargo check`, full `cargo test --lib`, Vitest, version validation, large-IPC audit, and `git diff --check`.

## What Shipped

| Area | Result |
| --- | --- |
| Scheduler core | `runtime::jobs::JobScheduler` owns registry, cancellation tokens, job gates, progress updates, and metrics finalization. |
| AppState | `AppState` now owns `Arc<JobScheduler>`. |
| Job IPC | `jobs_list`, `jobs_get`, `jobs_cancel`. |
| Events | `job://created`, `job://progress`, `job://finished`. |
| Reports | `reports_generate_comparison_pdf_by_ids` and `_excel_by_ids` run through scheduler-owned `ComparisonPdf` / `ComparisonExcel` jobs. |
| Cancellation | Checked before load/cache, between analysis misses, before cache store, and before render. Render itself remains non-cancellable in this sprint. |
| Metrics | `queuedMs`, `wallMs`, cache hits/misses, artifact bytes, and output bytes are recorded. CPU/RSS fields are present but nullable. |
| Cache maintenance | `analysis_cache_stats` and scheduler-backed `analysis_cache_prune`. |
| Frontend bridge | Tauri wrappers and `PlatformBridge` entries for `jobs` and `analysisCache`. |

## Definition of Done

| Item | Status |
| --- | --- |
| Job scheduler core exists and is in `AppState` | Done |
| Comparison PDF/XLSX by-IDs reports run through scheduler | Done |
| Max concurrent comparison reports = 1 enforced by scheduler | Done |
| `jobs_list` / `jobs_get` / `jobs_cancel` exist | Done |
| Progress events emitted for report jobs | Done |
| Cancellation works before render stage | Implemented |
| `wallMs` and `queuedMs` captured for every job | Done |
| RSS peak captured or documented | Documented as nullable until a loader-safe process sampler lands |
| AnalysisArtifact prune job exists | Done |
| Scheduler validation report exists | Done |
| `npm test` passes | Done |
| `cargo test --lib` passes | Done: 426 passed / 1 ignored |
| `version:validate` / `audit:large-ipc` / `diff --check` | Done |

## Follow-Ups

| ID | Follow-up | Owner |
| --- | --- | --- |
| S4-FU-001 | Add loader-safe per-job CPU/RSS sampler. | Scheduler hardening |
| S4-FU-002 | Move cache-hit raw point parsing fully outside the first DB scope. | Sprint 5 or scheduler hardening |
| S4-FU-003 | Add async start/result API for report jobs when UI is ready for a full job center. | Later UI sprint |
| S4-FU-004 | Remove legacy comparison payload fallback after alpha + beta rollback window. | Release hardening |

## See Also

- `docs/performance/JOB-SCHEDULER-VALIDATION.md`
- `docs/performance/SPRINT-3-RETROSPECTIVE.md`
- `docs/performance/BUDGETS.md`
