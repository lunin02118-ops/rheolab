# Sprint 2 planning — native comparison reports by IDs

**Status:** active, GO confirmed by operator review (2026-04-29).  
**Sprint window:** TBD (recommend 5–6 active days).  
**Theme:** **the main ROI lever** — see `PERF-ROADMAP-SPRINTS-1-6.md`.  
**Inherits from:** Sprint 1 (3 carry-over docs items, see "Lead-in" below).  
**Document version:** v3 (external-audit-amended 2026-04-29; supersedes v2 from earlier the same day).

> **TL;DR:** replace TS-side assembled `ComparisonReportInput` over IPC with native `reports_*_by_ids` IPC commands taking only experiment IDs + settings. Eliminates the only `LARGE-IPC-EXCEPTION` suppression, removes 3–10 MB JSON serialisation per export, simplifies the frontend, **ships native default in alpha with old TS path as fallback flag for one release**, and unblocks Sprint 3's analysis cache integration. v3 amendments fold an external static audit (`SPRINT-1-EXTERNAL-AUDIT.md`): S2-L3 promoted to mandatory, new S2-L5 (orchestrator fixture-mode) and S2-1.5 (production-shaped bench fixtures) added; total scope grows from ~5–6 days to ~7–8 active days; commit sequence grows from 11 to 14.

---

## Mission

Per the operator's program brief, restated:

> **Sprint 2 — Native comparison reports by IDs**
> - `feat(reports): add comparison report by experiment ids`
> - `test(reports): golden smoke for by_ids PDF/XLSX`
> - `perf(reports): compare TS assembly vs native by_ids`
>
> *Это главный ROI.*

Three numbered deliverables (S2-1 / S2-2 / S2-3 below) preceded by **3 critical lead-in items** (S2-L1, S2-L2, S2-L4) and **1 non-blocking parallel-track item** (S2-L3) inherited from Sprint 1.

---

## Operator decisions (post-draft review)

The v1 draft posed 5 open questions; v2 incorporates the operator's answers as binding constraints:

### Q1 → A1: Feature flag, not hard switch

**Decision: native default in alpha; old TS-assembly path behind a fallback flag for one release.**

| Release | Default path | Old path |
| ------- | ------------ | -------- |
| alpha.2 / alpha.3 | native by-ids | available behind `RHEOLAB_REPORTS_LEGACY_TS_ASSEMBLY=1` env / settings flag |
| beta | native by-ids | disabled by default; only via emergency feature flag |
| Sprint 3 | native by-ids | **deleted** after one alpha + one beta cycle with no regressions |

**Why not hard switch in S2-1.** Golden parity tests (S2-2) cover the structural cases but cannot exhaustively cover all user data edge cases. The fallback flag is a one-release rollback lane; it is not a long-term API contract.

### Q2 → A2: Golden fixtures must include corner cases

**Decision: 3 representative fixtures + 6 explicit corner cases, all in S2-2.**

| Case | Why it matters |
| ---- | -------------- |
| Chandler / BSL / Grace (3 main) | typical viscosity profile shapes; covers the dominant code paths |
| 1-experiment "comparison" | exercises degenerate layout / report builder paths without crash |
| missing optional metadata (`Laboratory`, `operator`, `water source`, `calibration`) | most common real-world incomplete data |
| missing / empty columnar data | must produce **controlled error**, not panic / blank report |
| over-cap (more than `max_comparison_experiments`) | must reject **at IPC validation** before any DB read; covers REP-001 cap |
| duplicate experiment IDs in input | **policy: reject as `ValidationError`**; do not silently dedupe |
| reordered IDs | **report order must equal input order**, *not* SQLite `WHERE id IN (...)` order |

**Critical: order preservation.** SQLite does not guarantee row order from `WHERE id IN (...)`. The Rust handler must explicitly reorder fetched rows to match the input `experiment_ids` Vec. This is a hard correctness requirement — the test for it lives in S2-2.

### Q3 → A3: Budget tightening protocol — measured candidate now, hard gate later

**Decision: BUDGETS.md gets new measured numbers immediately on S2-3, but severity stays `warn` until 5 stable nightly/alpha runs.**

