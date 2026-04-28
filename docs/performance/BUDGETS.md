# Performance Budgets — RheoLab Enterprise

**Status:** v1 (2026-04-28, Sprint 0 — baseline captured by S0-5).  
**Owner:** Architecture Team.  
**Linked baseline:** **AlphaBaseline-0.2.2-alpha.2** (see `BASELINES.md`, runId family `1777393597912`–`1777393927970`).  
**Compare gate:** any PR touching the comparison/report/library/filter paths
must run `npm run perf:compare` and prove it stays inside the budget envelope.

This document is the **formal performance contract** Sprint 0 added so that
subsequent perf-architecture work (Sprints 1-N) cannot regress silently. The
numbers below are **starting bands**, not aspirations — every band is computed
from existing measurements in `BASELINES.md` and `FRONTEND-IPC-DEEP-AUDIT-LATEST.md`,
plus a small explicit head-room for noise.

If a number is marked **TBD**, Sprint 0 has not yet captured a measurement for
it. The S0-5 baseline run on alpha.2 will replace each `TBD` with a real value
and a `> ≤ X` budget derived from it.

## How budgets are enforced

1. **Gate:** `npm run perf:compare -- <baseline.json> <new.json>` (already exists).
2. **Per-PR:** any PR labelled `perf:risk` (TODO: add the label to GitHub) must
   show a `perf:compare` table in the PR description.
3. **Per-release:** `release:prepare` already invokes `version:validate`; we will
   wire a soft `perf:budgets:check` step that reads the latest workflow JSON and
   fails the release if any **hard-fail** budget below is exceeded by >5%.
4. **Soft vs hard:** soft-fail = warn in CI, hard-fail = block release. New
   metrics start as soft for one release cycle, then promote to hard after a
   green run.

## Metric definitions and budgets

The 10 metrics from the architecture proposal mapped to what we actually
measure today.

### A. Memory pressure (process RSS + JS heap)

| ID | Metric | Source | Current p50 (Apr 28) | **Budget p50** | **Budget p95** | Severity |
|---|---|---|---:|---:|---:|---|
| **M-RSS-TOTAL** | `totalWsMb` peak (Tauri + WebView2 sum, MB) | `perf:workflow:tauri` | **558** (p95 725, peak 731) | **≤ 700** | **≤ 750** | hard |
| **M-RSS-RENDERER** | `rendererWsMb` peak (WebView2 renderer only, MB) | `perf:workflow:tauri` | **127** (p95 203, peak 207) | **≤ 220** | **≤ 250** | hard |
| **M-RSS-TAURI** | `tauriWsMb` peak (Rust process, MB) | `perf:soak:tauri` | **62** (p95 62, peak 62) | **≤ 500** | **≤ 540** | hard |
| **M-HEAP-PEAK** | `peakHeapMb` (JS heap, library workflow) | `perf:benchmark` | **9.81** (p95 9.84) | **≤ 12** | **≤ 16** | soft |
| **M-HEAP-LIB-10K** | JS heap after library open with 10k seed | `perf:db:large` | TBD | **≤ 128** | **≤ 160** | soft |
| **M-NODES-PEAK** | `peakNodes` (DOM node count) | `perf:benchmark` | **1646** (p95 1650) | **≤ 2400** | **≤ 3000** | soft |

Rationale for `M-RSS-TOTAL` 700 MB: `FRONTEND-IPC-DEEP-AUDIT-LATEST.md` shows
p50 at 673 MB and p95 at 703 MB; the AlphaBaseline-0.2.2-alpha.2 run (less
loaded test box) shows 558 / 725 MB — the p50 dropped 17% but p95 stayed
in the same envelope, confirming variance dominates. Setting the gate at
700/750 keeps both the Apr 28 worst-case AND the alpha.2 best-case inside
hard-fail; further growth (e.g. heavier comparison adapter) is caught
immediately. P3-001 in the audit's Remediation Backlog already owns the
longer-term goal of `≤ 600 MB p95` — moving the budget tighter is a
post-Sprint-1/2 deliverable, not now.

Note: `M-RSS-TAURI` measured 62 MB on the soak scenario — well below the
500 MB budget. The 484 MB number from the Apr 28 audit was the **`totalWsMb`**
for the soak scenario, not `tauriWsMb`. The corrected current value (62 MB)
shows the budget has plenty of headroom; we keep it loose because Sprint 2's
AnalysisArtifact cache will grow `tauriWsMb` materially.

### B. Wall-clock latency (interactive paths)

