# Sprint 2 planning — performance architecture

**Status:** draft (2026-04-29)  
**Sprint window:** TBD (recommend 4–5 active days)  
**Inherits from:** Sprint 1 (see `SPRINT-1-RETROSPECTIVE.md`)  
**Mission (proposed):** **convert the BUDGETS.md TBD backlog into measured numbers** and turn the most stable ones into release-blocking CI gates, while closing the 4 explicit S1-deferred items.

> **TL;DR:** Sprint 2 is the mission Sprint 1 was scoped for but skipped. The microbench harness, statistical methodology, and P10 verdict are settled; now we fill the contract.

---

## Backlog inventory

### A. Sprint 1 deferred (4 items)

| ID | Description | Estimated effort | Blocking? |
| -- | ----------- | ---------------- | --------- |
| **S2-A1** | Orchestrator fixture-mode integration: add `--fixture-db <path>` + `--all-experiments` to `run-rust-microbench.mjs`; expose `npm run perf:microbench:dbsweep` and `:dbsweep:compare`. Closes deferred S1-3.6 / S1-7. | 1–2 h | No (manual recipe works) |
| **S2-A2** | `large.db` sweep (1 764 experiments). 100 iter/exp = 176 k samples per arm, tightens corpus-mean CI from ±7 % to ~±1 %, settles the borderline p = 0.06 verdict from S1-6. | 1.5–2 h + 30–60 min compute | No (S1-5 verdict already cited) |
| **S2-A3** | Paired-t corpus test in `db-sweep-compare.mjs`: 19 paired observations on per-experiment mean differences, treating the experiment as the unit of analysis. Closes S1-6 caveat #1. | 1–1.5 h | No (auxiliary methodology) |
| **S2-A4** | BCa bootstrap (bias-corrected accelerated) in `db-sweep-compare.mjs`. Closes S1-6 caveat #2. | 1.5–2 h | No (basic percentile is close enough) |

### B. BUDGETS.md TBDs (~13 entries)

Grouped by family and rough Sprint-2 fitness. **Each row needs a one-shot harness + a measurement + a `BUDGETS.md` row update + a `BASELINES.md` entry.** A few share harnesses (e.g. all `L-CMP-{3,5,10}` ride one comparison-setup harness with three fixture sizes).

#### B.1 — Library and filter family (interactive paths, ≤ 200 ms perceived)

| Budget ID | Metric | Harness needed | Estimated effort |
| --------- | ------ | -------------- | ---------------- |
| **L-LIB-OPEN-1K** | Library page render after warm DB, 1k seed | extend `perf:db:small` with first-paint timing | ~1 h |
| **L-LIB-OPEN-10K** | Same, 10k seed | extend `perf:db:large` similarly | ~1 h (shared harness) |
| **L-FILTER** | Filter change → list re-render perceived latency | NEW harness: simulate filter input, measure paint | ~2 h |
| **L-EXP-DETAIL** | Single experiment detail open | NEW harness: click handler timing → first paint | ~1.5 h |
| **DB-LIST** | List/filter query (1k rows) | extend `perf:db:small` to capture query times | ~30 min |
| **DB-LIST-LARGE** | Same, 10k rows | extend `perf:db:large` similarly | ~30 min (shared) |
| **DB-DETAIL** | Single experiment full-load query | NEW: instrument `experiment_get_by_id` IPC | ~1 h |

**Estimated total for B.1:** 7–8 hours. **Yields:** 7 TBD → measured.

#### B.2 — Comparison flow family (the user-facing critical path)

| Budget ID | Metric | Harness needed | Estimated effort |
| --------- | ------ | -------------- | ---------------- |
| **L-CMP-3** | Comparison setup, 3 experiments → UI ready | NEW harness: time `comparison-store` to "ready for export" event | ~1.5 h |
| **L-CMP-5** | Same, 5 experiments | shared with L-CMP-3 | shared |
| **L-CMP-10** | Same, 10 experiments | shared | shared |
| **L-CMP-PDF-5** | Comparison PDF, 5 experiments | extend `perf:workflow:tauri` to fire the PDF path with 5 fixtures | ~1.5 h |
| **L-CMP-XLSX-5** | Comparison XLSX, 5 experiments | extend same as PDF | ~1 h (shared infra) |
| **L-XLSX** | Single XLSX report | extend `perf:workflow` | ~1 h |

**Estimated total for B.2:** 5–6 hours. **Yields:** 6 TBD → measured.

#### B.3 — CPU and main-thread health

