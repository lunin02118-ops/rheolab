# Performance Budgets — RheoLab Enterprise

**Status:** v1 (2026-04-28, Sprint 0 — baseline captured by S0-5).  
**Owner:** Architecture Team.  
**Linked baseline:** **AlphaBaseline-0.2.2-alpha.2** (see `BASELINES.md`, runId family `1777393597912`–`1777393927970`).  
**Latest RC scorecard:** `RC-PERFORMANCE-SCORECARD.md` (2026-04-29 local hardening pass).
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
| **M-HEAP-LIB-10K** | JS heap after library open with 10k seed | `perf:db:large` | **6.97** (7k seed) | **≤ 128** | **≤ 160** | soft |
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
| **L-LIB-OPEN-1K** | Library page render after warm DB, 1k seed (ms) | `perf:db:small` | **1,540** (12-exp proxy†) | **≤ 2,000** | **≤ 3,000** | soft |
| **L-LIB-OPEN-10K** | Library page render, 10k seed (ms) | `perf:db:large` | **1,555** (7k-exp proxy†) | **≤ 2,000** | **≤ 3,500** | soft |
| **L-FILTER** | Filter change → list re-render (ms, perceived) | `perf:db:large` | **1,034** (proxy†) | **≤ 1,500** | **≤ 2,500** | soft |
| **L-EXP-DETAIL** | Experiment detail open (ms) | `perf:db:large` | **1,319** (proxy†) | **≤ 1,800** | **≤ 3,000** | soft |
| **L-CMP-3** | Comparison setup, 3 experiments (ms to UI ready) | `perf:comparison:tauri` | TBD (runner shipped, pending first run) | **≤ 600** | **≤ 1,000** | soft |
| **L-CMP-5** | Comparison setup, 5 experiments | `perf:comparison:tauri` | TBD (needs license-override) | **≤ 1,000** | **≤ 1,800** | soft |
| **L-CMP-10** | Comparison setup, 10 experiments | `perf:comparison:tauri` | TBD (needs license-override) | **≤ 2,500** | **≤ 4,000** | soft |
| **L-PDF** | Single PDF report generation (ms) | `perf:workflow` | **1,571** (p95 1,844, n=6) | **≤ 5,000** | **≤ 8,000** | soft |
| **L-XLSX** | Single XLSX report generation (ms) | `perf:workflow` | TBD (pending workflow runner extension) | **≤ 2,000** | **≤ 4,000** | soft |
| **L-CMP-PDF-5** | Comparison PDF, 5 experiments | `perf:microbench:pdf --fixture-db` | **231** (p95 246, fixture-backed native render) | **≤ 12,000** | **≤ 20,000** | soft |
| **L-CMP-XLSX-5** | Comparison XLSX, 5 experiments | `perf:microbench:xlsx --fixture-db` | **2,400** (p95 2,458, fixture-backed native render) | **≤ 5,000** | **≤ 8,000** | soft |

† **Proxy note (Sprint 2 / S2-L3):** L-LIB-OPEN, L-FILTER, L-EXP-DETAIL measured
values are **UI wall_ms** from Playwright `db-scale-perf.tauri.spec.ts` — they
include IPC round-trip + React render + `waitForTimeout` padding, not just the
SQLite query. Original budget guesses (250 ms, 100 ms, 300 ms) assumed pure
DB-query time; the first real measurements show 1–1.5 s per operation at the UI
level. Budgets revised upward to reflect what the spec actually measures. **Pure
DB-query timings** will be extracted via Rust-side `tracing::instrument` spans
in Sprint 3+ (`perf:db:query-isolation` runner); at that point the budgets in
section D will tighten to sub-100 ms. Until then, the UI-level proxies are the
enforcement layer.

