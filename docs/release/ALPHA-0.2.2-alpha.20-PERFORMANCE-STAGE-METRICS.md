# Alpha 0.2.2-alpha.20 Performance Metrics By Refactoring Stage

Date: 2026-05-03

Scope: available local evidence from the last four-week release window, with the
most detailed measurements concentrated in the 2026-04-25 to 2026-05-03
performance and memory hardening track.

## How To Read This

These rows are not one single benchmark series. They combine the local
authoritative gates and targeted diagnostic runners used during the release
hardening work:

- workflow gates measure wall time, JS heap, DOM nodes, RSS and Tauri CPU peak;
- comparison memory diagnostics measure p50 RSS phases in N=5 direct-save runs;
- UX latency runs disable memory-step sampling and should be used for
  user-visible latency;
- Total RSS and GPU RSS remain soft runtime metrics because WebView2, GPU and
  allocator behavior are not fully app-controlled.

The strongest hard claim is app-owned memory ownership: raw/full-columnar
Comparison payloads are not retained, parse cache is clear, frontend/Rust series
caches are bounded, and route leave releases Comparison chart ownership.

## Executive Metric Delta

| Track | Before | After / Current | Numeric Result | Read |
| --- | ---: | ---: | ---: | --- |
| Soak peak heap p95 | 15.26 MB | 8.24 MB | -7.02 MB, -46.0% | Worst-run JS heap spikes removed. |
| Soak peak DOM nodes p95 | 10,034 | 1,349 | -8,685, -86.6% | DOM/node outlier cleaned up. |
| Workflow Total RSS p50 | 673.82 MB | 624.70 MB | -49.12 MB, -7.3% | RC perf gate improvement. |
| Workflow Renderer RSS p50 | 200.05 MB | 201.81 MB | +1.76 MB, +0.9% | Stable, not a hard RSS win. |
| Workflow Tauri RSS p50 | 66.45 MB | 68.75 MB | +2.30 MB, +3.5% | Stable and far under backend budget. |
| Workflow Tauri CPU peak p50 | 5.73 s | 5.44 s | -0.29 s, -5.1% | Backend CPU peak improved in RC gate. |
| Workflow JS heap peak | 9.81 MB | 9.82 MB fresh RC | +0.01 MB | Flat and low; main app-owned memory win. |
| Workflow wall time | 19,173 ms p50 baseline | 20,476 ms fresh RC | +1,303 ms | Still inside workflow budget. |
| Large IPC audit | legacy large payload risk | 92 Rust files, 0 violations | PASS | Large report/comparison IPC blocked. |
| Warm Comparison return | cold/reload-prone path | 455 ms, 0 old-line series refetches | 0 refetches | Warm route-return contract works. |
| Add 6th warm line | broad reload risk | 903 ms, 1 new window request | only new line loads | No reload storm for existing lines. |
| Visible metric cache footprint after add-5 | 303,040 B | 265,160 B | -37,880 B, -12.5% | Renderer series cache smaller. |
| Visible metric cache footprint in export phases | 606,080 B | 530,320 B | -75,760 B, -12.5% | Smaller chart-window footprint. |
| Add-5 click GPU delta before chart layout stabilization | +84.90 MB | +61.06 MB | -23.84 MB, -28.1% | App-controlled resize jump reduced. |
| Add-5 click Total RSS delta before chart layout stabilization | +87.49 MB | +63.76 MB | -23.73 MB, -27.1% | Remaining burst still GPU-dominated. |
| Current Comparison app-owned state after add | raw/columnar risk under investigation | raw/columnar 0/0, parse cache 0 | bounded | Store/export/WN are not current RAM targets. |
| Current fifth-add residual | unexplained GPU/RSS burst | chart commit / WebView2 GPU compositor | classified | No immediate RAM refactor justified. |
| Current N=5 UX ready time | no post-closeout UX baseline | 4,302 ms p50 / 4,339.8 ms p95 | baseline set | Next target is selector search latency. |

## Stage 1 - Soak Cleanup And Early Memory Baseline

Source:

- `docs/performance/memory-performance-report-2026-04-25.md`
- `docs/performance/memory-performance-report-2026-04-27.md`