| ID | Metric | Source | Current p50 (Apr 28) | **Budget p50** | **Budget p95** | Severity |
|---|---|---|---:|---:|---:|---|
| **L-WORKFLOW** | `totalWallMs` (5-fixture multi-fixture workflow, ms) | `perf:workflow:tauri` | **19,173** (p95 19,267) | **≤ 22,000** | **≤ 25,000** | soft |
| **L-COLDSTART** | App launch → first usable screen (ms) | NEW (Sprint 0) | TBD | **≤ 4,000** | **≤ 6,000** | soft |
| **L-LIB-OPEN-1K** | Library page render after warm DB, 1k seed (ms) | NEW (Sprint 1) | TBD | **≤ 250** | **≤ 400** | soft |
| **L-LIB-OPEN-10K** | Library page render, 10k seed (ms) | `perf:db:large` (extend) | TBD | **≤ 800** | **≤ 1,500** | soft |
| **L-FILTER** | Filter change → list re-render (ms, perceived) | NEW (Sprint 1) | TBD | **≤ 100** | **≤ 200** | soft |
| **L-EXP-DETAIL** | Experiment detail open (ms) | NEW (Sprint 1) | TBD | **≤ 300** | **≤ 600** | soft |
| **L-CMP-3** | Comparison setup, 3 experiments (ms to UI ready) | NEW (Sprint 1) | TBD | **≤ 600** | **≤ 1,000** | soft |
| **L-CMP-5** | Comparison setup, 5 experiments | NEW (Sprint 1) | TBD | **≤ 1,000** | **≤ 1,800** | soft |
| **L-CMP-10** | Comparison setup, 10 experiments | NEW (Sprint 1) | TBD | **≤ 2,500** | **≤ 4,000** | soft |
| **L-PDF** | Single PDF report generation (ms) | `perf:workflow` | **1,571** (p95 1,844, n=6) | **≤ 5,000** | **≤ 8,000** | soft |
| **L-XLSX** | Single XLSX report generation (ms) | `perf:workflow` | TBD | **≤ 2,000** | **≤ 4,000** | soft |
| **L-CMP-PDF-5** | Comparison PDF, 5 experiments | NEW (Sprint 1) | TBD | **≤ 12,000** | **≤ 20,000** | soft |
| **L-CMP-XLSX-5** | Comparison XLSX, 5 experiments | NEW (Sprint 1) | TBD | **≤ 5,000** | **≤ 8,000** | soft |

Coldstart, library-open and filter latency budgets are derived from human
perception ranges (RAIL model: 100 ms = instant, 1 s = task break) tightened
where possible. Comparison PDF 12 s for 5 exp is intentionally generous — it
will tighten by 30-50% after Sprint 1 (native by-ids) and Sprint 2 (analysis
artifact cache).

### C. CPU and main-thread health

| ID | Metric | Source | Current p50 (Apr 28) | **Budget p50** | **Budget p95** | Severity |
|---|---|---|---:|---:|---:|---|
| **C-CPU-WORKFLOW** | `tauriCpuSec` peak during workflow | `perf:workflow:tauri` | **3.75** (p95 5.89, peak 6.05) | **≤ 7.0** | **≤ 8.0** | soft |
| **C-CPU-SOAK** | `tauriCpuSec` peak during soak | `perf:soak:tauri` | (TBD — cli-trim) | **≤ 4.0** | **≤ 4.5** | soft |
| **C-LONG-TASK** | Longest single main-thread task (ms) | NEW (Sprint 1) | TBD | **≤ 200** | **≤ 350** | soft |
| **C-LONG-TASK-COUNT** | Long-task count (>50 ms) per workflow | NEW (Sprint 1) | TBD | **≤ 30** | **≤ 50** | soft |
| **C-IDLE-UPDATER** | Updater-check idle overhead per minute (CPU sec) | NEW (Sprint 0) | TBD | **≤ 0.05** | **≤ 0.10** | soft |

Long-task budgets are RAIL-derived: 50 ms breaks the "instant" feel; the count
caps how many we tolerate per workflow because a single hot path producing 30
long tasks is worse than 5 paths producing 6 each.

### D. Database query budgets

| ID | Metric | Source | Current p50 | **Budget p50** | **Budget p95** | Severity |
|---|---|---|---:|---:|---:|---|
| **DB-LIST** | List/filter query (1k rows) | `perf:db:small` | TBD | **≤ 30 ms** | **≤ 60 ms** | soft |
| **DB-LIST-LARGE** | List/filter query (10k rows) | `perf:db:large` | TBD | **≤ 80 ms** | **≤ 150 ms** | soft |
| **DB-DETAIL** | Single experiment full-load query | NEW (Sprint 1) | TBD | **≤ 30 ms** | **≤ 60 ms** | soft |
| **DB-FACET** | Facet/distinct values query | NEW (Sprint 5) | TBD | **≤ 50 ms** | **≤ 100 ms** | soft |

