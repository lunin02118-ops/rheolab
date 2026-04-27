# RheoLab Wave 2 Audit Report

Date: 2026-04-24
Mode: audit only, no implementation fixes
Workspace: D:\Development\Rheolab

## Executive Summary

Release readiness is NO-GO for the current working tree.

The strongest blockers are the enterprise quick gate failures, a red standalone `rheolab-core` lockfile audit, and several correctness/performance risks around columnar data, comparison rehydration, parser fault tolerance, and report unit consistency.

I used the following audit skills and helpers:

| Input | Usage |
|---|---|
| `audit-context-building` | Built code-path context before classifying findings. |
| `audit-prep-assistant` | Ran static, dynamic, dependency, and release-gate checks. |
| `cargo-fuzz` | Used as fuzzing-gap checklist for parser/core surfaces. |
| Agents | Frontend/memory agent and parser/core agent findings integrated. A Tauri/DB agent result was unavailable, so local checks covered that area. |

## Current Gate Status

| Check | Result | Evidence |
|---|---:|---|
| `npm run audit:enterprise:quick` | FAIL / NO-GO | `runtime/audit/2026-04-24-enterprise-deep-audit/release-gate-decision.md` |
| `npx tsc --noEmit` | FAIL | `runtime/audit/2026-04-24-enterprise-deep-audit/logs/04_npx_tsc_noemit.log` |
| `npm run lint` | FAIL | `runtime/audit/2026-04-24-enterprise-deep-audit/logs/05_npx_eslint.log` |
| `npm test` | FAIL | `runtime/audit/2026-04-24-enterprise-deep-audit/logs/06_npm_test.log` |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS | quick audit check 11 |
| `cargo check --manifest-path src/rust/rheolab-core/Cargo.toml` | PASS | local run |
| `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml` | PASS | 176 unit tests plus integration/doc targets passed |
| `cargo clippy --manifest-path src/rust/rheolab-core/Cargo.toml --all-targets` | FAIL | local run |
| `npm run test:parsing` | PASS | 32 tests passed |
| `npm run perf:stress` | PASS with warning | memory store-leak scenario reports heap growth but does not fail |
| `npm audit --omit=dev` | PASS | 0 vulnerabilities |
| `cargo audit` from `src-tauri/` | PASS by configured ignore policy | `src-tauri/.cargo/audit.toml` |
| `cargo audit --file src/rust/rheolab-core/Cargo.lock` | FAIL | 2 vulnerabilities found |
| `semgrep --version` | UNAVAILABLE | semgrep not installed |

## P0/P1 Findings

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| W2-01 | P0 | Enterprise quick gate is NO-GO. 13 checks executed, 8 passed, 5 failed blocking. | `runtime/audit/2026-04-24-enterprise-deep-audit/release-gate-decision.md` | Release cannot be trusted while type, lint, test, and PHP license-server checks are red. |
| W2-02 | P1 | Standalone core lockfile has active RustSec vulnerabilities. | `cargo audit --file src/rust/rheolab-core/Cargo.lock`: `RUSTSEC-2026-0103 thin-vec 0.2.14` high, `RUSTSEC-2026-0009 time 0.3.44` medium. | PDF/reporting dependency chain via Typst carries vulnerable crates in the standalone core lockfile. |
| W2-03 | P1 | TypeScript contract drift around `showRheology`. | `tests/reports/comparison-experiment-adapter.test.ts:37`, `tests/reports/useComparisonReportExport.test.ts:92`. | Static type guarantees are broken for comparison report export options/overrides. |
| W2-04 | P1 | Unit test gate fails in two files with 16 failures. | `tests/performance/dashboard-tabs-perf.test.tsx:177`, `tests/components/experiment-filters-touch-point.test.tsx:95`. | Regression baseline is not green; UI behavior or test assumptions are out of sync. |
| W2-05 | P1 | Single-report export can drop all raw data for columnar parse results. | `src/lib/store/experiment-data-store.ts:116-121`, `src/components/reports/hooks/useReportExport.ts:59-60`. | PDF/XLSX raw data tables and derived export inputs can be empty for memory-optimized parse results. |
| W2-06 | P1 | Malformed BSL calibration rows can panic. | `src/rust/rheolab-core/src/parser/calibration/parsers/bsl.rs:54-66`. | A row with exactly 5 cells passes the length check and later indexes `row[5]`, turning malformed input into panic instead of recoverable parse error. |

