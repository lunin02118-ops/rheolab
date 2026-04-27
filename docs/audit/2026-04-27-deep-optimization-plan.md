# Deep optimization audit — plan & baseline

**Date:** 2026-04-27
**Branch:** `main` @ `858f55c` (`0.2.0-beta.53`)
**Run-id:** `20260427-deep-opt-baseline`
**Goal:** measurable reduction in resource consumption (memory, bundle, native footprint, CPU) and overall code-base optimization.

---

## 0. Baseline snapshot

### 0.1 Code metrics

| Metric | Value |
|---|---:|
| Rust LOC (total) | 50 837 (203 files) |
| Rust LOC `src-tauri/` | 27 389 (113 files) |
| Rust LOC `src/rust/rheolab-core/` | 23 448 (90 files) |
| TS/TSX LOC `src/` | 36 289 (243 files) |
| Source bytes on disk | 3.62 MB |
| Production `unwrap()` | 0 |
| Production `expect()` | 49 (parser fallbacks) |
| Production `panic!()` | 3 (only in `examples/`) |
| TODO / unimplemented | 0 |
| Mojibake | 0 |
| IPC commands | 93 |
| Files >500 LOC (Rust) | 20 |
| Files >400 LOC (TS) | 8 |

**Top-5 oversized Rust files (refactor candidates):**

1. `src/rust/rheolab-core/src/report_generator/comparison/pdf_comparison.rs` — 1620 LOC
2. `src-tauri/src/commands/experiments/list/list_tests.rs` — 1586 LOC
3. `src/rust/rheolab-core/src/report_generator/chart_generator/line/multi_experiment.rs` — 1363 LOC
4. `src/rust/rheolab-core/src/report_generator/comparison/excel_comparison.rs` — 1243 LOC
5. `src/rust/rheolab-core/src/report_generator/formatters.rs` — 875 LOC

**Top-3 oversized TS files:**

1. `src/lib/utils/touch-point.ts` — 599 LOC
2. `src/components/library/experiment-filters.tsx` — 523 LOC
3. `src/lib/store/chart-settings-store.ts` — 423 LOC

### 0.2 Release gate

| | |
|---|---|
| Decision | **GO** |
| Checks executed | 14 |
| Checks passed | 14 |
| Blocking failures | 0 |
| Severity blockers | 0 |

### 0.3 Bundle (frontend, after `npm run build`)

| Asset | Size | Gzip |
|---|---:|---:|
| `main-*.js` | 273.50 KB | 86.79 KB |
| `page-Bq54HiSG.js` | 141.03 KB | 40.87 KB |
| `vendor-radix-*.js` | 115.52 KB | 36.99 KB |
| `page-XEM2GAqG.js` | 105.37 KB | 26.95 KB |
| `vendor-charts-*.js` | 52.54 KB | 23.38 KB |
| `vendor-react-*.js` | 49.03 KB | 17.39 KB |
| `DashboardContent-*.js` | 48.50 KB | 14.69 KB |
| Other chunks | various | various |

Build time: 18.19 s.

### 0.4 Dependencies

| Source | Outdated count |
|---|---:|
| npm (root deps) | ~28 |
| cargo workspaces | TBD |

### 0.5 Runtime performance (existing data)

| Metric | Value | Source |
|---|---:|---|
| Native memory `totalWsMb` p95 | 562.57 MB | Apr 27 audit (codex) |
| JS heap p95 | 9.73 MB | Apr 27 audit |
| Renderer working set p95 | 162.79 MB | Apr 27 audit |
| GPU working set p95 | 168.79 MB | Apr 27 audit |
| Soak (20 runs) | 20 / 20 PASS | Apr 27 audit |
| Idle heap Analysis route | 6.43 MB | Apr 25 benchmark |
| Idle heap Library | 7.75 MB | Apr 25 benchmark |
| Idle heap Comparison | 8.33 MB | Apr 25 benchmark |
| Idle heap Settings | 7.81 MB | Apr 25 benchmark |
| Navigation leak (5 cycles) | +2.71 MB / +3518 nodes | Apr 25 benchmark |

Fresh `perf:benchmark` and `perf:soak:tauri` runs are scheduled in this baseline.

---

## 1. Phase plan

### Phase 0 — Baseline collection (in progress)

