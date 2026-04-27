# RheoLab Deep Audit Waves — 2026-04-25

Scope: `D:\Development\Rheolab`, commit `6b0f0991e00cce45c0a65ccbc9de6860c85b4929`, branch `main`.

Important caveat: the worktree was already dirty before this audit. This audit generated/updated runtime/build artifacts only; no product source code fixes were applied.

## Wave 0 — Inventory and Scope

- Source corpus, excluding lock files, generated outputs, fixtures/assets: `915` text/source files, `161,627` LOC.
- Main source distribution:
  - `.rs`: `213` files, `53,859` LOC.
  - `.ts`: `293` files, `49,357` LOC.
  - `.tsx`: `126` files, `21,167` LOC.
  - `.md`: `91` files, `14,331` LOC.
- Largest areas:
  - `src`: `339` files, `60,459` LOC.
  - `tests`: `151` files, `31,976` LOC.
  - `src-tauri`: `122` files, `29,114` LOC.
  - `src/rust/rheolab-core`: `92` files, `23,419` LOC.
  - `scripts`: `125` files, `16,711` LOC.
- Largest implementation/review files:
  - `src/rust/rheolab-core/src/report_generator/comparison/pdf_comparison.rs`: `1,619` LOC.
  - `src/rust/rheolab-core/src/report_generator/chart_generator/line/multi_experiment.rs`: `1,362` LOC.
  - `src/rust/rheolab-core/src/report_generator/comparison/excel_comparison.rs`: `1,242` LOC.
  - `src-tauri/src/db/touch_point_precompute.rs`: `762` LOC.
  - `src-tauri/src/commands/experiments/list/query.rs`: `602` LOC.
  - `src/lib/utils/touch-point.ts`: `598` LOC.

## Wave 1 — Quality Gates and Coverage

Fresh commands:

- `npx tsc --noEmit --pretty false`: PASS.
- `npm audit --omit=dev --json`: PASS, `0` production vulnerabilities, `667` total npm deps in audit metadata.
- `npm run build`: PASS, `15.77s`, `2936` modules transformed.
- `npm run audit:bundle`: PASS, `18.29s`.
- `npm run lint -- --format json --output-file runtime\deep-audit-eslint-2026-04-25.json`: FAIL.
  - `33` errors, `1` warning, `11` files with messages.
  - Real source issues include:
    - `src/components/analysis/cycle-results-table.tsx`: unused `formatTime`.
    - `src/components/comparison/comparison-chart-uplot.tsx`: missing hook dependency.
    - `src/components/shared/UpdateChecker.tsx`: floating promise.
    - `src/hooks/useRheologyVisibility.ts`: unused args.
  - Config issue: ESLint scans Rust generated docs under `src/rust/rheolab-core/target/doc/static.files/*`.
- `npm run test:coverage -- --reporter=json --outputFile=runtime\deep-audit-vitest-coverage-2026-04-25.json`: FAIL because tests fail, but emitted diagnostic coverage.
  - Suites: `373` total, `369` passed, `4` failed.
  - Tests: `1337` total, `1315` passed, `16` failed, `6` skipped.
  - Failed files:
    - `tests/components/experiment-filters-touch-point.test.tsx`: `15` assertion failures.
    - `tests/performance/dashboard-tabs-perf.test.tsx`: `1` assertion failure.
  - Coverage from failed run:
    - Statements: `68.2%` (`3480/5103`).
    - Functions: `59.8%` (`726/1215`).
    - Branches: `59.5%` (`2443/4104`).
  - Lowest coverage among non-trivial files:
    - `src/components/calibration/CalibrationChartsUplot.tsx`: `0.6%` statements.
    - `src/components/calibration/chart-utils.ts`: `3.1%`.
    - `src/lib/tauri/bridge/index.ts`: `15.9%`.
    - `src/hooks/useFocusTrap.ts`: `16.7%`.
    - `src/lib/tauri/experiments.ts`: `25.9%`.
- `cargo test --manifest-path src\rust\rheolab-core\Cargo.toml`: PASS.
  - Core tests observed: `189 + 18 + 5 + 7 + 9 + 1 + 1 + 1 + 21 + 2 = 254` passed, doc tests `2` ignored.
- Previously verified in same audit session:
  - `cargo test --manifest-path src-tauri\Cargo.toml`: PASS, `319 + 25 + 12 + 10` Rust tests passed.
- `cargo clippy --manifest-path src-tauri\Cargo.toml --lib -- -D warnings`: FAIL, `40` lib errors.
- `cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings`: FAIL, `262` errors.
- `cargo clippy --manifest-path src\rust\rheolab-core\Cargo.toml --all-targets -- -D warnings`: FAIL, `54` lib errors and `79` lib-test errors.

