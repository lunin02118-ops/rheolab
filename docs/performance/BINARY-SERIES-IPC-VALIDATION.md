# Sprint 6 Validation — Binary Series IPC

**Date:** 2026-04-29  
**Scope:** initial binary by-id chart series vertical slice.

## What Changed

Added binary series IPC commands:

- `experiments_series_meta`
- `experiments_series_overview`
- `experiments_series_window`

The commands read `ExperimentData.dataBlob`, decode typed columnar channels in
Rust, downsample to a caller-provided `maxPoints`, and return `RHEOSR1` binary
f64 columns via `tauri::ipc::Response`.

The dashboard chart now attempts binary overview series for DB-loaded
experiments and falls back to the legacy AoS/SoA path if binary IPC is disabled
or unavailable.

## Local Validation

Rust targeted tests:

```text
cargo test --manifest-path src-tauri/Cargo.toml series --lib
4 passed
```

Full Rust library suite:

```text
cargo test --manifest-path src-tauri/Cargo.toml --lib
439 passed / 2 ignored
```

Frontend decoder tests:

```text
npm test -- tests/series/binary-series.test.ts
4 passed
```

Frontend production build:

```text
npm run build:ci
passed
```

Full frontend suite:

```text
npm ci
npm test
npm run version:validate
npm run audit:large-ipc
git diff --check
passed
```

## Payload Shape

For a typical overview request with `maxPoints = 1500` and 7 columns
(`timeSec` + 6 metrics), payload size is:

```text
align8(20 + 7 * 8) + 1500 * 7 * 8 = 84,080 bytes
```

That replaces a chart payload shape that previously required either full
`rawPoints` JSON objects or a JS-side conversion into SoA before rendering.

## What Is Not Claimed Yet

This slice does **not** claim a full dashboard-detail latency win yet.

Reason: the existing `experiments_get` detail path still loads `rawPoints` for
analysis, report, save-dialog, and raw-table workflows. Sprint 6 introduces the
binary chart read path, but the full detail workflow needs a follow-up by-id
analysis/detail contract before rawPoints can be removed from default detail
open entirely.

## Follow-Ups

- Add a lightweight experiment-detail metadata command that does not include
  `rawPoints`.
- Add by-id dashboard analysis or reuse `AnalysisArtifact` cache for detail open.
- Wire uPlot zoom/pan range changes to `experiments_series_window`.
- Extend binary series to comparison charts.
- Add Playwright measurements for chart first paint, JS heap, and long tasks.