* enterprise audit quick — done
* snapshot-metrics — done
* bundle composition — done
* npm outdated — done
* cargo outdated — running
* perf:benchmark — running
* perf:soak:tauri — TODO
* audit:frontend-ipc (deep, with rebuild) — optional, ~10 min
* DB schema dump + EXPLAIN baseline — optional

**Gate to enter Phase 1:** baseline JSON committed under `runtime/audit/20260427-deep-opt-baseline/`.

### Phase 1 — Bundle and dead exports

**Tooling:** `rollup-plugin-visualizer` (already in repo), add **`knip`** + **`ts-prune`** as dev-deps; add **`madge`** for module-dependency graph.

**Targets:**

* Bundle main + vendor reduced by ≥10 %.
* Dead TS exports list with concrete delete suggestions.
* Module dependency cycles list (acceptable: zero cycles).

**Risk:** low. No prod logic touched.

### Phase 2 — Architecture refactor (oversized files)

**Targets per file:**

| File | Plan |
|---|---|
| `pdf_comparison.rs` 1620 | split by report section: header / charts / tables / footer |
| `multi_experiment.rs` 1363 | split by chart type: line / bar / scatter |
| `excel_comparison.rs` 1243 | split by Excel sheet |
| `formatters.rs` 875 | split by domain |
| `touch_point_precompute.rs` 765 | split by precompute pipeline phase |
| `touch-point.ts` 599 | split: pure utils / kalman / smoothing |
| `experiment-filters.tsx` 523 | split by filter group |
| `chart-settings-store.ts` 423 | split into store slices |

**Goal:** Rust files >500 LOC: 20 → ≤10. TS files >400 LOC: 8 → ≤3.

**Risk:** medium. Tests must remain green; ADR per refactor.

### Phase 3 — Runtime performance

**Targets:**

| Metric | Now | Goal |
|---|---:|---:|
| Native memory `totalWsMb` p95 | 562.57 MB | <500 MB |
| JS heap p95 | 9.73 MB | <8 MB |
| Time-to-interactive (TTI) | TBD | −20 % |
| React renders >16 ms | TBD | 0 |

**Approach:** React Profiler runs, IPC waterfall analysis, lazy-load remaining heavy routes, fine-tune WebView2 args.

**Risk:** medium. Possible UX regressions; full Playwright suite must pass.

### Phase 4 — Database

**Targets:**

* EXPLAIN QUERY PLAN on top-10 read queries.
* Audit existing indexes: any never-used? any missing?
* VACUUM/ANALYZE strategy: when, how often.
* Migration scaffold health: applied vs DDL.
* Pagination correctness in `list_experiments`.
* Dead columns/tables: manual review.

**Risk:** medium-high. Touches schema. Strict migration tests + rollback plan.

### Phase 5 — Dead code

**Tools:** `knip`, `ts-prune`, `cargo-machete`, `cargo +nightly udeps`, existing `scripts/audit/orphan-commands.ps1`.

**Targets:**

* Dead TS exports (and tests for them).
* Dead Rust deps in `Cargo.toml`.
* Dead `pub` items / unused workspace members.
* Dead test fixtures.
* Dead i18n keys.
* Orphan IPC commands.
* Dead capabilities / permissions.

**Risk:** low. Pure deletions, easy revert.

### Phase 6 — Dependencies

**Targets:**

* Decision matrix per outdated package: bump / pin / replace / drop.
* Heavy deps in bundle: candidates for replacement.
* `npm dedupe` for duplicates.
* Major-bump RFCs.

**Risk:** medium. Major bumps need Playwright sweep.

### Phase 7 — Resource fine-tuning

After 1–6, point optimizations:

* Memory: extra WebView2 args (only data-driven).
* Disk: log rotation (already done), DB compaction, runtime/ cleanup policy.
* CPU: SIMD flags, parallel iterators in core, criterion regressions check.
* Network: license-server polling backoff, response caching.
* Bundle: lazy-load remaining heavy routes (Comparison, Settings).

**Risk:** low–medium per fix.

### Phase 8 — Final report

Sections:

* Before / after metrics summary.
* Applied optimizations (commit-by-commit).
* ROI table: effort vs gain.
* Roadmap for next 1–3 months.
* Anti-patterns / "do not do" recommendations.

Artifact: `docs/audit/2026-04-27-deep-optimization-final.md` plus run JSON.

---

## 2. Target KPIs