Quality conclusion: build and core tests are strong, but lint/clippy/Vitest are not release-clean. Treat current quality gate as RED.

## Wave 2 — Architecture and Boundaries

Architecture strengths:

- Tauri IPC is centralized in `src-tauri/src/startup/commands_registry.rs`.
- Frontend has a clear Tauri domain layer under `src/lib/tauri/*` plus `src/lib/tauri/bridge`.
- SQLite pool uses WAL, foreign keys, busy timeout, cache and mmap pragmas in `src-tauri/src/db/pool.rs`.
- DB schema is indexed aggressively: `23` tables, `52` indexes, `22` foreign keys.
- Experiment list has a fast path using `TouchPointPrecompute` and indexed threshold rows.

Architecture risks:

- IPC surface is large: `91` registered commands.
- `10` registered commands are exposed but not used by frontend wrappers:
  - `backup_export_db`, `backup_import_db`
  - `licensing_activate_full`, `licensing_can_save`, `licensing_debug_fingerprint`, `licensing_register_experiment`
  - `licensing_reset_all_experiments`, `licensing_reset_experiments`, `licensing_was_ever_licensed`
  - `search_projections_list`
- There are direct raw `invoke` imports outside the bridge:
  - `src/components/settings/BackupManager.tsx`
  - `src/components/settings/ExperimentExportImport.tsx`
  - `src/lib/store/license-store.ts`
  - `src/components/shared/UpdateChecker.tsx`
  - `src/lib/licensing/tauri-bridge.ts`
- `src/lib/tauri/core.ts` says domain modules should use `safeInvoke`, but `src/lib/tauri/index.ts` still exports raw `invoke`; this preserves legacy imports and weakens the intended boundary.
- Default export in `src/lib/tauri/index.ts` omits `operators` and `laboratories` while named exports include them. This is survivable today, but it is a drift trap.
- Write/destructive license gating remains inconsistent across IPC commands, especially catalog/sync/artifact/reset flows.

## Wave 3 — Complexity, Duplication, Dead-Code Signals

Approximate complexity scan over `.ts`, `.tsx`, `.rs`:

- Files scanned: `632`.
- Approximate decision points: `11,480`.
- Approximate function markers: `7,010`.

Top high-decision files:

- `src/rust/rheolab-core/src/report_generator/chart_generator/line/multi_experiment.rs`: `220` decision points / `1363` LOC.
- `src/rust/rheolab-core/src/report_generator/comparison/pdf_comparison.rs`: `179` / `1620`.
- `src/rust/rheolab-core/src/parser/row_mapper/detection.rs`: `113` / `436`.
- `src/rust/rheolab-core/src/report_generator/comparison/excel_comparison.rs`: `111` / `1243`.
- `src-tauri/src/commands/experiments/list/query.rs`: `104` / `603`.
- `src/lib/analysis/report-types/report-converter.ts`: `101` / `230`.
- `src/lib/utils/touch-point.ts`: `97` / `599`.
- `src/components/calibration/CalibrationChartsUplot.tsx`: `93` / `366`.

Highest complexity density, min 200 LOC:

- `src/lib/analysis/report-types/report-converter.ts`: `0.439`.
- `src/lib/analysis/cycle-factory.ts`: `0.285`.
- `src/lib/parsing/parse-normalize.ts`: `0.264`.
- `src/rust/rheolab-core/src/parser/row_mapper/detection.rs`: `0.259`.
- `src/components/calibration/CalibrationChartsUplot.tsx`: `0.254`.

Duplication scan:

- Source lines scanned after normalization: `68,130`.
- Duplicate block size: `14` normalized lines.
- Cross-file duplicate groups: `613`.
- Duplicate block occurrences: `1,279`.
- Top duplicate clusters:
  - Experiment row mapping / SQL projection duplicated across:
    - `src-tauri/src/commands/experiments/export/export_helpers.rs`
    - `src-tauri/src/commands/experiments/list/dynamic.rs`
    - `src-tauri/src/commands/experiments/list/query.rs`
    - `src-tauri/src/db/repositories/experiments/read.rs`
  - CSV/workbook parser loops duplicated across:
    - `src/rust/rheolab-core/src/parser/rheo_parser/csv_parser.rs`
    - `src/rust/rheolab-core/src/parser/rheo_parser/workbook.rs`
  - Comparison report layout/series logic duplicated across:
    - `src/rust/rheolab-core/src/report_generator/comparison/excel_comparison.rs`
    - `src/rust/rheolab-core/src/report_generator/comparison/pdf_comparison.rs`
    - `src-tauri/src/commands/reports.rs`

Dead-code / fragility signals:

- `TODO`: `0`, `FIXME`: `0`, `HACK`: `1`, `TEMP`: `18`, `XXX`: `8`.
- Rust `unwrap()`: `662` total under Rust source trees; production-like count after excluding obvious tests: `183`.
- Rust `expect(`: `154` total; production-like count: `106`.
- A real weak assertion exists: `src-tauri/src/commands/analysis_tests.rs:75` uses `assert!(!result.unwrap().steps.is_empty() || true, "call succeeded");`.

## Wave 4 — Performance

Fresh build/bundle numbers:

- `npm run build`: PASS, `15.77s`, `2936` modules transformed.
- `npm run audit:bundle`: PASS, `18.29s`, visualizer output path: `runtime/refactor-baseline/bundle.html`.
- Dist text assets:
  - JS: `1,169,260` bytes raw, `380,822` gzip.
  - CSS: `146,298` bytes raw, `21,572` gzip.
- Largest chunks:
  - `main-*.js`: `273.5 kB` raw, `86.8 kB` gzip.
  - `main-*.css`: `144.6 kB` raw, `20.9 kB` gzip.
  - route `page-*.js`: `141.0 kB` raw, `40.9 kB` gzip.
  - `vendor-radix`: `115.5 kB` raw, `37.0 kB` gzip.
  - another route `page-*.js`: `105.3 kB` raw, `26.9 kB` gzip.
- Build warning:
  - Vite externalizes Node `crypto` imported by `src/lib/utils/encryption.ts`.
  - Root cause: browser bundle contains a client/server hybrid encryption utility used by `src/lib/licensing/multi-license-store.ts`.

Existing same-day performance artifacts:

- Memory soak: PASS, `4/4` runs passed.
  - Peak heap max: `10.02 MB`.
  - Peak heap mean: `8.45 MB`.
  - Final heap mean: `7.99 MB`.
  - Peak nodes max: `1029`.
  - Slope max: `0.108 MB/round`.
- DB scale comparison:
  - Small: `12` experiments, total wall `11,379 ms`.
  - Large: `7,056` experiments, total wall `11,303 ms`.
  - DB size factor: `588x`.
  - Wall time ratio: `0.99x`.
  - This is an excellent scaling result for the measured workflow.
- Analysis timing, Tauri:
  - Chandler SST-63: `11 ms`, uPlot init `1 ms`.
  - Grace Report: `43 ms`, uPlot init `1 ms`.

Performance risks:

- `src-tauri/src/commands/experiments/list/dynamic.rs` custom threshold slow path decodes every candidate blob and recomputes touch points. The code comments estimate `15-20s` for `10k+` rows even after rayon parallelization. This is acceptable only if custom thresholds are rare or clearly treated as a heavy operation.
- DB pool is `max_size(8)` with `mmap_size=256 MB` and `cache_size=-20000` per connection. Comments correctly note address-space vs resident memory, but high parallel IPC plus dynamic scans should be watched with native process memory, not just JS heap.
- `src/lib/utils/downsample.ts` has smart/multichannel LTTB logic and avoids some allocation, but `downsampleRheoPoints` still maps all points into wrapper objects before LTTB. For huge visible series, prefer typed arrays or direct point-index LTTB.
- `src/lib/analysis/report-types/report-converter.ts` maps full `raw_data` into report payloads; for large reports this duplicates arrays in memory before Rust/native generation.

## Wave 5 — Prioritized Remediation

P0 / release blockers:

1. Fix Vitest failures in touch-point filters and dashboard tabs.
2. Fix ESLint gate and ignore generated Rust target docs.
3. Add/standardize license gates for every write/destructive IPC command.
4. Narrow Tauri FS capability scope.
5. Harden `sync_import_delta` path validation and size/schema limits.
6. Make backup merge fail/rollback on FK violations or table insert failures.

P1 / audit-readiness:

1. Reduce IPC exposed-but-unused commands or mark them admin/internal with explicit guards.
2. Move direct raw `invoke` users to bridge/safeInvoke wrappers.
3. Introduce shared row projection/mapper for experiment SQL results.
4. Extract shared parser section-to-points pipeline for CSV/workbook.
5. Split comparison report generation into shared layout model plus format-specific renderers.
6. Add coverage for low-coverage calibration/chart/bridge files.

P2 / performance hardening:

1. Add benchmark for custom touch-point threshold slow path at 1k/10k/50k rows.
2. Add native process RSS sampling around DB pool + dynamic threshold scan.
3. Add report payload memory benchmark for large `raw_data`.
4. Consider typed-array downsampling path for large chart series.
5. Add bundle budget check for `main`, route chunks, CSS, and `vendor-radix`.

Final verdict: engineering foundation is good, especially DB indexing and performance scaling on standard workflows, but the repo is not audit-clean or release-clean yet because lint/clippy/Vitest gates fail and IPC authorization/filesystem boundaries need tightening.
