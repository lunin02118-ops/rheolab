# RheoLab Codebase Audit - 2026-04-27

Scope: current `D:\Development\Rheolab` worktree after removing auxiliary Git worktrees. Focus areas: Tauri IPC, licensing gates, SQLite import/export, filesystem permissions, and audit hygiene.

## Executive Summary

- Validation gates were green after remediation: `npx tsc --noEmit`, `npm run lint`, `npm run test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm audit --omit=dev`, and `cargo audit`.
- `git worktree list --porcelain` now reports only one RheoLab worktree: `D:/Development/Rheolab`.
- Removed worktree state was preserved in `archive/worktree-preservation-20260427-113901.zip`.
- P1/P2 issues found in this pass were remediated: mutating/export IPC license gates, bounded delta import, backup-restore integrity validation, and removal of `$HOME/**` from the Tauri FS capability scope.
- Main residual risk: the worktree still contains many pre-existing modified/deleted/untracked files that must be committed, archived, ignored, or intentionally discarded before a release audit can be treated as final.

## Findings

### P1 - Mutating IPC commands bypass the write license gate - Remediated

Status: remediated on 2026-04-27 by adding `require_write_license(&AppState) -> Result<()>` and applying it to the uncovered write/export/destructive commands.

Original evidence:

- `src-tauri/src/commands/experiments/crud.rs:90` gates `experiments_save`, but `experiments_delete` at line 284 deletes rows at line 305 without calling `can_write_via_engine`.
- `src-tauri/src/commands/reagents/commands.rs` exposes create/update/delete/import/seed operations at lines 23, 92, 168, 261, and 371 without a license gate.
- `src-tauri/src/commands/operators/commands.rs` exposes create/update/delete at lines 59, 105, and 156 without a license gate.
- `src-tauri/src/commands/laboratories/commands.rs` exposes create/update/delete at lines 59, 106, and 159 without a license gate.
- `src-tauri/src/commands/data_flows/*.rs` exposes report artifact saves/deletes, conflict resolution, sync outbox mutation, and sync inbox receives without a license gate.
- `src-tauri/src/commands/sync_engine.rs` imports and persists experiments at lines 155, 200, and 205 and resolves conflicts with writes at lines 276, 318, and 337 without a license gate.

Impact: expired/demo/invalid license states can still mutate or delete local data through exposed Tauri commands if the renderer invokes them directly. This weakens the current `can_write_via_engine` policy because enforcement is per-command rather than centralized.

Remediation:

- Added shared helper `require_write_license`.
- Added gates to experiment deletion, reagent create/update/delete/export/import/seed, operator create/update/delete, laboratory create/update/delete, report artifact save/delete, conflict resolution, sync outbox/inbox mutations, delta sync export/import/resolve, backup create/delete/restore, and licensing reset commands.
- Existing gated commands using `can_write_via_engine` remain covered.

Follow-up: add a regression test or audit script that enumerates `register_tauri_commands!` mutators and asserts license-gate coverage.

### P1 - `sync_import_delta` accepts arbitrary path input without path/size validation - Remediated

Status: remediated on 2026-04-27.

Original evidence:

- `src-tauri/src/commands/sync_engine.rs:155` exposes `sync_import_delta`.
- It opens `file_path` directly at line 160.
- It does not call `validate_user_file_path`, does not enforce an extension or size cap, and deserializes the full JSON into memory before writing records.

Impact: a compromised renderer or unexpected UI path can request large or sensitive local files, causing memory pressure or confusing parse errors. Combined with the missing license gate, it also provides an ungated write path into experiments and conflicts.

Remediation:

- Validates the selected file path with `validate_user_file_path(file_path, true)`.
- Requires `.json`.
- Caps file size at 50 MB.
- Caps imports at 10,000 experiments.
- Moves parse/import work into `spawn_blocking`.
- Adds regression coverage for the experiment-count cap.

### P1 - Tauri filesystem capability scope is broader than the app's workflows need - Partially Remediated

Status: partially remediated on 2026-04-27 by removing `$HOME/**` from `src-tauri/capabilities/default.json`.

Original evidence:

- `src-tauri/capabilities/default.json:16` enables `fs:allow-read-file`.
- `src-tauri/capabilities/default.json:18` enables `fs:allow-write-file`.
- The scope included `$DOWNLOADS/**`, `$DESKTOP/**`, `$DOCUMENT/**`, and `$HOME/**` at lines 27-31.

Impact: if renderer execution is ever compromised, the frontend can read or write broad user-home paths via the FS plugin. The Rust parsing path has stronger path validation, but the plugin capability bypasses those Rust-side checks.

Current residual risk: the FS plugin still allows `$DOWNLOADS/**`, `$TEMP/**`, `$DESKTOP/**`, and `$DOCUMENT/**` because current frontend flows use `@tauri-apps/plugin-fs` after save/open dialogs for app settings, experiment import/export, and report saves.

Recommendation: migrate remaining frontend FS reads/writes behind native Rust commands, then narrow FS scope further to app-owned directories plus explicitly brokered user-selected paths.

### P2 - Backup restore schedules DB replacement without integrity verification - Remediated

Status: remediated on 2026-04-27.

Original evidence:

- `src-tauri/src/commands/backup/restore.rs:66` exposes `backup_restore`.
- It copies the selected backup to `pending_restore.db` at line 92 and restarts at line 99.
- Unlike `backup_create`, it does not open the selected DB read-only or run `PRAGMA integrity_check` before scheduling replacement.

Impact: a corrupt/manual backup file in the backups directory can be scheduled as the next live DB. Startup restore then swaps it before the pool opens.

Remediation:

- Opens the selected backup read-only before scheduling restore.
- Runs `PRAGMA integrity_check`.
- Verifies that the expected `Experiment` table exists.
- Adds regression tests accepting a valid RheoLab DB and rejecting a non-database file.

### P2 - Current audit runner cannot run cleanly on the present dirty tree

Evidence:

- `scripts/audit/run-enterprise-deep-audit.js` includes a blocking `Git clean worktree check`.
- Current `git status` has many modified/deleted/untracked docs/runtime/script/source files.

Impact: full release audit will correctly NO-GO before reaching deeper checks. This is healthy for release hygiene, but it means the current tree is not release-auditable until these local changes are committed/stashed/triaged.

Recommendation: triage the existing dirty worktree before release audit. Keep generated runtime outputs ignored or archived outside the tracked tree.

## Cleanup Performed

- Preserved dirty detached worktree patches, untracked audit files, and branch-ahead patch/bundle in `archive/worktree-preservation-20260427-113901.zip`.
- Removed Git worktrees:
  - `D:\Development\Rheolab-worktrees\enterprise-audit-20260425-detached`
  - `D:\Development\Rheolab-worktrees\enterprise-audit-alpha5-20260426`
- Removed empty `D:\Development\Rheolab-worktrees`.
- Other sibling folders under `D:\Development` were not touched because they are unrelated projects outside this repo.

## Verification Commands

- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` - pass
- `npx tsc --noEmit` - pass
- `npm run lint` - pass
- `npm run test` - pass
- `cargo test --manifest-path src-tauri/Cargo.toml` - pass
- `npm audit --omit=dev` - pass, 0 vulnerabilities
- `cargo audit` from `src-tauri/` - pass
- `git worktree list --porcelain` - only `D:/Development/Rheolab`