```
Sprint 2 close:
  BUDGETS.md L-CMP-{3,5,10}, L-CMP-PDF-5, L-CMP-XLSX-5 = measured numbers
  severity = soft (warn-only)

After 5 stable nightly/alpha runs:
  severity = hard (block on regression)
```

This avoids flaky perf gates blocking releases on a freshly-shipped path while still recording the new performance reality.

### Q4 → A4: XLSX is mandatory in A/B, not optional

**Decision: PDF + XLSX both required in S2-3.**

```
Required in S2-3 perf report:
  L-CMP-PDF-5  ← primary
  L-CMP-XLSX-5

Optional in S2-3 perf report:
  L-CMP-PDF-10
  L-CMP-XLSX-10
```

PDF can be the primary (more complex, slower, where the win is biggest), but XLSX must have at least baseline A/B numbers in the validation report. Sprint 2 cannot ship S2-1 (which adds **both** `_pdf_by_ids` and `_xlsx_by_ids`) without measuring both.

### Q5 → A5: Hash normalisation must go deeper than timestamps

**Decision: full normalisation list, with structural-hash fallback if byte equality is impossible.**

**PDF normalisation targets (strip / canonicalise before hashing):**
- `/CreationDate`
- `/ModDate`
- `/Producer`
- `/Creator`
- Document ID / trailer ID (both halves of `/ID [...]`)
- Object stream ordering (if the PDF generator produces non-deterministic streams)

**XLSX normalisation targets (strip / canonicalise before hashing):**
- `docProps/core.xml`: `dcterms:created`, `dcterms:modified`
- `docProps/core.xml`: `dc:creator`, `cp:lastModifiedBy`
- `xl/calcChain.xml` (if present)
- Workbook relationship IDs (rId1, rId2, ... when ordering is unstable)
- ZIP entry timestamps
- ZIP entry ordering (if archive packer is non-deterministic)

**If byte equality cannot be achieved after normalisation, fall back to structural hash:**

| Format | Structural hash composition |
| ------ | --------------------------- |
| PDF | (a) text-extraction hash (page-by-page text concatenation, normalised whitespace), (b) page count, (c) normalised object graph hash for selected text blocks, (d) optional: perceptual hash for chart raster regions. |
| XLSX | (a) sheet name list, (b) per-sheet cell value matrix hash, (c) per-sheet formula matrix hash, (d) per-sheet style hash where the style is semantically meaningful (number formats, conditional formats), (e) per-sheet `dimension` attribute. |

The hash normalisation layer is itself a deliverable — it ships as `tests/integration/reports/hash-normalise.ts` (or `*.rs` for Rust-side helpers) and is reusable for any future report parity test.

---

## External audit response (added in v3, 2026-04-29)

An external static-only audit of `main @ 463dce2` (alpha.2) produced 8 findings. The audit's verdict was **GO for Sprint 2 with 4 mandatory lead-in items + 3 plan amendments**. v3 folds those amendments. The full audit text is preserved at `docs/performance/SPRINT-1-EXTERNAL-AUDIT.md` for traceability.