## P2/P3 Findings

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| W2-07 | P2 | Dashboard eagerly rematerializes AoS data even when columnar data is available. | `src/components/dashboard/DashboardContent.tsx:95-106`. | Large datasets can keep SoA and AoS representations simultaneously and spike heap. |
| W2-08 | P2 | Comparison rehydration can race against unmount cleanup. | `src/app/dashboard/comparison/page.tsx:49-71`, `src/app/dashboard/comparison/page.tsx:105-109`, `src/lib/store/comparison-store.ts:115-178`. | Late IPC rehydrate can restore heavy arrays after `releaseHeavyData()`. |
| W2-09 | P2 | File-sourced comparison experiments persist heavy payloads to localStorage. | `src/lib/store/comparison-store.ts:206-228`; license-driven limit at `src/lib/store/comparison-store.ts:89-91`. | Main-thread serialization, quota failures, and stale "max 4" assumption. |
| W2-10 | P2 | CSV heuristic parser silently drops malformed records and cannot handle quoted multiline CSV. | `src/rust/rheolab-core/src/parser/rheo_parser/heuristics.rs:4-43`. | Bad files can become blank rows instead of explicit parser errors. |
| W2-11 | P2 | Invalid time values can become valid-looking `t=0` points. | `src/rust/rheolab-core/src/parser/row_mapper/mod.rs:141-150`. | Corrupt time input can be folded into baseline data and affect ordering/dedup/analysis. |
| W2-12 | P2 | Comparison Excel chart labels hard-code cP while values are unit-converted. | `src/rust/rheolab-core/src/report_generator/comparison/excel_comparison.rs:200-205`, `src/rust/rheolab-core/src/report_generator/comparison/excel_comparison.rs:423`. | `SI_Pas` or other unit modes can display converted values under misleading viscosity labels. |
| W2-13 | P2 | Touch-point filter tests fail because the tested section is inside a closed `FilterGroup`. | `src/components/library/filter-group.tsx:16-20`, `src/components/library/experiment-filters.tsx:375-390`, `tests/components/experiment-filters-touch-point.test.tsx:95-121`. | Test suite expects mounted controls before expanding "Диапазоны"; could hide regressions in the library filter UX. |
| W2-14 | P2 | `cargo clippy --all-targets` is red. | `src/rust/rheolab-core/benches/rheology_core.rs:71` missing `time_format`; `src/rust/rheolab-core/src/report_generator/formatters.rs:483` approx constant denied. | All-target Rust quality gate cannot be used as a release signal. |
| W2-15 | P2 | ESLint scope includes generated Rust docs. | `src/rust/rheolab-core/target/doc/static.files/*.js` appears in lint errors. | Real frontend lint errors are mixed with generated artifact noise. |
| W2-16 | P2 | PHP runtime unavailable, so license-server lint is blocked. | `php -v` fails; `node scripts/audit/php-lint-license-server.js` exits 127. | High-risk license-server PHP syntax/API checks are not actually running in this environment. |
| W2-17 | P2 | Memory stress test reports store cleanup heap growth but treats it as warning. | `tests/e2e/memory-stress.spec.ts:699-716`, `outputs/e2e/perf/memory-stress-store-leak-1776996286389.json`. | Possible store/cache leak remains non-blocking. |
| W2-18 | P2 | Memory stress thresholds are broad. | `tests/e2e/memory-stress.spec.ts:38-40`. | Slow regressions can pass until heap slope is very high. |
| W2-19 | P3 | Combined comparison export rebuilds heavy payloads for PDF and Excel separately. | `src/components/comparison/reports/hooks/useComparisonReportExport.ts:328-331`, `src/lib/reports/comparison-experiment-adapter.ts:174-190`. | Large comparisons duplicate conversion and analysis work. |
| W2-20 | P3 | Touch-point smoothing is optimization-sensitive on long traces. | `src/rust/rheolab-core/src/report_generator/touch_point/algorithm.rs:138-180`. | Repeated window scans and per-window sorting are likely hot on high-frequency traces. |
| W2-21 | P3 | Static-analysis coverage gap: Semgrep is unavailable. | `semgrep --version` not recognized. | Security/path queries cannot be reproduced locally. |