Comparison PDF 12 s for 5 exp is intentionally generous — it
will tighten by 30-50% after Sprint 2 (native by-ids) and Sprint 3 (analysis
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
| **DB-LIST** | List/filter query (1k rows) | Sprint 5 synthetic DB microbench | **3 ms** (`fieldName=North`, 1k rows) | **≤ 50 ms** | **≤ 100 ms** | soft |
| **DB-LIST-LARGE** | List/filter query (10k rows) | `perf:db:large` | **1,555** (UI proxy†) | **≤ 2,000** | **≤ 3,500** | soft |
| **DB-DETAIL** | Single experiment full-load query | `perf:db:small` | **1,325** (UI proxy†) | **≤ 1,800** | **≤ 3,000** | soft |
| **DB-FACET** | Facet/distinct values query | Sprint 5 synthetic DB microbench | **2 ms** facet rebuild over 1k rows | **≤ 50 ms** | **≤ 100 ms** | soft |

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
| `scripts/audit/check-large-ipc-contracts.mjs` (P14 lint) | **done** — commits `9fb902f`, `e77fb26`; rule formalised by `docs/adr/ADR-0013-no-large-ipc-rule.md`; RC hardening removed the final comparison-payload suppression, so `audit:large-ipc` is expected to report zero suppressions |
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
| Fill ~13 TBD entries in sections B / C / D above | **partially done in Sprint 2 / S2-L3** — the S2-L3 library/DB cluster is filled with measured proxy values (see † note). Remaining non-S2-L3 TBDs stay assigned to later runners / close-out. |
| Pre-P10 vs post-P10 binary-size delta (mentioned at the bottom of this file) | **partially done** — bench example showed +6 % code size; full release-installer delta still pending. Sprint 2 candidate. |

## Sprint 2 deliverables tracker

| Deliverable | Status |
|---|---|
| `scripts/test/extract-library-budgets.mjs` — budget extraction from db-scale sidecars | **done** — Sprint 2 / S2-L3, commit #5 |
| Fill 8 of 13 TBD budget entries (L-LIB-OPEN-1K/-10K, L-FILTER, L-EXP-DETAIL, M-HEAP-LIB-10K, DB-LIST/-LARGE, DB-DETAIL) | **done** — Sprint 2 / S2-L3, commit #5 |
| Budget p50/p95 recalibrated from pure-DB guesses to UI-wall-ms reality | **done** — Sprint 2 / S2-L3, commit #5 |
| Remaining non-S2-L3 TBDs (L-CMP-3/-5/-10, L-XLSX, C-LONG-TASK*, DB-FACET, etc.) | **partially reduced** — S2 closeout filled fixture-backed native `L-CMP-PDF-5` / `L-CMP-XLSX-5`; UI setup N=5/N=10 still needs license-override helper, workflow runner extension, and later query-isolation work |
| `npm run perf:library:budgets` extraction script | **done** — Sprint 2 / S2-L3, commit #5 |
| `REPORTS-NATIVE-BY-IDS-VALIDATION.md` native comparison report validation | **done** — Sprint 2 closeout; PDF/XLSX fixture-backed N=5/N=10 captured |

## Sprint 3 deliverables tracker

| Deliverable | Status |
|---|---|
| `AnalysisArtifact` migration, repository, stable key, and `json+zstd:v1` codec | **initial vertical slice done** — comparison by-IDs cache path stores and hits artifacts; key tests cover data hash, geometry, analysis settings, detection settings, report rates, core version, and algorithm version |
| Comparison PDF/XLSX by-IDs cache integration | **done for initial slice** — cold path runs analysis and stores artifact; warm path decodes cached `AnalysisOutput`; corrupt cache is deleted and recomputed |
| Cold vs warm validation | **captured** — see `ANALYSIS-ARTIFACT-CACHE-VALIDATION.md`; PDF N=5 full-render mean improved 0.9%, XLSX N=5 was effectively flat (-0.05%) |
| Budget action | **no tightening yet** — full PDF/XLSX render dominates this debug Rust bench; keep `L-CMP-PDF-5` and `L-CMP-XLSX-5` budgets unchanged until release-mode or scheduler job metrics show a stable win |
| CPU/RAM action | **deferred to Sprint 4 instrumentation** — Sprint 3 cache bench records wall time, bytes, artifact rows, and hit counts only |
| Dashboard/single-report cache adoption | **deferred** — current dashboard/single-report IPC uses mutable frontend payloads; persistent cache needs by-id contracts before keying by DB blob is safe |

## Sprint 4 deliverables tracker

| Deliverable | Status |
|---|---|
| Runtime `JobScheduler` in `AppState` | **implemented** — scheduler records queued/running/terminal state, progress, cancellation token, and per-job metrics |
| Comparison PDF/XLSX by-IDs through scheduler | **implemented** — both native by-IDs report commands use scheduler-owned comparison job gates |
| Job IPC and events | **implemented** — `jobs_list`, `jobs_get`, `jobs_cancel`, plus `job://created`, `job://progress`, `job://finished` |
| AnalysisArtifact maintenance | **implemented** — `analysis_cache_stats` and scheduler-backed `analysis_cache_prune` |
| Metrics action | **partial** — `queuedMs`, `wallMs`, cache hit/miss counts, artifact bytes, and output bytes are captured; CPU/RSS fields remain nullable pending loader-safe process sampler |
| Merge gate | **green** — `cargo check`, `cargo test --lib` (426 passed / 1 ignored), `npm ci`, `npm test`, `version:validate`, `audit:large-ipc`, and `git diff --check` pass |

## Sprint 5 deliverables tracker

| Deliverable | Status |
|---|---|
| `ExperimentListProjection`, `ExperimentFacetCache`, and `ExperimentProjectionMeta` migration | **implemented** — v0009 is registered and idempotent |
| Projection repository and row builder | **implemented** — save-path upsert, batch rebuild, status/readiness checks, facet rebuild, and projection query APIs |
| Library list read path | **implemented for supported ready queries** — reagent filters, batch filters, custom non-default touch thresholds, incomplete/stale projection fall back to legacy SQL |
| Filter metadata | **implemented with safe fallback** — reads `ExperimentFacetCache` when projection is ready; otherwise existing distinct-query path remains |
| Scheduler maintenance | **implemented** — `experiments_projection_status` and scheduler-backed `experiments_projection_rebuild` |
| DB-level validation | **captured** — see `LIBRARY-PROJECTION-VALIDATION.md`; synthetic 1k list query measured 3 ms legacy and 3 ms projection, facet rebuild 2 ms |
| Budget action | **partial** — `DB-LIST`/`DB-FACET` now have real synthetic DB-level values; UI-level L-LIB/L-FILTER budgets remain unchanged until the Playwright runner emits DB spans |

## Sprint 6 deliverables tracker

| Deliverable | Status |
|---|---|
| Binary by-id chart series IPC | **implemented** — `experiments_series_meta`, `experiments_series_overview`, and `experiments_series_window` read `ExperimentData.dataBlob` and return `RHEOSR1` binary f64 columns |
| Downsample strategy | **implemented** — min/max bucket downsampling preserves first/last points and primary metric extrema |
| Frontend decoder and chart adoption | **implemented as initial slice** — DB-loaded dashboard charts attempt binary overview and fall back to the legacy AoS/SoA path |
| Validation | **captured** — see `BINARY-SERIES-IPC-VALIDATION.md`; targeted Rust and TS codec/downsample tests pass |
| Budget action | **no hard tightening yet** — binary payload formula is documented, but chart first paint, JS heap, and long-task budgets wait for Playwright instrumentation and by-id detail analysis |

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
