# Triage: deep audit all directions

Date: 2026-05-04
Source: `docs/audit/2026-05-04-deep-audit-all-directions.md`
Scope: status check against current repository state after alpha hardening, memory closeout, website/server maintenance work.

## Executive decision

The audit is useful and broadly accurate: RheoLab is not blocked by a broken architecture, but it still has several release-hardening debts.

The main correction: the license-server HMAC bypass item appears stale for the current server state. Update polling is routed through `api/update-channel.php`; no directly exposed release manifests were found in the checked deployment layout.

For alpha, do not start a large `reports.rs` split as the next immediate task. The first small, high-confidence hardening slice was applied on 2026-05-04:

1. Tauri filesystem scope was narrowed from whole user folders to app data plus known export/import extensions.
2. The custom busy-wait `SpinMutex` in the job scheduler was replaced with a blocking mutex wrapper.
3. Frontend store/licensing/encryption errors now route through the app logger.
4. E2E license-bypass and updater-disable flags are separated.
5. Tauri E2E rebuild detection now includes `src-tauri/capabilities` and Tauri config files so capability changes are not tested against stale binaries.

## P1 status

| Audit item | Current status | Decision | Next action |
|---|---:|---|---|
| Custom `SpinMutex` in `src-tauri/src/runtime/jobs/scheduler.rs` | Fixed 2026-05-04 | Keep | Replaced with a `std::sync::Mutex` wrapper that recovers poisoned guards and avoids CPU busy-wait. |
| `commands/reports.rs` monolith | Live, 3620 lines / 144860 bytes | Important maintainability debt, not immediate alpha blocker | Split after alpha or in a dedicated PR. Do not mix with RAM/security fixes. |
| Broad Tauri FS scope in `src-tauri/capabilities/default.json` | Narrowed 2026-05-04 | Verify in real app smoke | Removed broad `$DOWNLOADS/**`, `$TEMP/**`, `$DESKTOP/**`, `$DOCUMENT/**`; allowed app data plus `pdf/xlsx/json/db` user files and direct-save E2E export temp files. |
| License-server `.htaccess` HMAC bypass | Appears closed/stale | No app-code action | Preserve current routed update-channel model; document in server audit if needed. |

## P2 status

| Audit item | Current status | Decision | Next action |
|---|---:|---|---|
| `console.error/warn` in stores/licensing/utils | Fixed 2026-05-04 | Keep | Replaced with `logger.error/warn` in store/licensing/encryption targets from the audit. |
| Top TSX files over 20 KB | Live | Refactor selectively | Do not refactor all before alpha. Touch only if fixing a real bug. |
| `block_in_place` + `block_on` in `AppState::init_licensing` | Live | Medium-risk startup cleanup | Move to async setup/background startup check in a focused PR. |
| Manual SQL filter builder | Live | Medium priority | Type columns before adding more filters. |
| `is_e2e_mode` coupling license bypass and updater suppression | Fixed 2026-05-04 | Keep | Added `is_updater_disabled` command and `RHEOLAB_E2E_DISABLE_UPDATER`; E2E setup now sets both flags. |

## P3 status

| Audit item | Decision |
|---|---|
| `archive/` in repo | Maintenance cleanup only. |
| `runtime/` size | Local generated/cache area; keep ignored and add/keep cleanup tooling. |
| `exceljs` dev-only advisory | Update when convenient; prod audit remains more important for release. |
| `typst` / `specta` upgrades | Measure and test separately; not alpha blocker. |
| Build-time dev/prod key assertion | Good low-cost hardening candidate. |
| Central constants file | Useful maintainability cleanup after release pressure drops. |
| V8 heap ceiling | Keep as measured guard; memory track already classified Total/GPU RSS as soft runtime metrics. |
| Licensing sequence diagram | Good documentation task. |

## Recommended alpha order

1. Real-app smoke for narrowed FS flows: settings export/import, report PDF/XLSX save, batch report save, experiment DB export/import.
2. Defer `reports.rs` split until after alpha release pressure drops.
3. Consider P2 startup cleanup: replace `block_in_place`/`block_on` in `AppState::init_licensing`.
4. Full local gate before release: `npm run version:validate`, `npm run lint`, `npm run typecheck`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml`

## Verification run

2026-05-04 checks:

- `git diff --check`
- `npm run version:validate`
- `npm run typecheck`
- `npm run lint`
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- `npm run audit:large-ipc`
- `npm test -- --run tests/store/chart-settings-store.test.ts tests/store/license-store.test.ts tests/reports/report-save.test.ts tests/components/UnitSystemCard.test.tsx`
- `npm test`
- `npm run build:ci`
- `npm run tauri:build:debug`
- `npx tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json`
- `COMPARISON_SMOKE_N=1 COMPARISON_SMOKE_EXPORT_SAVE_MODE=direct npx playwright test --config playwright.tauri.config.ts tests/e2e/comparison-smoke-perf.tauri.spec.ts`

## Explicit no-go list

Do not do these as the next alpha-prep change:

- Full `reports.rs` module split mixed into security or runtime fixes.
- Broad frontend component refactors without a concrete bug.
- New Comparison memory/cache refactors: the memory track already classified remaining fifth-add RSS/GPU movement as WebView2/GPU compositor allocation, with app-owned memory bounded.
- Reopen WN/store/export RAM work without new app-owned growth evidence.