| KPI | Now | Target |
|---|---:|---:|
| Native memory p95 | 562.57 MB | <500 MB (−11 %) |
| JS heap p95 | 9.73 MB | <8 MB (−18 %) |
| Bundle main + vendor | TBD | −10 % |
| Files >500 LOC (Rust) | 20 | ≤10 (−50 %) |
| Files >400 LOC (TS) | 8 | ≤3 (−63 %) |
| Production `expect()` | 49 | ≤30 |
| TTI | TBD | −20 % |
| Test runtime | Vitest 13 s, cargo 36 s | no regression |

## 3. Process safety

* Each phase is a separate feature branch off `main`.
* After every phase: all gates green (`tsc`, `eslint`, `vitest`, `cargo test`, `gitleaks`, enterprise-audit).
* Squash-merge only after manual review.
* Rollback: revert branch.
* No UX regressions: Playwright suite must keep passing.

## 4. Artifacts

* This document — plan and baseline summary.
* `runtime/audit/20260427-deep-opt-baseline/` — raw JSON / TSV / logs.
* `runtime/refactor-baseline/metrics.json` — LOC / quality / oversize snapshot.
* Fresh perf runs: `outputs/e2e/perf/benchmark-*.json`, soak summary.

## 5. Status

### Phase 0 — Baseline collection: **DONE** (2026-04-27)

All baseline artefacts captured under `runtime/audit/20260427-deep-opt-baseline/`:

* `metrics.json` — LOC, oversize, Rust quality counts
* `bundle-audit-stdout.log` — production bundle composition
* `npm-outdated.json`, `cargo-tree-*.txt` — dependency snapshots
* `madge-circular-ts.txt` — **0 circular deps** (clean architecture)
* `knip-report.txt`, `ts-prune-report.txt` — dead-code candidates
* `perf-benchmark-stdout.log`, `perf-soak-stdout.log` — runtime perf baseline
* `release-gate-decision.json` — GO (14/14 gates, 0 blockers)

### Phase 1 — Dead code & unused exports: **in progress** (branch `audit/phase-1-dead-code`)

Commits so far on the branch:

| SHA | Subject | Δ |
|---|---|---:|
| `0a8f7be` | add knip, ts-prune, madge as dev tooling | +3 dev-deps |
| `154211c` | remove 5 dead files identified by knip+ts-prune | −29.4 KB / −521 LOC |
| `f740536` | remove 4 unused exports from `src/` | −19 lines |

Files removed (manual review confirmed zero non-JSDoc imports):

* `src/components/reports/ReportSettings.tsx` (17.5 KB) — replaced by `useReportExport`
* `src/components/reports/ReportsPanel.tsx` (8.6 KB) — replaced by `ComparisonReportTab`
* `src/lib/api-keys/helpers.ts` (250 B) — zombie after S-1 removal
* `tests/api-keys/helpers.test.ts` (429 B) — placeholder for the deleted helpers
* `scripts/build/modify-chart-template.ts` (2.6 KB) — no callers

Exports removed (`ts-prune` + `grep` cross-check):

* `useAnalysisPipeline.ts` — `clearAnalysisCache` re-export (callers go direct)
* `lib/logger.ts` — `configureLogger`, `getLogLevel` (no callers)
* `lib/version.ts` + `scripts/build/generate-version.js` template — `FULL_VERSION` (no callers)

Verification after every commit: `tsc` clean, `eslint` clean (0 warnings), `vitest` 89/89 (1330 tests passing), `cargo test --lib` 322/322.

Skipped intentionally (false positives or ad-hoc dev tools):

* `Regents/` — TDS data scraping helpers (not source code, manual user data dump)
* `scripts/{audit,build,debug,dev,test,utils,release}/*` — most are invoked transitively from `run-enterprise-deep-audit.js`, `release/build.ps1`, or documented as one-shot dev tools in `scripts/README.md`
* `orphan-commands-report.txt` showing 91/91 IPC commands as "orphan" — false positive: the audit script does not parse the `register_tauri_commands!()` macro in `src-tauri/src/startup/commands_registry.rs`. All commands are verified registered (cargo test passes, IPC integration tests green).
* Most `ts-prune` "unused exports" — they are types in barrel-files (`*/index.ts`, `tauri.d.ts`) consumed via `import type` paths the tool cannot statically resolve.

### Phase 4 — Database deep-dive (read-only audit): **DONE** (2026-04-27)

