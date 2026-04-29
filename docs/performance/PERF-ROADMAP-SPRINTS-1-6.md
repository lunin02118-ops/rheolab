# Performance roadmap — Sprints 1 → 6

**Status:** drafted 2026-04-29 from operator's program-level brief; Sprint 2 GO confirmed by operator review (same day).  
**Owner:** Architecture Team.  
**Active sprint:** **Sprint 2 — Native comparison reports by IDs** (the main ROI lever).  
**Closed:** Sprint 1 (see `SPRINT-1-RETROSPECTIVE.md`).

This document is the **single-page program view** of the perf-architecture work that started with Sprint 0's `BUDGETS.md` contract. It captures the 6-sprint mission per sprint, the ROI logic that orders them, and the cross-sprint dependencies. Each per-sprint plan (`SPRINT-2-PLANNING.md`, etc.) drills into a single sprint; this doc is the connector.

---

## Mission per sprint

| Sprint | Theme | Mission | Status |
| ------ | ----- | ------- | ------ |
| **1** | Measurement + contracts | Define perf budgets, ship library/report smoke perf runners, codify the *no-large-ipc* rule, freeze the V1_DDL contract. | **closed** (with 2.5 of 4 originally-scoped items deferred — see "Sprint 1 carry-overs" below). |
| **2** | **Native comparison reports by IDs** | Add `reports_*_by_ids` IPC commands; replace TS-side assembly of large `ComparisonReportInput` payloads with Rust-side DB lookup by ID list. **This is the main ROI lever** — eliminates the `LARGE-IPC-EXCEPTION` suppression on `reports_generate_comparison_pdf`, unblocks Sprint 3 cache integration, and tightens every L-CMP-* budget by 30–50 %. | **active** |
| **3** | AnalysisArtifact cache | DB migration for cache table; `analysis_analyze_full` checks cache first, returns cached result if `(experiment_content_hash, settings_hash)` matches; reports + comparison consume the cache transparently. | pending Sprint 2 |
| **4** | Job scheduler | Native scheduler in Rust runtime with cancellation hooks; reports + imports run *through* the scheduler instead of bare `tokio::spawn`. Enables UI cancellation, queue depth visibility, and progress events. | pending Sprint 3 |
| **5** | Library projection | `ExperimentListProjection` table (denormalised, list-shape); library page serves from projection; facet/filter cache. Tightens L-LIB-OPEN and L-FILTER budgets to sub-100 ms. | independent |
| **6** | Binary series IPC | Downsampled binary viewport series endpoint; chart layer consumes viewport-fitting arrays instead of full per-point arrays over JSON. Reduces chart paint time for large experiments and trims IPC bandwidth. | independent |

---

## ROI logic

The order isn't arbitrary. Sprint 2 is at the top because it **unblocks** the next two:

```
            ┌─────────────────┐
            │ Sprint 2        │  ◀─── main ROI lever
            │ Native by-ids   │
            └────────┬────────┘
                     │ enables
            ┌────────┴────────┐
            │ Sprint 3        │  cache integration is clean once
            │ Analysis cache  │  the report path goes through DB
            └────────┬────────┘
                     │ enables
            ┌────────┴────────┐
            │ Sprint 4        │  scheduler can use cache for
            │ Job scheduler   │  cheap cancellation / replay
            └─────────────────┘

   (independent of Sprints 2-4:)
            ┌─────────────────┐    ┌─────────────────┐
            │ Sprint 5        │    │ Sprint 6        │
            │ Library proj.   │    │ Binary series   │
            └─────────────────┘    └─────────────────┘
```

### Why Sprint 2 is the main ROI

The current comparison-export flow has the architectural smell:

1. UI gathers each experiment's columnar raw points + metadata via individual IPC calls.
2. UI assembles a single `ComparisonReportInput` struct (typically 3–10 MB for a 5-experiment comparison).
3. UI sends the assembled struct over IPC to `reports_generate_comparison_pdf`.
4. Rust deserialises the struct, generates the PDF, returns bytes.

Step (3) is the LARGE-IPC-EXCEPTION case. It's the only IPC call in the whole audit that exceeds the per-call payload budget (`scripts/audit/check-large-ipc-contracts.mjs`), and it's there because the alternative — paginating the input — would explode the IPC count instead.

The native by-ids fix:

