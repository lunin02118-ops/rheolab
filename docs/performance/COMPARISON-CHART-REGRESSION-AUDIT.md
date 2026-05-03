# Comparison Chart Regression Audit

**Date:** 2026-05-03
**Scope:** Comparison chart behavior after the memory / warm-navigation /
binary-series refactoring track.
**Current head inspected:** `a323145` (`0.2.2-alpha.21` deployed provenance).

## Executive Verdict

The most likely regression stage is the **Warm Navigation binary/window chart
loading track**, especially:

| Commit | Date | Role | Regression Risk |
| --- | --- | --- | --- |
| `d3956ae` | 2026-04-30 | shared frontend series window cache | medium |
| `13dcdf9` | 2026-04-30 | Comparison chart lines loaded from binary series | high |
| `f2c1004` | 2026-04-30 | persisted Comparison viewport session | high |
| `10ded52` | 2026-04-30 | binary window refetch by viewport | very high |
| `a465072` | 2026-04-30 | Rust decoded series cache | medium |

This is where the Comparison chart stopped being a simple "selected
experiments with full columnar data go into uPlot" path and became a
multi-state pipeline:

```text
selected ids
  -> DB/Rust binary overview/window request
  -> frontend seriesWindowCache
  -> lineStates
  -> main chart window data
  -> separate brush overview data
  -> persisted viewport / fallback viewport / time-origin correction
  -> uPlot data alignment
```

The later GPU/RSS work (`SPRINT-MEM-GPU-1..4`, visible metrics, layout
stabilization) mostly measured or narrowed this path. It did not create the
core complexity. The root correctness risk sits earlier: `13dcdf9` plus
`10ded52`, with `f2c1004` making the viewport persistent across route changes.

## Why This Stage Is The Suspect

Before `13dcdf9`, `ComparisonChartUPlot` directly debounced the experiments it
received:

```text
experiments -> useDebouncedValue(experiments, 150) -> useComparisonChartData
```

After `13dcdf9`, it calls `useComparisonSeriesWindows()` and renders augmented
experiments returned by that hook. The hook is now the behavioral hot path:

- `src/components/comparison/useComparisonSeriesWindows.ts` is 629 lines.
- `src/components/comparison/comparison-chart-uplot.tsx` is 728 lines.
- The current binary/window stack added about 1,440 net lines across the main
  chart/window/cache/Rust series files since `13dcdf9^`.
- There are 10 follow-up `fix(comparison)` commits after the binary-window
  switch, all touching this behavioral area:
  - `d7a37ae` restore DB selection and chart reset
  - `ec36e06` recover stale viewport series loads
  - `3fc6cab` preserve time origin for zoom windows
  - `31b4b74` stabilize warm zoom lifecycle gates
  - `61b0d5d` split brush vs chart series and refine viewport reset
  - `79c1760` restore smooth brush panning
  - `ea2e2b7` exit brush preview on noop drag
  - `9d1caca` isolate viewport windows from overview
  - `79ef89a` keep narrow brush panning smooth
  - `3f6a6f2` auto-fit chart after experiment removal

That fix density is strong evidence that this stage introduced real interaction
and display fragility, not just measurement noise.

## Current High-Risk Code Points

| File | Lines | Why It Is Risky |
| --- | ---: | --- |
| `src/components/comparison/useComparisonSeriesWindows.ts` | 67, 176-179, 232-240, 485-486, 544-570 | Feature flag, viewport fallback refs, cache keys, overview/window requests, main vs brush data substitution. |
| `src/components/comparison/comparison-chart-uplot.tsx` | 176-190, 279-314, 422-428, 509-524, 663-675 | Binary hook integration, brush preview mode, persisted viewport commit, window readiness gates, chart-layer switching. |
| `src/lib/series/series-window-cache.ts` | 1-220 | Recoverable renderer cache with TTL/entries/bytes. Good for memory, but another source of stale partial chart data. |
| `src/components/comparison/comparison-visible-series-metrics.ts` | 85-102 | Later narrowing of requested columns. Useful, but it adds more conditional data-shape variation. |
| `src-tauri/src/commands/series/mod.rs` | series overview/window commands | Rust binary series source and decoded cache. Correctness depends on window/downsample semantics matching chart expectations. |