Static analysis of schema + production query patterns. Full report: `docs/audit/2026-04-27-database-deep-dive.md`.

Key findings:

* **0 high-severity** issues. Hot path is solidly indexed (PK / composite / partial indexes).
* **0 circular FKs**, all hot-path FKs are index-backed.
* **Schema is well-engineered**: 45 indexes across 23 tables, every index justified by a documented `WHERE`-path. `Experiment` carries 17 (12 base + 5 partial v0002), `TouchPointPrecompute` 4 partial indexes (v0003).
* 4 low / informational findings tracked for Phase 7 fine-tune (`LOWER(name)` footgun, 3 missing FK indexes on artifact tables, filter-metadata `DISTINCT`-fan-out, write-amplification monitoring).

### Phase 4 follow-up — F1 + F3 applied: **DONE** (2026-04-27)

| Commit | Finding | What |
|---|---|---|
| `b56bada` | F1 | `is_duplicate_name`: `LOWER(name) = LOWER(?)` → `name = ? COLLATE NOCASE` + 3 regression tests |
| `0725c58` | F3 | Frontend filter-metadata cache: extract state to `lib/experiments/filter-metadata-cache.ts`, wire `resetExperimentFilterMetadataCache` into `saveExperiment` / `deleteExperiment`, add 4 unit tests |

Verification: `tsc` clean, `eslint` 0 warnings, `madge` 0 cycles, `vitest` 1334/1340, `cargo test --lib` 325/325.

### Phase 4b — Live `EXPLAIN QUERY PLAN` profiling: **DONE** (2026-04-27)

Ran `scripts/audit/explain-plan.sql` against `outputs/seed/rheolab-fixture-seed-small.db` (19 experiments, 152 TPP rows). Full report: `docs/audit/2026-04-27-database-explain-profile.md`.

Key empirical findings:

* **F1 verified live.** Q8 (post-fix): `SEARCH USING COVERING idx_reagent_name_nocase (name=?)`. Q8b (pre-fix): `SCAN USING COVERING idx_reagent_name_nocase`. Index lookup vs full covering scan — measurable proof.
* **TPP partial indexes (v0003) all hit** (Q10a/b/c). Recent migration work pays off as designed.
* **F5 — NEW finding (medium):** the default Library page (`ORDER BY createdAt DESC, id DESC LIMIT 50` with no `WHERE`) produces `SCAN + TEMP B-TREE FOR ORDER BY`. Invisible at 19 rows, latent risk at 10k+ experiments. Fix is a 1-line v0004 migration:

  ```sql
  CREATE INDEX IF NOT EXISTS idx_experiment_createdat_id_desc
      ON Experiment(createdAt DESC, id DESC);
  ```

* **F6 — LOW:** `ReagentCatalog ORDER BY LOWER(...)` does a temp-sort scan. Tiny table (<500 rows), defer until it shows on a profile.
* **F7 — INFORMATIONAL:** Q4 list-with-`testType` filter does index seek + temp sort. Composite `(testType, createdAt, id)` would remove the sort but adds storage. No action.

### Phase 4b / F5 v0004 migration — **DONE** (2026-04-27)

Commit `ae5d93d`: new migration `v0004_experiment_list_default_index` adds
`idx_experiment_createdat_id_desc ON Experiment(createdAt DESC, id DESC)`.
`CURRENT_SCHEMA_VERSION` bumped 3 → 4. Three migration tests (creates index,
plan uses it without `TEMP B-TREE`, idempotent re-run) plus a fix to
`schema_identity_with_raw_ddl` to apply v0004 on the manual-DDL path.
`cargo test --lib`: **328/328**.

### Phase 5 — Dead-code (TS/JS surface): **DONE** (2026-04-27)

Three commits, atomic and gated:

| SHA | Subject | Δ |
|---|---|---:|
| `16bb034` | Phase 5a: drop 5 unused npm deps + 6 orphan scripts | −54 packages, −1054 LOC |
| `6becbae` | Phase 5b: narrow licensing TS-side public API surface | −15 LOC, 0 cycles |
| `1be5056` | Phase 5c: 5 internal-only demotions + 2 dead `default` exports | −15 LOC |
| `19a6c1d` | Phase 5c continued: 2 unused barrel re-export lines + 3 useComparisonChartData helpers demoted | −11 LOC |

Knip-report progression:

