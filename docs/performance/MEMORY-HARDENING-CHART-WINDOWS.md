# Memory Hardening - Chart Viewport Windows

**Date:** 2026-04-30.
**Track:** MEM-5.
**Status:** implementation validation.

## Goal

Saved-experiment charts should move from "overview only" binary series to a
viewport-driven model. Initial open still uses a bounded overview; zooming the
chart requests a bounded server-side window for the selected visible range.

## Implemented Path

```text
Dashboard chart open
  -> experiments_series_overview(experimentId, maxPoints=1500)
  -> chart renders overview

uPlot selection zoom
  -> zoomPlugin.onZoom(minMinutes, maxMinutes)
  -> RheologyChart converts visible minutes to source seconds
  -> useExperimentSeriesOverview.requestWindow(xMinSec, xMaxSec)
  -> debounce 100 ms
  -> experiments_series_window(experimentId, xMinSec, xMaxSec, maxPoints=1500)
  -> chart renders current window

uPlot double-click reset
  -> reset current window
  -> chart returns to overview data
```

Window requests are cached with a small in-memory LRU of five entries per
active overview hook. Stale responses are ignored by request sequence id.

## Scope Boundary

This slice wires the current uPlot selection zoom/reset flow. It also gives the
hook a reusable `requestWindow` / `resetWindow` API, so a future explicit pan
plugin can feed the same bounded window path without changing data ownership.

Chart processing still creates display-unit uPlot arrays because unit
conversion, time shift, rounding, and touch-point anchoring are view-level
operations.

## Validation

Targeted checks:

```powershell
npm test -- --run tests/hooks/useExperimentSeriesOverview.test.tsx tests/components/rheology-chart-uplot.test.tsx
```

Coverage:

- Overview loads first and remains available as reset/fallback data.
- Zoom window requests are debounced and routed to `experiments_series_window`.
- Invalid ranges are ignored.
- Reset drops the active window and restores overview data.
- `RheologyChart` converts uPlot minute ranges to source seconds, including
  time-shift origin handling.

## Remaining Memory Work

- MEM-6: runtime retention/cache policies.
- MEM-7: repeated memory p50/p95 scorecard after the hardening slices.