| Metric | 2026-04-25 | 2026-04-27 | Delta | Result |
| --- | ---: | ---: | ---: | --- |
| Runs analyzed | 20 | 20 | 0 | Comparable sample count. |
| Pass / fail | 20 / 0 | 20 / 0 | unchanged | Gate remained green. |
| Peak heap median | 7.96 MB | 7.97 MB | +0.01 MB | Median flat. |
| Peak heap p95 | 15.26 MB | 8.24 MB | -7.02 MB | Heap outlier removed. |
| Peak DOM nodes median | 945 | 847 | -98 | Smaller typical DOM footprint. |
| Peak DOM nodes p95 | 10,034 | 1,349 | -8,685 | Large DOM outlier removed. |
| Heap slope median | 0.05 MB/round | 0.05 MB/round | 0 | No median leak slope growth. |
| Heap slope p95 | 0.11 MB/round | 0.12 MB/round | +0.01 | Watch, but still passing. |
| Nodes ratio p95 | 1.01 | 1.00 | -0.01 | Node growth stabilized. |

Benefit: repeated upload/analyze and comparison navigation no longer show the
old high p95 heap/node spikes.

## Stage 2 - IPC, By-Id Export And RC Performance Gate

Source: `docs/performance/RC-PERFORMANCE-SCORECARD.md`

| Metric | Stored baseline p50 | RC gate current | Delta | Result |
| --- | ---: | ---: | ---: | --- |
| Total RSS / working set | 673.82 MB | 624.70 MB | -49.12 MB, -7.3% | Pass. |
| WebView2 renderer RSS | 200.05 MB | 201.81 MB | +1.76 MB, +0.9% | Pass, essentially stable. |
| Tauri RSS | 66.45 MB | 68.75 MB | +2.30 MB, +3.5% | Pass. |
| Tauri CPU peak | 5.73 s | 5.44 s | -0.29 s, -5.1% | Pass, CPU peak down. |
| Workflow wall | n/a | 18,966 ms | n/a | Under 22,000 ms p50 budget. |
| Peak JS heap | n/a | 9.79 MB | n/a | Under 12 MB p50 budget. |
| Peak DOM nodes | n/a | 1,637 | n/a | Under 2,400 p50 budget. |
| Comparison 4 loaded | n/a | 3,970 ms | n/a | Observational. |
| Chandler PDF step | n/a | 1,233 ms | n/a | Pass vs 5,000 ms p50 budget. |
| Grace PDF step | n/a | 1,793 ms | n/a | Pass vs 5,000 ms p50 budget. |
| Large IPC audit | legacy risk | 0 violations | blocked | No full scientific payload IPC accepted. |

Benefit: report/comparison export paths moved toward by-id/bounded IPC while
the release workflow stayed inside wall/heap/node budgets.

## Stage 3 - Memory Hardening Scorecard

Source: `docs/performance/MEMORY-HARDENING-SCORECARD.md`

| Metric | Baseline p50 / p95 | Hardened p50 / p95 | Result |
| --- | ---: | ---: | --- |
| Total RSS | 673.82 / 747.66 MB | 654.55 / 753.28 MB | p50 improved; p95 watch. |
| WebView2 renderer RSS | 200.05 / 206.79 MB | 207.26 / 207.45 MB | Stable within pass range. |
| Tauri RSS | 66.45 / 67.58 MB | 68.11 / 73.36 MB | Pass, p95 watch. |
| Tauri CPU peak | 5.73 / 6.05 s | 5.75 / 6.05 s | Flat. |
| JS heap peak | 9.81 / 9.84 MB | 9.84 / 9.85 MB | Flat and low. |
| Workflow wall | 19,173 / 19,267 ms | 19,751 / 19,918 ms | Pass. |
| Comparison smoke Total RSS | n/a | 669.69 / 678.08 MB | Pass. |
| Comparison smoke Renderer RSS | n/a | 266.08 / 277.54 MB | Watch vs old renderer budget. |
| Comparison smoke Tauri CPU peak | n/a | 3.86 / 4.20 s | Observational. |
| L-CMP-3 setup ready | n/a | 3,826 / 3,865 ms | Still above aspirational UI budget. |

Benefit: app-controlled scientific state became bounded while JS heap stayed
low. The remaining risk moved from app-owned arrays to WebView2/GPU RSS
classification.

## Stage 4 - Final RC Memory Readout

Source: `docs/performance/RC-MEMORY-HARDENING-FINAL-SCORECARD.md`

