# Sprint 5 Planning - Library Projection

**Status:** implemented as a fallback-safe vertical slice.
**Date:** 2026-04-29
**Mission:** move common Library list/filter/facet reads onto a denormalized read model without removing the legacy SQL path.

## Scope

Sprint 5 introduces:

- `ExperimentListProjection` for list-card shape data.
- `ExperimentFacetCache` for filter sidebar metadata.
- `ExperimentProjectionMeta` for rebuild/facet dirty state.
- Write-path projection maintenance on experiment save/import/delete.
- Scheduler-backed projection rebuild IPC.
- Projection reads for default/simple library queries when the projection is complete and current.
- Legacy fallback for unsupported or unsafe cases.

Out of scope:

- Binary chart series IPC.
- Arbitrary dynamic touch-threshold projection.
- Full frontend job center.
- Removal of legacy `experiments_list` SQL.

## Design

Migration `v0009_experiment_list_projection` creates the read-model tables only. It does not backfill data during migration, so app startup stays cheap on existing installs.

The read path uses projection only when:

- all `Experiment` rows have current projection rows;
- projection version matches `EXPERIMENT_LIST_PROJECTION_VERSION`;
- canonical `Experiment.updatedAt` and touch-point precompute fields still match the projection;
- query filters are supported by projection v1.

The unsupported cases stay on legacy SQL:

- reagent name filters;
- batch number filters;
- non-default custom touch threshold filters.

## Runtime API

New IPC:

- `experiments_projection_status`
- `experiments_projection_rebuild`

`experiments_projection_rebuild` runs through Sprint 4 `JobScheduler` as `JobKind::ExperimentProjectionRebuild`, batches rows in groups of 250, emits progress, rebuilds facets at the end, and stores rebuild metadata.

## Definition Of Done

| Item | Status |
| --- | --- |
| v0009 migration registered | Done |
| Projection/facet repository exists | Done |
| Save/import/delete maintain projection or dirty state | Done |
| Projection rebuild uses scheduler | Done |
| `experiments_list` uses projection for supported ready queries | Done |
| Unsupported queries fallback to legacy SQL | Done |
| `experiments_filter_metadata` can read facet cache | Done |
| Legacy/projection parity tests exist | Done |
| Manual DB-level validation exists | Done |
| No new large IPC suppressions | Done |