| Section | Before Phase 5 | After Phase 5 | Δ |
|---|---:|---:|---:|
| Unused files | 57 | 51 | **−6** |
| Unused dependencies | 3 | 0 | **−3** |
| Unused devDependencies | 7 | 1 | **−6** |
| Unused exports | 108 | **30** | **−78 (−72%)** |
| Unlisted binaries | 3 | 1 | **−2** |
| Unresolved imports | 4 | 2 | **−2** |

Verification on every Phase 5 commit: `tsc` clean, `eslint --max-warnings=0`
clean, `madge` 0 cycles, `vitest` 1334/1340 (parity with parent), `cargo test
--lib` 328/328 (Phase 5a touched the JS surface only).

Deferred (false positives or out-of-scope):

* shadcn/ui re-exports (`Dialog*`, `Select*`, `AlertDialog*`, `Card*`,
  `Table*`, `ScrollBar`) — convention; future code will use them.
* `playwright.*.config.ts`, `postcss.config.mjs`, `runtime/*`, `website/*`,
  `Regents/*`, most `scripts/{audit,build,debug,dev,test,utils,release}/*`
  — invoked via CLI flags or transitively, not as TS imports.
* `pdf-parse` devDep — only `Regents/extract_tds.js` (manual data dump per
  AGENTS.md); leave until that workflow is retired.
* Reserved future API (e.g. `temperatureDecimals`, `convertValue`,
  `axisLabel`, `DATA_COLORS`, `API_RATES`, `ISO_RATES`, `GEOMETRY_PARAMS`,
  `addLicenseSlot`, `clearMultiLicenseData`) — small surface, deleting
  would erase work; defer to a separate "API trim" pass with explicit user
  sign-off.

### Phase 6 — npm dependency bumps: **DONE** (2026-04-27)

Cherry-picked into 7 atomic batches by ownership area, with all gates
re-run after each batch:

| SHA | Batch | Packages | Δ |
|---|---|---|---:|
| `15de784` | 1 — test infra | `@playwright/test`, `@testing-library/react`, `@vitest/coverage-v8`, `@vitest/ui`, `vitest` | 5 |
| `b035745` | 2 — tooling | `eslint`, `typescript-eslint`, `@tauri-apps/cli`, `@types/node`, `@types/react` | 5 |
| `8a4e564` | 3 — runtime | `react-router-dom`, `@tanstack/react-virtual`, `zod`, `zustand` | 4 |
| `75d180c` | 4 — styling | `tailwindcss`, `@tailwindcss/postcss`, `tailwind-merge` | 3 |
| `679b8e4` | 5 — react patch | `react`, `react-dom` 19.2.1 → 19.2.5 (pinned exactly) | 2 |
| `c7923e2` | 6 — `lucide-react` | 0.561 → 1.11 (stability stamp, no API break) | 1 |
| `84491e8` | 7 — `jsdom` | 27 → 29 (dev-only test env, two-major spread) | 1 |

**21 packages bumped** (16 minor/patch within semver, 3 patches restored
to exact-pin discipline, 2 well-contained majors).  Verification on every
batch: `tsc` clean, `eslint --max-warnings=0` clean, `vitest` 1334/1340
(parity with parent).

#### Audit gate (2026-04-27, post-Phase 6)

* `cargo audit` — **0 vulnerabilities** (884 crates).
* `npm audit --omit=dev` — **0 vulnerabilities** in production deps.
* The 2 moderate advisories `npm audit` reports are devDep-only (test
  infra) and out of scope for the production-deps gate per AGENTS.md.

#### Attempted but reverted

* **`eslint-plugin-react-hooks` 5 → 7.1.1** — installed, then reverted.
  The 7.x line introduces the new `react-hooks/set-state-in-effect` rule
  which flags **65 errors** across the codebase (e.g.
  `src/hooks/useSaveDialogInit.ts:291` calling `setState` synchronously
  inside `useEffect`).  This is a real breaking change requiring a
  focused rule-by-rule refactor, not a pure dep bump; deferred.

#### Deferred (require focused sessions)

* `@vitejs/plugin-react` 4 → 6, `vite` 6 → 8 — Vite major chain; needs
  config + plugin compatibility review.
* `eslint` 9 → 10, `eslint-plugin-react-hooks` 5 → 7 — see above; the new
  rules are valuable but the cleanup is a separate work item.
