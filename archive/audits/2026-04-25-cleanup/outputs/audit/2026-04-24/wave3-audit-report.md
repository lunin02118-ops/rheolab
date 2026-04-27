# RheoLab Wave 3 Audit Report

Date: 2026-04-24
Mode: audit only, no product-code fixes
Workspace: D:\Development\Rheolab

## Scope

This wave continued after `outputs/audit/2026-04-24/wave2-audit-report.md` and focused on:

| Area | Coverage |
|---|---|
| License / IPC boundary | Tauri commands, reset/delete flows, update channel, API-key validation, report IPC gates. |
| DB / migrations / library filters | Schema version handling, touch-point precompute paths, dynamic vs SQL query parity. |
| Reports / units / data shape | PDF/XLSX parity, SI/SI_Pas/Imperial labels, showRawData/showRheology toggles, water params. |
| Parser / fuzzing | BSL calibration, delimited parser, non-finite numerics, fuzz harness gaps. |
| Audit / release tooling | Enterprise audit exit behavior, release-gate binary freshness, cargo audit coverage, frontend IPC audit stability. |

Agents used:

| Agent | Focus |
|---|---|
| Faraday | License / IPC boundary |
| Sartre | DB / migrations / library filters |
| Ptolemy | Reports / units / data-shape contracts |
| Dewey | Parser / fuzzing surfaces |
| Gibbs | Supply-chain / audit tooling |

## Gate / Command Results

| Command | Result | Notes |
|---|---:|---|
| `cargo test --manifest-path src-tauri/Cargo.toml migration -- --nocapture` | PASS | 29 migration-focused tests passed. |
| `cargo test --manifest-path src-tauri/Cargo.toml touch_point -- --nocapture` | PASS | 26 touch-point focused tests passed. |
| `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml report_generator::comparison -- --nocapture` | PASS | 39 comparison-report tests passed. |
| `cargo test --manifest-path src-tauri/Cargo.toml licensing -- --nocapture` | PASS | 72 licensing tests passed. |
| `cargo test --manifest-path src-tauri/Cargo.toml api_keys -- --nocapture` | NO COVERAGE | 0 tests matched. |
| `cargo test --manifest-path src-tauri/Cargo.toml reports -- --nocapture` | PASS | 7 tests passed. |
| `npx vitest run tests/reports/report-builders.test.ts tests/reports/comparison-builders.test.ts tests/reports/comparison-report-converter.test.ts tests/reports/useComparisonReportExport.test.ts` | PASS | 4 files, 50 tests passed. |
| `cargo fuzz --version` | FAIL | `cargo-fuzz` not installed. |
| `cargo +nightly --version` | FAIL | Nightly toolchain not installed. |
| `npm run audit:frontend-ipc` | INCOMPLETE / FAIL | Outer command timed out; dynamic warmup produced 32 Tauri failures after CDP disconnect. |
| `npm run audit:frontend-ipc -- --skip-dynamic --run-id wave3-frontend-ipc-static-only` | FAIL / SUMMARY WRITTEN | Dynamic KPI gates skipped; tool exits failure. |

