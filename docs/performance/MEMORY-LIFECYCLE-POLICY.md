# Memory Lifecycle Policy

Status: draft for warm-navigation mini-track.

## Goal

Keep the application feeling continuous while making memory ownership explicit.
Route changes must not erase user work. They may release heavy, recoverable
buffers when the same data can be recovered by id from Rust or SQLite.

## State Classes

| Class | Examples | Lifetime | Release Rule |
|---|---|---:|---|
| Hot | mounted chart instance, current chart window, current raw-table page, open report form | active view only | release on tab or route leave |
| Warm | recently visible chart overview/window data, comparison line windows | 2 to 5 minutes | TTL, LRU, byte budget, memory pressure |
| Logical | experiment ids, chips, display settings, viewport, active tab, table page, report toggles | until manual clear/reset | never clear on route leave |
| Cold | SQLite `ExperimentData.dataBlob`, analysis artifacts, projections | DB lifecycle | normal storage lifecycle |

## Never Clear On Route Leave

- selected comparison experiment ids
- comparison chip metadata
- comparison display settings
- comparison viewport or brush range
- active comparison tab
- library filters, search, pagination, and selection
- unsaved user edits or report override form state

## Always Release Quickly

- generated PDF/XLSX bytes after save/download
- object URLs
- hidden uPlot/canvas instances
- DB-backed full raw points in renderer
- transient report input payloads

## Warm Defaults

- frontend series warm TTL: 5 minutes
- frontend series max entries: 64
- frontend series byte budget: 96 MB
- Rust decoded-series TTL: 5 minutes
- Rust decoded-series max entries: 16
- Rust decoded-series byte budget: 128 MB

These are starting values. Total RSS remains a soft metric because WebView2,
GPU, and allocator behavior can retain memory outside app-controlled state.

## UX Contract

The target scenario is:

1. Open Comparison with 5 saved experiments, each around 100k points.
2. Navigate to Dashboard for about 30 seconds.
3. Inspect and save another experiment.
4. Return to Comparison.
5. The original 5 chips and lines are visible immediately or nearly immediately.
6. Add the 6th experiment.
7. Only the 6th line loads; the first 5 lines are not reloaded while the warm
   cache is still valid.

The app may show a short skeleton for cold misses, but it must not drop logical
selection or reset the user's context.

## Non-Goals

- Do not claim a hard Total RSS win.
- Do not run manual GC in product code.
- Do not move full raw arrays back into renderer state.
- Do not treat SQL as the first suspect when UI spans show debounce/render/settle.