| Metric | Fresh RC value | Read |
| --- | ---: | --- |
| Workflow wall | 20,476 ms | Inside workflow budget. |
| Peak JS heap | 9.82 MB | Low and flat. |
| Peak DOM nodes | 1,637 | Inside node budget. |
| Comparison chart load | 2,174 ms | Improved vs earlier 3.5-4.3 s comparison setup observations. |
| Chandler PDF | 1,263 ms | Pass. |
| Grace PDF | 1,808 ms | Pass. |
| Peak Total RSS | 744.65 MB | Soft watch near old p95. |
| Peak Renderer RSS | 205.82 MB | Stable. |
| Peak Tauri RSS | 70.11 MB | Acceptable. |
| Peak GPU RSS | 266.60 MB | Soft WebView2/GPU watch. |

Export cleanup in the comparison phase reclaimed about 100.12 MB Total RSS
after XLSX, including 16.23 MB renderer RSS and 83.82 MB GPU RSS. That showed
the old browser-download export spike was not the production-like direct-save
path to optimize first.

## Stage 5 - Warm Navigation

Source: `docs/performance/WARM-NAVIGATION-CLOSEOUT.md`

| Metric | First smoke | After invalidation | Result |
| --- | ---: | ---: | --- |
| Initial 5-line comparison ready | 4,927 ms | 4,980 ms | Setup cost, not route-return. |
| Route away duration | 32,956 ms | 32,899 ms | Matches 30 s scenario. |
| Return to old 5 lines | 473 ms | 455 ms | Warm return preserved under 500 ms budget. |
| Series requests on return | 0 | 0 | No existing-line refetch. |
| Add 6th line ready | 936 ms | 903 ms | Within 1 s soft target. |
| Series requests after add | 1 window | 1 window | Only new line loads. |
| Refetched existing lines after add | 0 | 0 | No reload storm. |
| Raw/columnar in store after route leave | 0 / 0 | 0 / 0 | Heavy DB-backed state stripped. |

Benefit: the user gets warm route-return behavior without retaining raw/full
columnar scientific payloads in the renderer.

## Stage 6 - N=5 Comparison Memory Attribution

Source: `docs/performance/SPRINT-MEM-GPU-1-SCORECARD.md`

Initial add-to-chart attribution:

| Phase | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_5_cleanup | 523.26 MB | 129.82 MB | 159.14 MB | 65.90 MB |
| after_add_5_selector_search | 526.64 MB | 128.91 MB | 160.07 MB | 68.96 MB |
| after_add_5_click | 620.09 MB | 132.71 MB | 247.01 MB | 68.96 MB |
| after_add_5 | 617.54 MB | 131.77 MB | 245.11 MB | 68.90 MB |
| after_chart_visible | 623.15 MB | 136.19 MB | 247.48 MB | 68.90 MB |
| after_export_gc_hint | 593.32 MB | 122.38 MB | 228.25 MB | 68.42 MB |
| after_second_gc_hint | 545.05 MB | 120.37 MB | 180.95 MB | 69.05 MB |

| Delta | Total RSS | Renderer RSS | GPU RSS | Tauri RSS |
| --- | ---: | ---: | ---: | ---: |
| after_fixture_5_cleanup -> after_add_5 | +94.28 MB | +1.95 MB | +85.97 MB | +3.00 MB |
| after_add_5 -> after_chart_canvas_painted | +6.98 MB | +4.41 MB | +2.68 MB | +0.00 MB |
| after_xlsx -> after_export_gc_hint | -11.88 MB | -11.82 MB | -2.14 MB | -0.10 MB |

App-owned invariants at this point:

| Signal | P50 |
| --- | ---: |
| Comparison store raw / columnar | 0 / 0 |
| Rust parse cache entries / points | 0 / 0 |
| Frontend seriesWindowCache after add-5 | 303,040 B |
| Frontend seriesWindowCache export phases | 606,080 B |
| Rust decoded series cache | 5 entries / 784,418 B |
| JS heap after add-5 | 15.72 MB |
| JS heap after export GC hint | 11.50 MB |

Benefit: this disproved the broad "warm navigation / Comparison store retains
everything" hypothesis and moved the next work to chart/GPU attribution.

## Stage 7 - Visible Chart Metrics

Source: `docs/performance/SPRINT-MEM-GPU-1-SCORECARD.md`

