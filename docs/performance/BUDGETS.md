# Performance Budgets — RheoLab Enterprise

**Status:** v1 draft (2026-04-28, Sprint 0).  
**Owner:** Architecture Team.  
**Linked baseline:** to be set in `BASELINES.md` as **AlphaBaseline-0.2.2-alpha.2**.  
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
| **M-RSS-TOTAL** | `totalWsMb` peak (Tauri + WebView2 sum, MB) | `perf:workflow:tauri` | 673 | **≤ 700** | **≤ 750** | hard |
| **M-RSS-RENDERER** | `rendererWsMb` peak (WebView2 renderer only, MB) | `perf:workflow:tauri` | 205 | **≤ 220** | **≤ 250** | hard |
| **M-RSS-TAURI** | `tauriWsMb` peak (Rust process, MB) | `perf:soak:tauri` | 484 | **≤ 500** | **≤ 540** | hard |
| **M-HEAP-PEAK** | `peakHeapMb` (JS heap, library workflow) | `perf:benchmark` | 9.90 | **≤ 12** | **≤ 16** | soft |
| **M-HEAP-LIB-10K** | JS heap after library open with 10k seed | `perf:db:large` | TBD | **≤ 128** | **≤ 160** | soft |
| **M-NODES-PEAK** | `peakNodes` (DOM node count) | `perf:benchmark` | 2016 | **≤ 2400** | **≤ 3000** | soft |

Rationale for `M-RSS-TOTAL` 700 MB: `FRONTEND-IPC-DEEP-AUDIT-LATEST.md` shows
p50 at 673 MB and p95 at 703 MB. Setting the gate at 700/750 keeps Apr 28's
state inside hard-fail; any further growth (e.g. heavier comparison adapter)
would be caught immediately. P3-001 in the audit's Remediation Backlog already
owns the longer-term goal of `≤ 600 MB p95` — moving the budget tighter is a
post-Sprint-1/2 deliverable, not now.

### B. Wall-clock latency (interactive paths)

| ID | Metric | Source | Current p50 (Apr 28) | **Budget p50** | **Budget p95** | Severity |
|---|---|---|---:|---:|---:|---|
| **L-WORKFLOW** | `totalWallMs` (5-fixture multi-fixture workflow, ms) | `perf:workflow:tauri` | 20,178 | **≤ 22,000** | **≤ 25,000** | soft |
| **L-COLDSTART** | App launch → first usable screen (ms) | NEW (Sprint 0) | TBD | **≤ 4,000** | **≤ 6,000** | soft |
| **L-LIB-OPEN-1K** | Library page render after warm DB, 1k seed (ms) | NEW (Sprint 1) | TBD | **≤ 250** | **≤ 400** | soft |
| **L-LIB-OPEN-10K** | Library page render, 10k seed (ms) | `perf:db:large` (extend) | TBD | **≤ 800** | **≤ 1,500** | soft |
| **L-FILTER** | Filter change → list re-render (ms, perceived) | NEW (Sprint 1) | TBD | **≤ 100** | **≤ 200** | soft |
| **L-EXP-DETAIL** | Experiment detail open (ms) | NEW (Sprint 1) | TBD | **≤ 300** | **≤ 600** | soft |
| **L-CMP-3** | Comparison setup, 3 experiments (ms to UI ready) | NEW (Sprint 1) | TBD | **≤ 600** | **≤ 1,000** | soft |
| **L-CMP-5** | Comparison setup, 5 experiments | NEW (Sprint 1) | TBD | **≤ 1,000** | **≤ 1,800** | soft |
| **L-CMP-10** | Comparison setup, 10 experiments | NEW (Sprint 1) | TBD | **≤ 2,500** | **≤ 4,000** | soft |
| **L-PDF** | Single PDF report generation (ms) | `perf:workflow` | TBD | **≤ 5,000** | **≤ 8,000** | soft |
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
| **C-CPU-WORKFLOW** | `tauriCpuSec` peak during workflow | `perf:workflow:tauri` | 6.27 | **≤ 7.0** | **≤ 8.0** | soft |
| **C-CPU-SOAK** | `tauriCpuSec` peak during soak | `perf:soak:tauri` | 3.42 | **≤ 4.0** | **≤ 4.5** | soft |
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
| `docs/perf/BUDGETS.md` (this file) | done |
| `docs/perf/BASELINES.md` AlphaBaseline-0.2.2-alpha.2 entry | pending S0-5 |
| `scripts/audit/check-large-ipc-contracts.ts` (P14 lint) | pending S0-3 |
| Cargo `[profile.release.package.*]` per-package opt-level=3 (P10) | pending S0-4 |
| Comparison-path `tracing::instrument` instrumentation | pending S0-6 |
