# DB / Calculations / Kaizen Audit — 2026-04-23

**Project:** RheoLab Enterprise V2  
**Scope:** SQLite layer, calculation engine, and continuous-improvement / kaizen discipline  
**Snapshot:** local working tree on 2026-04-23

## Executive Verdict

Общая картина лучше, чем в широком enterprise-аудите: у проекта сильный DB-фундамент, хорошие regression-tests вокруг touch-point/Grace и уже зрелая культура измерений. Но состояние всё ещё **не дотягивает до clean release posture**, потому что часть “не падать любой ценой” достигается через **тихую деградацию derived-state**, а расчётно-репортный test perimeter сейчас **не полностью зелёный**.

## What Was Verified

- DB pool / PRAGMA / concurrency: `src-tauri/src/db/pool.rs`
- Migrations / schema versioning / migration tests: `src-tauri/src/db/migration.rs`, `src-tauri/src/db/migration_tests.rs`, `src-tauri/src/db/migrations/v0003_multi_threshold_touch_point.rs`
- Experiment repositories / read-write semantics: `src-tauri/src/db/repositories/experiments/*.rs`
- Touch-point precompute and library query fast/slow paths:
  - `src-tauri/src/db/touch_point_precompute.rs`
  - `src-tauri/src/commands/experiments/list/query.rs`
  - `src-tauri/src/commands/experiments/list/dynamic.rs`
  - `src-tauri/src/commands/experiments/list/list_tests.rs`
- Calculation contour:
  - `src/rust/rheolab-core/src/grace.rs`
  - `src/rust/rheolab-core/src/physics.rs`
  - `src/rust/rheolab-core/src/analysis/hydration.rs`
  - `src/rust/rheolab-core/src/report_generator/touch_point/*`
  - `src/lib/analysis/cycle-detector.ts`
- Kaizen artifacts:
  - `docs/release/RELEASE_GATE.md`
  - `docs/REFACTORING_DEEP_PLAN.md`
  - `docs/audit/README.md`
  - `docs/audit/refactor-metrics-delta-2026-04-21.md`
  - `docs/audit/REFACTORING_AUDIT_2026-04-18.md`

## Commands Run

- `cargo test --manifest-path src-tauri/Cargo.toml db::migration -- --nocapture` → **29 passed**
- `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml --lib touch_point -- --nocapture` → **17 passed**
- `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml --lib grace -- --nocapture` → **6 passed**
- `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml touch_point -- --nocapture` → **compile failure before test run**
- `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml grace -- --nocapture` → **compile failure before test run**

## Findings

### [HIGH] 1. `rheolab-core` integration-test perimeter is red after `ChartConfig` API drift

**Evidence**

- `ChartConfig` now requires `time_format`: `src/rust/rheolab-core/src/report_generator/chart_generator/common.rs:71-77`
- Several integration tests still build `ChartConfig` without that field:
  - `src/rust/rheolab-core/tests/axis_mode_test.rs:268-290`
  - `src/rust/rheolab-core/tests/axis_mode_test.rs:315-337`
  - `src/rust/rheolab-core/tests/axis_mode_test.rs:430-438`
  - `src/rust/rheolab-core/tests/report_regression_test.rs:359-372`

**Observed failure**

`cargo test --manifest-path src/rust/rheolab-core/Cargo.toml touch_point -- --nocapture` does not reach the selected tests because unrelated integration tests fail to compile with:

`missing field 'time_format' in initializer of 'ChartConfig'`

**Why it matters**

Core unit tests for touch-point and Grace are green, but the broader calculation/report-generation perimeter is not continuously verifiable. For a kaizen workflow this is a real break in the “change -> validate -> trust” loop.

**Recommendation**

- Update all `ChartConfig` initializers in integration tests.
- Prefer a test helper / builder for `ChartConfig` so future field additions do not break unrelated suites.
- Add this suite back to mandatory green gates before calling the calculation perimeter healthy.

---

### [MEDIUM] 2. Touch-point precompute failures can silently degrade library filtering instead of surfacing a repair-needed state

**Evidence**

- Save path logs and continues on precompute failure:
  - `src-tauri/src/db/repositories/experiments/write.rs:196-210`
- Backfill path converts row-level errors into empty “computed” state:
  - `src-tauri/src/db/touch_point_precompute.rs:469-474`
- Error source includes columnar decode failure:
  - `src-tauri/src/db/touch_point_precompute.rs:497-513`

**Why it matters**

If `ExperimentData` is malformed or decoding fails, the system prefers availability over correctness and can persist an empty / `has_crossing = false` result. That avoids infinite retries, but it also makes the library filter look “clean” while derived touch-point data is actually degraded.

**Recommendation**

- Distinguish `empty_because_no_signal` from `empty_because_precompute_failed`.
- Store an explicit failure marker or error code, not a normal empty value.
- Let the UI/admin diagnostics surface “needs recompute / corrupt blob” rows.

---

### [MEDIUM] 3. Read paths suppress malformed JSON / blob decode and fall back to empty data, which can hide DB corruption

**Evidence**

- Single-read path:
  - `src-tauri/src/db/repositories/experiments/read.rs:54-64`
  - `src-tauri/src/db/repositories/experiments/read.rs:118-131`
- Batch-read path:
  - `src-tauri/src/db/repositories/experiments/read.rs:248-256`
  - `src-tauri/src/db/repositories/experiments/read.rs:333-339`

**Why it matters**