1. UI sends `Vec<experiment_id> + ComparisonSettings` (a tiny payload).
2. Rust reads each experiment's data **directly from the DB** (no marshalling).
3. Rust generates the PDF, returns bytes.

What this unlocks:

- **Eliminates the only large-IPC suppression** — the `LARGE-IPC-EXCEPTION` on `reports_generate_comparison_pdf` goes away, the lint becomes universally enforced again.
- **Removes JSON serialisation cost** of the 3–10 MB struct (currently dominant in `cmp:pdf:ipcRoundtrip` instrument traces).
- **Simplifies the frontend** — no need for `comparison-experiment-adapter.ts` to assemble the input shape.
- **Makes Sprint 3's cache trivial** — Rust can check the cache before re-running analysis without any IPC choreography.
- **Tightens every L-CMP-* budget** — the `BUDGETS.md` comment under L-CMP-PDF-5 explicitly anticipates "30-50 % reduction after Sprint 1 (native by-ids)"; that promise is now a Sprint 2 deliverable.

### Why Sprint 5 / 6 are independent

They touch different surfaces (library list / chart paint) and don't share infrastructure with the report path. They can be scheduled around Sprint 2-4 based on which budget bites first.

---

## Sprint 1 status (closed) + carry-overs

Sprint 1 was **scoped** as the "measurement + contracts" sprint with four deliverables; it shipped one of them on the originally-stated path, partial on a second, and traded the other two for a deep-dive into P10 release-profile validation that produced reusable microbench infrastructure but didn't fill the originally-listed TBDs.

| Sprint 1 originally-scoped item | Delivery |
| ------------------------------- | -------- |
| `docs(perf): define performance budgets` | ✅ **done** in Sprint 0 (`BUDGETS.md`, commit `5fd4308`); Sprint 1 didn't need to repeat it. |
| `test(perf): add library/report smoke perf runner` | ❌ **not delivered**. `perf:workflow:tauri` exists from before Sprint 1 and exercises a 5-fixture multi-fixture workflow but doesn't isolate `L-LIB-OPEN`, `L-FILTER`, `L-EXP-DETAIL`, `L-CMP-*`, `L-CMP-PDF-5`, `L-CMP-XLSX-5`. **Inherited by Sprint 2 lead-in.** |
| `docs(arch): add no-large-ipc rule` | ⚠️ **partial**. The lint is in place (`scripts/audit/check-large-ipc-contracts.mjs`, with the `LARGE-IPC-EXCEPTION` suppression on `reports_generate_comparison_pdf` documented in `BUDGETS.md`), but there is no formal ADR. **Inherited by Sprint 2 lead-in** — and Sprint 2 will retire the suppression, which is the cleanest moment to write the ADR. |
| `docs(db): freeze V1_DDL contract fully` | ❌ **not delivered**. 7 migrations live in `src-tauri/src/db/migrations/v0001..v0007*.rs` but there is no human-readable `docs/db/V1_DDL.md` documenting the contract. **Inherited by Sprint 2 lead-in** — Sprint 2's by-ids report path needs a stable schema reference anyway. |

### What Sprint 1 *did* deliver

In place of the broad TBD-fill mission, Sprint 1 produced (from the retrospective):

- `bench_comparison_pdf.rs` + `bench_analysis_pipeline.rs` cargo examples (synthetic + fixture + DB sweep).
- `pub fn run_full_analysis_kernel` (eliminates bench drift).
- `db-sweep-compare.mjs` with Welch's t-test + bootstrap 95 % CI + Bonferroni.
- 4 P10 validation reports + 1 microbench guide.
- **Final P10 verdict: KEEP, narrowly** — settles a contentious release-profile question that was implicitly blocking every L-CMP-* / L-XLSX TBD measurement.

### Sprint 2 lead-in (operator-reviewed)

Sprint 2 starts with **3 critical lead-in items** + **1 non-blocking parallel-track item**. Operator decision: the library smoke runner is **not** a blocker for the main ROI work — it can land in parallel or post-S2-1, so Sprint 2 stays focused on the report-path mission rather than expanding into a "perf infra sprint".

**Critical lead-in (must land before S2-1):**