## Positive Signals

| Area | Result |
|---|---|
| Core parser/report tests | `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml` passed across unit, integration, golden, PDF, and touch-point parity targets. |
| Desktop Rust compile | `cargo check --manifest-path src-tauri/Cargo.toml` passed in enterprise quick audit. |
| Parsing TS tests | `npm run test:parsing` passed 32 tests. |
| Production npm dependency audit | `npm audit --omit=dev` found 0 vulnerabilities. |
| Website/release dry run | Website build and unsigned beta dry-run passed in quick audit. |
| Memory stress | `npm run perf:stress` completed, with warnings noted above. |

## Recommended Next Audit Waves

| Wave | Goal | Suggested Commands / Focus |
|---|---|---|
| W3 Gate Hygiene | Make CI signals actionable before deeper security work. | Re-run `npx tsc --noEmit`, `npm run lint`, `npm test`, `cargo clippy --all-targets`; separate generated artifacts from lint scope. |
| W4 Supply Chain | Reconcile both Rust lockfiles and documented ignores. | Audit `src-tauri/Cargo.lock` with and without `src-tauri/.cargo/audit.toml`; audit `src/rust/rheolab-core/Cargo.lock`; review `RUSTSEC-2026-0103`, `RUSTSEC-2026-0009`, `RUSTSEC-2023-0071`. |
| W5 Parser Fuzzing | Turn parser edge cases into fuzz/property checks. | BSL calibration row widths, quoted multiline CSV, invalid time cells, non-finite values, huge rows, mixed delimiters. |
| W6 Columnar/Memory | Verify SoA/AoS contracts under large fixtures. | Single-report export with `columnarData`, dashboard tab navigation, comparison rehydrate/unmount race, localStorage quota tests. |
| W7 Report Unit Consistency | Audit all PDF/XLSX labels, values, and chart axes. | Golden exports for `SI`, `SI_Pas`, `Imperial`, mixed per-category units, Russian/English labels. |
| W8 License/IPC Boundary | Deep audit high-risk Tauri commands and PHP license server. | Activation, signatures, machine fingerprinting, API key commands, restore/import/export IPC paths. Requires PHP runtime. |
| W9 DB/Migration Invariants | Validate schema, migration idempotence, and seed DB assumptions. | Seed DB schema version, v0002/v0003 migration rollback/forward, touch-point precompute consistency, library filters. |
| W10 Performance Hotspots | Profile heavy report and touch-point paths. | Combined comparison export payload reuse, touch-point smoothing complexity, chart downsampling, comparison localStorage serialization. |

## Repro Command Log

```powershell
npm run audit:enterprise:quick
npx tsc --noEmit
npm run lint
npx vitest run tests/performance/dashboard-tabs-perf.test.tsx
npm run test:parsing
npm run perf:stress
cargo check --manifest-path src/rust/rheolab-core/Cargo.toml
cargo test --manifest-path src/rust/rheolab-core/Cargo.toml
cargo clippy --manifest-path src/rust/rheolab-core/Cargo.toml --all-targets
cargo audit
cargo audit --file src-tauri/Cargo.lock
cargo audit --file src/rust/rheolab-core/Cargo.lock
npm audit --omit=dev
semgrep --version
```