## What stays explicitly out-of-scope this sprint

* **Throughput optimisation** (e.g. report generation tuned for 50 PDFs/min
  batch). RheoLab is interactive-first — we optimise latency, not throughput.
* **Bundle size budgets** (covered by `audit:bundle`, separate report).
* **Network/server SLOs** (license server uptime is owned elsewhere).

## Process for adding a new budget

1. Land the measurement first (instrumentation PR).
2. Capture three baseline runs, take p50/p95.
3. Add the row above with severity = soft, current = measured value.
4. After one green release cycle, promote to hard if the metric is stable
   (variance < 10% across 5 successive nightly runs).

## Sprint 0 deliverables tracker

| Deliverable | Status |
|---|---|
| `docs/perf/BUDGETS.md` (this file) | **done** — commit `5fd4308` |
| `scripts/audit/check-large-ipc-contracts.mjs` (P14 lint) + `LARGE-IPC-EXCEPTION` suppression on `reports_generate_comparison_pdf` | **done** — commits `9fb902f`, `e77fb26` |
| Cargo `[profile.release.package.*]` per-package opt-level=3 (P10) for `rheolab-core` + Typst stack + plotters | **done** — commit `7df0209` |
| Comparison-path `tracing::instrument` (Rust, 4 spans) + `withPerf<T>` (TS, 3 handlers) | **done** — commit `ca2496e` |
| `docs/perf/BASELINES.md` AlphaBaseline-0.2.2-alpha.2 entry | **done** — S0-5 measurements |
| Replace TBD values in this file with first real measurements | **done** (memory, workflow latency, PDF latency, peakNodes, peakHeap, CPU) |

## Sprint 1 deliverables tracker

> **Sprint 1 was scoped** to (a) fill ~13 TBD entries in this file, (b) ship library/report smoke perf runners, (c) codify the no-large-ipc rule as an ADR, and (d) freeze the V1_DDL contract. **Mid-sprint, scope shifted** to a deep P10 release-profile validation with reusable microbench infrastructure. The original deliverables (b), (c), (d) and the TBDs in sections B / C / D above are inherited by Sprint 2 lead-in. See `PERF-ROADMAP-SPRINTS-1-6.md` for the program view, `SPRINT-2-PLANNING.md` for the recovery plan, and `SPRINT-1-RETROSPECTIVE.md` for what actually shipped.

| Deliverable | Status |
|---|---|
| `bench_comparison_pdf.rs` cargo example + PDF target P10 microbench | **done** — commit `5951fb5` (S1-1) |
| `bench_analysis_pipeline.rs` cargo example + synthetic API RP 39 P10 microbench | **done** — commit `91c6522` (S1-2) |
| `--load-fixture` mode (real production data via `decode_typed`) | **done** — commit `52d2614` (S1-3) |
| `pub fn run_full_analysis_kernel` refactor (eliminates bench drift risk) | **done** — commit `b7f1c0b` (S1-4) |
| `--all-experiments` DB sweep + `db-sweep-compare.mjs` corpus validation tool | **done** — commit `e34cec7` (S1-5) |
| Welch t-test + bootstrap 95 % CI + Bonferroni in `db-sweep-compare.mjs` | **done** — commit `f6e9f46` (S1-6) |
| **Final P10 verdict (post-S1-6):** ✅ **KEEP, narrowly.** Pooled mean Δ = +7.0 % (95 % CI [-0.2 %, +13.9 %], p = 0.06 — borderline non-significant); supporting evidence (deterministic +7 % full-pass total, +17.8 % p95 tail, 7 Bonferroni-significant wins vs 5 regressions) tips the balance. See `P10-DB-SWEEP-VALIDATION-REPORT.md`. | **closed** |
| Fill ~13 TBD entries in sections B / C / D above | **deferred to Sprint 2** — original scope, dropped in favour of P10 deep-dive. |
| Pre-P10 vs post-P10 binary-size delta (mentioned at the bottom of this file) | **partially done** — bench example showed +6 % code size; full release-installer delta still pending. Sprint 2 candidate. |

## Binary size note (corrected)

An earlier draft of this document estimated the installer at “~80 MB”. The
actual measured size from the first P10 release build is:

* `rheolab-enterprise.exe` (release, signed): **30.39 MB**
* NSIS installer (signed): **10.36 MB**

This is roughly 8× smaller than the wrong estimate. The P10 budget claim
“+2–5 MB acceptable on a ~80 MB installer” is therefore stricter in
proportional terms; the real binary-size budget should be derived from
this measurement, not the prior estimate. Sprint 1 will capture a
pre-P10 vs post-P10 size delta when it has cause to rebuild without the
release overrides.