The visible symptom described by the user, sparse or strange horizontal chart
segments and bad interaction behavior, is consistent with one of these failure
modes:

- main chart uses a viewport window while the brush uses overview data;
- stale persisted viewport is applied to a new or changed experiment set;
- time origin differs between overview and window data;
- a window request returns a minmax/downsampled set that is later aligned as if
  it were a normal full series;
- cache key / fallback state reuses old partial data;
- `resetScalesOnDataChange={false}` preserves a bad x-range while data changes;
- visible-metric narrowing leaves a support column absent or filled with NaN
  for a path that still expects it.

## What We Actually Gained

The memory work did produce real bounded-memory wins, but not enough to justify
broken Comparison chart behavior if users see it.

| Result | Metric |
| --- | ---: |
| Comparison store raw/columnar after add | `0 / 0` |
| Parse cache entries after add | `0` |
| JS heap after export GC | about `11.5 MB` |
| Frontend series cache after add-5 before visible metrics | `303,040 B` |
| Frontend series cache after add-5 after visible metrics | `265,160 B` |
| Frontend series cache reduction from visible metrics | `-37,880 B`, `-12.5%` |
| Rust decoded series cache after add-5 | `5 entries / 784,418 B` |
| Warm return to existing 5 lines | `455 ms` |
| Old-line refetches on warm return | `0` |
| Add 6th warm line | `903 ms`, `1` new window request |
| Add-5 click GPU delta after layout stabilization | `+61.06 MB` p50 |
| Residual fifth-add burst classification | WebView2/GPU compositor at chart commit |

The strongest objective win is **architecture and ownership**, not dramatic user
visible memory reduction:

- no raw/full-columnar Comparison payload retained in the store after route
  leave;
- no large scientific IPC for report/export paths;
- warm route return avoids reloading old lines;
- app-owned memory is bounded and measurable.

The weaker part is that the most user-visible Comparison chart path became much
more complex while the remaining RSS/GPU movement is still mostly WebView2/GPU
runtime allocation, not app-owned scientific arrays.

## Tradeoff Assessment

The current architecture is defensible for a future large-data product, but it
is not currently paying for itself in the Comparison chart if display behavior
is unreliable.

For alpha readiness, correctness should win:

```text
Simple full-data Comparison chart > bounded but fragile binary window chart
```

The by-id report/export work, raw table paging, security hardening and release
gate work should stay. The risky part to relax or roll back is specifically the
Comparison chart's binary/window/warm-cache path.

## Rollback / Simplification Options

### Option A - Immediate Diagnostic Fallback

Use the existing localStorage kill switch to disable the binary Comparison
series path:

```js
localStorage.setItem('RHEOLAB_SERIES_LEGACY_AOS', '1')
```

or:

```js
localStorage.setItem('RHEOLAB_COMPARISON_LEGACY_EXPERIMENT_STORE', '1')
```

Expected behavior:

- `isComparisonBinarySeriesEnabled()` returns false;
- `useComparisonSeriesWindows()` returns original experiments;
- DB-backed experiments rehydrate through the older full-data store path;
- chart uses full `columnarData` / raw fallback instead of binary windows.

Complexity: very low.

Use this as the fastest confirmation test: if the user's broken Comparison
chart becomes normal with this flag, the regression is confirmed in the
binary/window path.

### Option B - Product Fallback For Alpha

Make full-data Comparison chart the default for alpha, while keeping the binary
series code behind an explicit opt-in flag.

Suggested policy:

```text
Comparison chart default: full columnar experiment data
Binary/window Comparison mode: opt-in diagnostic / memory mode
Report/export by-id path: unchanged
Dashboard/saved-detail series optimizations: unchanged unless separately broken
```

Likely touched files:

