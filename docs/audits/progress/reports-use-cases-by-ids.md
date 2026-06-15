# Reports Use Cases By IDs

Date: 2026-06-15
Work item: W4-03 `ref/reports-use-cases-by-ids`

## Scope

Extracted report application use-case orchestration from
`src-tauri/src/commands/reports.rs` into:

- `src-tauri/src/reports/application/comparison.rs`
- `src-tauri/src/reports/application/generate_by_ids.rs`
- `src-tauri/src/reports/application/generate_single.rs`

The Tauri command module still owns IPC entrypoints, license/demo/trial gates,
feature validation, debug-only mocked report bytes, and scheduler invocation.
The application layer now owns by-ID/by-IDs input construction, cache-aware
comparison loading, analysis artifact cache resolution, and renderer handoff.

## Non-Scope

- No by-IDs behavior changes.
- No report cache/temp-file policy changes.
- No renderer behavior changes.
- No command registration changes.
- No license, demo, trial, or `license-server/**` changes.
- No dependency, version, migration, IPC policy, or Tauri config changes.
- Direct heavy comparison payload commands remain absent from production builds;
  they are still gated behind `#[cfg(any(test, debug_assertions))]`.

## Validation

Required:

```bash
cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo test --manifest-path src-tauri/Cargo.toml reports -- --test-threads=1
npm run audit:large-ipc
npm run test:release-gate
```

Recommended:

```bash
npm run typecheck
cargo check --release --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npm run version:validate
git diff --check
```

## Rollback

Revert this PR.
