# Sprint 6 Plan — Binary Series IPC

**Status:** implemented as initial vertical slice on 2026-04-29.

## Mission

Move chart reads toward by-id, viewport-sized binary series data instead of
full per-point JSON object graphs.

Sprint 6 starts with the safest slice:

- read existing `ExperimentData.dataBlob`;
- decode Rust-side with `decode_typed`;
- downsample by viewport/overview budget;
- return `RHEOSR1` binary f64 columns;
- decode on the frontend into typed arrays;
- feed the existing uPlot chart through the existing SoA adapter;
- keep the AoS path as rollback/fallback.

## In Scope

- `experiments_series_meta`
- `experiments_series_overview`
- `experiments_series_window`
- Rust metric allowlist and validation
- Rust min/max bucket downsampling
- `RHEOSR1` binary format v1
- frontend binary decoder and Tauri wrappers
- dashboard chart overview adoption for DB-loaded experiments
- tests for Rust downsample/codec shape and TS decoder
- validation doc and budget notes

## Out of Scope

- deleting `rawPoints` from `experiments_get`
- replacing dashboard analysis IPC with by-id analysis
- raw data table virtualization rewrite
- comparison chart multi-experiment binary windows
- pan/zoom event-driven window refetch

Those are follow-ups because the current dashboard detail page still needs full
data for analysis, report tab, save dialog, and raw table workflows.

## Binary Format

Magic: `RHEOSR1\0`

Header:

| Field | Type |
|---|---|
| magic | 8 bytes |
| version | u16 LE |
| flags | u16 LE |
| pointCount | u32 LE |
| columnCount | u16 LE |
| reserved | u16 LE |

Descriptor, repeated `columnCount` times:

| Field | Type |
|---|---|
| metricId | u16 LE |
| dtype | u8, `1 = f64` |
| nullable | u8 |
| offset | u32 LE, absolute byte offset |

Payload is aligned to 8 bytes, then contiguous `f64` columns.

Metric IDs:

| ID | Key |
|---:|---|
| 1 | `timeSec` |
| 2 | `viscosityCp` |
| 3 | `temperatureC` |
| 4 | `shearRate` |
| 5 | `shearStressPa` |
| 6 | `speedRpm` |
| 7 | `pressureBar` |
| 8 | `bathTemperatureC` |

Missing optional values are encoded as `NaN`; frontend conversion maps them to
`null` before handing data to the existing chart adapter.

## Downsampling

V1 uses min/max buckets over the primary metric:

- preserves first visible point;
- preserves last visible point;
- preserves primary metric extrema per bucket;
- emits monotonically increasing time;
- returns exact rows when row count is already `<= maxPoints`.

The default primary metric is `viscosityCp` when present.

## Rollback

Set localStorage key `RHEOLAB_SERIES_LEGACY_AOS=1` to force the dashboard chart
back onto the legacy AoS path.

The legacy path remains the functional fallback whenever binary IPC fails or no
DB experiment id is available.
