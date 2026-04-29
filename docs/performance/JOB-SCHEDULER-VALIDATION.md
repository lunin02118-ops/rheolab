# Job Scheduler Validation - Sprint 4

**Date:** 2026-04-29
**Scope:** Rust runtime job scheduler, comparison PDF/XLSX by-IDs report jobs, and AnalysisArtifact cache maintenance IPC.

## What Was Validated

| Check | Result |
| --- | --- |
| Scheduler core compiles into the Rust test binary | Passed: `cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run` |
| Frontend bridge/types compile under Vitest | Passed: `npm test` |
| Comparison by-IDs commands are routed through `JobScheduler::run_blocking` | Implemented for PDF and XLSX |
| Comparison report concurrency limit | Implemented with scheduler-owned atomic gate, max 1 active comparison report |
| Job IPC | `jobs_list`, `jobs_get`, `jobs_cancel` registered |
| Progress events | `job://created`, `job://progress`, `job://finished` emitted when an `AppHandle` is available |
| Cancellation | Supported before load/cache work, between analysis items, before cache store, and before render |
| Cache maintenance | `analysis_cache_stats` and scheduler-backed `analysis_cache_prune` registered |

## Metrics Captured

Every scheduler job records:

| Metric | Status |
| --- | --- |
| `queuedMs` | Captured |
| `wallMs` | Captured |
| `cacheHits` / `cacheMisses` | Captured for comparison by-IDs reports |
| `artifactBytesRead` / `artifactBytesWritten` | Captured for comparison by-IDs reports |
| `outputBytes` | Captured for report jobs |
| `cpuMsDelta` | Field exists, currently `null` in this environment |
| `rssMbStart` / `rssMbPeak` / `rssMbEnd` | Fields exist, currently `null` in this environment |

CPU/RSS process sampling was not enabled inside the app binary in this slice. A direct Windows process API attempt made the local Rust test executable fail before the test harness started with `STATUS_ENTRYPOINT_NOT_FOUND`, so Sprint 4 keeps the fields optional and relies on the existing release-gate native memory sampler for process RSS until the sampler can be made loader-safe.

The test-binary loader issue was resolved for the scheduler slice by keeping Tauri event emission out of `cfg(test)` builds and by waiting for scheduler gates inside the blocking job task instead of using `tokio::time`. The full Rust lib suite now starts normally and passes.

## Validation Commands

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm ci
npm test
npm run version:validate
npm run audit:large-ipc
git diff --check
```
