# Sprint 6 Retrospective — Binary Series IPC

**Status:** closed as an initial vertical slice.  
**Date:** 2026-04-29.

## Delivered

- Binary by-id series IPC over existing `ExperimentData.dataBlob`.
- `RHEOSR1` v1 f64 column format.
- Rust min/max bucket downsampling with first/last/peak preservation.
- Frontend decoder and Tauri wrappers.
- Dashboard chart binary overview adoption for DB-loaded experiments.
- Legacy AoS fallback via `RHEOLAB_SERIES_LEGACY_AOS=1`.
- Rust and TypeScript tests for the new codec/downsample surface.

## Result

Sprint 6 establishes the chart-layer foundation: chart data can now be requested
as viewport-sized binary columns instead of frontend-built full point objects.

This is intentionally narrower than deleting `rawPoints` from
`experiments_get`. The detail page still depends on full data for analysis,
reports, save, and raw-table workflows, so that broader cut belongs to the
hardening lane after by-id analysis/detail contracts exist.

## Follow-Up Lane

- Replace detail-open `experiments_get` with metadata + by-id analysis + binary
  series reads.
- Fetch `experiments_series_window` from chart zoom/pan events.
- Add comparison-chart binary series.
- Promote chart IPC payload, JS heap, and long-task metrics into budgets after
  Playwright instrumentation lands.