1. **S2-L1** — `docs(arch): add ADR-0013-no-large-ipc-rule` (~1 h). Formalises the rule the lint already enforces; current `LARGE-IPC-EXCEPTION` on `reports_generate_comparison_pdf` is documented as "to be retired in Sprint 2".
2. **S2-L2** — `docs(db): document report-relevant V1 schema contract` (~1 h, **narrowed scope** — only the tables S2-1 actually touches: `Experiment`, `ExperimentData`, `User`, `Laboratory`, `WaterSourceCatalog`).
3. **S2-L4** — `test(perf): add comparison smoke baseline runner` (~3 h). Records pre-S2-1 baseline numbers for `L-CMP-3 / 5 / 10 / PDF-5 / XLSX-5`. Directly fed by S2-3's A/B comparison.

**Non-blocking parallel track:**

4. **S2-L3** — `test(perf): add library smoke perf runner` (~4 h). Fills 7 BUDGETS.md TBDs (L-LIB / L-FILTER / L-EXP-DETAIL / DB-LIST family). Useful but **decoupled** from the by-ids critical sequence per operator decision.

After critical lead-in, Sprint 2's main work is the three native-by-ids deliverables (S2-1 / S2-2 / S2-3). See `SPRINT-2-PLANNING.md` § "Operator decisions" for the binding constraints (feature flag policy, golden corner cases, XLSX requirement, budget tightening protocol, hash normalisation depth) and § "Architectural guardrails" for the design constraints baked into S2-1 (input validation, output enum, semaphore, cache-key pre-load).

---

## Cross-sprint dependencies

| If you change… | …then re-run / re-validate… |
| -------------- | --------------------------- |
| `analysis_analyze_full` (Sprint 3 cache) | `bench_analysis_pipeline --all-experiments` (Sprint 1 harness still applies) |
| `reports_*_by_ids` (Sprint 2) | golden snapshot tests (Sprint 2 deliverable), L-CMP-* budgets |
| Job scheduler (Sprint 4) | reports + imports E2E + soak |
| `ExperimentListProjection` (Sprint 5) | L-LIB-OPEN-1K / L-LIB-OPEN-10K / L-FILTER / DB-LIST family |
| Binary series IPC (Sprint 6) | chart paint perf in Playwright workflow tests |

---

## Active state (this commit)

- **Sprint 1:** closed `5f11efb`. Retrospective: `SPRINT-1-RETROSPECTIVE.md`. P10 verdict: KEEP narrowly. Microbench infrastructure: durable.
- **Sprint 2:** active, GO confirmed by operator review + external static audit (see `SPRINT-1-EXTERNAL-AUDIT.md`). Plan: `SPRINT-2-PLANNING.md` v3 (audit-amended). Critical lead-in (5 items): S2-L1 (✅ commit #1) + S2-L2 + S2-L3 (promoted from non-blocking) + S2-L4 + S2-L5 (orchestrator fixture-mode, new in v3). Main work: S2-1 + S2-1.5 (production-shaped bench fixtures, new in v3) + S2-2 + S2-3. **14-commit** recommended sequence; ~7–8 active days. Tightened DoD includes feature-flag default native + LARGE-IPC-EXCEPTION removal + ADR-0010 update + L-LIB-* / DB-LIST family TBD-fill.
- **Sprint 3:** queued behind Sprint 2.
- **Sprint 4:** queued behind Sprint 3.
- **Sprint 5–6:** independent; can slot whenever a budget in their family bites.

---

## See also

- `docs/performance/SPRINT-1-RETROSPECTIVE.md` — what Sprint 1 actually delivered + 4 process lessons learned.
- `docs/performance/SPRINT-1-EXTERNAL-AUDIT.md` — external static audit of `main @ 463dce2` that drove the v3 plan amendments.
- `docs/performance/SPRINT-2-PLANNING.md` — per-task plan for the active sprint (v3, audit-amended).
- `docs/performance/BUDGETS.md` — the perf contract this whole roadmap is fulfilling.
- `docs/performance/MICROBENCH.md` — the bench harness Sprint 1 built (used by every subsequent sprint that touches CPU-bound code).
- `docs/performance/P10-DB-SWEEP-VALIDATION-REPORT.md` — Sprint 1 deep-dive that kept the program on a single canonical release profile.
- `docs/adr/ADR-0010-comparison-report-generation.md` — current comparison-report architecture (Sprint 2 will revise this with the by-ids path).