## High Findings

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| W3-01 | High | IPC reset commands can delete experiments based on caller-supplied user IDs, without a real caller/session binding. | `src-tauri/src/commands/licensing/mod.rs:252-322`, registered at `src-tauri/src/startup/commands_registry.rs:89-94`. | Any main-WebView IPC caller that can invoke these commands can delete one user's experiments, or all experiments if it supplies an active admin user ID. |
| W3-02 | High | DB downgrade detection logs but still rewrites a future schema version down to current. | `src-tauri/src/db/migration.rs:107-152`. | Older binaries can mark a newer DB as current and continue against a schema they do not understand. |
| W3-03 | High | Single-report Imperial temperature/pressure settings are not honored in report stats tables. | UI preset `src/lib/store/chart-settings-defaults.ts:76-82`; PDF labels `src/rust/rheolab-core/src/report_generator/pdf/template/stats.rs:148-149`; XLSX labels `src/rust/rheolab-core/src/report_generator/excel/stats.rs:123-124`. | Imperial reports can display Celsius/bar headers even when UI selected Fahrenheit/psi. |
| W3-04 | High | Comparison XLSX converts viscosity values but hardcodes Y-axis label/format as cP/integer. | `src/rust/rheolab-core/src/report_generator/comparison/excel_comparison.rs:200-205`, `:423-428`. | `SI_Pas` values can be displayed under cP labels and rounded incorrectly. |
| W3-05 | High | `showRawData=false` is honored by PDF but not by XLSX. | PDF guard `src/rust/rheolab-core/src/report_generator/pdf/template/raw_data.rs:16-18`; Excel unconditional write `src/rust/rheolab-core/src/report_generator/excel/mod.rs:124-126`, `excel/raw_data.rs:105`. | Export privacy/size setting is inconsistent; XLSX can include raw data when user disabled it. |
| W3-06 | High | Non-finite numeric tokens can enter parsed rheology points. | `src/rust/rheolab-core/src/parser/row_mapper/mod.rs:89-99`, `:141-150`. | `NaN`/`inf` can survive parsing, contaminate analysis/sorting, or hide bad input as data. |
| W3-07 | High | `npm run audit:enterprise` can false-green at process level. | NO-GO is computed at `scripts/audit/run-enterprise-deep-audit.js:831-836`; `main()` ends without nonzero exit at `:1027-1035`. | CI can mark an audit job successful even when the report says NO-GO. |
| W3-08 | High | Release gate can test a stale generated Tauri binary. | Build only if missing or `--build` at `scripts/test/run-release-gate.js:78-85`; test env forces `TAURI_E2E_SKIP_BUILD=1` at `:112-117`. | Source/dependency changes can pass release E2E against an older executable. |

