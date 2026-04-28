# Sprint 2 planning — native comparison reports by IDs

**Status:** active draft (2026-04-29)  
**Sprint window:** TBD (recommend 5–6 active days)  
**Theme:** **the main ROI lever** in the perf roadmap (see `PERF-ROADMAP-SPRINTS-1-6.md`).  
**Inherits from:** Sprint 1 (4 carry-over items, see "Lead-in" below).

> **TL;DR:** replace the TS-side assembled `ComparisonReportInput` over IPC with a native `reports_*_by_ids` IPC that just takes a list of experiment IDs and reads the data straight from the DB inside Rust. Eliminates the only `LARGE-IPC-EXCEPTION` suppression, removes 3–10 MB of JSON serialisation per export, simplifies the frontend, and unblocks Sprint 3's analysis cache integration.

---

## Mission

Per the operator's program brief:

> **Sprint 2 — Native comparison reports by IDs**
> - `feat(reports): add comparison report by experiment ids`
> - `test(reports): golden smoke for by_ids PDF/XLSX`
> - `perf(reports): compare TS assembly vs native by_ids`
>
> *Это главный ROI.*

Three numbered deliverables (S2-1, S2-2, S2-3 below), preceded by four small lead-in tasks inherited from Sprint 1.

---

## Lead-in (Sprint 1 carry-overs)

These were originally Sprint 1 deliverables that didn't ship; Sprint 1 swapped them for the P10 deep-dive. They are small (each is a single PR's worth) and Sprint 2 needs them as foundations:

### S2-L1 — `docs(arch): add ADR-0013-no-large-ipc-rule`

**Why now.** Sprint 2 retires the `LARGE-IPC-EXCEPTION` suppression on `reports_generate_comparison_pdf`. That's the cleanest moment to formalise the architectural rule the audit lint has been quietly enforcing.

**Deliverable.**

- `docs/adr/ADR-0013-no-large-ipc-rule.md` written in the standard ADR format used by ADR-0001 → ADR-0012.
- Cites `scripts/audit/check-large-ipc-contracts.mjs` as the enforcement, BUDGETS.md § "M-IPC-PAYLOAD" (or equivalent) as the budget, and the `reports_generate_comparison_pdf` LARGE-IPC-EXCEPTION as the historical exception that Sprint 2 removes.
- States the rule positively: "every IPC handler payload must fit within `LARGE_IPC_BYTE_LIMIT` (configurable, default `MISSING_VALUE`); large data must travel via DB or shared memory, not over the IPC channel". Updates the audit script's documentation if the constant needs to be exposed.

**Effort.** 1 hour.

### S2-L2 — `docs(db): freeze V1_DDL contract fully`

**Why now.** S2-1 (the by-ids feature) reads experiment data directly from the DB inside the Rust handler. That code path needs a stable schema reference: which tables, which columns, which indexes, which FK relationships, which migration introduced each. Without the contract doc, "the schema is just whatever migration v0007 last did" — which is fine for incremental migrations but blocks any cross-cutting work that touches multiple tables.

**Deliverable.**

- `docs/db/V1_DDL.md` documenting the schema as of migration v0007. Per-table sections covering: column list with types, primary key, indexes (including the V2 touch-point precompute additions in v0002), FK relationships, FTS triggers, and the migration that introduced each piece.
- Cross-references the migration files (`src-tauri/src/db/migrations/v0001..v0007`) so a future reader can trace each row back to its origin commit.
- The doc is **not a duplicate of the migration code** — it's a *human-readable contract* that the migration code happens to express in Rust. If someone needs to write a query that joins three tables, they read this doc, not 7 migration files.

