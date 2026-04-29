# Sprint 3 retrospective - AnalysisArtifact cache

**Sprint window:** 2026-04-29
**Status:** closed as a comparison by-IDs vertical slice
**Mission:** add a persistent `AnalysisArtifact` cache so stable experiment analysis output can be reused by report flows without recomputing the pure analysis kernel.

## Verdict

Sprint 3 shipped the durable cache foundation and wired it into the production-native comparison PDF/XLSX by-IDs path.

The cache works functionally: cold comparison exports run analysis and store one artifact per experiment; warm exports decode `AnalysisOutput` from SQLite; corrupt artifacts are deleted and recomputed; save/update invalidates artifacts for the changed experiment; delete cascades through the migration FK.

The full-export latency win is intentionally not claimed. The fixture bench shows PDF and XLSX warm exports are almost flat because report rendering dominates the measured wall time. CPU/RAM were not sampled by the Sprint 3 cache bench, so the closeout does not claim new CPU/RAM savings for this sprint.

## What shipped

| Area | Result |
| --- | --- |
| Migration | `v0008_analysis_artifact` creates `AnalysisArtifact`, unique key index, lookup index, and LRU index. |
| Repository | `get`, `put`, delete-by-experiment, prune-by-version, and LRU prune helpers landed with SQLite tests. |
| Cache key | Stable key covers experiment ID, data hash, geometry, settings hash, report rates hash, core version, and algorithm version. |
| Codec | `analysis-output.json+zstd:v1` encodes/decodes `AnalysisOutput` with a decompression size guard. |
| Report integration | Comparison PDF/XLSX by-IDs use short DB scopes: load/cache hit, drop connection, compute misses, store misses, render. |
| Invalidation | Experiment save/update deletes that experiment's artifacts; experiment delete cascades by FK. |
| Validation | Cold/warm cache behavior, corrupt-cache repair, request order preservation, and blob-hash keying are covered by tests. |
| Documentation | Validation report and budgets now include measured cold/warm results and explicit no-material-win note. |

## Performance closeout

The measured cache validation is recorded in `ANALYSIS-ARTIFACT-CACHE-VALIDATION.md`.

| Scenario | Cold mean | Warm mean | Delta | Cache proof |
| --- | ---: | ---: | ---: | --- |
| Comparison PDF N=5 | 3,228.0 ms | 3,200.0 ms | -0.9% | 15 hits across 3 warm iterations |
| Comparison XLSX N=5 | 11,182.9 ms | 11,177.4 ms | -0.05% | 15 hits across 3 warm iterations |

Interpretation:

- The cache is hitting and artifact bytes are small, around 15.6 KB total for the N=5 fixture set.
- Full report latency did not materially improve because render cost dominates this debug Rust bench.
- Budgets stay unchanged; no Sprint 3 CPU/RAM claim is made without process sampling.

## Two-stage comparison

| Stage | Path compared | PDF wall delta | XLSX wall delta | CPU/RAM status |
| --- | --- | ---: | ---: | --- |
| Sprint 2 | Legacy payload IPC -> native by-IDs | -18.0% | -4.1% | Measured; renderer CPU improved for both, PDF native working set improved materially. |
| Sprint 3 | Cold by-IDs -> warm AnalysisArtifact cache | -0.9% | -0.05% | Not sampled; bench records wall time, hit counts, rows, and artifact bytes. |

## Definition of Done

| Item | Status |
| --- | --- |
| `AnalysisArtifact` migration exists and is registered | Done |
| Migration/repository/cache key/codec tests exist | Done |
| Comparison PDF by-IDs uses cache | Done |
| Comparison XLSX by-IDs uses cache | Done |
| Cold/warm structural parity is covered | Done at report-input/cache behavior level |
| Cold/warm validation report exists | Done |
| `BUDGETS.md` has measured no-material-win note | Done |
| Cache invalidation on delete/update is tested | Done |
| Legacy fallback removal issue exists with gate | Done: https://github.com/10lunin021189-max/rheolab/issues/2 |
| Release validation commands are green | Done |

## Explicit deferrals

| Deferred item | Why | Owner sprint |
| --- | --- | --- |
| Dashboard persistent cache adoption | Current dashboard analysis uses mutable frontend points, expert overrides, and manual geometry remapping. A by-id command contract is needed before keying by DB blob is safe. | Sprint 4+ |
| Single-experiment report cache adoption | Current single-report IPC receives a full frontend `ReportInput`; a by-id report command should come first. | Sprint 4+ |
| CPU/RSS/JS heap cache metrics | Sprint 3 bench is Rust-only and does not sample processes. | Sprint 4 scheduler/instrumentation |
| Legacy comparison payload removal | Rollback lane remains gated by one alpha and one beta window with no by-IDs regressions. | Release hardening after gate |
| Budget tightening | Warm-cache full-render win is not material yet. | After release-mode/scheduler metrics show a stable improvement |

## Validation summary

| Check | Status |
| --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | Passed: 422 passed, 1 ignored |
| `npm test` | Passed |
| `npm run version:validate` | Passed |
| `npm run audit:large-ipc` | Passed with the expected legacy suppression |
| `git diff --check` | Passed |
| Manual cold/warm fixture bench | Captured |

## Lessons learned

1. The cache should stay above the pure analysis kernel; keeping `run_full_analysis_kernel` cache-free preserved benches and tests.
2. A DB cache does not guarantee report latency wins when render dominates. Measure the whole path and write down flat results.
3. Short SQLite connection scopes matter: cache IO can be split cleanly from CPU analysis and render.
4. Dashboard/single-report cache adoption needs by-id contracts, not a shortcut over mutable frontend payloads.
5. Sprint closeout should distinguish "functional foundation shipped" from "performance win proven".

## See also

- `docs/performance/SPRINT-3-PLANNING.md`
- `docs/performance/ANALYSIS-ARTIFACT-CACHE-VALIDATION.md`
- `docs/performance/BUDGETS.md`
- `docs/performance/SPRINT-2-RETROSPECTIVE.md`
- `docs/adr/ADR-0013-no-large-ipc-rule.md`