| Budget ID | Metric | Harness needed | Estimated effort |
| --------- | ------ | -------------- | ---------------- |
| **C-LONG-TASK** | Longest single main-thread task during workflow | extend `perf:workflow:tauri` with PerformanceObserver longtask collection | ~2 h |
| **C-LONG-TASK-COUNT** | Long-task count (>50 ms) per workflow | shared with C-LONG-TASK | shared |
| **C-IDLE-UPDATER** | Updater-check idle CPU sec/min | NEW: synthetic idle scenario, capture `tauriCpuSec` over N minutes | ~1.5 h |

**Estimated total for B.3:** 3–4 hours. **Yields:** 3 TBD → measured.

### C. Carry-overs from existing audits + research briefs

| Origin | Item | Notes |
| ------ | ---- | ----- |
| `MEMORY-RESEARCH-BRIEF.md` | M-RSS-TAURI live monitoring | The audit expects `tauriWsMb` to grow with Sprint 2's AnalysisArtifact cache; we should land in-CI memory regression detection before that grows silently. |
| `FRONTEND-IPC-DEEP-AUDIT-LATEST.md` (P3-001) | AnalysisArtifact cache | Eliminates redundant `analyze_full` calls when the same experiment is re-opened. Big lever on L-CMP-* and L-EXP-DETAIL once those are measured. |
| `BUDGETS.md` § "L-CMP-* tightening" | Native-by-ids comparison | Replace the JSON-shuttle path with direct DB lookup. Mentioned as a Sprint 1 expected reduction; not delivered. |

### D. Release-only perf gates (turn measured TBDs into hard CI failures)