## Medium Findings

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| W3-09 | Medium | Machine ID is exposed by IPC and also used as API-key encryption seed. | `licensing_machine_id` at `src-tauri/src/commands/licensing/mod.rs:191-208`; KDF at `src-tauri/src/commands/api_keys/mod.rs:38-54`. | If a caller can also access/copy DB rows, the exposed seed reduces protection of stored API keys. |
| W3-10 | Medium | Update channel ignores invalid/expired license status and keys off cached license type. | `src-tauri/src/commands/licensing/mod.rs:443-466`; invalid/revoked paths keep `license_type` at `src-tauri/src/commands/licensing/engine/verification.rs:203-230`, `:439-444`. | Revoked/inactive/expired developer/superuser licenses can still receive beta/alpha update channel headers. |
| W3-11 | Medium | Comparison report IPC bypasses licensed comparison-count limits. | Commands only call `can_write_via_engine` at `src-tauri/src/commands/reports.rs:112-150`; demo/trial limits at `src-tauri/src/commands/licensing/features.rs:31-35`, `:77-83`. | Direct IPC can generate comparison reports with more experiments than the active license allows. |
| W3-12 | Medium | Runtime environment can redirect stored API-key validation endpoint. | `GROQ_BASE_URL` read at `src-tauri/src/commands/api_keys/commands.rs:403-407`; bearer key sent at `:414-416`. | A manipulated process environment can exfiltrate active stored API keys during validation. |
| W3-13 | Medium | Dynamic custom-threshold library query ignores crossing-viscosity filters. | Dynamic path filters time and target viscosity at `src-tauri/src/commands/experiments/list/dynamic.rs:209-320`; SQL fast path applies crossing viscosity at `src-tauri/src/commands/experiments/list/query.rs:297-306`. | Custom threshold results can include rows outside requested crossing-viscosity range. |
| W3-14 | Medium | Preset touch-point filters can false-negative before v3 backfill completes. | v3 seeds only 50 cP at `src-tauri/src/db/migrations/v0003_multi_threshold_touch_point.rs:88-106`; query fast-paths all preset thresholds at `src-tauri/src/commands/experiments/list/query.rs:347-384`. | On first launch after upgrade, 500/700/etc filters can return empty/incomplete results until delayed backfill finishes. |
| W3-15 | Medium | Comparison XLSX time format defaults to minutes instead of selected chart format. | Export context omits time format at `src/components/comparison/reports/hooks/useComparisonReportExport.ts:132-135`; converter defaults at `src/lib/analysis/report-types/comparison-report-converter.ts:71`; PDF derives from report input at `src/rust/rheolab-core/src/report_generator/comparison/pdf_comparison.rs:668-670`. | PDF/XLSX comparison exports can disagree on time axis. |
| W3-16 | Medium | Water ion fields are extracted but dropped before report export. | Extraction at `src/lib/reports/comparison-experiment-adapter.ts:88-99`; builder forwards only source/salinity/ph/hardness at `src/lib/reports/report-builders.ts:256-263`; Rust supports ions at `src/rust/rheolab-core/src/report_generator/types.rs:177-187`. | Fe/Ca/Mg/Cl/SO4/HCO3 can render missing in exported reports. |
| W3-17 | Medium | Columnar nullable raw fields are coerced to zero. | `src/lib/utils/columnar.ts:16-31`; comparison adapter uses conversion at `src/lib/reports/comparison-experiment-adapter.ts:177-180`. | Missing shear/pressure/speed values become real zeros in report/export calculations. |
| W3-18 | Medium | Malformed CSV records are silently converted to blank rows. | `src/rust/rheolab-core/src/parser/rheo_parser/heuristics.rs:4-40`. | Quoted multiline/unbalanced CSV can erase or shift rows without explicit parse errors. |
| W3-19 | Medium | Semicolon CSV with comma-bearing headers can be mis-tokenized. | Delimiter selection at `src/rust/rheolab-core/src/parser/rheo_parser/heuristics.rs:12-24`. | Headers like `Time, min;Viscosity, cP` can fall back to comma parsing and corrupt mapping. |
| W3-20 | Medium | Rust audit coverage is incomplete/non-hermetic. | Enterprise audit cargo command at `scripts/audit/run-enterprise-deep-audit.js:338-340`; core dev deps at `src/rust/rheolab-core/Cargo.toml:47-50`; separate core lockfile exists. | `src/rust/rheolab-core/Cargo.lock` vulnerabilities can be missed by the default audit job. |
| W3-21 | Medium | cargo-audit ignores are broad and expiry-free. | `src-tauri/.cargo/audit.toml:10-38`. | Advisory suppressions can outlive their original justification. |
| W3-22 | Medium | `perf:db:*` uses unpinned `npx cross-env`. | `package.json:32-33`; `package-lock.json` has no `node_modules/cross-env`. | Perf commands may fetch/prompt for an unpinned package, hurting reproducibility. |
| W3-23 | Medium | Enterprise audit timeout is not process-tree safe. | `spawn(... shell: true ...)` and `child.kill('SIGTERM')` at `scripts/audit/run-enterprise-deep-audit.js:697-710`. | Timed-out audit commands can leave grandchildren alive. This happened with frontend IPC audit until manual cleanup. |

## Low / Tooling Notes

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| W3-24 | Low | Dynamic default ordering is reversed versus SQL fast path. | `src-tauri/src/commands/experiments/list/dynamic.rs:402-420`; SQL default at `src-tauri/src/commands/experiments/list/query.rs:419-423`. | Custom-threshold list order can differ from normal list order. |
| W3-25 | Low | Seed verifier assumes `PRAGMA user_version` as production invariant. | `scripts/dev/verify-seed-db.py:34-39`; fixture generator writes pragma at `tools/fixture_seed/src/main.rs:933-936`. | Seed verification can mislead because production migrations rely on `schema_meta`. |
| W3-26 | Low | Root lockfile metadata version is stale. | `package.json:3` is `0.2.0-beta.39`; `package-lock.json:3` and root package are `0.2.0-beta.25`. | Release traceability and artifact provenance are weaker, even though dependency specs matched in read-only check. |
| W3-27 | Tooling | Frontend IPC static scan has at least one false positive. | `runtime/audit/wave3-frontend-ipc-static-only/static-scan-findings.json`; flagged `src/components/dashboard/file-upload.tsx:18`, which is `setTimeout(resolve, 0)` inside `waitForIdle`. | Audit backlog noise can distract from real IPC/perf issues. |
| W3-28 | Tooling | `audit:frontend-ipc` dynamic pass lacks per-command timeout and can fail to produce summary. | `scripts/audit/run-frontend-ipc-deep-audit.js:304-314`, `:811-838`; partial run log `runtime/audit/20260424-022916812-frontend-ipc-deep-audit/logs/D-WARMUP_npx_cross_env_tauri_e2e_skip_build_1_npm_run_perf_workflow.log`. | Long failing Playwright runs can outlive parent timeout and leave dev processes behind. |