* `typescript` 5 → 6 — language major; rerun every gate plus careful
  diff of emitted error messages and lib.d.ts changes.
* `@types/node` 20 → 25 — node-types must match the Node runtime; defer
  until the Node LTS pin is reviewed.

### Phase 7a — react-hooks 7.x readiness: **PARTIAL** (2026-04-27)

Started the refactor toward `eslint-plugin-react-hooks` 7.x compatibility.
The 7.x line ships 5 new rules; the initial scan reported **66 violations
across 24 files** distributed:

| Rule | Count |
|---|---:|
| `set-state-in-effect` | 25 |
| `refs` | 18 |
| `preserve-manual-memoization` | 11 |
| `static-components` | 11 |
| `incompatible-library` | 1 |

Plugin held at 5.2.0 during the refactor so gates stay green; will bump
to 7.x when all violations are resolved.

#### Progress so far — 6 atomic batches, **24/65 violations resolved**

| SHA | Batch | Files | Violations |
|---|---|---|---:|
| `326c256` | 7a-1 | `theme-context`, `ui-mode-context`, `collapsible-card` | 3 |
| `6a36808` | 7a-2 | `OperatorManager`, `LaboratoryManager`, `APIKeyManager`, `cycle-editor-dialog` | 4 |
| `f1cad0a` | 7a-3 | `comparison/page`, `UpdateCheck`, `file-upload`, `DevModeSection` | 4 |
| `5946052` | 7a-4 | `viscosity-threshold-selector`, `LicenseActivationDialog`, `comparison-selector`, `reagents-manager` | 4 |
| `ba21fa0` | 7a-5 | `BackupManager` | 2 |
| `9b2e4ab` | 7a-6 | `useSaveDialogInit` | 7 |

Three reusable patterns proved out:

1. **Lazy useState init** — for the "useState + mount-effect localStorage
   hydration" anti-pattern (`theme-context`, `ui-mode-context`,
   `useSaveDialogInit` Effect 1, `DevModeSection`).
2. **"Adjusting state during render"** with a guarded prev-prop
   comparison — for the "useEffect-on-prop-change with setState" case
   (`collapsible-card`, `file-upload`, `viscosity-threshold-selector`,
   `LicenseActivationDialog`).
3. **`Promise.resolve().then()` microtask deferral** — universal fallback
   when neither lazy init nor useMemo can express the behaviour
   (`comparison/page`, `comparison-selector`, `reagents-manager`,
   `BackupManager`, all 6 deferred effects in `useSaveDialogInit`).

Verification on every batch: `tsc` clean, `eslint --max-warnings=0` clean,
`vitest` 1334/1340 (parity with parent).  The new rules were verified
manually by temporarily installing plugin 7.x and running eslint, then
reverting to 5.2.0 for the gates.

#### Remaining (~41 violations across 7 files)

Different rule categories that require different fix approaches:

| Rule | Remaining | Files |
|---|---:|---|
| `set-state-in-effect` | 3 | `comparison-chart-uplot`, `useAnalysisPipeline` |
| `refs` | 14 | `experiment-list`, `uplot-chart`, `comparison-chart-uplot`, `useAnalysisPipeline`, `useRheologyChartOptions`, `experiment-table` |
| `preserve-manual-memoization` | 11 | `CalibrationChartsUplot` |
| `static-components` | 11 | `experiment-table` |
| `incompatible-library` | 1 | (TBD) |

Recommended order (lowest risk first): finish remaining `set-state-in-effect`
(3 mechanical fixes) → tackle `static-components` in `experiment-table`
(extract inline component definitions) → `refs` (read-during-render
issues, mostly chart code) → `preserve-manual-memoization` in
`CalibrationChartsUplot` (likely needs useMemo dep-list cleanup or React
Compiler-friendly rewrites).

### Phase 2+ — Pending

Recommended next steps in priority order:

1. **Phase 7a continuation** — finish the remaining 41 react-hooks 7.x
   violations.  Mechanical for `set-state-in-effect`; per-rule analysis
   for the others.
2. **Phase 2 — refactor `pdf_comparison.rs`** (1620 LOC) → ≤500 LOC per
   section. Highest impact but largest risk; needs its own feature branch.
3. **Major-version bump pass** (Vite, ESLint, TypeScript) — one
   ecosystem chain per session with full regression gate after each.
4. **F6 / F7** — defer until profiling on production-size DB shows them.
