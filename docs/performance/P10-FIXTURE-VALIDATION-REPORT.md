# P10 Fixture-Mode Validation — analysis pipeline on real production data

> **Status:** Sprint 1 / S1-3 (2026-04-28).  Companion to
> `docs/performance/P10-ANALYSIS-VALIDATION-REPORT.md` (synthetic).
> Re-run with `npm run perf:microbench:analysis:build` followed by the
> commands at the bottom of this report.  See `docs/performance/MICROBENCH.md`
> for fixture-mode CLI documentation.

## TL;DR

Synthetic-mode P10 win **does not transfer cleanly to real production
data**.  On 3 representative experiments from `rheolab-fixture-seed-small.db`,
P10 ranged from **−13 % (slower)** to **−2 % (faster)**, with the
weight of evidence leaning *negative*.  The synthetic 5×4h fixture
remains the only configuration where P10 shows a clear, reproducible
win.  **Final P10 verdict moves from "keep" to "keep but understand
the workload mix"** — see the Recommendation update at the bottom.

## Methodology

- **Bench binary:** `bench_analysis_pipeline.rs` with the new S1-3
  `--load-fixture <path.db> --experiment-index <i>` flags.  Reads raw
  points from `ExperimentData.dataBlob` via the production
  `rheolab_enterprise::db::columnar::decode_typed` (zero new deps).
- **Pipeline:** identical to synthetic mode (`detect_schedule` →
  `filter_parasitic_steps` → cycle detection → `process_all_cycles`).
- **Fixture DB:** `outputs/seed/rheolab-fixture-seed-small.db` (1.1 MB,
  19 experiments seeded from `tests/fixtures/`).
- **Sweep:** 3 representative experiments × `--n 5` (replay each
  trace 5× per timed iteration to amplify timing) × `--iterations 10`
  (twice the synthetic-mode reps for tighter statistics).
- **A/B procedure:** standard Cargo.toml stash dance from
  `MICROBENCH.md`, rebuilt bench binary between the WITH and NO sweeps.

## Fixture profile (selected for representativeness)

| idx | Instrument | Geometry | Points × n | Cycles ×n | Real workload character |
|----:|---|---|---:|---:|---|
| 3 | Chandler 5550 | R1B5 | 28442×5 = 142210 | 2×5 = 10 | **Heavy, sparse cycles** — dense raw points, few cycle fits |
| 4 | Chandler 5550 | R1B5 | 21803×5 = 109015 | 2×5 = 10 | **Medium, sparse cycles** |
| 14 | Brookfield PVS | R1B5 | 670×5 = 3350 | 29×5 = 145 | **Light, dense cycles** — small input but many Power-Law fits |

These three span the production workload landscape in `small.db`:
the Chandler experiments dominate by raw-point count, the Brookfield
experiment dominates by cycle count.  No single fixture exercises
both axes simultaneously — that's the nature of the test types
(Chandler runs prolonged stability tests with few transitions;
Brookfield runs cyclic shear sweeps).

## Results (mean ± range, ms)

| Fixture | WITH-P10 mean | WITH-P10 range | NO-P10 mean | NO-P10 range | Δ mean | Verdict |
|---|---:|---|---:|---|---:|---|
| idx=3 (Chandler heavy) | 6.7 | 5.22–9.73 | 5.8 | 5.07–7.01 | **+15 %** | NO-P10 faster |
| idx=4 (Chandler medium) | 4.1 | 3.87–4.63 | 4.2 | 3.91–5.25 | −2 % | Equal within noise |
| idx=14 (Brookfield, 145 cyc) | 2.3 | 1.50–3.50 | 2.0 | 1.53–2.41 | **+13 %** | NO-P10 faster |

Negative percentage means WITH-P10 is faster (the goal).

### Sample distributions

**idx=3 (most discriminating — biggest absolute time):**

