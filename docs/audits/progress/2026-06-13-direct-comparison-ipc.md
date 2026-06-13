# Agent progress report

Branch: ref/comparison-by-ids-only
Base branch: ref/ipc-policy-inventory
Commit: see PR head SHA
PR: pending
Phase: PR-G - Remove direct heavy comparison IPC from production path
Date: 2026-06-13
Agent: Codex

---

## Objective

Remove production exposure of direct comparison report payload IPC so comparison export uses the bounded by-IDs flow.

This is the fourth execution slice from `docs/audits/2026-06-13-refactoring-master-plan.md`.

---

## Changes

- Removed `reports_generate_comparison_pdf` and `reports_generate_comparison_excel` from the production Tauri command registry.
- Kept the legacy Rust direct handlers compiled only for `test` / `debug_assertions`.
- Removed production IPC policy entries for the direct comparison payload commands.
- Added IPC policy tests proving:
  - direct comparison payload commands are absent from the production registry;
  - by-IDs comparison export commands remain registered and license-marked;
  - by-IDs commands still return binary responses.
- Removed frontend bridge/client methods for direct comparison payload export.
- Removed `src/lib/reports/comparison-direct-export.ts` and its tests.
- Updated comparison report export hook to use by-IDs only.
- Added a UI guard for file-backed local experiments: comparison export now asks the user to save local files to the library before exporting.

---

## Files changed

- `src-tauri/src/startup/commands_registry.rs`
- `src-tauri/src/commands/reports.rs`
- `src-tauri/src/ipc_policy.rs`
- `src/components/comparison/reports/hooks/useComparisonReportExport.ts`
- `src/lib/reports/client.ts`
- `src/lib/reports/comparison-direct-export.ts`
- `src/lib/tauri/reports.ts`
- `src/lib/tauri/bridge/index.ts`
- `src/types/tauri.d.ts`
- `tests/reports/client.test.ts`
- `tests/reports/comparison-direct-export.test.ts`
- `tests/reports/useComparisonReportExport.test.ts`
- `docs/audits/progress/2026-06-13-direct-comparison-ipc.md`

---

## Behavior changes

- Persisted comparison reports use `reports_generate_comparison_pdf_by_ids` / `reports_generate_comparison_excel_by_ids`.
- Production frontend no longer calls `reports_generate_comparison_pdf` / `reports_generate_comparison_excel`.
- Production registry no longer exposes direct comparison payload commands.
- If a comparison selection contains a local `file-*` experiment, export fails before IPC with a user-facing instruction to save local files to the library first.

---

## Commands run

| Command | Exit code | Notes |
|---|---:|---|
| `npm run typecheck` | 0 | `tsc --noEmit` passed. |
| `npm run lint` | 0 | ESLint passed. |
| `npm run test -- tests/reports/client.test.ts tests/reports/useComparisonReportExport.test.ts` | 0 | 32 Vitest tests passed. The deleted direct-export test file is intentionally not part of the command. |
| `cargo fmt --manifest-path src-tauri\Cargo.toml --check` | 0 | Rust formatting check passed. |
| `cargo test --manifest-path src-tauri\Cargo.toml ipc_policy -- --test-threads=1` | 0 | 11 IPC policy tests passed. |
| `cargo test --manifest-path src-tauri\Cargo.toml reports -- --test-threads=1` | 0 | 55 passed, 1 ignored. |
| `cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets --all-features -- -D warnings` | 0 | Passed. |
| `npm run audit:large-ipc` | 0 | Static large IPC audit passed. |

---

## Test failures / deviations

- No new test failures.
- Full `cargo test` was not repeated in this slice; PR-E ran the full top-of-stack Rust suite, and PR-G ran the focused report/policy tests plus clippy.
- The full dynamic `npm run audit:frontend-ipc` workflow was not run because it launches the long Tauri/WebView profiling path.

---

## Security and performance notes

- The large comparison report payload can no longer be invoked through production IPC.
- The frontend no longer builds full comparison payloads for export.
- by-IDs export keeps payload size bounded to experiment IDs plus settings and lets Rust load data from SQLite.

---

## Risk assessment

Medium. This intentionally changes UX for local, unsaved `file-*` comparison experiments: they must be saved before report export. Persisted experiment comparison export remains covered by Rust and frontend tests.

---

## Rollback plan

Revert:

- registry removal of `reports_generate_comparison_pdf` / `reports_generate_comparison_excel`;
- frontend bridge/client removal of direct comparison methods;
- hook change that blocks file-backed selections;
- deletion of `comparison-direct-export.ts` and its test;
- IPC policy test/metadata changes in this slice.

That restores the legacy direct comparison payload IPC path.

---

## Reviewer questions

- Is the new local-file export message acceptable UX, or should a follow-up add a guided "save selected local files, then export" flow?