| Finding | v2 status | v3 status |
| ------- | --------- | --------- |
| **S1-AUD-001** Sprint 1 scope misses (high) | covered (4 lead-in items) | unchanged |
| **S1-AUD-002** Orchestrator fixture mode still manual (medium) | deferred | **lifted: new S2-L5 in critical lead-in** |
| **S1-AUD-003** PDF bench parity, production-shaped fixtures (medium) | partially covered | **explicit: new S2-1.5 in main work** |
| **S1-AUD-004** P10 watch list (medium) | covered (P10-DB-SWEEP triggers) | unchanged |
| **S1-AUD-005** TBDs remain TBD (high) | partially covered (S2-L3 non-blocking) | **S2-L3 promoted to mandatory critical lead-in** |
| **S1-AUD-006** ADR-0013 + suppression (medium) | covered (#1 done; #10 retires) | unchanged |
| **S1-AUD-007** V1_DDL contract (medium) | covered (#2 next) | unchanged |
| **S1-AUD-008** CI status visibility (low) | not covered | deferred to Sprint 3+ (not Sprint 2 critical) |

**3 amendments applied in v3:**

1. **S2-L3 promoted from non-blocking → mandatory critical lead-in.** Per S1-AUD-005, the library smoke runner must produce baseline JSON + update `BUDGETS.md` / `BASELINES.md` before Sprint 2 closes; otherwise the L-LIB-* / L-FILTER / L-EXP-DETAIL / DB-LIST family stays TBD after the sprint that was supposed to close it. Adds ~4 hours to lead-in (~8 h total).
2. **S2-L5 added: orchestrator fixture-mode integration.** Per S1-AUD-002, `--fixture-db <path>` and `--all-experiments` flags must move from manual `foreach` PowerShell into `run-rust-microbench.mjs`. Otherwise S2-3's A/B perf measurement requires manual stash dance for every reproduction. ~1.5 hours.
3. **S2-1.5 added: production-shaped fixture mode in `bench_comparison_pdf.rs`.** Per S1-AUD-003, the comparison-PDF bench must be able to load real DB experiments by ID list (mirroring what S1-3 did for the analysis bench). The S2-1 native by-ids handler's internal builder is reusable here — no separate dump mechanism needed. ~2 hours.

**Total scope adjustment:** Sprint 2 grows from ~5–6 active days to **~7–8 active days**. The 11-commit sequence becomes **14 commits**. The audit's recommended steps now map 1:1 to the v3 sequence.

---

## Architectural guardrails (added in v2 review)

These are mandatory design constraints for S2-1, beyond the bare "feat: add by-ids handler" scope.

### G1 — IPC input validation must fail fast, before any DB read or analysis

The new IPC commands must validate **before** entering `tokio::task::spawn_blocking`:

```rust
fn validate_request(
    experiment_ids: &[String],
    settings: &ComparisonSettings,
    license: &LicenseFeatures,
) -> Result<(), ReportError> {
    // 1. Non-empty
    require!(!experiment_ids.is_empty(), ReportError::EmptyExperimentList);

    // 2. Within cap (REP-001 cap, currently MISSING_VALUE — re-use the same constant)
    require!(experiment_ids.len() <= MAX_COMPARISON_EXPERIMENTS,
             ReportError::OverCap(experiment_ids.len(), MAX_COMPARISON_EXPERIMENTS));

    // 3. No duplicate IDs
    require!(no_duplicates(experiment_ids), ReportError::DuplicateExperimentIds);

    // 4. ID shape (UUID-like or whatever the schema enforces)
    for id in experiment_ids {
        require!(is_valid_experiment_id(id), ReportError::InvalidExperimentIdShape(id.clone()));
    }

    // 5. Settings bounded — chart dimensions, viscosity rate count, etc.
    settings.validate()?;

    // 6. License features
    license.require(LicenseFeature::ComparisonReports)?;
    if format == ReportFormat::Pdf {
        license.require(LicenseFeature::ExportPdf)?;
    } else {
        license.require(LicenseFeature::ExportExcel)?;
    }

    Ok(())
}
```

Rationale: fail-fast continues the alpha.2 pattern from REP-001 (per-feature license + cap checks before heavy work). The new IPC commands must not be a weaker validation layer than the old one.

### G2 — Output abstraction: don't bake `Vec<u8>` as the long-term contract

**Decision: return `Vec<u8>` in S2-1, but design an internal abstraction that allows streaming-to-file in Sprint 4/5.**

```rust
pub enum ReportOutput {
    /// Whole report buffered in memory. Acceptable for small/medium reports.
    Bytes(Vec<u8>),
    /// Report written to a temp file; caller streams it to the user. Acceptable
    /// for large reports where holding the full bytes would balloon RSS.
    TempFile { path: PathBuf, byte_count: u64 },
}

#[tauri::command]
pub async fn reports_generate_comparison_pdf_by_ids(
    experiment_ids: Vec<String>,
    settings: ComparisonSettings,
) -> Result<Vec<u8>> {
    match build_comparison_report_by_ids(experiment_ids, settings, ReportFormat::Pdf).await? {
        ReportOutput::Bytes(b) => Ok(b),
        ReportOutput::TempFile { path, .. } => fs::read(&path).await.map_err(into),
    }
}
```

Sprint 2 only ships the `Bytes` arm; the `TempFile` arm is the placeholder Sprint 4/5 will fill when streaming-to-file becomes the preferred path for large comparisons.

### G3 — Concurrency cap: semaphore on comparison reports

**Decision: `max_concurrent_comparison_reports = 1` from S2-1.**

Two concurrent PDF comparison exports can each consume hundreds of MB of RAM and saturate CPU; with two running at once the UI grinds to a halt. A simple `tokio::sync::Semaphore` with `permits=1` around the comparison-report code path is a small change with a large UX impact.

```rust
static COMPARISON_REPORT_SEMAPHORE: Semaphore = Semaphore::const_new(1);

pub async fn reports_generate_comparison_pdf_by_ids(...) -> Result<Vec<u8>> {
    let _permit = COMPARISON_REPORT_SEMAPHORE.acquire().await?;
    // ... actual work
}
```

This is a lighter-weight precursor to Sprint 4's full job scheduler — Sprint 4 will replace this semaphore with a queue + cancellation API but keep the cap at 1 for comparison reports specifically.

### G4 — Cache key material design (Sprint 3 pre-load)

**Decision: design the cache key now, persist in Sprint 3.**

The S2-1 handler does not add a cache, but **the data it gathers must include everything Sprint 3's cache key will hash over**:

```rust
struct AnalysisCacheKey {
    experiment_id: ExperimentId,
    experiment_data_hash: ContentHash,     // hash of decoded columnar data
    geometry: GeometryDescriptor,           // bob/cup/cone/plate descriptor
    analysis_settings_hash: ContentHash,   // hash of (Reynolds, sliding window, etc.)
    report_viscosity_rates_hash: ContentHash, // hash of comparison-report-specific rate list
    rheolab_core_version: SemVer,           // bump → cache invalidation
    algorithm_version: u32,                 // explicit version bump for breaking algorithm changes
}
```

Sprint 2 computes these but doesn't persist them anywhere. Sprint 3 adds the migration + cache table + lookup-before-recompute logic.

### G5 — Frontend feature-flag wiring + audit lint hardening

```ts
const useNativeByIds = featureFlags.get("REPORTS_NATIVE_BY_IDS_DEFAULT");

if (useNativeByIds) {
  await invoke("reports_generate_comparison_pdf_by_ids", { experimentIds, settings });
} else {
  // legacy TS-assembly path (deprecated, retained for one release)
  const input = await assembleComparisonReportInput(experimentIds, settings);
  await invoke("reports_generate_comparison_pdf", { input });
}
```

After S2-1 lands, the audit lint (`scripts/audit/check-large-ipc-contracts.mjs`) must reject any **new** large IPC suppression — the existing one on `reports_generate_comparison_pdf` is being retired by Sprint 2, and no new ones should be allowed without an ADR.

---

## Lead-in (Sprint 1 carry-overs)

### Critical (must land before S2-1)

#### S2-L1 — `docs(adr): add ADR-0013-no-large-ipc-rule`

**Why now.** S2-1 retires the `LARGE-IPC-EXCEPTION` suppression. That's the cleanest moment to formalise the rule. Allows S2-1's PR to cite the ADR as the reason the suppression goes away.

**Deliverable.** Standard ADR format (`docs/adr/ADR-0013-no-large-ipc-rule.md`). States the rule positively, cites the lint as enforcement, references BUDGETS.md M-IPC-PAYLOAD, names the historical exception that Sprint 2 removes. **Effort:** 1 hour.

#### S2-L2 — `docs(db): document report-relevant V1 schema contract`

**Why now.** S2-1's handler reads experiment data directly from the DB; without a schema reference doc the handler ends up grepping migration files. Operator scope adjustment: **short**, only the tables S2-1 actually touches.

**Deliverable.** `docs/db/V1_DDL.md` — concise table-by-table reference for **only** the tables the by-ids handler touches: `Experiment`, `ExperimentData`, `User`, `Laboratory`, `WaterSourceCatalog` (+ FTS triggers if relevant to lookup). Per-table sections: column list with types, primary key, indexes, FK relationships, source migration. Cross-references `src-tauri/src/db/migrations/v0001..v0007*.rs`. **Effort:** ~1 hour (down from 1.5–2 hours in v1 because of the narrower scope).

#### S2-L4 — `test(perf): comparison smoke baseline runner`

**Why now.** S2-3's A/B comparison wants a measured baseline for `L-CMP-3 / 5 / 10 / PDF-5 / XLSX-5` *before* the by-ids path lands. S2-3 then re-runs and diffs. Without S2-L4 there's no baseline to diff against.

**Deliverable.** Playwright spec exercising the comparison flow at 3 / 5 / 10 fixture sizes, both PDF and XLSX outputs. JSON sidecar emission for each budget. Records pre-S2-1 numbers. **Effort:** ~3 hours.

#### S2-L3 — `test(perf): library smoke perf runner` *(promoted to mandatory in v3)*

**Why now (v3 amendment).** Per audit finding S1-AUD-005, this runner must produce baseline JSON + update `BUDGETS.md` / `BASELINES.md` before Sprint 2 closes; otherwise 7 long-tail TBDs (L-LIB-OPEN-1K/10K, L-FILTER, L-EXP-DETAIL, DB-LIST, DB-LIST-LARGE, DB-DETAIL) outlive the sprint that was scoped to close them. Original v2 plan deferred this as a non-blocking parallel; v3 promotes it to mandatory critical lead-in to honour the audit verdict.

**Deliverable.** Playwright spec or harness extension that exercises:
- **L-LIB-OPEN-1K / -10K** — library page render after warm DB at 1k / 10k seeds (extends `perf:db:small` and `perf:db:large`).
- **L-FILTER** — filter change → list re-render perceived latency.
- **L-EXP-DETAIL** — experiment detail open.
- **DB-LIST / -LARGE / DB-DETAIL** — query times underlying the above.
- Per-budget JSON sidecar emission.
- `BUDGETS.md` and `BASELINES.md` rows updated (severity stays `soft` per A3 protocol until 5 stable runs).

**Effort:** ~4 hours.

#### S2-L5 — `feat(perf): orchestrator fixture-mode integration` *(new in v3)*

**Why now (v3 amendment).** Per audit finding S1-AUD-002, `run-rust-microbench.mjs` currently orchestrates only synthetic sweeps; fixture / all-experiment sweeps require manual `foreach` PowerShell loops. S2-3's A/B perf measurement (TS-assembly vs native by-ids on production-shaped DB fixtures) reproducibility benefits directly from automation here. Without this, every reproduction of the headline win number is a manual stash dance.

**Deliverable.**
- Add `--fixture-db <path>` flag to `run-rust-microbench.mjs` for both `analysis` and `pdf` targets.
- Add `--all-experiments` flag passthrough.
- Expose `npm run perf:microbench:dbsweep` and `npm run perf:microbench:dbsweep:compare` as wrapper scripts.
- Reproducing recipes in P10 / Sprint-2 perf reports updated to use the new commands.

**Effort:** ~1.5 hours.

---

## Main work

### S2-1 — `feat(reports): add comparison report by experiment IDs`

**Goal.** Ship `reports_generate_comparison_{pdf,xlsx}_by_ids` IPC commands. Native default behind feature flag. Old IPC marked `#[deprecated]` but functional for one release.

**Implementation outline:**

1. **Validation layer (G1).** `validate_request()` runs before any heavy work; covers empty-list / over-cap / duplicate / shape / settings-bounds / license checks.
2. **DB read layer.** For each `experiment_id` in the input order:
   - `SELECT ... FROM Experiment WHERE id = ?` (one query per ID, **explicitly to preserve order**, unless we batch with `WHERE id IN (...)` and **then sort the results by input position**).
   - `SELECT dataBlob FROM ExperimentData WHERE experiment_id = ?` → `decode_typed`.
   - Fetch `Laboratory`, `User`, `WaterSourceCatalog` rows for metadata (using S2-L2 contract).
3. **Analysis layer.** Call `rheolab_enterprise::commands::analysis::run_full_analysis_kernel` per experiment (Sprint 1 / S1-4 public kernel). Compute the `AnalysisCacheKey` material from G4 (don't persist yet).
4. **Report layer.** Pass the analyzed data into the existing PDF/XLSX builder code (Typst/plotters chain for PDF, openpyxl-equivalent Rust path for XLSX). The builder shape stays the same; only its input source moves from "deserialised IPC payload" to "in-Rust analysis result".
5. **Concurrency cap (G3).** Semaphore wrap around steps 2–4.
6. **Output (G2).** Return `Vec<u8>` from the IPC; internal `ReportOutput` enum reserved for Sprint 4/5.
7. **Tracing.** Register `reports::cmp::pdf::by_ids` and `reports::cmp::xlsx::by_ids` spans with experiment count + total raw points + total wall ms.

**Backwards compat.**

- Old `reports_generate_comparison_pdf` IPC stays. `#[deprecated(note = "use reports_generate_comparison_pdf_by_ids; this command will be removed in Sprint 3")]`.
- Same for `reports_generate_comparison_xlsx`.
- `comparison-experiment-adapter.ts` gains a feature-flag branch (G5).

**Effort.** 2 active days. The bulk is wiring the existing builder's input from "deserialised payload" to "freshly-computed analysis result" without changing the builder itself.

### S2-1.5 — `feat(perf): production-shaped fixture mode in bench_comparison_pdf.rs` *(new in v3)*

**Why now (v3 amendment).** Per audit finding S1-AUD-003, `bench_comparison_pdf.rs` currently uses synthetic `ComparisonReportInput`; it does not mirror the real TS adapter or the native by-ids path. Without a production-shaped fixture mode, S2-3's A/B comparison only proves the win on synthetic data — operator and reviewers want the win on real production-shaped fixtures from `outputs/seed/rheolab-fixture-seed-small.db`.

**Implementation outline:**

- Add `--load-fixture <db> --experiment-ids <id1,id2,...>` mode to `bench_comparison_pdf.rs` (mirroring the S1-3 pattern from `bench_analysis_pipeline.rs`).
- Reuse the **internal Rust builder** that S2-1's by-ids handler exposes (the part that turns `Vec<experiment_id>` + `ComparisonSettings` into a `ComparisonReportInput`-equivalent in-memory structure). No separate dump-from-running-app mechanism is needed because S2-1 already has the assembly logic.
- Bench harness in TS-assembly arm: synthesises the input the same way the legacy frontend does (for parity).
- Bench harness in native arm: calls the by-ids assembly directly.
- Both arms call the same downstream PDF builder, so timing differences isolate the **input gathering** cost — exactly what S2-3 wants to measure.

**Effort.** ~2 hours. Lands as a single commit between S2-1 (commits #4–#6) and S2-2 (commit #8 in v3).

### S2-2 — `test(reports): golden parity for by_ids PDF/XLSX`

**Goal.** Prove byte-for-byte (after normalisation) or hash-equivalent identity between by-ids and TS-assembly outputs. Cover both **3 representative fixtures** and **6 corner cases** from A2 above.

**Concrete deliverables:**

- `tests/integration/reports/hash-normalise.ts` — reusable hash-normalisation library (PDF + XLSX, normalisation list per A5 above).
- `tests/integration/reports/golden-by-ids.spec.ts` — runs each fixture through both paths, normalises, hashes, snapshots.
- Test naming: one test per fixture × format (so `Chandler / PDF`, `Chandler / XLSX`, `1-experiment / PDF`, `duplicate-IDs / error`, ...).
- Negative-path tests assert the **exact error variant** (`ReportError::DuplicateExperimentIds`, `ReportError::EmptyExperimentList`, etc.), not just "fails".
- Snapshot file: `tests/integration/reports/__snapshots__/golden-by-ids.snap`.

**Effort.** ~1 day. Hash normalisation library + corner-case fixture authoring is the bulk.

### S2-3 — `perf(reports): TS-assembly vs native by-ids A/B validation`

**Goal.** Quantify the win across **5 metrics**, write the validation report.

**5 metrics in the A/B report:**

| Metric | Why |
| ------ | --- |
| **wall_ms** (per-iter, p50/p95) | the headline number — does native get the report out faster? |
| **IPC payload size** (bytes per call) | proves the LARGE-IPC-EXCEPTION removal is real — should drop from 3–10 MB to ~1 KB |
| **JS heap peak** (browser-side) | proves the frontend-side serialisation cost goes away |
| **Rust RSS peak** (handler-side) | proves we don't accidentally trade IPC RAM for Rust handler RAM |
| **p50 / p95 distribution** | proves the win isn't only at the mean; tail behaviour matters for L-CMP-PDF-5 budget |

**Concrete deliverables:**

- Extend `run-rust-microbench.mjs` (Sprint 1 / S1-1) with a third target: `--target reports`. Or add a sibling A/B harness if the reports flow doesn't fit cleanly.
- Drives **PDF + XLSX** at 5 experiments (`L-CMP-PDF-5`, `L-CMP-XLSX-5`) **mandatory**. PDF + XLSX at 10 experiments (`L-CMP-PDF-10`, `L-CMP-XLSX-10`) **optional** if time allows.
- Validation report at `docs/performance/REPORTS-NATIVE-BY-IDS-VALIDATION.md` with all 5 metrics, statistical methodology from S1-6 (Welch + bootstrap + Bonferroni), final verdict.
- `BUDGETS.md` rows updated with measured candidate budgets per A3 (severity stays `soft` for now).

**Effort.** ~1 day. Stats + harness already exist from Sprint 1; this is wiring the new arm and the 5-metric capture.

---

## Recommended commit sequence (v3, audit-amended)

The **14-commit** sequence preserves "one topic per commit". v3 inserts S2-L3 (promoted), S2-L5 (new), and S2-1.5 (new) into the v2 sequence at their dependency-correct positions:

```
 1.  docs(adr): add no-large-ipc rule                            (S2-L1)
 2.  docs(db): document report-relevant V1 schema contract       (S2-L2)
 3.  feat(perf): orchestrator fixture-mode integration           (S2-L5, new in v3)
 4.  test(perf): comparison smoke baseline runner                (S2-L4)
 5.  test(perf): library smoke runner + L-LIB-* / DB-LIST*       (S2-L3, promoted in v3)
 6.  feat(reports): by-ids DTOs and validation                   (G1, G2 enum, G4 key material)
 7.  feat(reports): native comparison PDF by-ids                 (S2-1 PDF + G3 semaphore)
 8.  feat(reports): native comparison XLSX by-ids                (S2-1 XLSX)
 9.  feat(perf): production-shaped fixtures in bench_comparison_pdf  (S2-1.5, new in v3)
10.  test(reports): by-ids golden parity tests                   (S2-2 incl. corner cases + hash normalisation lib)
11.  feat(frontend): route comparison exports through native by-ids flag  (G5)
12.  perf(reports): TS vs native validation report               (S2-3)
13.  chore(audit): remove comparison large-ipc exception         (final cleanup)
14.  docs(perf): update budgets and Sprint 2 retrospective       (close-out)
```

Approximate timing on the v3 critical sequence: **~7–8 active days** (up from 5–6 in v2 because S2-L3 is now mandatory and S2-L5 / S2-1.5 add ~3.5 hours).

Progress as of this commit:

- ✅ Commit #1 (S2-L1): `55912f6` shipped 2026-04-29.
- 🔄 Commit #2 (S2-L2): in progress at the time of v3 amendment.
- ⬜ Commits #3–#14: pending.

---

## Definition of done (tightened)

Sprint 2 closes only when **all** are true:

- [ ] **Native PDF + XLSX by-ids paths default in alpha** (feature flag wired per G5; flag default = native).
- [ ] **Old TS-assembly path** is reachable only via the fallback flag; `#[deprecated]` markers in place.
- [ ] **Golden parity tests** cover 3 main fixtures + 6 corner cases (incl. duplicate-IDs reject + reordered-IDs preserve-order).
- [ ] **A/B validation report** at `REPORTS-NATIVE-BY-IDS-VALIDATION.md` shows all 5 metrics: wall_ms (p50/p95), IPC payload size, JS heap peak, Rust RSS peak; A/B includes **synthetic + production-shaped DB fixtures** (S2-1.5).
- [ ] **`LARGE-IPC-EXCEPTION` for `reports_generate_comparison_pdf` removed** from the audit lint config.
- [ ] **`audit:large-ipc`, `cargo test --lib`, `vitest`, `version:validate` all green** on the closing commit.
- [ ] **`BUDGETS.md` carries measured numbers** for `L-CMP-3`, `L-CMP-5`, `L-CMP-10`, `L-CMP-PDF-5`, `L-CMP-XLSX-5` (severity stays `soft` per A3 until 5 stable nightly runs).
- [ ] **`BUDGETS.md` carries measured numbers** for `L-LIB-OPEN-1K`, `L-LIB-OPEN-10K`, `L-FILTER`, `L-EXP-DETAIL`, `DB-LIST`, `DB-LIST-LARGE`, `DB-DETAIL` (S2-L3 promoted in v3, audit S1-AUD-005). Severity stays `soft`.
- [ ] **`run-rust-microbench.mjs` supports `--fixture-db` and `--all-experiments`** (S2-L5 / S1-AUD-002); `npm run perf:microbench:dbsweep[:compare]` exposed.
- [ ] **`ADR-0010-comparison-report-generation.md` updated** with a "post-Sprint-2 by-ids path" section (so future readers find the new architecture from the original ADR).
- [ ] **Sprint 2 retrospective doc** written (template: `SPRINT-1-RETROSPECTIVE.md`).
- [ ] **Sprint 3 planning doc** drafted with the cache key material design from G4 already pre-loaded.

---

## Risk register (v3)

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Native handler reads stale data because Sprint 3 cache doesn't exist yet, so every report re-runs analysis | high (it's the current behaviour, just inside Rust now) | low | document explicitly; S2-3 numbers are the post-Sprint-2 / pre-Sprint-3 baseline; Sprint 3 multiplies the win. |
| Order preservation regression: SQLite `WHERE id IN (...)` returns wrong order | high | high (correctness) | explicit test in S2-2 (reordered-IDs fixture); per-row loop or post-fetch sort by input index in the handler. |
| Two concurrent comparison exports OOM the process | medium | high | G3 semaphore with `permits=1` from S2-1 PR. |
| Golden test flaky on PDF/XLSX metadata even after normalisation | medium | medium | structural-hash fallback per A5; ship the normalisation lib as a reusable artefact. |
| Old TS-assembly path silently used in production because feature flag default is wrong | low | medium | flag default = native; manifest in `BASELINES.md` runId; S2-3 perf report explicitly logs which path each iteration ran. |
| ADR-0013 disagrees with the lint's actual behaviour | low | low | write the ADR after confirming the lint's current rules; cite the lint as source of truth. |
| V1_DDL.md drifts from migration code over time | high (long-tail) | medium | future Sprint 3+ task: `npm run audit:db-schema-drift` lint that diffs documented schema vs `PRAGMA table_info()` of fresh seed DB. |
| Sprint 2 timeline slips because v3 added S2-L3 + S2-L5 + S2-1.5 to the critical sequence | medium | medium | accepted scope expansion; v3 explicitly costs +3.5 hours; if a hard deadline emerges, S2-L3 (4 h) is the cheapest item to defer because the audit wants it but the by-ids ROI doesn't strictly need it. |
| Long-tail BUDGETS.md TBDs stay TBD if S2-L3 ships partially (only some L-LIB-* measurements land) | medium | high (audit accepts no excuse) | gate Sprint 2 close on the new DoD line item explicitly listing all 7 L-LIB / L-FILTER / L-EXP-DETAIL / DB-LIST budgets; partial S2-L3 = Sprint 2 not closed. |

---

## See also

- `docs/performance/PERF-ROADMAP-SPRINTS-1-6.md` — program-level view (this is the active sprint at the top of the ROI ordering).
- `docs/performance/SPRINT-1-EXTERNAL-AUDIT.md` — external static audit that drove v3 amendments.
- `docs/performance/SPRINT-1-RETROSPECTIVE.md` — what shipped in Sprint 1, what's inherited.
- `docs/performance/BUDGETS.md` — the contract this sprint moves the L-CMP-* numbers on.
- `docs/performance/MICROBENCH.md` — the bench harness Sprint 2 will extend with a `reports` target.
- `docs/adr/ADR-0010-comparison-report-generation.md` — the architecture this sprint revises.
- `docs/adr/ADR-0013-no-large-ipc-rule.md` — **created in S2-L1** (commit #1, 2026-04-29).
- `docs/db/V1_DDL.md` — to be created in S2-L2.
- `scripts/audit/check-large-ipc-contracts.mjs` — the lint whose exception this sprint retires.
