# Reports Artifacts Temp Cache Cleanup

Date: 2026-06-15
Work item: W4-04 `ref/reports-artifacts-temp-cache`
Branch: `ref/reports-artifacts-temp-cache`

## Scope

Stabilized Playwright report download artifact cleanup for report export E2E
coverage.

Files changed:

- `tests/e2e/report-download-cleanup.ts`
- `tests/e2e/pages/reports.page.ts`
- `tests/e2e/pages/comparison-reports.page.ts`
- `tests/e2e/reports/comparison-workflow-release-gate.tauri.spec.ts`
- `tests/e2e/reports/comparison-report.tauri.spec.ts`
- `tests/e2e/reports/real-native-export.tauri.spec.ts`
- `tests/e2e/saved-report-by-id-smoke.tauri.spec.ts`
- `docs/audits/progress/reports-artifacts-temp-cache.md`

## Non-Scope

- No runtime report renderer changes.
- No Tauri IPC command changes.
- No report cache key or analysis artifact cache behavior changes.
- No dependency, version, migration, CI, package, or Tauri config changes.
- No license, demo, trial, activation, signed payload, or `license-server/**`
  changes.

## Behavior Changes

Test harness behavior only.

- Report download bytes are read through one shared E2E helper.
- Download temp files are deleted after validation in `finally` blocks, so cleanup
  still runs when assertions fail.
- Cleanup retries transient Windows filesystem errors:
  `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, and `EPERM`.
- Cleanup first asks Playwright to delete the download, then falls back to
  `fs.rmSync(..., { force: true })` for the known download path.
- If the download file still exists after retry exhaustion, the test fails
  instead of hiding leftover temp artifacts.

## Validation

| Command | Result | Notes |
|---|---|---|
| `npm run typecheck` | PASS | TypeScript compile check passed. |
| `npm run version:validate` | PASS | SSoT version lockstep is intact. |
| `git diff --check` | PASS | No whitespace errors. |
| `npx playwright test --workers=1 tests/e2e/reports/reports-export.spec.ts` | PASS | `8 passed`; browser report export downloads cleaned through shared helper. |
| `npm run audit:large-ipc` | PASS | No large-IPC contract violations. |
| `cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | PASS | Rust check passed. |
| `npm run test:release-gate` | PASS | `1 passed`; 7 comparison exports; heap growth `+5.96 MB` against `20 MB` budget. |
| Temp runner path check | PASS | Release-gate isolated DB and WebView2 paths no longer existed after teardown. |

## Risks

- The helper intentionally makes leftover download files a hard test failure.
  This is stricter than the previous best-effort `download.delete().catch(...)`
  behavior and may expose real Windows file-handle issues in report E2E runs.

## Rollback

Revert this PR. It only changes E2E report download artifact cleanup and this
progress note.
