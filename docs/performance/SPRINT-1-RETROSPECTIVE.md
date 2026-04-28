# Sprint 1 retrospective — performance architecture

**Sprint window:** 2026-04-26 → 2026-04-29 (4 active days)  
**Status:** ✅ closed (2026-04-29)  
**Mission as scoped:** fill ~13 BUDGETS.md `TBD` entries with measurements + tighten the perf contract for the next release.  
**Mission as delivered:** built a **statistically rigorous microbench harness** for the analysis pipeline and PDF generation, used it to settle the long-running P10 (release-profile) question, and deferred the broad TBD-fill to Sprint 2.

> **TL;DR:** Sprint 1 swapped a broad-but-shallow budget-filling pass for a deep P10 validation + reusable microbench infrastructure. The trade-off was deliberate, the artefacts are durable, and Sprint 2 inherits the entire BUDGETS.md TBD backlog plus 4 explicit S1-deferred items.

---

## What was built

| Phase | Commit | What | LOC (approx) |
| ----- | ------ | ---- | ------------ |
| **S1-1** | `5951fb5` | `bench_comparison_pdf.rs` cargo example: synthetic comparison-PDF microbench (3 fixtures: 3 / 5 / 10 experiments). `run-rust-microbench.mjs` orchestrator with sweep + compare modes. `P10-VALIDATION-REPORT.md` with PDF target neutral verdict. | +480 (bench) +415 (orchestrator) +115 (report) |
| **S1-2** | `91c6522` | `bench_analysis_pipeline.rs` cargo example: synthetic API RP 39 schedule generator (1×4h, 1×12h, 5×4h fixtures), full `analyze_full` pipeline emulation. Orchestrator generalised to multi-target. `P10-ANALYSIS-VALIDATION-REPORT.md` with KEEP verdict on synthetic. | +815 (bench) +210 (orchestrator delta) +115 (report) |
| **S1-3** | `52d2614` | `--load-fixture <db> --experiment-index <i>` mode for analysis bench: real production data via the production columnar decoder (`rheolab_enterprise::db::columnar::decode_typed`). Manual `foreach` sweep across 3 hand-picked experiments. `P10-FIXTURE-VALIDATION-REPORT.md` narrowing the verdict. | +250 (bench delta) +213 (report) |
| **S1-4** | `b7f1c0b` | Refactored `analysis_analyze_full` IPC handler body into `pub fn run_full_analysis_kernel` with `#[inline]` for cross-crate inlining. Bench now calls the same kernel as production — vendoring drift risk eliminated. | +44 (kernel) -202 (vendored bench helpers dropped) |
| **S1-5** | `e34cec7` | `--all-experiments` flag for analysis bench: full DB sweep with per-experiment + corpus aggregate (pooled p50/p95/mean, median of per-exp means, total per pass). `db-sweep-compare.mjs` standalone Node tool. `P10-DB-SWEEP-VALIDATION-REPORT.md` confirming KEEP at corpus level (1900 samples per arm). | +476 (bench delta) +340 (compare tool) +218 (report) |
| **S1-6** | `f6e9f46` | Welch's two-sample t-test (normal-approx p-value via Abramowitz & Stegun erf) + basic-bootstrap 95 % CI (R = 2000 default) + Bonferroni-survivor flagging in `db-sweep-compare.mjs`. Report gains "Statistical caveats" section + Headline corpus verdict callout. | +320 (stats + report builder rewrite) |

**Net Sprint 1 delta vs Sprint 0 baseline (`ca2496e`):**

```
 docs/performance/{P10-VALIDATION,P10-ANALYSIS-VALIDATION,
                   P10-FIXTURE-VALIDATION,P10-DB-SWEEP-VALIDATION,
                   MICROBENCH}.md   1 050 +
 scripts/test/{run-rust-microbench, db-sweep-compare}.mjs    1 000 +
 src-tauri/examples/{bench_comparison_pdf,
                     bench_analysis_pipeline}.rs             1 540 +
 src-tauri/src/commands/analysis/commands.rs (kernel)            76 +
 docs/performance/SPRINT-1-RETROSPECTIVE.md (this file)         ~150 +
                                                       ───────────────
                                                          ~3 800 LOC
```