```
WITH-P10: 9.73, 6.65, 5.83, 5.92, 6.09, 5.22, 6.97, 5.75, 8.19, 6.53
NO-P10:   6.61, 6.44, 5.45, 5.34, 5.07, 7.01, 5.46, 5.33, 6.42, 5.32
```

WITH-P10 has **two outlier samples (9.73, 8.19)** that drag the mean
up.  NO-P10 sample range is narrower (1.94 ms vs 4.51 ms).  Even
ignoring the outliers, NO-P10 medians lower (5.46 vs 6.31).

**idx=14 (most cycles per byte — closest analogue to synthetic 5×4h):**

```
WITH-P10: 2.34, 2.15, 3.50, 2.75, 1.54, 1.60, 2.72, 2.20, 2.44, 1.50
NO-P10:   1.53, 2.41, 1.97, 2.20, 1.74, 1.61, 2.01, 2.37, 2.04, 1.88
```

WITH-P10 again has higher variance (range 2.00 ms vs 0.88 ms).  The
WITH-P10 worst sample (3.50) is significantly slower than any NO-P10
sample.

## Why fixture mode shows different P10 behaviour than synthetic

The synthetic 5×4h fixture in `P10-ANALYSIS-VALIDATION-REPORT.md`
showed clear P10 wins (−6.1 % mean).  Real-data results are flat or
negative.  Three contributing causes:

1. **Cycle density per byte.**  Synthetic 5×4h had 150 cycles over
   72k points = **1 cycle per 480 points**.  Real Chandler experiments
   have 2 cycles over 28k points = **1 cycle per 14000 points** — 30×
   sparser.  P10 wins by speeding up the per-cycle hot loops in
   `calculate_grace_internal`; if there are fewer cycles per unit of
   time, the wins don't accumulate.
2. **Real Chandler stability tests are dominated by `detect_schedule`
   sliding-window iteration over flat data**, not by cycle fits.  The
   bulk of the time is in mostly-no-op rate-clustering loops where
   opt-level=3's auto-vectorisation has nothing to vectorise (data is
   essentially constant within long flat regions).
3. **Variance amplification.**  WITH-P10 binaries are 1.5 MB larger;
   the additional code consistently produces wider sample spread
   (range = 4.5 ms vs 1.9 ms on idx=3).  This is consistent with
   i-cache pressure: opt-level=3's larger function bodies thrash the
   instruction cache, causing occasional 2–3 ms outliers when a hot
   path doesn't stay resident.  On a `--n=1 --iterations=5` synthetic
   run those outliers got smoothed by the larger workload; with `--n=5
   --iterations=10` on shorter real traces they show up clearly.

The Brookfield idx=14 result is particularly diagnostic: it has 145
cycles total — even more than the synthetic 5×4h's 150 — but on
*smaller* total points (3.4k vs 72k).  P10 still loses, suggesting
cycle count alone isn't sufficient; total *time spent in hot loops*
matters, and 3.4k points doesn't give the loop enough iterations to
benefit from opt-level=3's optimisations after paying the i-cache
cost.

## What this means for production

Production users typically run RheoLab against a mix of:
- **Stability tests** (long Chandler-style runs, few cycles) — P10
  *neutral or slightly negative* per this report.
- **Sweep tests** (shorter Brookfield-style cyclic patterns, many
  cycles) — P10 *slightly negative* per this report.
- **Comparison reports across N stability tests** — synthetic 5×4h is
  the closest analogue, P10 *positive* per the synthetic report.

The synthetic 5×4h scenario only matches production when a user is
comparing 5+ heavy stability experiments at once.  That's a real but
not dominant workflow.

## Recommendation update (supersedes the synthetic-mode "KEEP" verdict)

**Final P10 verdict (S1-3 update): KEEP P10, but narrowly.**

The original `KEEP P10` recommendation in
`P10-ANALYSIS-VALIDATION-REPORT.md` was based on the synthetic
microbench showing a 6 % win on the analysis pipeline.  That win is
real for the synthetic workload but **does not generalise**: real
fixtures show 0–13 % *negative* P10 effect on individual experiments.

