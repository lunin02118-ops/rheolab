# IPC Policy Enforcement Phase 1

Date: 2026-06-14
Work item: W3-03 `ref/ipc-policy-enforcement-phase-1`

## Scope

This slice turns the existing IPC policy inventory into a startup-enforced
static guardrail.

Enforced:

- every registered production Tauri command must have policy metadata;
- policy metadata must not name commands outside the production registry;
- policy command names must be unique;
- high-risk commands must carry audit metadata or an explicit exception;
- file read/write commands cannot be low risk without an explicit rationale;
- reviewed external-network commands must stay tagged and allowlisted;
- large binary payload commands must return binary IPC responses;
- `ProhibitedLargeJson` commands must have an explicit exception.

## Non-Scope

- No runtime license denial.
- No runtime demo denial.
- No trial-window changes.
- No RBAC enforcement.
- No `license-server/**` changes.
- No command registration changes.
- No dependency, version, or migration changes.

## Trial Safety

This PR does not modify activation, offline activation, license validation,
`GRACE_PERIOD_DAYS`, license payload fields, demo semantics, or the 30-day
trial path. Enforcement fails only for developer-side IPC policy metadata
inconsistency.

## Validation

Required:

```bash
cargo test --manifest-path src-tauri/Cargo.toml ipc_policy -- --test-threads=1
npm run audit:large-ipc
cargo check --release --manifest-path src-tauri/Cargo.toml
```

Recommended:

```bash
cargo test --manifest-path src-tauri/Cargo.toml external -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml command_boundary -- --nocapture
git diff --check
```

## Rollback

Revert this PR.
