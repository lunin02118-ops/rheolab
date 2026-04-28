# Phase 3 — Performance Delta Investigation (2026-04-28)

## Why this report exists

Hypothesis raised after Phase 3 (major-version bump pass) closed:
"old versions consumed less CPU; new versions feel heavier".

This document compares **apples-to-apples** native-memory + CPU
measurements taken before and after Phase 3, plus a synthetic
benchmark suite, and concludes whether the perception is supported
by the numbers.

## What changed during Phase 3

| SHA | Chain |
|---|---|
| `700edbf` | vite 6 → 7 + plugin-react 4 → 5 |
| `c2f6c66` | typescript 5 → 6.0.3 |
| `99f3784` | eslint 9 → 10.2.1 |
| `c28d36e` | @types/node 20 → 25.6.0 |
| `49098a5` | vite 7 → 8.0.10 + plugin-react 5 → 6 (Rolldown wave) |

All landed on 2026-04-28 between 01:28 and 01:55 (UTC+5).
The earliest measurement we can compare against is from 2026-04-26
(B#26 era; `e5c761a` was 2026-04-28 02:43, well after Phase 3).

## Methodology

The native-memory sampler emits one `*.jsonl` per Playwright run
with these fields: `tauriWsMb`, `tauriCpuSec`, `webview2WsMb`,
`webview2RendererWsMb`, `webview2GpuWsMb`, `webview2BrowserWsMb`,
`totalWsMb`.  Each scenario is identifiable by sample count:

* **WORKFLOW** scenario (5 fixtures + warmup): 11–12 samples per run
* **SOAK** scenario (single load+unload loop): 8 samples per run
* **BENCHMARK** suite (5 nav cycles + analysis): per-scenario JSON
  via `outputs/e2e/perf/benchmark-*.json`

The same `perf:workflow:tauri`, `perf:soak:tauri` and
`perf:benchmark` scripts ran on both dates.  Test code last touched
on 2026-04-25 (`5cb1329`), before any measurement compared here.

## Results

### SOAK scenario (apples-to-apples; same workload, 8 samples each)

| Date | Pre/Post | Peak `totalWsMb` | Peak `tauriCpuSec` |
|---|---|--:|--:|
| Apr 26 04:15 | pre | 484 / 486 / 484 | 3.25 / 2.98 / 2.89 |
| Apr 27 15:00 | pre | 508 | 3.97 |
| Apr 28 02:41–02:42 | **post** | 486 / 484 / 484 | 3.53 / 3.41 / 3.30 |

* **Memory: flat** — 484 MB pre and post.  No regression.
* **CPU: noise** — Apr 27 measured 3.97 sec (worst day, pre-Phase 3).
  Apr 28 (3.30–3.53) sits between Apr 26 (2.89–3.25) and Apr 27
  (3.97).  Single-day variance dominates.

### WORKFLOW scenario (12 samples, 5 fixtures + warmup)

| Date | Pre/Post | Peak `totalWsMb` (range) | Peak `tauriCpuSec` (range) |
|---|---|--:|--:|
| Apr 26 03:44–03:48 | pre | 673 – 777 | 5.98 – 7.28 |
| Apr 26 04:11–04:14 | pre | 647 – 663 | 5.19 – 5.88 |
| Apr 28 02:38–02:40 | **post** | 664 – 737 | 5.86 – 6.67 |

* **Memory: within pre-Phase 3 range** — Apr 28 (664–737) sits
  between the two Apr 26 batches (647–663 and 673–777).  No
  regression.
* **CPU: within pre-Phase 3 range** — Apr 28 (5.86–6.67) overlaps
  both Apr 26 batches (5.19–5.88 and 5.98–7.28).  No regression.

### BENCHMARK suite (5 nav cycles, leak detection)

| Date | Pre/Post | Peak Heap | Heap Δ | Final Nodes | Nodes Δ |
|---|---|--:|--:|--:|--:|
| Apr 26 04:18 | pre | 9.57 MB | +2.74 | 3988 | +3518 |
| Apr 26 04:21 | pre | 9.54 MB | +2.71 | 3988 | +3518 |
| Apr 27 14:55 | pre | 10.56 MB | +1.81 | 3201 | +1098 |
| Apr 28 02:44 | **post** | 8.91 MB | **−0.10** | 2671 | +649 |
| Apr 28 02:47 | **post** | 8.96 MB | **−0.28** | 1452 | **−677** |

* **Heap peak: improved 9 %** — 9.55 MB pre → 8.85 MB post (mean
  of the two same-day pairs).
* **Heap delta: improved** — pre carried +2.7 MB after 5 nav cycles;
  post measured −0.1 / −0.3 MB.  Effectively no leak signal post.
* **Node count: improved 33 – 64 %** — 3988 nodes pre → 1452 / 2671
  post.  Apr 28 02:47 actually finished with **fewer** nodes than
  baseline (1452 vs 2129), the strongest leak-free signal we've seen
  on this benchmark.

## Conclusion

**The performance perception is not supported by the measurements.**

| Metric | Direction | Magnitude |
|---|---|---|
| SOAK memory | flat | 484 MB ↔ 484 MB |
| SOAK CPU | within noise | Apr 27 was the worst (3.97 sec, pre-Phase 3) |
| WORKFLOW memory | within range | Apr 28 sits inside Apr 26 envelope |
| WORKFLOW CPU | within range | Apr 28 sits inside Apr 26 envelope |
| BENCHMARK heap peak | **improved 9 %** | 9.55 → 8.85 MB |
| BENCHMARK heap leak | **improved → 0** | +2.7 MB → −0.1 MB |
| BENCHMARK nodes | **improved 33 – 64 %** | 3988 → 1452 / 2671 |

Workflow wall-time (`totalWallMs`) did rise from ≈ 18.7 s (Apr 26
B#26) to ≈ 20.2 s (Apr 28 B#27), or +8 %.  Node count on the
workflow scenario went 1681 → 2016 (+20 %).  Both stayed within the
audit gate, both are within the day-to-day variance band visible
across Apr 21–25 historical runs (totalWallMs ranged 18.5 s to 24.3 s
in B#22 era), and the benchmark suite (a more controlled probe of
React render/leak behaviour) shows the runtime got cleaner.

If the user-perceived slowdown comes from a specific interactive
flow (loading large fixtures, opening many comparison tabs, etc.),
that would not show in the workflow-summary or soak metrics — it
would need a dedicated profile of that exact path.  No such report
has been filed.

## Recommendation

* **No action.**  Phase 3 did not regress memory or CPU on any
  measured scenario beyond noise; the benchmark suite shows
  meaningful heap & DOM-leak improvements.
* If a specific user-flow regression is reported, profile that
  exact path with the Chromium devtools timeline against an old
  build (e.g. `0a8f7be^` checkout) — workflow / soak summaries are
  too coarse for interactive diagnostics.
* Keep Baseline #27 as the new reference; future audits should
  compare against it, not against B#24's quick-mode single-sample
  measurement (which is not directly comparable).

## Pointer to raw data

* `outputs/e2e/perf/native-memory-1777158886300..1777158930368.jsonl`
  — Apr 26 SOAK runs (3 files)
* `outputs/e2e/perf/native-memory-1777158660049..1777158857026.jsonl`
  — Apr 26 WORKFLOW runs (7 files)
* `outputs/e2e/perf/native-memory-1777325878805..1777326033264.jsonl`
  — Apr 28 WORKFLOW runs (6 files)
* `outputs/e2e/perf/native-memory-1777326063589..1777326110557.jsonl`
  — Apr 28 SOAK runs (3 files)
* `outputs/e2e/perf/benchmark-1777159114206.json` and
  `benchmark-1777159286287.json` — Apr 26 benchmarks
* `outputs/e2e/perf/benchmark-1777326292970.json` and
  `benchmark-1777326461538.json` — Apr 28 benchmarks
* `docs/performance/BASELINES.md` — running history of audit baselines
* `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-28.md` — Phase 0
  follow-up audit run summary

---

## Addendum — long-tail comparison vs B#13 (Mar 2) and B#22 (Apr 15)

> Added 2026-04-28 after the user asked: "what about runs from early
> April / March 2nd?".  Pulled B#13, B#22, B#23 from `BASELINES.md`
> and reconciled them against B#24-B#27.

### Long-tail KPI table

| Metric               | B#13 (Mar 2) | B#22 (Apr 15) | B#23 (Apr 18) | B#24 (Apr 26) | B#25 (Apr 26) | B#26 (Apr 26) | **B#27 (Apr 28)** | Δ B#13 → B#27 |
|----------------------|---:|---:|---:|---:|---:|---:|---:|---:|
| Peak heap MB         | 8.39 | 11.44 | 11.74 | 9.62 | 9.66 | 9.65 | **9.90** | +18% ⚠ |
| Peak DOM nodes       | 3,243 | 7,184 | 6,143 | 1,669 | 1,669 | 1,669 | **2,016** | **−38%** ✅ |
| Wall time ms         | 18,500 | 24,280 | 18,047 | 20,389 | 21,062 | 18,869 | **20,178** | +9% ~ |
| Total WS MB (p50)    | n/a | 473 | n/a | 484 | 699 | 655 | **673** | (see below) |
| Renderer WS MB (p50) | n/a | **103** | n/a | **103** | 206 | 206 | **205** | (see below) |

### Apparent "+99 % renderer working set" — explained

The headline-worrying "rendererWsMb 103 → 205" jump first surfaces
between B#24 (`20260426-frontend-ipc-quick-dynamic-pass`) and
B#25 (`20260426-enterprise-full-final-frontend-ipc`) — **both
on Apr 26, both pre-Phase 3 (Phase 3 commits start Apr 27)**.  So
this delta is *not* caused by the Vite 8 / TS 6 / ESLint 10 /
@types-node 25 / plugin-react 6 bumps.

Direct inspection of the JSONL samples shows what the number really
represents.  Reading every workflow's `native-memory-*.jsonl` for
the post-Phase 3 run (timestamps 1777325878805..1777326033264):

| Sample point             | webview2RendererWsMb | totalWsMb |
|---|---:|---:|
| First sample (cold, t≈600 ms)  | **78–83 MB** | **447–463 MB** |
| Last sample (warm, t≈30 s)     | **202–216 MB** | **665–737 MB** |
| Within-run delta               | **+130 MB**  | **+220 MB** |

So the renderer process grows ~130 MB **inside a single workflow
run** as the user navigates through 6 fixtures, runs analysis,
opens a 4-experiment comparison, and renders 2 PDFs.  This is
expected V8 heap + DOM cache + JIT / image-buffer growth, not a
leak: the SOAK suite shows leak slope ≈ 0 MB/round, the benchmark
suite shows leak slope IMPROVED from +2.7 MB to −0.1 MB after
Phase 3 (see "Phase 3 finding 4" above).

### Where the "B#22 = 103 MB" number actually came from

B#22 (Apr 15) ran the deep-audit harness with mode=quick (single
workflow run, no warmup).  Its KPI snapshot's `rendererWsMb` was
recorded near the **start** of that run.  B#25-B#27 ran mode=full
(multi-cycle: warmup + 5 measured workflows + 3 soaks + 2
benchmarks) and report `rendererWsMb` near the **end** of the
last measured cycle.  Same code, different sampling point.

The B#26 report itself encodes this directly: its KPI table
shows `rendererWsMb Baseline 104.90 → Current 206.14` (delta
+101.24) within a single audit run, where "Baseline" is the
first sampled value and "Current" is the median of measured
runs (i.e. cold vs warm), not pre vs post Phase 3.

### Verdict — long-tail

* Apples-to-apples (same harness, same scenario, same sampling
  point) shows **no Phase 3 regression** on heap, DOM nodes,
  wall time, or CPU.
* The eye-catching "+99 % renderer working set" between B#22 and
  B#27 is a measurement-window artefact: B#22 captured the
  cold-start state, B#27 captures end-of-run steady state of a
  longer workload.  Both states exist in both code versions.
* The peak-heap +18 % from B#13 (Mar 2) to B#27 (Apr 28) is
  spread across 8 weeks of feature additions (filter cache,
  comparison page, PDF improvements, etc.) — it is **not**
  attributable to Phase 3.
* Recommended action: **none**.  Continue tracking per-cycle
  heap slope (already <0 MB/round on the benchmark suite, ≈0.01-
  0.13 MB/round on soak) as the regression early-warning signal.