- `src/components/comparison/useComparisonSeriesWindows.ts`
- `src/app/dashboard/comparison/page.tsx`
- `src/lib/store/comparison-store.ts`
- tests around Comparison chart and warm navigation
- release/readiness docs

Complexity: moderate.

Estimated effort: 1-2 implementation days plus focused chart/manual validation.
This is the recommended rollback shape because it avoids broad git revert risk
and preserves most non-chart hardening work.

### Option C - Surgical Revert Of Binary/Viewport Commits

Revert or unwind:

- `13dcdf9`
- `f2c1004`
- `10ded52`
- selected follow-up fixes that only exist to support those commits

Complexity: high.

Reason: the current tree has many later fixes and diagnostics layered on top.
The diff from `13dcdf9^` to current in the relevant chart/window/cache files is
about `2,128 insertions / 76 deletions` across 14 files. A raw revert would
almost certainly conflict and could accidentally damage report/export,
diagnostics or release docs.

### Option D - Full Warm Navigation Stack Revert

Revert:

- normalized warm session state;
- frontend series cache;
- binary Comparison loading;
- persisted viewport;
- viewport window refetch;
- Rust decoded series cache;
- mutation invalidation;
- warm-navigation smoke assumptions.

Complexity: very high.

This is not recommended. It would throw away useful session/ID architecture and
touch too much code for an alpha hotfix.

## Recommended Decision

Do **Option A** first as a confirmation run, then implement **Option B** for
alpha if it fixes the chart:

```text
fix(comparison): default alpha chart to full-data rendering path
```

The goal is not to delete the binary/window work forever. The goal is to stop
letting it be the default path for a critical chart until we can prove the chart
is visually correct under zoom, brush, metric switching, add/remove and route
return.

## Implementation Note

The alpha-safe default is now:

```text
Comparison chart default: full-data selector/store path
Binary/window Comparison path: diagnostic opt-in only
```

Diagnostic opt-in:

```js
localStorage.setItem('RHEOLAB_COMPARISON_BINARY_SERIES', '1')
```

Existing kill switches still disable the binary path even if the diagnostic
flag is set:

```js
localStorage.setItem('RHEOLAB_SERIES_LEGACY_AOS', '1')
localStorage.setItem('RHEOLAB_COMPARISON_LEGACY_EXPERIMENT_STORE', '1')
```

This keeps the binary/window implementation available for controlled perf and
visual-regression work without making it the default alpha user path.

## Acceptance Criteria For The Simplification

The fallback is acceptable when:

- Comparison chart displays continuous expected curves for the user's broken
  scenario;
- add/remove experiment does not produce sparse horizontal segments;
- brush drag/zoom/reset behaves normally;
- changing primary/secondary metrics does not blank or distort existing lines;
- report/export still works by id;
- no large IPC audit regression;
- route leave does not create unbounded store growth in normal N<=5 alpha use.

Suggested local validation:

```powershell
npm run typecheck
npm run lint
npm test -- --run tests/components/comparison-chart-scales.test.ts tests/hooks/useComparisonSeriesWindows.test.tsx tests/pages/comparison-page.cleanup.test.tsx
npm run build:ci
npm run version:validate
npm run audit:large-ipc
git diff --check
```

Manual validation should include the exact user-visible broken Comparison
scenario, because this is primarily a rendering/interaction regression rather
than a pure unit-test failure.

## No-Go For Rollback

Do not revert these as part of the chart simplification:

- by-id report/export;
- Tauri filesystem scope hardening;
- release/version gate;
- raw table paging;
- parsing release cache;
- large IPC audit;
- alpha.21 idle upload animation fix.

Those tracks are either unrelated to the chart regression or provide clear
release hardening value.

## Auditor Summary

The memory track succeeded at bounding app-owned memory, but the Comparison
chart paid for it with a fragile binary/window/cache/viewport pipeline. The
current bugs should be treated as a product correctness regression in the
Comparison chart default path.

The lowest-risk path is to keep the architecture available behind a flag, but
ship alpha with the simpler full-data Comparison rendering path unless and
until the binary/window mode passes visual regression coverage and the user's
broken scenario.
