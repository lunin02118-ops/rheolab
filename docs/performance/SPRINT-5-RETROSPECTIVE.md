# Sprint 5 Retrospective - Library Projection

**Sprint window:** 2026-04-29
**Status:** closed as a fallback-safe read-model slice
**Mission:** add a denormalized Library projection and facet cache so common list/filter reads can avoid repeated joins/distinct queries.

## Verdict

Sprint 5 shipped the read-model foundation without deleting the legacy path. The Library list now uses `ExperimentListProjection` for supported queries when projection rows are complete/current, and safely falls back to legacy SQL for unsupported filters or stale projection state.

The measured 1k synthetic DB query is already sub-10 ms on both legacy and projection paths, so there is no honest UI-level latency claim yet. The value is in the new architecture: projection rows are maintained on writes, facets are cached, and existing installs can rebuild through the Sprint 4 scheduler.

## What Shipped

| Area | Result |
| --- | --- |
| DB | `v0009_experiment_list_projection` creates `ExperimentListProjection`, `ExperimentFacetCache`, and `ExperimentProjectionMeta`. |
| Repository | Projection build/upsert/delete/rebuild, facet rebuild, status, readiness, and projection query APIs. |
| Write path | `persist_experiment` upserts projection after reagents; delete/import dirty or rebuild facets. |
| Read path | `experiments_list` uses projection for supported ready queries. |
| Fallback | Reagent filters, batch filters, non-default custom touch thresholds, and stale/incomplete projection stay legacy. |
| Facets | `experiments_filter_metadata` reads `ExperimentFacetCache` when projection is ready; otherwise legacy distinct queries remain. |
| Scheduler | `experiments_projection_rebuild` runs via `JobKind::ExperimentProjectionRebuild`. |
| Frontend bridge | `experimentProjection.status()` and `.rebuild()` wrappers are available. |
| Validation | Migration tests, repository tests, list suite, parity test, and manual 1k DB microbench. |

## Definition Of Done

| Item | Status |
| --- | --- |
| v0009 projection/facet migration registered | Done |
| Projection rebuild job exists and uses scheduler | Done |
| Save/delete/import update or invalidate projection/facets | Done |
| `experiments_list` uses projection for default/simple paths | Done |
| Unsupported cases safely fallback to legacy query | Done |
| `experiments_filter_metadata` reads facet cache when ready | Done |
| Parity tests cover default/simple filter fallback vs projection | Done |
| Perf validation report exists | Done |
| BUDGETS updated with Sprint 5 DB-level note | Done |
| No new large IPC suppressions | Done |

## Follow-Ups

| ID | Follow-up | Owner |
| --- | --- | --- |
| S5-FU-001 | Add `ExperimentReagentProjection` if reagent filters become a hot path. | Sprint 5.5 / Library |
| S5-FU-002 | Update Playwright DB-scale runner to capture Rust DB spans for `DB-LIST` and `DB-FACET`. | Perf instrumentation |
| S5-FU-003 | Consider startup-scheduled projection rebuild prompt for old installs. | Runtime/UI |
| S5-FU-004 | Add projection retention/drift diagnostics to app support export. | Support tooling |

## See Also

- `docs/performance/SPRINT-5-PLANNING.md`
- `docs/performance/LIBRARY-PROJECTION-VALIDATION.md`
- `docs/performance/BUDGETS.md`
