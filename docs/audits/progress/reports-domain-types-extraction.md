# Reports Domain Types Extraction

Date: 2026-06-14
Work item: W4-01 `ref/reports-domain-types-extraction`

## Scope

Mechanical extraction of report request/settings/output domain types from
`src-tauri/src/commands/reports.rs` into:

- `src-tauri/src/reports/domain/types.rs`
- `src-tauri/src/reports/domain/options.rs`

The old `crate::commands::reports::*` path keeps re-exporting the moved public
types so command signatures, Specta bindings, frontend imports, and existing
tests retain the same contract.

## Non-Scope

- No report renderer extraction.
- No by-IDs behavior changes.
- No report cache/temp-file policy changes.
- No command registration changes.
- No license, demo, trial, or `license-server/**` changes.
- No dependency, version, migration, IPC policy, or Tauri config changes.

## Validation

Required:

```bash
cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features
cargo test --manifest-path src-tauri/Cargo.toml reports -- --test-threads=1
npm run typecheck
```

Recommended:

```bash
npm run audit:large-ipc
cargo check --release --manifest-path src-tauri/Cargo.toml
git diff --check
```

## Rollback

Revert this PR.
