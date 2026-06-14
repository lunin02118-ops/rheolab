# Reports Renderers Extraction

Date: 2026-06-15
Work item: W4-02 `ref/reports-renderers-extraction`

## Scope

Mechanical extraction of the Tauri-side report renderer boundary from
`src-tauri/src/commands/reports.rs` into:

- `src-tauri/src/reports/render/pdf.rs`
- `src-tauri/src/reports/render/excel.rs`
- `src-tauri/src/reports/render/typst.rs`

The command module keeps orchestration, feature gates, job progress, cache
lookup/write policy, and by-ID/by-IDs use-case construction. The render modules
only wrap the existing `rheolab_core::report_generator` calls and preserve the
existing error messages.

## Non-Scope

- No by-IDs behavior changes.
- No report cache/temp-file policy changes.
- No command registration changes.
- No report use-case extraction.
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
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
git diff --check
```

## Rollback

Revert this PR.