Currently every budget in `BUDGETS.md` has severity = **soft** (warns, doesn't block). After Sprint 2 fills its TBDs and the numbers prove stable across 5 nightly runs, candidates for promotion to **hard**:

- L-WORKFLOW (already measured, very stable in Sprint 0 baseline)
- L-PDF (already measured, single PDF stable)
- C-CPU-WORKFLOW (already measured)
- M-RSS-TAURI (already measured, low-headroom)
- L-CMP-PDF-5 (after Sprint 2 measurement + 5 stable nightly runs)

Estimated effort: 1–2 h to wire `npm run perf:compare` into CI as a blocking gate, plus per-budget promotion decisions as the data arrives.

---

## Prioritisation framework

For each candidate, evaluate on three axes (1 = low, 5 = high):

- **Impact** — does the artefact measurably improve Architecture Team confidence in releases?
- **Effort** — how many hours / how much complexity?
- **Blocking** — does anything else depend on this?

Recommended Sprint 2 selection rule: **start with high-impact / low-effort items, then high-impact / medium-effort, defer low-impact regardless of effort.**

| Item | Impact | Effort | Blocking | Score (impact × ease) |
| ---- | -----: | -----: | -------- | --------------------: |
| **B.1 (library + DB family)** | 4 | 2 (per item) | unblocks B.2 indirectly | 8 |
| **B.2 (comparison flow)** | 5 | 3 | downstream of B.1 | 7 |
| **C (long-task + idle CPU)** | 3 | 3 | independent | 6 |
| **A1 (orchestrator fixture mode)** | 2 | 1 | independent (QoL only) | 6 |
| **D (CI gate promotion)** | 4 | 1 (after data) | downstream of B.1+B.2 | 6 |
| **A2 (large.db sweep)** | 2 | 2 + compute | independent | 4 |
| **A3 (paired-t)** | 2 | 1.5 | independent | 4 |
| **A4 (BCa bootstrap)** | 1 | 2 | independent | 2 |

(Scores are heuristic; the team should re-rank after seeing Sprint 1 retrospective.)

---

## Recommended Sprint 2 phases

### Phase 1 — fill the library + DB family (S2-1 → S2-4)

**Goal:** convert 7 TBDs into measured numbers, all in one harness extension cluster. **Estimated:** 1.5–2 days. **Yields:** L-LIB-OPEN-{1K, 10K}, L-FILTER, L-EXP-DETAIL, DB-LIST, DB-LIST-LARGE, DB-DETAIL.

These are the cheapest TBDs because:
- **Existing harnesses** (`perf:db:small`, `perf:db:large`) just need new timing instrumentation, not new fixtures.
- **No new IPC contracts** — we instrument existing IPC calls, don't add new ones.
- **Independent of P10** — pass / fail the budget regardless of release profile.

### Phase 2 — fill the comparison flow family (S2-5 → S2-7)

**Goal:** 6 TBDs covering the user-facing critical path (`L-CMP-{3,5,10}`, `L-CMP-PDF-5`, `L-CMP-XLSX-5`, `L-XLSX`). **Estimated:** 1–1.5 days. **Yields:** the most user-visible budgets in the contract.

Phase 2 reuses `bench_comparison_pdf.rs` from Sprint 1 for synthetic comparison-PDF baseline measurements; the production-data-equivalent number requires a way to dump `ComparisonReportInput` from the running app, which is itself a sub-deliverable.

### Phase 3 — CPU and idle (S2-8)

**Goal:** 3 TBDs (`C-LONG-TASK`, `C-LONG-TASK-COUNT`, `C-IDLE-UPDATER`). **Estimated:** ~1 day. **Yields:** main-thread health budgets that catch jank-introducing changes.

`PerformanceObserver` longtask API is simple to wire into the existing soak / workflow harnesses — main lift is deciding what counts as "the workflow" for `count` aggregation.

### Phase 4 — promote to hard gates (S2-9)

**Goal:** turn the 5 most stable measured budgets into release-blocking CI gates. **Estimated:** 1–2 hours after the data is in.

This is where Sprint 2's value compounds: each measured TBD is an upper-bounded contract that can't silently regress.

### Side-quest — orchestrator fixture-mode (S2-A1)

**Goal:** close S1-deferred S2-A1 with `--fixture-db` + `--all-experiments` in `run-rust-microbench.mjs`. **Estimated:** 1–2 h. **Yields:** `npm run perf:microbench:dbsweep` and `:dbsweep:compare` workflows that don't require manual `foreach` loops.

Cheap quality-of-life win that pairs naturally with any phase that runs another A/B sweep (e.g. before promoting an L-CMP-* gate to hard).

### Optional — settle the borderline P10 verdict (S2-A2)

**Goal:** run S1-5's sweep on `large.db` (1 764 experiments × 100 iter), tighten corpus-mean CI from ±7 % to ~±1 %, formally resolve "p = 0.06 inconclusive" from S1-6. **Estimated:** 1.5–2 h hands-on + 30–60 min compute.

Not strictly necessary — S1's narrow KEEP verdict is on solid enough ground for the alpha → beta release. But if any reviewer or downstream architecture document cites the P10 verdict as a blocking dependency, this is the one-shot way to upgrade "narrow KEEP" to "definitive KEEP" or "definitive STRIP".

---

## Open questions for stakeholder

1. **Sprint window length.** Sprint 1 was 4 active days. Sprint 2 backlog is larger; recommend 5–6 active days.
2. **Phase ordering.** Recommended Phase 1 → Phase 2 → Phase 3 → Phase 4 above. Side-quest A1 fits anywhere; A2 is optional. **Should we lock the order or flex per-phase?**
3. **Hard-gate promotion criteria.** `BUDGETS.md` § "Severity policy" says "5 successive nightly runs with variance < 10 %". Do we have nightly perf CI, or do we need to set that up first as part of Phase 4?
4. **`ComparisonReportInput` dump.** Phase 2 wants to compare synthetic vs real comparison-PDF timings. Is there appetite for a hidden `npm run perf:capture-cmp` developer flag that dumps the struct from a running session? That's a ~half-day side-quest, not in the current estimate.
5. **AnalysisArtifact cache (P3-001 from frontend audit).** Big lever on Phase 2 numbers. Do we measure-then-cache, or cache-then-measure? Recommend **measure first, cache as a separate Sprint 3 deliverable**, so the budget reflects the un-cached path that all power users will hit on first open.

---

## Definition of done

Sprint 2 closes when:

- [ ] **All 13 BUDGETS.md TBDs** are replaced with measured p50 / p95 numbers + a corresponding `BASELINES.md` entry.
- [ ] **At least 5 budgets are promoted to hard severity** in `BUDGETS.md`, after 5 stable nightly runs each.
- [ ] **Sprint 2 retrospective doc** is written (see template: `SPRINT-1-RETROSPECTIVE.md`).
- [ ] **Sprint 3 planning doc** is drafted (priorities: AnalysisArtifact cache, native-by-ids comparison, sub-millisecond UI hot-path budgets if any showed up in Sprint 2).
- [ ] All gates green on the closing commit (cargo `--lib`, vitest, audit, version-validate, hard-budget compare).

---

## See also

- `docs/performance/SPRINT-1-RETROSPECTIVE.md` — what Sprint 1 actually delivered + deferred.
- `docs/performance/BUDGETS.md` — the contract this Sprint fills.
- `docs/performance/BASELINES.md` — where new measurements land.
- `docs/performance/MEMORY-RESEARCH-BRIEF.md` — long-form input for memory-related Sprint 2+ work.
- `docs/performance/FRONTEND-IPC-DEEP-AUDIT-LATEST.md` — P3-001 (AnalysisArtifact cache) and other Sprint-2-relevant findings.
- `docs/performance/MICROBENCH.md` — the bench harness Sprint 2 will keep extending.
