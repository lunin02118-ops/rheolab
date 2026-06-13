# Agent progress report

Branch: ref/error-boundary-redacted-logging
Base branch: chore/rust-clippy-clean-baseline
Commit: see PR head SHA
PR: pending
Phase: PR-E - Clean error serialization and IPC error boundary helper
Date: 2026-06-13
Agent: Codex

---

## Objective

Move `AppError` logging out of serde serialization and make the IPC error logging path use
redacted, user-safe fields.

This is the second execution slice from `docs/audits/2026-06-13-refactoring-master-plan.md`.

---

## Changes

- Removed the `tracing::error!` side effect from `impl Serialize for AppError`.
- Made `AppError::kind_str()` and `AppError::safe_message()` public safe APIs.
- Added `ipc_error_log_fields(...)` and `log_ipc_error(...)` helpers.
- Added tests proving:
  - error serialization still returns `{kind, message}`;
  - infrastructure errors do not expose raw paths/details in IPC responses;
  - log fields use `safe_message`, not `Display`/raw internals;
  - serialization emits no tracing events;
  - explicit `log_ipc_error` emits a tracing event.

---

## Files changed

- `src-tauri/src/error.rs`
- `docs/audits/progress/2026-06-13-error-boundary.md`

---

## Behavior changes

- IPC error response contract remains `{kind, message}`.
- Serialization is now side-effect free.
- Automatic logging from serialization is intentionally removed.
- A redacted IPC logging helper now exists, but the repository does not yet have a common Tauri invoke-wrapper to apply it globally without a larger command rewrite.

---

## Commands run

| Command | Exit code | Notes |
|---|---:|---|
| `cargo fmt --manifest-path src-tauri\Cargo.toml --check` | 0 | Rust formatting check passed. |
| `cargo test --manifest-path src-tauri\Cargo.toml error -- --test-threads=1` | 0 | Error-focused tests passed: 9 relevant `error` tests plus matching filtered tests. |
| `cargo check --manifest-path src-tauri\Cargo.toml --all-targets --all-features` | 0 | Passed. |
| `cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets --all-features -- -D warnings` | 0 | Passed. |
| `cargo test --manifest-path src-tauri\Cargo.toml -- --test-threads=1` | 0 | Passed: 499 lib tests, 30 `ai_parsing`, 12 `db_integrity`, 10 `ipc_contracts`, doc-test ignored. |
| `npm run typecheck` | 0 | `tsc --noEmit` passed. |

---

## Test failures / deviations

- No new failures.
- No common IPC invoke-wrapper exists today, so this slice does not mass-wrap every command. That should be addressed with PR-003/IPC policy work or a dedicated follow-up wrapper slice.

---

## Security notes

- `AppError::Serialize` no longer logs raw error internals.
- Infrastructure error messages remain redacted for IPC responses and log helper fields.
- Domain errors (`BadRequest`, `License`, `Parse`) still pass through intentionally user-visible messages.

---

## Performance notes

- No performance-sensitive runtime path changed.

---

## Risk assessment

Low to medium. Frontend IPC response shape is unchanged, but implicit error logging from serialization is removed. Call sites that need command-context logging should use `log_ipc_error` or a future common IPC wrapper.

---

## Rollback plan

Revert:

- `src-tauri/src/error.rs`
- `docs/audits/progress/2026-06-13-error-boundary.md`

This restores serialization-time logging and removes the helper/tests.

---

## Reviewer questions

- Should PR-003 introduce a common command wrapper so `log_ipc_error` is applied uniformly at the IPC boundary?
