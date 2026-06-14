# Rust Unused Functions Cleanup

Date: 2026-06-14
Work item: W1-05
Plan label: `chore/rust-unused-functions-cleanup`
Branch: `chore/rust-unused-functions-cleanup`
GitHub PR: TBD
Base: `main`

## Purpose

Remove the two known Rust unused-function warnings from release checks without
changing runtime behavior.

## Scope

Files changed:

- `src-tauri/src/commands/reports.rs`
- `docs/audits/progress/rust-unused-functions-cleanup.md`

No frontend code, license-server code, dependency version, migration, or version
file was changed.

## Behavior Changes

None intended.

The two helpers remain available for test/debug builds where the legacy
direct-input comparison commands and regression tests compile:

- `validate_comparison_direct_input`
- `validate_core_comparison_chart`

They are cfg-gated with `#[cfg(any(test, debug_assertions))]` because the
production release path no longer compiles the debug-only direct-input
comparison commands. Production comparison report export uses the by-ids path.

There is no change to 30-day trial behavior, license payload semantics,
activation, validation, offline grace handling, or signed license data.

## Validation

| Command | Result | Notes |
|---|---|---|
| `cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | PASS | No warnings. |
| `cargo check --release --manifest-path src-tauri/Cargo.toml` | PASS | The two previous unused-function warnings are gone. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS | No warnings. |
| `git diff --check` | PASS | No whitespace errors. |
| hidden/bidi scan | PASS | No hidden/bidi Unicode found in changed files. |

## Rollback

Revert this PR. It only changes cfg visibility for debug/test-only validation
helpers and this progress note.