**Effort.** 1.5–2 hours (it's bigger than S2-L1 because the schema is non-trivial — `Experiment`, `ExperimentData`, `User`, `Laboratory`, `WaterSourceCatalog`, `ArtifactImportBatch`, plus the FTS virtual table + several indexes added across the 7 migrations).

### S2-L3 — `test(perf): library smoke perf runner`

**Why now.** Sprint 2's perf-comparison deliverable (S2-3) will measure native-by-ids vs TS-assembly times. Both numbers want to be measured against a stable backdrop where the *rest* of the workflow (library page open, filter response, experiment-detail open) is also non-TBD. Without these baselines, S2-3's "native is X % faster" claim has nothing to anchor against.

**Deliverable.**

- New Playwright spec or harness extension that exercises:
  - **L-LIB-OPEN-1K**: library page render after warm DB with 1k seed.
  - **L-LIB-OPEN-10K**: same with 10k seed (extends `perf:db:large`).
  - **L-FILTER**: filter change → list re-render perceived latency.
  - **L-EXP-DETAIL**: experiment detail open.
  - **DB-LIST / DB-LIST-LARGE / DB-DETAIL**: query times underlying the above.
- Per-budget JSON sidecar emission so `compare-db-scale.js` (existing) or a sibling can validate against `BUDGETS.md` thresholds.
- `BUDGETS.md` and `BASELINES.md` updated with the first measured numbers (replace TBDs in those budget rows).

**Effort.** ~4 hours. It's the biggest lead-in but it's all extension of existing infrastructure (Playwright + perf:db:* configs); no new framework choices.

### S2-L4 — `test(perf): comparison smoke perf runner`

**Why now.** This is the *direct* baseline for Sprint 2's main perf comparison (S2-3). Without it, "native by-ids is X % faster than TS-assembly" has no L-CMP-* budget number to validate against.

**Deliverable.**

- Playwright spec exercising the comparison flow at three fixture sizes:
  - **L-CMP-3**, **L-CMP-5**, **L-CMP-10** (UI-ready latency).
  - **L-CMP-PDF-5** (single PDF generation across 5 experiments).
  - **L-CMP-XLSX-5**, **L-XLSX**.
- Both arms (current TS-assembled flow + the new by-ids flow once S2-1 lands) report into the same harness so S2-3 just diffs the two.
- `BUDGETS.md` / `BASELINES.md` updated for these rows.

**Effort.** ~3 hours. Reuses `bench_comparison_pdf.rs` (Sprint 1) for synthetic baselines + new Playwright wiring for the prod-data measurement.

**Lead-in total:** ~8–9 hours of single-shot deliverables, ideally landed as 4 separate commits before the main Sprint 2 work starts.

---

## Main work

### S2-1 — `feat(reports): add comparison report by experiment ids`

**Goal.** New IPC commands that take a list of experiment IDs (and the analysis / report settings) and produce a comparison PDF / XLSX entirely in Rust, reading data from the DB.

**Concrete IPC additions:**

```rust
#[tauri::command]
pub async fn reports_generate_comparison_pdf_by_ids(
    experiment_ids: Vec<String>,
    settings: ComparisonSettings,
) -> Result<Vec<u8>>;

#[tauri::command]
pub async fn reports_generate_comparison_xlsx_by_ids(
    experiment_ids: Vec<String>,
    settings: ComparisonSettings,
) -> Result<Vec<u8>>;
```

**Implementation outline:**

- Inside `tokio::task::spawn_blocking`, for each `experiment_id`:
  - Fetch row from `Experiment` (using V1_DDL contract from S2-L2).
  - Fetch `ExperimentData.dataBlob`, decode via `rheolab_enterprise::db::columnar::decode_typed`.
  - Run the analysis pipeline via `rheolab_enterprise::commands::analysis::run_full_analysis_kernel` (Sprint 1 / S1-4 kernel — already public).
- Once all experiments are analyzed, call into the existing PDF/XLSX builder code (the same Typst/plotters chain that today consumes `ComparisonReportInput`). The internal builder shape stays the same; only the *input gathering* moves from TS to Rust.
- The handler must register a tracing span (`reports::cmp::pdf::by_ids`) with experiment count + total raw points so the existing `withPerf<T>` instrumentation continues to work.

**Backwards compat.**

- The old `reports_generate_comparison_pdf` IPC stays for at least one release for parity testing (S2-2 golden smoke), but is marked `#[deprecated(note = "use reports_generate_comparison_pdf_by_ids; this path will be removed in Sprint 3")]`.
- Frontend `comparison-experiment-adapter.ts` gets a new `assembleByIds(ids, settings)` path; the old assembly path stays behind a feature flag or A/B for the sprint.

**Effort.** 2 active days. This is the heart of the sprint and dominates the timeline.

### S2-2 — `test(reports): golden smoke for by_ids PDF/XLSX`

**Goal.** Prove the by-ids output is byte-for-byte (or hash-equivalent) identical to the current TS-assembled output on a representative fixture set, so the migration carries no silent regressions in the report content.

**Concrete deliverables:**

- New test file `tests/integration/reports/golden-by-ids.spec.ts` (or similar location) that:
  - Loads 3 representative fixtures from `outputs/seed/rheolab-fixture-seed-small.db` (a Chandler 5550 multi-cycle, a small BSL, a Grace M5600).
  - Generates the comparison PDF + XLSX via **both** paths.
  - Compares: byte-equality where possible, otherwise structural hash (PDF object tree comparison, XLSX sheet hash) — choose the strictest comparison the format allows.
  - Snapshots the expected hash so future runs catch any drift.
- Tests must pass before S2-1 is merged. After merge, they are the regression detector for any future change to either path.

**Why hashes and not byte-equality.** PDFs include creation timestamps in the trailer; XLSXs include workbook-level metadata that differs between TS-assembly and Rust-assembly even when the content is identical. The test should normalise these (strip metadata) before comparing — this is itself a useful piece of testing infrastructure.

**Effort.** ~1 day. Fixture choice + hash normalisation logic are the bulk of the work; the actual diff-and-snapshot code is straightforward.

### S2-3 — `perf(reports): compare TS assembly vs native by_ids`

**Goal.** Quantify the win. Use the bench harness from Sprint 1 + the new comparison smoke runner (S2-L4) to produce A/B numbers that prove the native by-ids path is faster on the metrics that matter (`L-CMP-PDF-5`, `cmp:pdf:ipcRoundtrip`).

**Concrete deliverables:**

- A/B run script (extension of `run-rust-microbench.mjs` or a new sibling) that runs each fixture through both code paths, captures per-iter timings, and emits a `db-sweep-compare`-style markdown report with:
  - Per-fixture mean wall time (TS-assembly arm vs native arm).
  - 95 % CI on Δ %.
  - Welch t-test p-value.
  - Bonferroni-survivor flag.
  - Headline corpus verdict.
- The report lands in `docs/performance/REPORTS-NATIVE-BY-IDS-VALIDATION.md` with: methodology, results, final verdict on whether to retire the TS-assembly path immediately or keep it for one release.
- `BUDGETS.md` L-CMP-PDF-5 / L-CMP-XLSX-5 rows tightened (the 30–50 % reduction the BUDGETS.md comment promises after Sprint 2 — measured rather than estimated).

**Effort.** ~1 day. The harness + stats infrastructure is already there from Sprint 1; this just wires the new arm.

---

## Definition of done

Sprint 2 closes when:

- [ ] **All 4 lead-in items shipped** (ADR-0013, V1_DDL.md, library smoke runner, comparison smoke runner).
- [ ] **All 3 main deliverables shipped** (S2-1, S2-2, S2-3).
- [ ] **`LARGE-IPC-EXCEPTION` suppression on `reports_generate_comparison_pdf` removed** from the audit lint config (the original suppression was always temporary; Sprint 2 makes it unnecessary).
- [ ] **L-CMP-PDF-5 / L-CMP-XLSX-5 / L-CMP-3 / L-CMP-5 / L-CMP-10 budgets** in `BUDGETS.md` carry measured numbers (no more TBDs in this family).
- [ ] **Validation report** at `docs/performance/REPORTS-NATIVE-BY-IDS-VALIDATION.md` with the A/B numbers and final verdict.
- [ ] **Sprint 2 retrospective doc** written (template: `SPRINT-1-RETROSPECTIVE.md`).
- [ ] **Sprint 3 planning doc** drafted (`SPRINT-3-PLANNING.md` — analysis cache work pre-loaded).
- [ ] **All gates green**: cargo `--lib`, vitest, audit:large-ipc (now without the suppression), version-validate, hard budgets compare.

---

## Open questions for stakeholder

1. **Frontend feature flag vs hard switch.** S2-1 plans `comparison-experiment-adapter.ts` to keep the old assembly path behind a flag for one release. Is that the right migration cadence, or should the old path be deleted in S2-1's PR (and the golden smoke test become the only proof of equivalence)?
2. **Fixture count for golden smoke.** Three fixtures (Chandler / BSL / Grace) is the proposed minimum. Should we also test a **degenerate corner case** (1-experiment "comparison", empty experiment, missing-channel experiment) in S2-2?
3. **L-CMP-PDF-5 budget tightening.** `BUDGETS.md` currently has L-CMP-PDF-5 at 12 000 ms p50 / 20 000 ms p95 with a comment "will tighten by 30-50 % after Sprint 2". Should we tighten *immediately* on the new measurement (Sprint 2 sets the new band) or wait for **5 stable nightly runs** per the BUDGETS.md severity policy?
4. **XLSX scope.** The brief says "PDF/XLSX" for both S2-1 and S2-2. The current TS-assembly path supports both, so by-ids must too. But S2-3's `perf` measurement could be PDF-only initially since PDF is the slower of the two. Is that an acceptable simplification or do we want both numbers in the validation report?
5. **Hash normalisation depth.** S2-2's golden test needs to strip PDF/XLSX metadata before hashing. Do we want to strip just timestamps + creator strings, or do we go further (e.g. normalise all Producer/CreationDate/ModDate fields and any randomised IDs)?

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Native by-ids handler reads stale data because the analysis cache (Sprint 3) doesn't exist yet, so every report re-runs analysis | high (it's the current behaviour, just inside Rust now) | low | document explicitly that Sprint 2 doesn't add caching; `perf:reports` numbers are the **post-Sprint-2 / pre-Sprint-3** baseline that Sprint 3 then improves on. |
| Golden smoke test flaky on PDF metadata even after stripping | medium | medium | use structural hash (PDF object graph) instead of binary hash; ship a normalisation library function reused by all golden tests. |
| Large-DB fixture causes the by-ids handler to run out of memory loading all experiments at once | low | high (release blocker) | stream the experiment data instead of loading all at once; benchmark with the 28 442-point Chandler from `small.db` as the largest single experiment, and a 10-experiment comparison as the worst-case multiplier. |
| ADR-0013 wording disagrees with how the lint actually behaves | low | low | write the ADR after the lint behaviour is finalised; cite the lint as the source of truth. |
| V1_DDL doc drift from migration code (someone updates the code, forgets the doc) | high (long-tail) | medium | add a `npm run audit:db-schema-drift` lint that diffs the documented schema against `PRAGMA table_info(...)` output of a fresh seed DB. Sprint 3 task. |

---

## See also

- `docs/performance/PERF-ROADMAP-SPRINTS-1-6.md` — the program-level view (this sprint is at the top of the ROI ordering).
- `docs/performance/SPRINT-1-RETROSPECTIVE.md` — what shipped in Sprint 1 and what's inherited.
- `docs/performance/BUDGETS.md` — the contract Sprint 2 finally moves the L-CMP-* needles on.
- `docs/performance/MICROBENCH.md` — the bench harness Sprint 2 will extend with a third target (`reports`).
- `docs/adr/ADR-0010-comparison-report-generation.md` — the current architecture (Sprint 2 will revise this with a "post-Sprint-2 by-ids path" section).
- `scripts/audit/check-large-ipc-contracts.mjs` — the lint whose exception Sprint 2 retires.