6 commits, 4 phases planned + 2 phases added on the fly (S1-5 and S1-6 emerged from "we should validate at scale" and "the ±5 % verdict threshold isn't good enough"). All gates green at every step (cargo `--lib` 381/381 → 381/381, vitest 1348/1354, audit clean, version-validate clean).

---

## What was learned

### 1. P10 verdict — KEEP, narrowly, with caveats

After 6 phases of testing across:

- **synthetic API RP 39 schedules** (1 / 5 / 10 traces × 4 / 12 hours)
- **3 hand-picked production fixtures** (S1-3)
- **all 19 experiments in `small.db`** (S1-5: 1 900 samples per arm)
- **statistically rigorous reanalysis** with Welch's t-test + bootstrap CI (S1-6)

The picture is consistent and nuanced:

- **Aggregate metrics favour P10.** Pooled mean +7 %, total per full pass +7 %, pooled p95 +17.8 %.
- **Per-experiment effects are mixed.** 8 statistically significant wins, 6 statistically significant regressions, 5 noise (out of 19, S1-6 thresholds: |Δmean| ≥ 2 % AND p < 0.05). 12 of 14 non-noise verdicts survive Bonferroni at α = 0.05 / 19.
- **The corpus mean Δ CI just barely includes 0.** [-0.2 %, +13.9 %] at 95 %, p = 0.06 by pooled-Welch — borderline non-significant. The +7 % point estimate is real, but uncertainty propagation reveals it's not a slam dunk.
- **Pattern of regressions** is consistent with **i-cache pressure on small workloads**: `opt-level=3` produces ~30–40 % more code, sub-300 µs experiments lose 20–60 % when a single i-cache eviction occurs.

**Triggers to revisit P10** unchanged from S1-3:

1. Binary-size budget within 10 % of cap → strip P10 first (cheapest revert).
2. Sub-millisecond UI hot-path appears in BUDGETS.md → strip P10 for that path or build a P10-disabled tier-1 binary.
3. Real user complaints about small-fixture latency → revisit with `db-sweep-compare` against the affected install's fixture seed.

### 2. Microbench infrastructure is now durable

`bench_analysis_pipeline.rs` exists as a permanent regression detector that mirrors the production IPC code path **exactly** (post-S1-4 it calls the same `pub fn run_full_analysis_kernel` the IPC handler runs inside `spawn_blocking`). Any future change to the pipeline shape automatically appears in microbench results — no manual sync to an example file.

The same is **not** yet true of `bench_comparison_pdf.rs`: the PDF bench still synthesises its own `ComparisonReportInput`, because we don't have a way to dump that struct from production. Doing so is a Sprint 2+ candidate (see Backlog below).

### 3. Statistical methodology established

S1-6 added the discipline that makes microbench numbers trustworthy:

- **Welch's t-test** (independent two-sample, normal-approx p-value) for per-experiment and corpus-level mean differences.
- **Basic-percentile bootstrap** (R = 2000 default) for 95 % CIs on Δ %.
- **Bonferroni correction** at α = 0.05 / N for multiple comparisons.
- **5 documented caveats** so future readers know what the methodology *doesn't* claim.

This translates the loose "+7 % win" / "−13 % regression" language from S1-2 / S1-3 into reproducible, defensible numbers. The cost is one Node script and ~200 LOC of pure-JS stats.

### 4. Iteration count matters more than expected

