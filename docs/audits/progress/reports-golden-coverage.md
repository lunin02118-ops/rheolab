# Reports Golden Coverage

Date: 2026-06-15
Work item: W4-05 `test/reports-golden-coverage`
Branch: `test/reports-golden-coverage`

## Scope

Added golden-style regression coverage for reports without changing runtime
behavior.

Files changed:

- `src-tauri/src/commands/reports.rs`
- `src/rust/rheolab-core/src/report_generator/pdf/template/tests.rs`
- `docs/audits/progress/reports-golden-coverage.md`

Coverage added:

- single-report Excel workbook sheet order and expected section text;
- comparison by-IDs Excel workbook shape and debug metadata;
- PDF Typst template metadata rendering into header and test passport source;
- Typst renderer rejection of unregistered local file reads;
- expected validation errors for recipe overrides, water overrides, and invalid
  report language.

## Non-Scope

- No runtime report renderer behavior changes.
- No Tauri IPC command registration changes.
- No report cache, temp-file, artifact naming, or cleanup policy changes.
- No dependency, version, migration, CI, package, or Tauri config changes.
- No license, demo, trial, activation, signed payload, or `license-server/**`
  changes.

## Behavior Changes

None. Test coverage only.

## Validation

| Command | Result | Notes |
|---|---|---|
| `npm run version:validate` | PASS | SSoT version lockstep is intact. |
| `git diff --check` | PASS | No whitespace errors. |
| `cargo test --manifest-path src-tauri/Cargo.toml reports -- --test-threads=1` | PASS | `61 passed`, `1 ignored`; includes new reports golden/error guard tests. |
| `cargo test -q --manifest-path src/rust/rheolab-core/Cargo.toml --features full pdf_template_renders_report_metadata_into_header_and_passport -- --test-threads=1` | PASS | PDF template metadata guard passed. |
| `cargo check --manifest-path src-tauri/Cargo.toml --all-targets --all-features` | PASS | Rust dev check passed. |
| `cargo check --release --manifest-path src-tauri/Cargo.toml` | PASS | Rust release check passed. |
| `npm run audit:large-ipc` | PASS | No large-IPC contract violations. |
| `npm run test:release-gate` | PASS | `1 passed`; 7 exports; heap growth `+5.92 MB` against `20 MB` budget. |
| `npx playwright test --workers=1 tests/e2e/reports/reports-export.spec.ts` | PASS | `8 passed`. |
| `npm run typecheck` | PASS | TypeScript compile check passed. |

## Risks

- Golden-style workbook assertions are intentionally stricter than basic smoke
  tests. Future intentional report layout/text changes may need coordinated test
  updates.

## Rollback

Revert this PR. It only changes test coverage and this progress note.
