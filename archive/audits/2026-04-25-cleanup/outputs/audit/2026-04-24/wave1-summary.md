## Wave 1 Audit Summary — 2026-04-24

### Baseline

- `npm run build` — passed
- `cargo check --manifest-path src-tauri/Cargo.toml` — passed
- `cargo test --manifest-path src-tauri/Cargo.toml --lib check_local_startup -- --nocapture` — passed
- `cargo test --manifest-path src-tauri/Cargo.toml --no-run` — passed
- `cargo test --manifest-path src-tauri/Cargo.toml commands::backup::restore::merge_tests -- --nocapture` — passed (`20 passed`)
- `cargo test --manifest-path src-tauri/Cargo.toml import_experiments_blocking -- --nocapture` — passed (`3 passed`)
- `npx vitest run tests/store/license-store.test.ts` — passed
- `npx vitest run tests/reports/client.test.ts` — passed
- `npm run test:parsing` — passed
- `npm run audit:bundle` — passed after replacing `cross-env` with a Node runner
- `npm audit --omit=dev` — passed (`0 vulnerabilities`)
- `cargo audit` — passed

### DB Seed Status

- `outputs/seed/rheolab-fixture-seed-small.db` — created, ~1.1 MB
- `outputs/seed/rheolab-fixture-seed.db` — created, ~84.3 MB on verify output / ~97-101 MB on disk with WAL growth
- `python scripts/dev/verify-seed-db.py outputs/seed/rheolab-fixture-seed.db`
  - `PRAGMA user_version = 3`
  - `schema_meta = (3, fixture-seed-0.1.0)`
  - `Experiments = 1764`
  - passed after updating the script to schema version `3` and ASCII output

### Findings

#### P1 — Rust test build was broken, now fixed in current tree

- Initial failure: [src-tauri/src/commands/reports.rs](../../../src-tauri/src/commands/reports.rs) test fixture initialized `SectionToggles` without the new mandatory `show_rheology` field.
- Compiler error was:
  - `missing field 'show_rheology' in initializer of 'SectionToggles'`
- Related type:
  - [src/rust/rheolab-core/src/report_generator/comparison/types.rs](../../../src/rust/rheolab-core/src/report_generator/comparison/types.rs)
- Current status:
  - the fixture now includes `show_rheology: true`
  - `cargo test --manifest-path src-tauri/Cargo.toml --no-run` passes

#### P1 — DB-scale perf harness is blocked on this machine by Tauri/WebView2 startup failure

- `perf:db:small` did not reach performance measurement.
- Repro:
  - run Playwright db-scale test after seed generation
- Observed failures:
  - first run with `TAURI_E2E_SKIP_BUILD=1`: test timed out in `beforeEach`, page snapshot showed `ERR_CONNECTION_REFUSED` for localhost
  - second run with rebuild enabled: Tauri startup logged:
    - `failed to create webview: WebView2 error: WindowsError(Error { code: HRESULT(0x8007139F), ... })`
    - db-scale setup then failed waiting for CDP on port `9223`
- Impact:
  - `perf:db:small` / `perf:db:large` are currently not usable as automated perf sources on this machine

#### P2 — `verify-seed-db.py` was out of date and not Windows-safe, now fixed

- [scripts/dev/verify-seed-db.py](../../../scripts/dev/verify-seed-db.py) now asserts schema version `3`.
- Unicode arrow output was replaced with ASCII `->`.
- Current status:
  - `python scripts/dev/verify-seed-db.py outputs/seed/rheolab-fixture-seed.db` passes

#### P2 — `npm run audit:bundle` was broken on this repo snapshot, now fixed

- Previous failure: [package.json](../../../package.json) defined `audit:bundle` as `cross-env ANALYZE=true vite build --mode production`.
- `npm ls cross-env --depth=0` reported an empty tree, and `npm run audit:bundle` failed with:
  - `'cross-env' is not recognized as an internal or external command`
- Current fix:
  - [scripts/test/run-bundle-audit.js](../../../scripts/test/run-bundle-audit.js) sets `ANALYZE=true` and calls Vite's JS `build()` API.
- Current status:
  - `npm run audit:bundle` passes
  - build succeeds
  - largest chunks remain `main` (~273.5 kB), `page-*` (~141.0 kB / ~105.3 kB), `vendor-radix` (~115.5 kB), `vendor-charts` (~52.5 kB), `DashboardContent` (~48.5 kB)

#### P2 — `backup_import_db` temp cleanup was not fail-safe on every error path, now fixed

- [src-tauri/src/commands/backup/restore.rs](../../../src-tauri/src/commands/backup/restore.rs) now uses `TempDirGuard` to remove `_import_temp` on every exit path from the blocking import operation.
- [src-tauri/src/commands/backup/restore_tests.rs](../../../src-tauri/src/commands/backup/restore_tests.rs) includes a focused unit test for guard cleanup.
- Current status:
  - `cargo test --manifest-path src-tauri/Cargo.toml commands::backup::restore::merge_tests -- --nocapture` passes

#### P2 — Command-level import/backup coverage is still incomplete

- `experiments_import` DB/import logic now has focused helper coverage for:
  - valid payload import
  - duplicate skip inside one batch
  - invalid payload reporting without insert
- `backup_import_db` now has merge internals coverage and a `TempDirGuard` cleanup test.
- Remaining gap:
  - full Tauri command-wrapper tests for `experiments_import` license gate and `backup_import_db` end-to-end command surfaces still need a Tauri state/app harness.

### Useful Coverage Already Present

- `commands::backup::restore::merge_tests::*`
- `commands::experiments::sync::tests::*`
- `db::migration::tests::*`
- `commands::licensing::engine::tests::check_local_startup_*`
- `db::touch_point_precompute::tests::*`
- `tests/store/license-store.test.ts`
- `tests/reports/client.test.ts`
- `tests/parsing/*`

### Recommended Next Steps

1. Treat WebView2/CDP startup as a separate harness/environment blocker before trusting db-scale perf automation.
2. Add a reusable Tauri command test harness for full `State<'_, AppState>` command-wrapper tests.
3. Continue Wave 2 with frontend memory/stress audit and parser malformed-fixture coverage.