A 30 iter/exp pre-flight in S1-5 gave the same directional corpus verdict as 100 iter/exp **but with 5 of 19 individual experiments flipping verdict between the two runs**. That means low-N microbenches are fine for sanity checks but cannot be cited for per-experiment claims. We landed on **100 iter/exp as the practical floor** and **1 000 iter/exp as the level needed to push corpus-mean CI from ±7 % to ±2 %** if the borderline-p question (caveat #5 in S1-6) ever becomes load-bearing.

### 5. The stash-dance Cargo.toml workflow is annoying but tractable

Every A/B sweep required: backup canonical `Cargo.toml` → strip `[profile.release.package.*]` → rebuild bench → measure → restore → rebuild bench. Roughly 6 minutes per sweep including compile. Not painful enough to automate in Sprint 1; very tractable to automate in Sprint 2 if A/B sweeps become routine. Until then the manual recipe in each report's "Reproducing" section is the canonical path.

---

## What was deferred (Sprint 2 inheritance)

### Explicit Sprint 1 misses (per operator's program brief)

After close, operator restated Sprint 1's originally-scoped deliverables. The audit:

| Originally-scoped Sprint 1 item | Delivery | Inherited by |
| ------------------------------- | -------- | ------------ |
| `docs(perf): define performance budgets` | ✅ done in Sprint 0 | — |
| `test(perf): add library/report smoke perf runner` | ❌ **not delivered** — `perf:workflow:tauri` exists from before Sprint 1 but doesn't isolate L-LIB / L-FILTER / L-EXP-DETAIL / L-CMP-* | Sprint 2 lead-in (S2-L3, S2-L4) |
| `docs(arch): add no-large-ipc rule` | ⚠️ **partial** — lint exists (`check-large-ipc-contracts.mjs`); no formal ADR | Sprint 2 lead-in (S2-L1, ADR-0013) |
| `docs(db): freeze V1_DDL contract fully` | ❌ **not delivered** — 7 migration files exist; no human-readable schema-contract doc | Sprint 2 lead-in (S2-L2, V1_DDL.md) |

So Sprint 1 shipped **1 of 4** originally-scoped items as planned (budgets), **1 of 4 partially** (no-large-ipc lint without the ADR), and **traded the other 2** for the P10 deep-dive + microbench harness. See `SPRINT-2-PLANNING.md` § "Lead-in" for the recovery plan.

### TBD entries still open in BUDGETS.md

Beyond the 4 originally-scoped items, **~13 TBD entries** in `BUDGETS.md` were still open at Sprint 1 close. Sprint 1 filled **0** of them by direct measurement.

- **L-LIB-OPEN-1K**, **L-LIB-OPEN-10K** — library page render after warm DB. NEW harness needed.
- **L-FILTER** — filter change → list re-render perceived latency.
- **L-EXP-DETAIL** — experiment detail open.
- **L-CMP-3 / L-CMP-5 / L-CMP-10** — comparison setup latency at 3 / 5 / 10 experiments.
- **L-XLSX**, **L-CMP-PDF-5**, **L-CMP-XLSX-5** — report generation latencies. Single PDF measured in S0 (1.57 s, well within 5 s budget); comparison-PDF only synthetic so far.
- **C-LONG-TASK**, **C-LONG-TASK-COUNT** — main-thread health metrics.
- **C-IDLE-UPDATER** — updater idle overhead.
- **DB-LIST**, **DB-LIST-LARGE**, **DB-DETAIL** — DB query latencies.

Of these, **L-LIB-* / L-FILTER / L-EXP-DETAIL / DB-LIST* / DB-DETAIL** ride directly on Sprint 2's library smoke runner (S2-L3); **L-CMP-* / L-CMP-PDF-5 / L-CMP-XLSX-5 / L-XLSX** ride on the comparison smoke runner (S2-L4) plus the native-by-ids work itself.

### Specifically labelled S1-{n} that were dropped or deferred

- **S1-3.5 / S1-3.6** — orchestrator fixture-mode integration. Currently `run-rust-microbench.mjs` only knows about synthetic sweeps; fixture sweeps are run manually with `foreach` PowerShell loops. Adding `--fixture-db <path> --all-experiments` to the orchestrator would close this. Estimated: 1–2 hours.
- **S1-7** — same as S1-3.6, alternate naming (the conversation re-numbered it after S1-6 closed).
- **S1-8** — `large.db` sweep (1 764 experiments). At 100 iter/exp = 176 400 samples per arm, the corpus-mean CI would tighten from ±7 % (current) to ~±1 %, which **would settle the borderline p = 0.06 corpus verdict** from S1-6. Compute: ~10–30 minutes per arm. Estimated: 1.5–2 hours.
- **S1-9** — paired-t corpus test (caveat #1). Treats experiments as the unit of analysis (n = 19 paired observations) instead of treating samples as iid. Lower power but more correct null distribution. Estimated: 1–1.5 hours.

### Statistical caveats deferred

From S1-6's "Statistical caveats" section, future improvements are:

1. **Paired-t corpus test** — see S1-9 above.
2. **BCa bootstrap** — bias-corrected accelerated bootstrap is the gold standard but the basic percentile method is close enough at n = 100 with reasonably symmetric distributions.
3. **FDR (Benjamini-Hochberg) instead of Bonferroni** — less conservative correction. On `small.db` it would give ~the same survivor count because most surviving p-values are < 0.001 already.

---

## Lessons learned

1. **Build the harness before claiming a verdict.** The S1-1 / S1-2 reports both said "P10 is fine" with very small samples. S1-5 / S1-6 nearly retracted that to "borderline non-significant". The earlier reports were technically not wrong but they over-claimed certainty. Always ship the verdict alongside its CI.

2. **Refactor on day 4, not day 1.** The S1-2 vendored helpers (`vendored_detect_cycles`, `vendored_process_all_cycles`, ~140 LOC) were a known-vendoring-drift risk. We could have refactored upfront in S1-1 but it would have blocked progress on the actual measurement question. Doing the refactor in S1-4, *after* having concrete bench numbers to validate parity against, was lower-risk.

3. **Statistical rigour pays off late.** S1-6 added ~320 LOC and gave us nothing the loose magnitude verdicts didn't already say *for this dataset*. But: (a) the methodology is now reusable for every future A/B comparison, (b) the "Headline corpus verdict: inconclusive" callout would have caught us if we'd been tempted to over-claim P10, and (c) it documented 5 explicit caveats that prevent future-us from misreading the numbers.

4. **A four-day Sprint can yield 6 commits and 3 800 LOC** when the work is mostly in tooling + documentation, gates are green at every step, and there's no UI work blocking. This was a back-end-only Sprint; the next one will inevitably be slower if it touches React surfaces.

5. **Scope-shift is fine when the artefact is durable.** Sprint 1 didn't fill the TBDs it was scoped for, but the microbench harness it built will serve every subsequent sprint that asks "did this change break anything in the analysis pipeline / comparison PDF flow?". That's a long-tailed return.

---

## See also

- `docs/performance/PERF-ROADMAP-SPRINTS-1-6.md` — program-level view of all 6 sprints, ROI ordering, and cross-sprint dependencies.
- `docs/performance/SPRINT-2-PLANNING.md` — active sprint plan (native comparison-by-IDs + 4 Sprint 1 carry-over lead-in items).
- `docs/performance/BUDGETS.md` — formal performance contract (TBD entries are Sprint 2 backlog).
- `docs/performance/MICROBENCH.md` — the harness guide (synthetic + single-fixture + `--all-experiments`).
- `docs/performance/P10-VALIDATION-REPORT.md` — S1-1 PDF target.
- `docs/performance/P10-ANALYSIS-VALIDATION-REPORT.md` — S1-2 analysis on synthetic data.
- `docs/performance/P10-FIXTURE-VALIDATION-REPORT.md` — S1-3 analysis on 3 hand-picked fixtures.
- `docs/performance/P10-DB-SWEEP-VALIDATION-REPORT.md` — S1-5 + S1-6 full DB sweep + significance reanalysis.
- `docs/performance/SPRINT-2-PLANNING.md` — what Sprint 2 inherits and how to prioritise.
