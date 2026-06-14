# Tauri E2E Cleanup Hardening

Date: 2026-06-14
Work item: W1-04
Plan label: `test/tauri-e2e-cleanup-hardening`
Branch: `test/tauri-e2e-cleanup-hardening`
Implementation commit: `0ddca619e5bcdc3d5e9a5982e5851e40bef965db`
GitHub PR: `#17` - https://github.com/lunin02118-ops/rheolab/pull/17
Base: `main`

## Purpose

Reduce Windows EPERM/EBUSY/ENOTEMPTY cleanup noise after Tauri E2E runs and
lower flake risk around WebView2, SQLite sidecars, and startup failures.

## Scope

Files changed:

- `scripts/test/tauri-cleanup-utils.js`
- `scripts/test/tauri-e2e-setup.js`
- `scripts/test/tauri-e2e-teardown.js`
- `scripts/test/tauri-db-scale-teardown.js`
- `docs/audits/progress/tauri-e2e-cleanup.md`

No application runtime code, Tauri command code, license-server code,
dependency version, migration, or version file was changed.

## Behavior Changes

Test harness behavior only.

- Tauri/WebView2 process shutdown now uses a shared process-tree helper.
- Temporary DB and WebView2 cleanup now retries transient Windows filesystem
  errors instead of logging a single immediate failure.
- Cleanup continues even when the Tauri PID is missing or the process already
  exited.
- Failed Tauri startup now performs runner-local DB/WebView cleanup before
  rethrowing the setup error.

There is no change to 30-day trial behavior, license payload semantics,
activation, validation, offline grace handling, or signed license data.

## Investigation

Observed pre-change risks:

- `tauri-e2e-teardown.js` returned early when PID was missing, skipping DB and
  WebView2 cleanup even though side-channel path files could still exist.
- SQLite sidecars were deleted with direct `unlinkSync`, with no retry/backoff
  for `EPERM`, `EBUSY`, or delayed handle release.
- WebView2 UserData cleanup had `fs.rmSync(..., maxRetries)`, but DB cleanup and
  marker-file cleanup did not share the same transient-error policy.
- `tauri-e2e-setup.js` killed only the direct child on CDP startup failure and
  did not proactively remove runner-local temp DB/WebView artifacts.

## Validation

| Command | Result | Notes |
|---|---|---|
| `node --check scripts/test/tauri-cleanup-utils.js` | PASS | Syntax check passed. |
| `node --check scripts/test/tauri-e2e-setup.js` | PASS | Syntax check passed. |
| `node --check scripts/test/tauri-e2e-teardown.js` | PASS | Syntax check passed. |
| `node --check scripts/test/tauri-db-scale-teardown.js` | PASS | Syntax check passed. |
| `git diff --check` | PASS | No whitespace errors. |
| hidden/bidi scan | PASS | No hidden/bidi Unicode found in changed files. |
| `npx playwright test --config playwright.tauri.config.ts tests/e2e/multi-fixture-perf.tauri.spec.ts` | PASS | `1 passed`; teardown stopped sampler/Tauri and removed isolated DB/WebView2 directory without EPERM/EBUSY warnings. |
| `npx playwright test --workers=1 tests/e2e/reports/reports-export.spec.ts` | PASS | `8 passed`. |
| `npm run audit:frontend-ipc -- --windows-runner` | PASS | Full audit completed with gate status PASS; generated performance artifacts were not committed. |

## Risks

- Tauri E2E commands are long-running and may expose unrelated environment
  issues.
- Cleanup retries intentionally classify transient file-handle cleanup failures
  as non-blocking after retry exhaustion. This preserves test result signal
  while keeping the warning visible.

## Rollback

Revert this PR. It only changes test/audit harness cleanup behavior and this
progress note.
