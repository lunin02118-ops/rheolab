# Memory Hardening - Runtime Retention

**Date:** 2026-04-30.
**Track:** MEM-6.
**Status:** implementation validation.

## Goal

Bound long-session runtime retention without changing visible workflows:

- completed job records must not grow without limit;
- cancellation should be visible to the UI immediately;
- scheduler CPU/RSS metrics should be populated on supported desktop targets;
- leaving the dashboard detail view should hint Rust/SQLite to release caches.

## Implemented

### Job Registry Retention

`JobScheduler` now prunes terminal jobs with two safeguards:

- keep at most 100 terminal records;
- prune terminal records older than 60 minutes.

Queued/running/cancelling jobs are never pruned. `jobs_list` also applies the
same pruning pass so long-running sessions converge even if a record was
inserted before the retention policy existed.

### Immediate Cancel Progress

`jobs_cancel` now passes the app handle into the scheduler. When a cancellable
job is marked `Cancelling`, the scheduler emits `job://progress` immediately
instead of waiting for the worker to reach the next cancellation boundary.

### Process Metrics

The scheduler process sampler now reports current-process RSS and total CPU
milliseconds on Windows via `GetProcessMemoryInfo` and `GetProcessTimes`.
Unsupported platforms still return nullable metrics rather than failing jobs.

`rssMbPeak` is computed as the max of start/end snapshots for this slice. A
true interval sampler can replace that later if needed.

### Cache Release Hook

`DashboardContent` releases the Rust parse cache and runs SQLite
`PRAGMA shrink_memory` on unmount in Tauri runtime. This is best-effort and
does not block navigation.

### Async Gate Before Blocking Pool

Queued gated jobs now wait for their scheduler gate asynchronously before
entering `tokio::task::spawn_blocking`. Only the active job occupies a blocking
worker thread; queued comparison/report/import/maintenance jobs remain scheduler
records until their gate is released.

Cancellation wakes queued jobs through the cancellation token notification, so a
queued job can still be cancelled without waiting for the active job to finish.

## Validation

Targeted coverage:

- completed scheduler jobs are pruned to the retention limit;
- expired terminal jobs are pruned while active jobs remain visible;
- Windows process snapshots return non-null RSS and CPU values;
- queued gated jobs do not occupy spare blocking-pool threads while waiting;
- existing dashboard tests still pass with the unmount cache-release hook.

## Remaining Work

- repeated MEM-7 scorecard with 3-5 comparable memory runs;
- optional report-to-file path for very large PDF/XLSX exports.