| Metric | Before visible metrics | After visible metrics | Delta | Result |
| --- | ---: | ---: | ---: | --- |
| after_add_5_click Total RSS | 620.09 MB | 591.41 MB | -28.68 MB | Lower local click-phase footprint. |
| after_add_5_click GPU RSS | 247.01 MB | 219.48 MB | -27.53 MB | GPU pressure lower, not eliminated. |
| after_chart_visible Total RSS | 623.15 MB | 588.86 MB | -34.29 MB | Lower visible chart phase. |
| after_chart_visible GPU RSS | 247.48 MB | 214.46 MB | -33.02 MB | Lower visible chart GPU RSS. |
| selector search -> add_5_click Total delta | +93.45 MB | +81.49 MB | -11.96 MB | Hot delta improved. |
| selector search -> add_5_click GPU delta | +86.94 MB | +73.08 MB | -13.86 MB | Still GPU-dominated. |
| Frontend series cache after add-5 | 303,040 B | 265,160 B | -37,880 B | -12.5% cache bytes. |
| Frontend series cache export phases | 606,080 B | 530,320 B | -75,760 B | -12.5% cache bytes. |
| JS heap after add-5 | 15.72 MB | 15.03 MB | -0.69 MB | Small heap reduction. |

Benefit: chart requests/cache became bounded by visible metrics without making
report/export depend on chart-loaded data.

## Stage 8 - Chart Lifecycle And Layout Stabilization

Sources:

- `docs/performance/SPRINT-MEM-GPU-2-SCORECARD.md`
- `docs/performance/SPRINT-MEM-GPU-3-SCORECARD.md`

Lifecycle attribution showed the fifth-add burst was already present at the
click boundary, before uPlot init, setData, first canvas paint, or any
destroy/create overlap:

| Delta | SPRINT-MEM-GPU-2 | SPRINT-MEM-GPU-3 | Improvement |
| --- | ---: | ---: | ---: |
| selector search -> add_5_click, Total RSS | +87.49 MB | +63.76 MB | -23.73 MB, -27.1% |
| selector search -> add_5_click, GPU RSS | +84.90 MB | +61.06 MB | -23.84 MB, -28.1% |
| selector search -> add_5_click, Renderer RSS | +2.37 MB | +1.72 MB | -0.65 MB |
| selector search -> add_5_click, Tauri RSS | +0.00 MB | +0.05 MB | essentially flat |

Layout evidence after stabilization:

| Signal | Before | After |
| --- | ---: | ---: |
| Chip row height at fifth click | 30 px -> 64 px | stable 38 px |
| Chart shell height at fifth click | 572 px -> 562 px | stable 572 px |
| Chart/canvas backing height | 458 px -> 448 px | stable 458 px |
| Max active Comparison uPlot instances | 1 | 1 |
| Comparison uPlot/canvas after route leave | 0 / 0 | 0 / 0 |

Benefit: one app-controlled layout resize was removed and the hot GPU delta fell
by about 24 MB p50. The remaining movement was still GPU-dominated.

## Stage 9 - GPU/RSS Closeout

Source: `docs/performance/SPRINT-MEM-GPU-4-SCORECARD.md`

| Experiment | Delta | Total RSS | Renderer RSS | GPU RSS | Tauri RSS | Interpretation |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| selector-close-only | before close -> close click | -12.91 MB | +0.04 MB | -12.15 MB | 0 MB | Selector close alone is not the positive burst. |
| commit-without-close | before commit -> commit | +65.03 MB | +3.05 MB | +60.46 MB | +0.02 MB | Burst appears while selector remains open. |
| defer-chart-commit | selector search -> click | +0.26 MB | +0.05 MB | +0.24 MB | 0 MB | Selection/chip update is flat without chart commit. |
| defer-chart-commit | before chart commit -> chart commit | +86.93 MB | +1.02 MB | +85.45 MB | -0.02 MB | Burst follows chart commit. |

App-owned invariants across the classifier groups:

| Signal | Value |
| --- | ---: |
| Comparison store raw / columnar after add-5 | 0 / 0 |
| Parse cache entries after add-5 | 0 |
| Frontend seriesWindowCache after add-5 | 265,160 B |
| Rust decoded series cache after add-5 | 784,418 B |
| JS heap after second GC hint | about 11.21-11.26 MB |
| Comparison uPlot/canvas after route leave | 0 / 0 |
| Direct-save export recovery | after_xlsx - after_export_gc_hint p50 11.42-14.64 MB |

