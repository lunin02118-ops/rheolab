# RheoLab Wave 4 Audit Report

Date: 2026-04-24
Mode: audit only, no product-code fixes
Workspace: D:\Development\Rheolab

## Scope

This wave focused on the desktop trust boundary rather than feature correctness:

| Area | Coverage |
|---|---|
| Tauri v2 capability model | `tauri.conf.json`, `capabilities/default.json`, registered plugins, frontend plugin imports. |
| IPC write-gate consistency | Commands that mutate DB/files vs `can_write_via_engine` / license-denied behavior. |
| Parser / sync robustness | User-controlled file paths, inline bytes, delta JSON import, size/shape limits. |
| Audit test gaps | Negative tests for license denial, capability contracts, report parity, parser payload limits. |

Agents / skills used:

| Agent / Skill | Focus |
|---|---|
| audit-context-building | Bottom-up Tauri/IPC context and trust-boundary mapping. |
| audit-prep-assistant | Audit-prep checklist framing: static scans, test gaps, least-privilege gaps. |
| cargo-fuzz | Defensive fuzz-readiness review only; no harness was added. |
| McClintock | Tauri capability / plugin exposure review. |
| Boyle | License/write-gate consistency review. |
| Dewey | Test-gap / audit-coverage review. |

## Commands / Checks

| Check | Result | Notes |
|---|---:|---|
| `Get-Content src-tauri/capabilities/default.json` | PASS | Capability grants reviewed line-by-line. |
| `Get-Content src-tauri/src/lib.rs` | PASS | Registered plugin list reviewed. |
| `Get-Content src-tauri/src/startup/commands_registry.rs` | PASS | Central IPC surface reviewed. |
| Frontend plugin import scan | PASS | Found FS/dialog/updater/process usage; no observed plugin-http/os/opener/shell imports. |
| Mutating IPC static scan | PASS / FINDINGS | Heuristic scan: 88 Tauri commands, 33 mutating, 28 mutating without a detected write gate, 5 gated mutating. |
| Parser/sync file-read scan | PASS / FINDINGS | Parser and sync import paths read user-controlled payloads without backend max-size caps. |
| Fuzz readiness scan | PASS / GAP | No `fuzz/`, `fuzz_targets`, corpus, or `cargo-fuzz` setup under `src/rust/rheolab-core`. |

## High Findings

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| W4-01 | High | Remote origin receives the same default desktop capability set as local app UI. | `src-tauri/capabilities/default.json:4-12` applies default capability locally and to `https://license.vizbuka.ru`; the same capability grants FS/process/http/opener/log/updater at `:13-47`. | If the main webview ever navigates to or embeds the trusted remote origin, that origin can inherit a broad desktop plugin surface. |
| W4-02 | High | File-system capability is much broader than observed user-file flows require. | `src-tauri/capabilities/default.json:15-32` grants `fs:default`, read/write file/text, mkdir/exists, and scopes `$HOME/**`, `$DOCUMENT/**`, `$DESKTOP/**`, `$DOWNLOADS/**`, `$TEMP/**`, app data dirs. Frontend observed usage is dialog-driven settings/report/import-export: `src/components/settings/AppSettingsExporter.tsx:7-8`, `src/components/settings/ExperimentExportImport.tsx:2-4`, `src/lib/reports/report-save.ts:11-12`. | Renderer compromise or a future frontend bug gets broad read/write reach into user directories, not only explicit app-owned data. |
| W4-03 | High | Primary experiment deletion is not license/write-gated. | `experiments_save` gates writes at `src-tauri/src/commands/experiments/crud.rs:106-115`; `experiments_delete` starts at `:283-321`, opens DB at `:291-292`, appends sync/search side effects at `:296-302`, and deletes at `:304-305` without `can_write_via_engine`. Registered at `src-tauri/src/startup/commands_registry.rs:43`. | A denied/expired license state can still delete primary user experiment data through direct IPC. |
| W4-04 | High | Sync import and conflict resolution can create/overwrite experiments without the write gate. | `sync_import_delta` starts at `src-tauri/src/commands/sync_engine.rs:155`, opens arbitrary path at `:160-162`, transaction at `:170-172`, persists experiments at `:200` and `:205`, and writes conflicts at `:215-239`. `sync_resolve_conflict` starts at `:276`, persists remote experiment snapshots at `:318` and `:337`. Registered at `src-tauri/src/startup/commands_registry.rs:122-125`. | Direct IPC can import, overwrite, duplicate, or conflict-mark experiment data outside the license write policy. |
| W4-05 | High | Backup create/delete mutate DB artifacts without the write gate. | `backup_create` starts at `src-tauri/src/commands/backup/manage.rs:53`, creates backup dir at `:61-63`, writes DB snapshot via `VACUUM INTO` at `:75-77`; `backup_delete` starts at `:110`, deletes backup file at `:133`. Adjacent backup export/import paths are gated at `src-tauri/src/commands/backup/export.rs:54-57` and `src-tauri/src/commands/backup/restore.rs:138-140`. | Backup artifacts can be created or removed in states where export/import/restore are denied, making licensing behavior inconsistent and weakening data-retention expectations. |
| W4-06 | High | Write-gate policy is systemic/manual: most mutating IPC commands lack a detected gate. | Static scan result: 88 Tauri commands, 33 mutating, 28 mutating without detected `can_write_via_engine`/license gate, 5 gated mutating. Central registry exposes all commands at `src-tauri/src/startup/commands_registry.rs:20-126`. | License enforcement depends on each handler remembering to call the gate; regressions are easy and already present across multiple command domains. |

