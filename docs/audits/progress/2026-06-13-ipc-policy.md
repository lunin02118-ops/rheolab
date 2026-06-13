# Agent progress report

Branch: ref/ipc-policy-inventory
Base branch: ref/error-boundary-redacted-logging
Commit: see PR head SHA
PR: pending
Phase: PR-F - IPC policy inventory and high-risk command metadata
Date: 2026-06-13
Agent: Codex

---

## Objective

Make the Tauri IPC surface auditable by adding static policy metadata for every
registered command, without changing runtime command behavior.

This is the third execution slice from `docs/audits/2026-06-13-refactoring-master-plan.md`.

---

## Changes

- Added `src-tauri/src/ipc_policy.rs` as a read-only policy inventory module.
- Registered the module from `src-tauri/src/lib.rs`.
- Added policy types for:
  - command risk: `Low`, `Medium`, `High`;
  - payload class: `Tiny`, `Small`, `Medium`, `LargeBinaryByDesign`, `ProhibitedLargeJson`;
  - command capabilities: external network, file read/write, DB read/write, binary response;
  - command metadata: license requirement, audit-log requirement, demo allowance.
- Added an explicit `IPC_COMMAND_POLICIES` table for the current command registry.
- Added `policy_for_command(...)` lookup helper.
- Added tests that parse `startup/commands_registry.rs` and enforce policy coverage.

---

## Files changed

- `src-tauri/src/ipc_policy.rs`
- `src-tauri/src/lib.rs`
- `docs/audits/progress/2026-06-13-ipc-policy.md`

---

## Behavior changes

- Runtime IPC behavior is intentionally unchanged.
- No commands were added, removed, renamed, or gated.
- The new metadata is compile-time/static inventory only; later slices can use it for enforcement, review checks, or generated docs.

---

## Policy checks added

- Every registered command has exactly one policy entry.
- No policy entry exists for a non-registered command.
- Policy names are unique.
- Every high-risk command requires an audit log or an explicit exception.
- File-write commands are not classified as low risk.
- Known external-network commands are marked.
- Known file-write commands are marked.
- `LargeBinaryByDesign` commands are marked as returning binary responses.
- `requires_license` does not imply demo denial; demo denial is explicit policy metadata.
- Current direct comparison payload commands remain inventoried only and are marked as `ProhibitedLargeJson`.

---

## Commands run

| Command | Exit code | Notes |
|---|---:|---|
| `cargo fmt --manifest-path src-tauri\Cargo.toml --check` | 0 | Rust formatting check passed after formatting the new module. |
| `cargo test --manifest-path src-tauri\Cargo.toml ipc_policy -- --test-threads=1` | 0 | 11 IPC policy tests passed. |
| `cargo check --manifest-path src-tauri\Cargo.toml --all-targets --all-features` | 0 | Passed. |
| `cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets --all-features -- -D warnings` | 0 | Passed. |
| `npm run audit:large-ipc` | 0 | Static large IPC audit passed. |
| `npm run typecheck` | 0 | `tsc --noEmit` passed. |
| `npm run version:validate` | 0 | Version SSoT validation passed. |

---

## Test failures / deviations

- No new test failures.
- Full `cargo test` was not repeated in this slice; PR-E ran the full top-of-stack Rust suite, and PR-F ran the focused `ipc_policy` coverage tests plus `check`/`clippy`.
- The full dynamic `npm run audit:frontend-ipc` path was not run in this slice because it launches the long Tauri/WebView profiling workflow.
- Policy metadata is based on current source review and registry coverage tests. It does not prove that every command already performs the declared license, audit, or path-validation behavior at runtime.

---

## Security notes

- High-risk commands are now visible in one static table.
- External-network and file-write commands have explicit policy markers.
- This prepares the repo for future automated enforcement, but does not enforce new authorization or capability checks yet.

---

## Performance notes

- No runtime path changed.
- The added tests are lightweight source/metadata checks.

---

## Risk assessment

Low. The only compiled runtime change is exposing a new module; command handlers and registry behavior are unchanged. The main review risk is policy classification accuracy, which is now centralized and test-covered for coverage invariants.

---

## Rollback plan

Revert:

- `src-tauri/src/ipc_policy.rs`
- the `pub mod ipc_policy;` line in `src-tauri/src/lib.rs`
- `docs/audits/progress/2026-06-13-ipc-policy.md`

This removes the policy inventory and its tests without affecting command behavior.

---

## Reviewer questions

- Should the next slice generate a human-readable high-risk IPC report from `IPC_COMMAND_POLICIES`, or should PR-004 immediately use the metadata to guide removal/gating of heavy comparison IPC?