Benefit: the remaining fifth-add Total/GPU RSS movement is classified as
WebView2/GPU compositor allocation at chart commit. There is no evidence
justifying another immediate RAM refactor in warm navigation, store retention,
parse cache, report/export, Rust series cache, visible metrics, uPlot teardown
or selector close.

## Stage 10 - Current UX Latency Baseline

Source: `docs/performance/COMPARISON-UX-LATENCY-BASELINE.md`

This run disables memory-step RSS sampling and is the correct current UX
baseline for N=5 Comparison direct-save work.

| Metric | p50 | p95 | Read |
| --- | ---: | ---: | --- |
| Comparison workflow ready | 4,302 ms | 4,339.8 ms | Current UX baseline. |
| Comparison route open | 49 ms | 52.6 ms | Fast. |
| Selector open | 22 ms | 25.6 ms | Fast. |
| Selector search, per add | 528 ms | 529.8 ms | Largest repeated user-visible phase. |
| Add 1 ready | 224 ms | 242 ms | Stable. |
| Add 5 ready | 223 ms | 226.6 ms | Stable fifth add. |
| Chart first visible | 46 ms | 52.3 ms | Not dominant. |
| Chart ready | 48 ms | 55.2 ms | Not dominant. |
| Report tab open | 410 ms | 413.6 ms | Secondary. |
| PDF direct-save export | 22 ms | 28.3 ms | Mocked runner, not dominant. |
| XLSX direct-save export | 50 ms | 50 ms | Mocked runner, not dominant. |
| Series request count | 10 | 10 | Stable. |
| Series request total duration | 178.7 ms | 196.34 ms | Not dominant. |
| Series response bytes | 303,600 B | 303,600 B | Stable. |
| Browser long tasks | 0 | 0 | No long-task issue in the 3-run sample. |

Current alpha.20 release smoke after the E2E debug rebuild:

| Metric | Value |
| --- | ---: |
| N=5 `cmp_ready_ms` | 4,362 ms |
| Mocked PDF export | 28 ms / 8 B |
| Mocked XLSX export | 46 ms / 4 B |

Benefit: the next performance target is now visible: selector search latency,
not RSS, export, series IPC or chart first paint.

## CPU Coverage Notes

CPU evidence is narrower than memory evidence:

- the release workflow records Tauri CPU peak seconds;
- RC performance improved Tauri CPU peak from 5.73 s to 5.44 s p50;
- memory hardening kept Tauri CPU peak flat at 5.75 / 6.05 s p50/p95;
- comparison memory smoke observed Tauri CPU peak at 3.86 / 4.20 s;
- there is not yet a full React CPU profile per UI phase.

For frontend work, the current actionable proxies are wall time, IPC time,
render time, settle time, long-task count and per-phase UX timing.

## Final Performance Readout

What improved materially:

- p95 soak heap spikes: 15.26 MB -> 8.24 MB.
- p95 soak DOM spikes: 10,034 nodes -> 1,349 nodes.
- workflow Total RSS p50 in the RC gate: 673.82 MB -> 624.70 MB.
- workflow Tauri CPU peak p50: 5.73 s -> 5.44 s.
- visible metric cache footprint: 303,040 B -> 265,160 B after add-5.
- fifth-add chart/layout GPU delta: +84.90 MB -> +61.06 MB after layout
  stabilization.
- warm return to five existing Comparison lines: 455 ms with 0 old-line
  refetches.

What did not become a hard win:

- Total RSS is not guaranteed lower across every diagnostic phase.
- GPU RSS is not fixed.
- the fifth-add chart commit still produces WebView2/GPU compositor allocation.
- Comparison selector search remains the largest repeated UX latency at about
  528 ms p50 per add.

Release claim:

```text
RheoLab alpha.20 keeps renderer-owned scientific payload/state bounded on the
measured saved-detail/report/comparison paths. JS heap remains low, large IPC is
blocked, warm Comparison navigation avoids old-line refetches, and the remaining
Comparison fifth-add Total/GPU RSS movement is classified as WebView2/GPU
compositor allocation at chart commit. Total RSS/GPU RSS are tracked as soft
runtime metrics, not hard release claims.
```
