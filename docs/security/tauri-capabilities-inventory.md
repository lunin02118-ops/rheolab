# Tauri Capabilities Inventory

Date: 2026-06-14
Status: updated after phase-1 Tauri capability hardening.
Behavior changes: none from this document. Runtime capability narrowing is handled by `security/tauri-capabilities-hardening-phase-1`.

## Source Files

| File | Role | Notes |
| --- | --- | --- |
| `src-tauri/capabilities/default.json` | Default app capability | Applies to local `main` window and remote `https://license.vizbuka.ru`. |
| `src-tauri/tauri.conf.json` | Window, CSP, updater, shell policy | Keeps `plugins.shell.open` disabled and defines updater endpoint. |
| `src-tauri/tauri.e2e.conf.json` | E2E build override | Only overrides `build.frontendDist`; it does not override capabilities. |

## Capability Metadata

| Field | Current value | Reason | Owner | Follow-up |
| --- | --- | --- | --- | --- |
| `identifier` | `default` | Single production desktop capability. | Platform | Keep until per-window capability split is needed. |
| `local` | `true` | Production UI is loaded from bundled local assets. | Platform | Keep. |
| `windows` | `main` | The app has one production window label. | Platform | Revisit only if more windows are added. |
| `remote.urls` | `https://license.vizbuka.ru` | Allows the license/update host to be part of the capability boundary. | Licensing / Release | Keep aligned with license and updater endpoints. |

## Permission Inventory

| Permission | Reason | Current risk | Owner | Follow-up |
| --- | --- | --- | --- | --- |
| `core:default` | Baseline Tauri core API surface required by the desktop shell. | Medium: broad default bundle. | Platform | Keep under regression review when Tauri upgrades. |
| `fs:default` | Enables the filesystem plugin used by report save, settings import/export, and reagent JSON import/export flows. | High: generic frontend filesystem plugin remains exposed, though scope is constrained. | Platform / Reports / Settings | Phase 1 candidate: move user-file writes behind narrow Rust commands. |
| `fs:allow-read-file` | Reads dialog-selected settings and reagent JSON files. | Medium: bounded by `fs:scope` and user-selected flows. | Settings | Broker via Rust command when direct frontend reads are removed. |
| `fs:allow-read-text-file` | Reads dialog-selected settings text backup files. | Medium: bounded by `fs:scope` and user-selected flows. | Settings | Broker via Rust command when direct frontend reads are removed. |
| `fs:allow-write-file` | Writes report, reagent JSON, and E2E-controlled export artifacts. | Medium: bounded by extension allowlist paths in `fs:scope`. | Reports / Settings | Broker report and JSON writes through narrow Rust commands. |
| `fs:allow-write-text-file` | Writes dialog-selected settings backup files. | Medium: bounded by `fs:scope`. | Settings | Broker via Rust command when direct frontend writes are removed. |
| `fs:allow-exists` | Supports file existence checks in plugin-backed file workflows. | Low to medium: depends on scoped paths. | Platform | Verify exact callers during filesystem hardening phase. |
| `fs:allow-mkdir` | Supports export output directory creation for allowed locations, including controlled temp comparison export folders. | Medium: directory creation in allowed roots. | Reports / Test Harness | Replace with command-specific directory creation where practical. |
| `fs:scope` | Constrains filesystem plugin access to app data, local app data, selected user export roots, and comparison temp artifacts. | Medium: user document roots remain available for compatibility. | Platform / Reports / Settings | Keep regression test pinned; reduce after Rust save broker exists. |
| `dialog:default` | Used for open/save dialogs in reports, settings backup/restore, reagent import/export, and startup error handling. | Low: user-mediated dialogs. | UX / Platform | Keep. |
| `process:default` | Used by updater install flow for app relaunch. | Medium: broad default process permission. | Release / Platform | Phase 1 candidate: narrow to relaunch-only permission if Tauri plugin supports it. |
| `http:default` | Allows plugin HTTP traffic to license/update host and Groq AI endpoint. | Medium: external network surface. | Licensing / AI | Split or broker by feature if Tauri permission model allows narrower commands. |
| `log:default` | Supports renderer and backend logging through `tauri_plugin_log`. | Low: app log is rotated and dependency noise is muted in release. | Observability / Platform | Keep with redaction policy. |
| `updater:default` | Supports release update check/install workflow. | Medium: update flow is release critical and network-facing. | Release | Keep paired with updater endpoint and signature validation. |

## Filesystem Scope Classification

| Scope group | Entries | Reason | Risk note |
| --- | --- | --- | --- |
| App data | `$APPDATA/com.rheolab.enterprise/**`, `$LOCALAPPDATA/com.rheolab.enterprise/**` | App-owned storage and local runtime data. | Lower risk than whole `$APPDATA/**`; still app-sensitive. |
| Downloads exports/imports | `$DOWNLOADS/*.pdf`, `$DOWNLOADS/*.xlsx`, `$DOWNLOADS/*.json`, `$DOWNLOADS/*.db`, recursive variants | Common user-selected report, JSON, and DB export/import location. | Compatibility scope; should shrink after Rust save broker. |
| Desktop exports/imports | `$DESKTOP/*.pdf`, `$DESKTOP/*.xlsx`, `$DESKTOP/*.json`, `$DESKTOP/*.db`, recursive variants | Common user-selected report, JSON, and DB export/import location. | Compatibility scope; should shrink after Rust save broker. |
| Documents exports/imports | `$DOCUMENT/*.pdf`, `$DOCUMENT/*.xlsx`, `$DOCUMENT/*.json`, `$DOCUMENT/*.db`, recursive variants | Common user-selected report, JSON, and DB export/import location. | Compatibility scope; should shrink after Rust save broker. |
| Comparison temp exports | `$TEMP/rheolab-comparison-export-*/*.pdf`, `$TEMP/rheolab-comparison-export-*/*.xlsx` | Controlled report comparison export artifacts. | Narrow temp pattern; keep pinned by regression tests. |

