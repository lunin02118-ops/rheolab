# Library Projection Validation

**Sprint:** 5
**Date:** 2026-04-29
**Branch:** `codex/sprint-5-library-projection`
**Version:** `0.2.2-alpha.3`

## What Was Validated

Sprint 5 validates the DB-level read model, not full UI render latency. The legacy UI-wall budgets remain proxy metrics until the Playwright scale runners are updated to isolate DB spans.

Validated paths:

- v0009 schema creation and idempotency.
- `ExperimentListProjection` cascade on experiment delete.
- save-path projection upsert.
- projection readiness fallback when canonical Experiment touch fields drift.
- projection query parity for default/simple filters.
- facet cache rebuild and read.
- scheduler-backed projection rebuild IPC.

## Manual Microbench

Command:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml bench_library_projection_1k_synthetic --lib -- --ignored --nocapture
```

Result:

| Scenario | Rows | Query | Wall ms |
| --- | ---:| --- | ---:|
| Legacy fallback | 1,000 | `fieldName = North`, page 1, limit 100 | 3 |
| Projection ready | 1,000 | same | 3 |
| Facet rebuild | 1,000 | all cached facets | 2 |

Interpretation: on the synthetic 1k DB, both legacy and projection list queries are already below the Sprint 5 DB budget. The material win is architectural: common reads no longer need joins or page-level reagent batch loading when projection is ready, and facet reads become cache lookups after rebuild.

## Budget Action

| Budget | Current Sprint 5 Result | Action |
| --- | ---:| --- |
| DB-LIST | 3 ms synthetic DB-level | keep UI-proxy budget; add real DB timing note |
| DB-FACET | 2 ms synthetic facet rebuild; cached reads are one indexed table scan | fill initial real DB validation note |
| L-LIB-OPEN / L-FILTER | not remeasured at UI level | unchanged until Playwright runner extracts DB spans |

## Residual Risk

| Risk | Status |
| --- | --- |
| Projection drift | Mitigated by write-path upsert, readiness checks, rebuild job, parity tests. |
| Stale facet cache | Mitigated by dirty flag and on-demand rebuild when projection is ready. |
| Unsupported filters | Safe legacy fallback remains. |
| Reagent filters | Deferred to a possible `ExperimentReagentProjection` follow-up. |
| UI-level latency | Still requires Playwright/db-span runner update. |
