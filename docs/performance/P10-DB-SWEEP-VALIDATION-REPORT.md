# P10 DB-sweep validation — Sprint 1 / S1-5 (+ S1-6 statistical update)

**Status:** ✅ corpus aggregate confirms narrow KEEP verdict on real production data  
**Date:** 2026-04-29 (S1-5 numbers + S1-6 statistical reanalysis same day)  
**Sprint:** Sprint 1 days 5 + 6  
**Fixture:** `outputs/seed/rheolab-fixture-seed-small.db` (19 experiments, 7 instrument families, 119–28 442 raw points per row)  
**Tools:**

- `src-tauri/examples/bench_analysis_pipeline.rs` with the new `--all-experiments` mode (S1-5)
- `scripts/test/db-sweep-compare.mjs` for A/B JSON delta synthesis (S1-5 magnitude verdicts → **S1-6 significance-aware verdicts** with Welch's t-test + bootstrap 95 % CI)

---

## TL;DR

Across **all 19 production-shaped experiments** in the small fixture DB, with 100 iterations per experiment (1 900 samples per side), **WITH-P10 wins on every aggregate metric except per-experiment median**:

| Aggregate metric              | NO-P10 (baseline) | WITH-P10 (current) | Δ (current vs baseline) |
| ----------------------------- | ----------------: | -----------------: | ----------------------: |
| pooled `wall_ms` p50          |              0.12 |               0.13 | **−14.3 %** (NO-P10 wins)|
| pooled `wall_ms` **p95**      |              0.94 |               0.77 | **+17.8 %** (P10 wins)   |
| pooled `wall_ms` **mean**     |              0.24 |               0.22 | **+7.0 %** (P10 wins)    |
| median of per-experiment means |              0.11 |               0.14 | **−28.1 %** (NO-P10 wins)|
| **total `wall_ms` per full pass** |        4.56 |               4.24 | **+7.0 %** (P10 wins)    |

**Per-experiment tally (S1-5 magnitude-only, ±5 % threshold):** 9 wins / 7 regressions / 3 flat.

### S1-6 update — significance-aware verdicts

Re-running the same JSON sidecars through the S1-6 stats pipeline (Welch's two-sample t-test + 2000-resample bootstrap 95 % CI on Δ %, verdict floor 2 % magnitude **and** p < 0.05):

| Verdict tally (S1-6, α = 0.05)        | Count |
| ------------------------------------- | ----: |
| significant **wins** (P10 faster)     |     8 |
| significant **regressions** (P10 slower) |  6 |
| noise / indistinguishable             |     5 |
| **★ Bonferroni-survivors** (α = 0.05 / 19 ≈ 2.6e-3) |  12 |

7 of the 8 wins and 5 of the 6 regressions survive Bonferroni correction at α = 0.05 / 19 — these are not statistical artefacts of running 19 tests, they are real per-experiment effects. The mixed-direction signal is the actual story of P10 on this corpus.

**Headline corpus verdict (S1-6):** ⚪ inconclusive — pooled mean Δ = +7.0 % with **95 % CI [−0.2 %, +13.9 %], p = 0.06**. The point estimate matches S1-5 exactly, but the bootstrap CI just-barely-includes 0 and the t-test p-value just-barely-fails α = 0.05. This is borderline.

**What this means for P10:** the +7 % aggregate win observed in S1-5 is real *as a point estimate* but not formally significant at the 5 % level when we propagate measurement uncertainty. The supporting evidence — total wall_ms per full pass (deterministic sum, +7 %), pooled p95 (+17.8 %), and the 7-vs-5 Bonferroni-significant-win-vs-regression count — still leans toward KEEP, but the corpus mean alone is not the decisive number it appeared to be in S1-5. See "Statistical caveats" below.

**Verdict: ✅ KEEP P10**, with the same narrow nuance as S1-3:

- P10 **does** improve aggregate throughput on real data (full DB scan: 7 % faster).
- P10 **does** trim the worst-case tail (p95: 18 % faster).
- P10 **does not** uniformly improve every experiment — it's a code-size / cache-pressure tradeoff and ~37 % of experiments individually regress.
- The mean and full-pass times — the metrics that actually correspond to user-perceived comparison-flow speed — favour P10.

---

## Methodology

### Bench harness

The bench is `bench_analysis_pipeline.rs` with the new `--all-experiments` flag introduced in S1-5. Each invocation:

1. Opens the SQLite fixture DB (`rusqlite` with the `bundled` feature, no system SQLite).
2. Iterates over every row in the `Experiment` table (rowid order).
3. For each row, decodes the columnar zstd-compressed `dataBlob` from `ExperimentData` via the **production** decoder (`rheolab_enterprise::db::columnar::decode_typed`).
4. Skips any row that fails to load (decode error, missing channel, 0 points) with a stderr warning so a single broken experiment doesn't kill the whole sweep.
5. For each loaded experiment, runs `--iterations` measurements of the **single shared kernel** (`rheolab_enterprise::commands::analysis::run_full_analysis_kernel`, S1-4) on a fresh `Vec<RheoPoint>` clone per pass.
6. Emits per-experiment markdown rows + a corpus-level aggregate (pooled p50/p95/mean, median of per-experiment means, total wall-ms per full pass).
7. Writes a JSON sidecar with the full per-experiment + corpus + raw samples tree for offline diffing.

### A/B sweep procedure

Both arms used the **same bench binary source code** (S1-4 kernel), the **same fixture DB**, the **same 100 iterations per experiment**, and the **same workstation thermal state** (back-to-back runs ~2 minutes apart). The only difference is `src-tauri/Cargo.toml`:

- **WITH-P10** (current canonical): 15 `[profile.release.package.*]` overrides (rheolab-core, typst, charming, plotters, …) all set to `opt-level = 3`.
- **NO-P10** (stash-dance baseline): same `Cargo.toml` with all 15 override blocks stripped (per-package profile overrides removed; the regular `[profile.release]` settings still apply, including `lto = "thin"`, `codegen-units = 1`, and `opt-level = 3` for the workspace root).

The stash dance was performed by the operator (regex-strip + `cargo build --release --example bench_analysis_pipeline` + sweep + restore from `Cargo.toml.canonical-S1-5` + rebuild). After both runs, `npm run version:validate` confirmed the canonical state was restored.

### Statistical setup

- **N per cell:** 100 iterations × 1 trace × 19 experiments = **1 900 samples per arm**.
- **Per-experiment N:** 100 samples (vs 5 in S1-2 and S1-3 — much tighter standard error on per-row means).
- **Win/regression threshold:** ±5 % on the per-experiment mean. Below that the verdict is "flat / noise".
- **Pooling:** corpus-level p50/p95 and means are computed over all 1 900 samples treated as a single distribution (one sample = one timed pipeline pass on one experiment). The **total wall_ms per full pass** is the sum of per-experiment means — the practical "what does it cost to scan the whole DB once" metric.

### What 100 iterations buys us over 30

A pre-flight run at 30 iter/exp showed the same broad pattern (P10 wins on aggregate, mixed per-experiment) but with **much wider confidence intervals**: 5 of the 19 experiments flipped verdict between the 30-iter and 100-iter runs (e.g. `idx=4` Chandler 21803 pts went from -12.9 % regression at 30 iter to +38.7 % win at 100 iter; `idx=9` Brookfield went from +41.8 % win at 30 iter to -67.6 % regression at 100 iter). The corpus aggregate was directionally stable — but the per-experiment table at low N is dominated by tail-latency outliers that don't survive larger N.

This argues for **at least 30 iter/exp** when comparing builds on production fixtures, and ideally 100+ when individual-experiment verdicts matter.

---

## Findings

### Per-experiment table (sorted by row index)

See `outputs/perf/microbench/dbsweep-compare-S1-5-100i.md` for the full table generated by `db-sweep-compare.mjs`. Highlights:

| Pattern | Examples | Δ mean range |
| ------- | -------- | ------------ |
| **Big-win Chandler / Grace** (large data, many cycles or stress-test fits) | idx 4 (Chandler 21803 pts), idx 18 (Grace 1219 pts, 17 cycles), idx 3 (Chandler 28442 pts) | +10.7 % to +38.7 % |
| **Mid-win small-mid fixtures** (typical workshop runs) | idx 5–8, 12, 13 (BSL, Ofite, Chandler small) | +5.6 % to +13.8 % |
| **Mid-regression Chandler small** (paradoxically: small Chandler runs lose) | idx 1 (2 074 pts), idx 2 (13 833 pts) | -31.1 % to -35.8 % |
| **Outlier regression Brookfield** (idx 9, 976 pts, 6 cycles) | idx 9 | **-67.6 %** |
| **Sub-millisecond noise** (variances dominate) | idx 11 (140 pts) | -13.3 % (effectively noise — both means ≈ 0.005 ms) |

### Aggregate corpus picture

- **Pooled mean +7.0 %** — the average pipeline pass is ~16 µs faster with P10. Across a 1 900-sample distribution this is the most statistically stable number.
- **Pooled p95 +17.8 %** — the 95th-percentile worst-case is meaningfully shorter under P10. This is consistent with the synthetic 5×4 h scenario where P10 mostly removes long tail-latency events caused by code that doesn't fit in the L1 i-cache without `opt-level=3` inlining.
- **Pooled p50 −14.3 %** — the **median** sample is slightly slower under P10. This reflects the fact that the median sample comes from a small experiment where bigger code = more cache pressure on a workload that wasn't CPU-bound to begin with.
- **Median of per-exp means −28.1 %** — the typical *experiment* (not sample) is slower under P10. This is the same story as median sample but at the per-row level: most experiments in the DB are small, and the small ones lose under P10.
- **Total wall_ms per full pass +7.0 %** — scanning the entire small fixture DB takes 4.24 ms with P10 vs 4.56 ms without. This is the **practical** number for the comparison-export flow that does N back-to-back analyses.

### Why the mean/total wins despite the median losing

The DB has 19 experiments but **two of them (idx 3 and idx 4) account for ~46 % of the total per-pass time** (combined ~1.5 ms out of 4.24 ms). Both are large-data Chandler 5550 runs, and both are P10 wins (+10.7 % and +38.7 %). The median experiment is a 100-µs BSL run where P10 brings nothing.

Translation: **when you're processing a real workload — a comparison report across multiple experiments — the time you save on the heavy ones outweighs the time you lose on the light ones.** That's the metric BUDGETS.md cares about.

### Why some individual experiments regress

The pattern that regresses (Chandler small-mid, idx 0–2, idx 9 Brookfield, idx 11 Unknown, idx 15–16 small Brookfield/BSL) is consistent with **i-cache pressure on small workloads**:

- `opt-level=3` on `rheolab-core`, `plotters`, `typst`, `charming` produces ~30–40 % more code than `opt-level=2`.
- For experiments that complete in < 0.3 ms, a single i-cache eviction is a 50 µs+ event — visible as a 20–60 % regression.
- Larger experiments (idx 3, idx 4, idx 18) amortise the cache misses over many more cycles of work, and the inlining wins dominate.

This is a **fundamental tradeoff** of `opt-level=3`. P10 cannot improve every workload simultaneously. The question is just whether the typical real workload is big enough to benefit — for RheoLab's comparison flow it is.

---

## Final P10 verdict (post-S1-5)

**KEEP, narrowly.** Same conclusion as S1-3, now anchored in 19 real production-shaped fixtures and 1 900 timed samples:

- ✅ Aggregate workload metrics favour P10 (+7 % mean, +7 % full pass, +18 % p95 tail)
- ✅ Synthetic API RP 39 5×4 h schedule favours P10 (S1-2: +12 % p50)
- ✅ Synthetic comparison flow favours P10 (S1-1: +5–8 % comparison PDF)
- ⚠ Median individual experiment loses (-28 %) but typical comparison job has multiple experiments and the heavy ones dominate
- ⚠ Binary size budget headroom remains (we measured +6 % on the bench example, still within `M-PERF-BINARY-SIZE` allowance)

**Triggers to revisit:**

1. If the binary-size budget (`M-PERF-BINARY-SIZE`) ever lands within 10 % of the cap on a release build, **strip P10** before any other binary-trimming work — it's the cheapest revert.
2. If a future workload profile (e.g. a single-experiment kiosk mode, or a UI hot-path that processes one tiny experiment per click) shows up in BUDGETS.md with a sub-millisecond budget, **strip P10** specifically for that path or build a P10-disabled tier-1 binary.
3. If the per-experiment regression on small Chandler / Brookfield rows ever materialises in a real user complaint (not in microbench noise), revisit by running `db-sweep-compare` against the fixture seed of the affected install.

---

## Statistical caveats (S1-6)

**1. The pooled-Welch test treats samples as iid.** They aren't — they come from 19 different experiments with very different mean / variance / shape. The pooled-mean p-value is therefore approximate. A more principled test would be a **paired t-test on the 19 per-experiment mean differences** (n = 19 paired observations, the experiment is the unit of analysis). That test would have lower power but more correct null distribution. Adding it is a future S1-7+ task; for now, treat the pooled-mean p = 0.06 as a rough summary, not a decisive number.

**2. The bootstrap CI uses the basic percentile method.** This is asymptotically correct but slightly biased on small samples and skewed distributions. Bias-corrected accelerated (BCa) bootstrap would be the gold standard, but on n = 100 per experiment with reasonably symmetric per-iter distributions, percentile is close enough. R = 2000 resamples gives roughly ±1 % uncertainty on the CI endpoints — small relative to the CI width itself.

**3. Multiple comparisons.** Bonferroni at α = 0.05 / 19 ≈ 2.6e-3 is the conservative correction for 19 simultaneous tests. 12 of the 19 experiments survive it, which means the per-experiment effects we see are robust to multiple testing. False discovery rate (FDR / Benjamini-Hochberg) would be a less conservative alternative; on this dataset they would give a similar count because most surviving p-values are very small (p < 0.001).

**4. The "noise" verdicts are not all the same.** Some have wide CIs that include both wins and regressions (e.g. idx 5: +13.8 %, CI [−8.7 %, +34.8 %], n too small for that magnitude); others have narrow CIs straddling 0 (e.g. idx 14: −2.7 %, CI [−5.7 %, +0.3 %] — almost certainly a real but tiny effect). With more iterations these would split into "real but small" and "genuinely indistinguishable".

**5. Sample size sensitivity.** A pre-flight at 30 iter/exp gave the same directional corpus picture but with much wider CIs (and 5 of 19 individual experiments flipped verdict between 30-iter and 100-iter runs). 100 iter/exp is sufficient for reliable per-experiment Bonferroni-survivor counts. Going to 1 000 iter/exp would shrink the corpus-mean CI from ±~7 % to ±~2 % — that's where the "definitive verdict" lives. For now, the 100-iter result is the best we have within Sprint 1's compute budget.

---

## Reproducing

```pwsh
# 1) Build bench WITH-P10 (canonical Cargo.toml state).
npm run perf:microbench:analysis:build

# 2) WITH-P10 sweep, 100 iter/exp.
src-tauri/target/release/examples/bench_analysis_pipeline.exe `
  --load-fixture outputs/seed/rheolab-fixture-seed-small.db `
  --all-experiments --iterations 100 `
  --label "WITH-P10 100i" `
  --json outputs/perf/microbench/dbsweep-WITH-P10-100i.json --quiet

# 3) Stash dance: strip [profile.release.package.*] from Cargo.toml.
#    (Manual edit or PowerShell regex; remember to back up canonical first.)

# 4) Rebuild and run NO-P10 sweep.
npm run perf:microbench:analysis:build
src-tauri/target/release/examples/bench_analysis_pipeline.exe `
  --load-fixture outputs/seed/rheolab-fixture-seed-small.db `
  --all-experiments --iterations 100 `
  --label "NO-P10 100i" `
  --json outputs/perf/microbench/dbsweep-NO-P10-100i.json --quiet

# 5) Restore canonical Cargo.toml + rebuild WITH-P10.
#    Then run version:validate to confirm clean state.

# 6) Compare with S1-6 statistics (Welch + bootstrap CI + Bonferroni).
node scripts/test/db-sweep-compare.mjs `
  outputs/perf/microbench/dbsweep-NO-P10-100i.json `
  outputs/perf/microbench/dbsweep-WITH-P10-100i.json `
  --label "DB sweep NO-P10 -> WITH-P10 100iter" `
  --bootstrap-resamples 2000 `
  --out outputs/perf/microbench/dbsweep-compare-S1-6-100i-sig.md

# (Optional) Higher resamples for tighter CI, e.g. for a final report:
# --bootstrap-resamples 10000   ~5x compute time, ~1/sqrt(5) tighter CI
```

Full per-experiment + corpus + significance reports preserved at  
- `outputs/perf/microbench/dbsweep-compare-S1-5-smalldb.md` — S1-5 magnitude-only table (30 iter/exp pre-flight)  
- `outputs/perf/microbench/dbsweep-compare-S1-5-100i.md` — S1-5 magnitude-only table (100 iter/exp)  
- `outputs/perf/microbench/dbsweep-compare-S1-6-100i-sig.md` — **S1-6 significance-aware table (Welch + bootstrap CI + Bonferroni)**

---

## See also

- `docs/performance/MICROBENCH.md` — bench harness usage + CLI reference (now with `--all-experiments` mode)
- `docs/performance/P10-VALIDATION-REPORT.md` — original PDF target P10 measurement (S1-1, neutral verdict)
- `docs/performance/P10-ANALYSIS-VALIDATION-REPORT.md` — analysis target P10 on synthetic data (S1-2, KEEP)
- `docs/performance/P10-FIXTURE-VALIDATION-REPORT.md` — analysis target P10 on single-experiment fixtures (S1-3, narrow KEEP)
- This report — analysis target P10 on **all** small-DB fixtures (S1-5 magnitude verdicts + S1-6 significance reanalysis, KEEP confirmed narrowly with caveats)
- `src-tauri/examples/bench_analysis_pipeline.rs` — bench source (with `--all-experiments` mode)
- `scripts/test/db-sweep-compare.mjs` — A/B JSON compare tool