The current regression test forbids broad roots such as `$HOME/**`, `$APPDATA/**`,
`$LOCALAPPDATA/**`, `$DOWNLOADS/**`, `$TEMP/**`, whole filesystem roots, and
drive roots. It also pins the exact `fs:scope` allowlist.

## Direct Frontend Plugin Usage Found

| Plugin | Production frontend usage found | Files |
| --- | --- | --- |
| `@tauri-apps/plugin-fs` | Yes | `src/lib/reports/report-save.ts`, `src/components/settings/AppSettingsExporter.tsx`, `src/components/settings/ExperimentExportImport.tsx` |
| `@tauri-apps/plugin-dialog` | Yes | `src/lib/reports/report-save.ts`, `src/components/settings/AppSettingsExporter.tsx`, `src/components/settings/ExperimentExportImport.tsx` |
| `@tauri-apps/plugin-log` | Yes | `src/main.tsx`, `src/lib/logger.ts` |
| `@tauri-apps/plugin-updater` | Yes | `src/components/shared/UpdateChecker.tsx`, `src/components/shared/update-install.ts` |
| `@tauri-apps/plugin-process` | Yes | `src/components/shared/update-install.ts` uses `relaunch`. |
| `@tauri-apps/plugin-http` | No direct frontend import in current scan | Rust network clients cover license and AI workflows. |

## Phase 1 Removed Surface

| Surface | Previous state | Current state | Evidence |
| --- | --- | --- | --- |
| `os:default` permission | Enabled in `src-tauri/capabilities/default.json`. | Removed from the default capability. | No direct production frontend import was found; release regression test forbids reintroduction. |
| `tauri_plugin_os::init()` | Initialized in the Tauri builder. | Removed from `src-tauri/src/lib.rs`. | No direct production frontend import was found; release regression test pins removal. |
| `opener:default` permission | Enabled in `src-tauri/capabilities/default.json`. | Removed from the default capability. | No direct production frontend import was found; release regression test forbids reintroduction. |
| `tauri_plugin_opener::init()` | Initialized in the Tauri builder. | Removed from `src-tauri/src/lib.rs`. | No direct production frontend import was found; release regression test pins removal. |

## Network And CSP Boundary

| Surface | Current value | Reason | Follow-up |
| --- | --- | --- | --- |
| CSP `connect-src` | `'self' https://license.vizbuka.ru https://api.groq.com` | Local app, licensing/update host, Groq AI endpoint. | Keep aligned with external AI network policy. |
| Updater endpoint | `https://license.vizbuka.ru/releases/v1/update/{{target}}-{{arch}}/update` | Release update metadata endpoint. | Covered by release updater smoke plan. |
| HTTP permission allowlist | `https://license.vizbuka.ru/*`, `https://api.groq.com/*` | License/update and AI API hosts. | Consider feature-specific network brokers. |
| Shell plugin open | `false` | Prevents shell-open permission from being enabled through config. | Keep disabled unless a narrow use case is approved. |

## Broad Permission Follow-ups

| Item | Owner | Why it is broad | Planned direction |
| --- | --- | --- | --- |
| Generic filesystem plugin permissions | Platform / Reports / Settings | Renderer can call generic file read/write APIs inside scoped roots. | Replace with command-specific Rust save/import brokers. |
| User document root scopes | Platform / Reports / Settings | Desktop, Documents, and Downloads are still meaningful user data locations. | Shrink after report/settings/reagent workflows no longer need direct frontend FS. |
| `process:default` | Release / Platform | Default process permission is broader than updater relaunch. | Prove/narrow to relaunch-only or document Tauri limitation. |
| `http:default` | Licensing / AI | External hosts are allowed at plugin level. | Keep host allowlist tight; evaluate command-level network brokering. |

## Validation

| Command | Exit code | Result | Notes |
| --- | ---: | --- | --- |
| `node -e "JSON.parse(require('fs').readFileSync('src-tauri/capabilities/default.json','utf8')); JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); JSON.parse(require('fs').readFileSync('src-tauri/tauri.e2e.conf.json','utf8'));"` | 0 | PASS | JSON parse check. |
| `npm test -- --run tests/release/tauri-capabilities-security.test.ts` | 0 | PASS | 1 file, 4 tests passed; verifies forbidden roots, exact FS scope allowlist, and removal of `os`/`opener` permission/plugin surface. |
| Hidden/bidi Unicode scan | 0 | PASS | Checked inventory doc plus capability/config files. |
| `git diff --check` | 0 | PASS | Whitespace check. |

## Rollback

Revert this documentation-only PR or delete
`docs/security/tauri-capabilities-inventory.md`. No runtime state, database,
license, updater, or trial behavior is changed.