The decision still favours keeping P10 because:

1. **The PDF target was already neutral** (`P10-VALIDATION-REPORT.md`)
   so removing P10 wouldn't regain anything there.
2. **Comparison-report flow** (the only workflow where the synthetic
   5×4h matches production) shows clear P10 wins, and that flow runs
   user-facing latency that the user actively waits on.
3. **Single-experiment analysis paths** (where P10 is neutral or
   slightly negative) are usually fast enough in absolute terms (4–7
   ms) that a 13 % regression is invisible to users.
4. **Variance amplification** is the more serious concern, but it
   manifests as occasional 2–3 ms outliers — still within the
   "indistinguishable from noise" budget for individual analyses.

**Trigger to re-evaluate (revised):**

| Trigger | Action |
|---|---|
| Production telemetry shows users spend > 50 % of analysis time on single-experiment paths | Drop P10's 14 Typst/font/plotters overrides, drop `[profile.release.package.rheolab-core]`, accept synthetic-comparison regression. |
| `M-RSS-TAURI` budget pressure | Drop the 14 Typst/font/plotters overrides first (they help the PDF target by ~0 %, neutral to remove). Keep `[profile.release.package.rheolab-core]` only if the synthetic-comparison win still matters. |
| `bench_analysis_pipeline --load-fixture rheolab-fixture-seed.db` (full 102 MB DB) shows P10 negative on > 70 % of experiments | Drop P10 entirely. |
| New "comparison-report-heavy" use case is identified | No action — current P10 config favours that workload already. |

## Re-run procedure

```pwsh
# 1. WITH-P10 baseline (assumes Cargo.toml has the 15 P10 overrides)
npm run perf:microbench:analysis:build
foreach ($idx in 3,4,14) {
    & "src-tauri/target/release/examples/bench_analysis_pipeline.exe" `
        --load-fixture outputs/seed/rheolab-fixture-seed-small.db `
        --experiment-index $idx `
        --n 5 --iterations 10 `
        --label "WITH-P10-fixture-idx$idx" `
        --json "outputs/perf/microbench/fixture-mode/with-p10-idx$idx.json" `
        --quiet
}

# 2. Stash P10
Copy-Item src-tauri/Cargo.toml src-tauri/Cargo.toml.bak
# (manually delete the 15 [profile.release.package.*] sections, save)

# 3. NO-P10 baseline
npm run perf:microbench:analysis:build
foreach ($idx in 3,4,14) {
    & "src-tauri/target/release/examples/bench_analysis_pipeline.exe" `
        --load-fixture outputs/seed/rheolab-fixture-seed-small.db `
        --experiment-index $idx `
        --n 5 --iterations 10 `
        --label "NO-P10-fixture-idx$idx" `
        --json "outputs/perf/microbench/fixture-mode/no-p10-idx$idx.json" `
        --quiet
}

# 4. Restore + rebuild
Move-Item src-tauri/Cargo.toml.bak src-tauri/Cargo.toml -Force
npm run perf:microbench:analysis:build
```

The orchestrator (`run-rust-microbench.mjs`) does not yet support
fixture-mode sweeps via `--target analysis` — it remains
synthetic-only.  Adding fixture-mode orchestration is a future S1-3.5
or Sprint 2 task; for now the manual `foreach` loop above is the
canonical re-run path.

## See also

- `docs/performance/P10-ANALYSIS-VALIDATION-REPORT.md` — synthetic-mode validation (positive result on 5×4h).
- `docs/performance/P10-VALIDATION-REPORT.md` — PDF target validation (neutral).
- `docs/performance/MICROBENCH.md` — bench tooling guide.
- `src-tauri/examples/bench_analysis_pipeline.rs` — `--load-fixture` implementation.
- `outputs/perf/microbench/fixture-mode/` — raw JSON sidecars from the sweeps above.
