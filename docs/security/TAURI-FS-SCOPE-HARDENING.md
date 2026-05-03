# Tauri Filesystem Scope Hardening

**Date:** 2026-05-03
**Status:** current policy and regression-test inventory.

## Current Allowlist

The default Tauri filesystem scope is:

```text
$APPDATA/com.rheolab.enterprise/**
$LOCALAPPDATA/com.rheolab.enterprise/**
$DOWNLOADS/**
$TEMP/**
$DESKTOP/**
$DOCUMENT/**
```

The current scope is narrower than `$HOME/**` and guarded by tests, but it
still allows user document roots for dialog-based save flows.

## Forbidden Roots

`$HOME/**` is forbidden because it grants broad access to the user's profile,
including unrelated documents and application data. The regression test also
forbids whole app-data roots, program roots, resource roots, whole drives, and
whole filesystem scopes.

Pinned forbidden examples:

```text
$HOME/**
$APPDATA/**
$LOCALAPPDATA/**
$PROGRAMDATA/**
$PROGRAMFILES/**
$PROGRAMFILESX86/**
$RESOURCE/**
/**
C:/**
C:\**
```

## Why User Roots Remain

`$DOCUMENT/**`, `$DESKTOP/**`, `$DOWNLOADS/**`, and `$TEMP/**` remain allowed
for current dialog-based export/import flows. The renderer does not get
`$HOME/**`, but the Tauri `plugin-fs` still needs permission to write or read
paths returned by save/open dialogs in these user-facing locations.

These scopes are compatibility scopes, not a claim that filesystem access is
fully locked down.

## Direct Frontend Filesystem Usage

Production direct `@tauri-apps/plugin-fs` imports are:

| File | Usage | Classification |
| --- | --- | --- |
| `src/lib/reports/report-save.ts` | `writeFile` after save/open dialog or E2E output dir | report/export save path |
| `src/components/settings/AppSettingsExporter.tsx` | `writeTextFile`/`readTextFile` after save/open dialog | app settings backup/restore path |
| `src/components/settings/ExperimentExportImport.tsx` | `writeFile` for reagent JSON export and `readFile` for reagent/legacy JSON import after dialog | user-selected import/export path |

`src/components/settings/ExperimentExportImport.tsx` also exports/imports the
experiment SQLite database through Rust commands (`backup_export_db` and
`backup_import_db`) after dialog selection. That path is not a generic frontend
`plugin-fs` write of DB bytes.

Test and perf runners use `plugin-fs` for local artifacts under controlled E2E
output directories; those are not production user workflows.

## Risk Boundary

If the renderer is compromised, the remaining risk is bounded by the exposed
Tauri plugin permissions and the filesystem scope above. Removing `$HOME/**`
limits broad profile traversal, but document/download/desktop/temp roots still
represent meaningful user data exposure until direct frontend filesystem writes
are replaced or further brokered.

## Regression Tests

`tests/release/tauri-capabilities-security.test.ts` enforces:

- no `$HOME/**`;
- no broad app-data, program, resource, drive, or whole-filesystem roots;
- exact current `fs:scope` allowlist.

Run:

```powershell
npm test -- --run tests/release/tauri-capabilities-security.test.ts
```

## Future Rust Save Broker

If the remaining user-root scope must be narrowed later, move report/settings
and JSON import/export flows behind specific Rust commands instead of exposing
generic frontend file writes.

The target shape should be narrow, not an arbitrary write API:

```rust
#[tauri::command]
pub async fn files_write_user_selected_report(
    path: String,
    bytes: Vec<u8>,
    expected_extension: String,
) -> Result<()> {
    // validate path, extension, parent directory and sensitive directory rules
}
```

Broker validation should:

- accept only paths returned by a user dialog in the current flow;
- require an expected extension such as PDF, XLSX, JSON, or DB where applicable;
- reject known sensitive directories such as `.ssh`, `.gnupg`, credentials
  directories, Windows system directories, Program Files, and ProgramData;
- avoid exposing generic arbitrary write commands.

Until that migration exists, do not remove `$DOCUMENT/**`, `$DESKTOP/**`, or
`$DOWNLOADS/**` because report/settings/reagent save flows rely on dialog-based
paths in those roots.