## Medium Findings

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| W4-07 | Medium | Reagent catalog mutations are not write-gated. | `reagents_create` inserts at `src-tauri/src/commands/reagents/commands.rs:23-73`; `reagents_update` updates at `:92-149`; `reagents_delete` deletes and writes sync outbox at `:168-215`; `reagents_import` updates/inserts at `:261-358`; `reagents_seed` mutates at `:371-374`. Registered at `src-tauri/src/startup/commands_registry.rs:52-58`. | Reference/catalog data and sync metadata can change when primary save/export paths may be denied. |
| W4-08 | Medium | Operator and laboratory mutations are not write-gated. | Operators: create/update/delete at `src-tauri/src/commands/operators/commands.rs:59-178`; laboratories: create/update/delete at `src-tauri/src/commands/laboratories/commands.rs:59-190`. Registered at `src-tauri/src/startup/commands_registry.rs:60-68`. | Personnel/lab attribution data can be changed independently of license write state. |
| W4-09 | Medium | Data-flow artifact, sync queue, inbox, and conflict mutations are not write-gated. | `report_artifacts_save/delete` at `src-tauri/src/commands/data_flows/artifacts.rs:159-205`; `sync_outbox_mark_synced/retry` at `src-tauri/src/commands/data_flows/sync.rs:123-171`; `sync_inbox_receive` at `:176-245`; `conflicts_resolve` at `src-tauri/src/commands/data_flows/conflicts.rs:58-83`. Registered at `src-tauri/src/startup/commands_registry.rs:111-120`. | Audit/sync state can be rewritten or marked processed without the same business gate as primary writes. |
| W4-10 | Medium | Native parser IPC has no backend max-size cap for path reads or inline bytes. | `ParseRequest.bytes` is `Option<Vec<u8>>` at `src-tauri/src/commands/parsing/types.rs:5-15`; `read_request_bytes` reads selected path via `fs::read` at `src-tauri/src/commands/parsing/commands/io.rs:17-21` and only rejects empty inline bytes at `:23-30`. Backup import has an explicit 2 GB cap at `src-tauri/src/commands/backup/restore.rs:135-136`, showing the pattern exists elsewhere. | Large selected files or direct inline-byte IPC can consume memory and long blocking parse time before parser validation runs. |
| W4-11 | Medium | Sync delta import reads a user-supplied path and parses JSON without path policy or size cap. | `sync_import_delta` accepts `file_path: String` at `src-tauri/src/commands/sync_engine.rs:155-158`, opens it directly at `:160-162`, then parses with `serde_json::from_reader`. | A direct IPC caller can point the sync importer at large or unexpected readable files, causing memory/CPU pressure or noisy errors outside intended delta-file flows. |
| W4-12 | Medium | Updater/process permissions are broader than observed use. | `process:default` at `src-tauri/capabilities/default.json:35`; updater default at `:46`; frontend uses updater `check` at `src/components/shared/UpdateChecker.tsx:15,66,110`, `downloadAndInstall` at `src/components/shared/update-install.ts:54`, and process relaunch at `src/components/shared/update-install.ts:10`. | The renderer gets more process/updater surface than a minimal check/download/install/relaunch workflow may need. |
| W4-13 | Medium | HTTP, OS, opener, and shell plugin surface appears unused or over-provisioned. | Plugins registered in `src-tauri/src/lib.rs:58-65`; capability grants `os:default`, `http:default`, `opener:default` at `src-tauri/capabilities/default.json:36-44`; shell plugin registered but shell open disabled in `src-tauri/tauri.conf.json:65-68`. Frontend scan found no `@tauri-apps/plugin-http`, `plugin-os`, `plugin-opener`, or `plugin-shell` imports. | Extra plugins increase audit/dependency surface and can become reachable through future imports without another backend review. |
| W4-14 | Medium | Command-level negative tests do not prove license denial across the full IPC surface. | Report commands gate at `src-tauri/src/commands/reports.rs:65,91,116,144`, but local tests in that file focus on generation helpers around `:222`, `:235`, `:269`, `:285`. E2E mocks often return `licensing_can_save=true`, e.g. `tests/e2e/base-test.tauri.ts:185,221` and web mocks return successful mutations at `tests/e2e/base-test.ts:235-331`. | Tests can pass while direct command handlers lack license-denied invariants or no-mutation assertions. |
| W4-15 | Medium | Report settings parity still needs exhaustive TS-to-Rust contract tests. | Single settings include `rheologyUnits` in `src/lib/analysis/report-types/report-inputs.ts:137`; Rust expects `rheology_units` in `src/rust/rheolab-core/src/report_generator/types.rs:291`; comparison converter delegates per-experiment payload at `src/lib/analysis/report-types/comparison-report-converter.ts:85`, while tests mainly assert selected defaults around `tests/reports/comparison-report-converter.test.ts:175`. | Field omissions/default drift can keep producing PDF/XLSX parity bugs like those found in Wave 3. |

