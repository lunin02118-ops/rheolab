# Memory Hardening - Typed Chart Pipeline

**Date:** 2026-04-30.
**Track:** MEM-4.
**Status:** implementation validation.

## Goal

Keep Sprint 6 binary series data as typed arrays all the way into chart
processing. The binary chart path should not decode `Float64Array` columns,
copy them into `number[]`, and then create new typed arrays again for uPlot.

## Implemented Path

```text
RHEOSR1 bytes
  -> decodeRheoSeriesV1()
  -> Float64Array column views
  -> seriesWindowToColumnarData()
  -> ChartColumnarData with Float64Array columns
  -> useRheologyData()
  -> uPlot arrays
```

Optional binary columns keep the existing wire contract: `NaN` means missing.
The chart hook now treats `NaN` optional values as gaps/missing values, matching
the older `null` semantics used by plain-array `ColumnarData`.

## Scope Boundary

This slice removes one full renderer-side copy cycle in the binary chart path:

```text
before: Float64Array -> number[] -> Float64Array
after:  Float64Array -> chart processing
```

Chart processing still creates display-unit uPlot arrays because it applies
time shifting, unit conversion, rounding, and visible-series touch-point
anchoring. Viewport refetching remains MEM-5.

## Validation

Targeted checks:

```powershell
npm test -- --run tests/series/binary-series.test.ts tests/hooks/useRheologyData.test.ts tests/components/rheology-chart-uplot.test.tsx
npm run build:ci
```

Coverage:

- Binary series conversion preserves `Float64Array` views without copying.
- Nullable `NaN` columns remain typed arrays.
- `useRheologyData` treats typed `NaN` optional values as gaps/missing values.
- Bath-temperature gaps still render as `null`, not `0`.
- Chart component accepts the broader `ChartColumnarData` input shape.

## Remaining Memory Work

- MEM-5: wire chart zoom/pan to `experiments_series_window`.
- MEM-6: add runtime retention/cache policies.
- MEM-7: repeat memory p50/p95 measurements after all memory hardening slices.