`metrics`, `rawPoints`, and columnar blobs are often decoded with `unwrap_or_default`, `.ok()`, or silent fallback. This is resilient, but it also means a corrupted experiment can render as “empty but valid-looking” instead of generating a visible integrity signal.

**Recommendation**

- Keep soft-fallbacks for UI resilience, but emit structured diagnostics.
- Consider returning a `dataIntegrity` flag with loaded experiments.
- Add a targeted integrity check that compares `ExperimentData.pointCount` with decoded rows and reports mismatches.

---

### [MEDIUM] 4. Calculation logic is strong, but part of the numerical / behavioral contract is duplicated across Rust and TypeScript fallbacks

**Evidence**

- Duplicate linear regression helpers:
  - `src/rust/rheolab-core/src/grace.rs:65-140`
  - `src/rust/rheolab-core/src/physics.rs:117-179`
- TS fallback explicitly lacks some WASM-only behavior:
  - `src/lib/analysis/cycle-detector.ts:35-45`

**Why it matters**

This is not a confirmed math bug today. The immediate risk is drift: future fixes can land in one path but not another, which is the opposite of kaizen’s “standardize the improved process” principle.

**Recommendation**

- Consolidate shared numeric helpers where possible.
- Document which behaviors are intentionally WASM-only vs acceptable fallback degradation.
- Add parity tests for any logic that must match across TS and Rust.

## Strong Signals

### Database

- Pool tuning is thoughtful and clearly motivated: WAL, FK enforcement, busy timeout, mmap, cache, and higher pool size for concurrent IPC.  
  Evidence: `src-tauri/src/db/pool.rs:15-53`
- Migration runner is disciplined: schema versioning, downgrade detection, per-migration transactions, idempotent upsert into `schema_meta`.  
  Evidence: `src-tauri/src/db/migration.rs:21-159`
- Multi-threshold touch-point schema is a good design choice: side table instead of 32 extra columns, with partial indexes and explicit back-compat story.  
  Evidence: `src-tauri/src/db/migrations/v0003_multi_threshold_touch_point.rs:1-36`, `58-124`
- Slow-path library filtering explicitly releases the DB connection before CPU-heavy recomputation, which is exactly the kind of practical concurrency fix you want in a desktop app.  
  Evidence: `src-tauri/src/commands/experiments/list/dynamic.rs:47-64`
- Migration coverage is excellent.  
  Verified by `cargo test --manifest-path src-tauri/Cargo.toml db::migration -- --nocapture` → **29 passed**

### Calculations

- Grace code is readable, formula-backed, and unit-tested.  
  Evidence: `src/rust/rheolab-core/src/grace.rs:91-185`
- Touch-point code shows healthy bug-history discipline: explicit comments for bug fixes, non-finite sanitization, shear-rate clustering, snap behavior around jumps.  
  Evidence:
  - `src/rust/rheolab-core/src/report_generator/touch_point/algorithm.rs:46-50`, `81-93`, `185-297`
  - `src/rust/rheolab-core/src/report_generator/touch_point/helpers.rs:49-101`, `170`
- Touch-point regression tests are strong and realistic:
  - bug-specific unit tests in core: `src/rust/rheolab-core/src/report_generator/touch_point/tests.rs:180-255`
  - real-fixture / fast-vs-slow / combat tests in Tauri list layer:
    `src-tauri/src/commands/experiments/list/list_tests.rs:732-1015`

### Kaizen / Continuous Improvement

- Audit artifacts are intentionally preserved in `runtime/audit/<run-id>/`.  
  Evidence: `docs/audit/README.md:11-39`
- Refactor plan is metrics-driven and staged with DoD/checklists.  
  Evidence: `docs/REFACTORING_DEEP_PLAN.md:28`, `76-111`, `605-630`, `772-793`
- Metrics delta reporting is real, not ceremonial.  
  Evidence: `docs/audit/refactor-metrics-delta-2026-04-21.md:1-14`, `53`, `96`, `140-151`
- One of the strongest kaizen signals: the follow-up audit explicitly calls out where prior “DONE” statuses were inaccurate.  
  Evidence: `docs/audit/REFACTORING_AUDIT_2026-04-18.md:182-193`, `212`, `361-425`
- Release gate is documented as a mandatory living workflow, not an afterthought.  
  Evidence: `docs/release/RELEASE_GATE.md:1-10`, `69-71`, `124-155`

## Scorecard

- **DB layer:** `A-`
  - Mature migrations, sane pool config, good repository boundaries, strong filter-query discipline.
  - Main gap: silent fallback around corrupted / undecodable data.

- **Calculation layer:** `B+`
  - Core algorithms and regression tests are strong.
  - Main gaps: duplicated helper logic, degraded TS fallback, and a red integration-test perimeter around chart/report code.

- **Kaizen adherence:** `B`
  - Strong evidence of measurement, staged refactoring, post-audit self-correction, and baseline culture.
  - Score held back because several loops are still open in the current snapshot:
    - red `rheolab-core` integration-test compile perimeter
    - previously confirmed AI parsing regression
    - previously confirmed release-gate / lint issues from the broader audit

## Recommended Next Steps

1. Fix the `ChartConfig.time_format` compile drift in integration tests and restore a green `rheolab-core` full test run.
2. Replace “empty on precompute/read failure” with explicit degraded-state markers.
3. Add integrity diagnostics for `ExperimentData` decode mismatches and malformed JSON payloads.
4. Standardize shared numeric helpers and define parity expectations between Rust/WASM and TS fallbacks.
5. Re-run the broader enterprise gate after the focused fixes; companion report:
   `docs/audit/2026-04-23-codebase-audit.md`