## Coverage Gaps

| Gap | Evidence |
|---|---|
| No API-key unit tests matched targeted run. | `cargo test --manifest-path src-tauri/Cargo.toml api_keys -- --nocapture` ran 0 tests. |
| No parser fuzz harness / nightly fuzz setup. | `cargo fuzz --version` failed; `cargo +nightly --version` failed. |
| Current report tests do not assert unit-label parity or `showRawData` XLSX behavior. | Report-focused Rust and TS tests passed despite W3-03, W3-04, W3-05, W3-15. |
| Current migration/touch-point tests do not cover future-schema downgrade persistence or custom-threshold crossing-viscosity filters. | Migration/touch-point targeted tests passed despite W3-02 and W3-13. |
| Current licensing tests do not model hostile IPC caller identity. | Licensing targeted tests passed despite W3-01, W3-10, W3-11. |

## Recommended Next Audit Waves

| Wave | Goal | Focus |
|---|---|---|
| W4 Security Harnesses | Convert high-risk IPC findings into negative tests. | Reset commands, update channel with revoked/expired status, report feature limits, API-key validation endpoint. |
| W5 DB Query Parity | Assert fast SQL path equals dynamic path. | Custom threshold vs preset threshold, crossing-viscosity filters, default ordering, pending backfill. |
| W6 Export Golden Matrix | Generate PDF/XLSX golden assertions over unit/toggle matrix. | SI, SI_Pas, Imperial, showRawData, showRheology, water ions, columnar nullable values. |
| W7 Parser Fuzz Setup | Add reproducible fuzz prep package. | BSL ragged rows, NaN/inf, quoted multiline CSV, semicolon/comma headers, invalid UTF-8, DAT tabs. |
| W8 Audit Tooling Hardening | Make audit outputs CI-authoritative. | Nonzero NO-GO exit, process-tree timeout kill, static scan suppressions, lockfile coverage, no stale binary release gate. |

## Artifact Notes

`npm run audit:frontend-ipc -- --skip-dynamic --run-id wave3-frontend-ipc-static-only` generated:

| Artifact | Notes |
|---|---|
| `runtime/audit/wave3-frontend-ipc-static-only/frontend-ipc-audit-summary.json` | Static-only summary written; gate status is `skipped`. |
| `runtime/audit/wave3-frontend-ipc-static-only/static-scan-findings.json` | Contains two static findings, one confirmed false positive. |
| `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-24.md` | Generated by the audit script. |
| `docs/performance/FRONTEND-IPC-DEEP-AUDIT-LATEST.md` | Updated by the audit script. |

## Repro Commands

```powershell
cargo test --manifest-path src-tauri/Cargo.toml migration -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml touch_point -- --nocapture
cargo test --manifest-path src/rust/rheolab-core/Cargo.toml report_generator::comparison -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml licensing -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml api_keys -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml reports -- --nocapture
npx vitest run tests/reports/report-builders.test.ts tests/reports/comparison-builders.test.ts tests/reports/comparison-report-converter.test.ts tests/reports/useComparisonReportExport.test.ts
cargo fuzz --version
cargo +nightly --version
npm run audit:frontend-ipc
npm run audit:frontend-ipc -- --skip-dynamic --run-id wave3-frontend-ipc-static-only
```