## Low / Tooling Notes

| ID | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| W4-16 | Low | Browser update diagnostic does not exercise the same path as the Tauri updater. | Diagnostic hardcodes stable endpoint and uses browser `fetch` at `src/app/dashboard/settings/UpdateCheck.tsx:8-35`; production updater check uses Tauri updater with channel/token headers at `src/components/shared/UpdateChecker.tsx:33-47,65-66,109-110`. | Settings diagnostics can disagree with the real updater path, especially for beta/alpha channels or token-gated responses. |
| W4-17 | Low | Parser fuzzing is ready conceptually but not operationally wired. | Core parser exposes good fuzz targets at `src/rust/rheolab-core/src/parser/rheo_parser/mod.rs:34,85` and calibration buffer parsing at `src/rust/rheolab-core/src/parser/calibration/parsers/buffer.rs:11`, but no `src/rust/rheolab-core/fuzz/`, fuzz targets, corpus, or dictionaries were found. `cargo-fuzz` / nightly were already unavailable in Wave 3. | Parser regressions rely on curated fixtures and unit tests instead of continuous mutation coverage over CSV/XLSX/DAT inputs. |

## Recommended Next Audit Waves

| Priority | Wave | Goal |
|---:|---|---|
| 1 | License-gate contract audit | Build a command matrix: read/write/export/import/admin; prove expected behavior for active, demo, expired, invalid, revoked, and no-engine states. |
| 2 | Capability least-privilege audit | Split local vs remote capabilities and create a contract test that rejects broad `$HOME/**` / default plugin grants unless explicitly justified. |
| 3 | IPC payload limits audit | Add backend-side size/shape caps for parser bytes, parser path reads, sync delta files, sync inbox events, and report artifact JSON fields. |
| 4 | Report settings parity audit | Generate exhaustive TS payloads and deserialize in Rust for single/comparison reports; assert PDF/XLSX toggles, units, axes, sections, and defaults match. |
| 5 | Parser fuzz-prep package | Add cargo-fuzz harnesses for `parse_rheo_data`, `parse_rheo_data_with_ai_hint` with bounded synthetic mapping, calibration buffer parsing, filename parser, and row mapper. |

## Audit-Only Status

No product-code fixes were made in this wave. This file is the only intended Wave 4 artifact.
