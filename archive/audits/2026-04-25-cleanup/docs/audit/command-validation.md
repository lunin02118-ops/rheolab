# Tauri Command Input Validation Checklist

**WP:** WP-1.5 (Security Phase-1) &nbsp;•&nbsp; **Updated:** 2026-04-19 &nbsp;•&nbsp; **Status:** Baseline ✅

Tauri exposes 89 commands (87 registered in `generate_handler!`). This document enumerates every command, its validation domain, and the required runtime checks. It is the canonical reference for code-reviewers assessing IPC safety.

---

## 1. Validation Domains

Every command accepts one or more of the following input shapes. Each shape has a **mandatory** validation recipe; any command that doesn’t apply the recipe is considered an open finding.

| Domain | Example params | Required validation |
|---|---|---|
| **Path** | `file_path: String`, `dest: PathBuf` | Canonicalise → assert inside `app_data_dir` allow-list → reject `..`, absolute paths outside allow-list, symlinks escaping root |
| **UUID / ID** | `id: String`, `experiment_id: String` | `uuid::Uuid::parse_str()` or `^[A-Za-z0-9_-]{1,64}$` regex; reject non-matching |
| **Numeric bounds** | `limit: u32`, `offset: u32` | Cap at server-side maximum (`list` = 10_000; `batch` = 512) |
| **Unbounded text** | `name: String`, `message: String` | Length ≤ 1024 chars; trim, reject control chars except `\n\r\t` |
| **JSON blobs** | `payload: serde_json::Value` | Typed deserialisation into domain struct; `#[serde(deny_unknown_fields)]` on critical structs |
| **Binary** | `key: String` (base64/hex), `bytes: Vec<u8>` | Length cap (1 MiB default); decode format-check before use |
| **License key** | `key: String` | Exact format: `^[A-Z0-9]{4}(-[A-Z0-9]{4}){3,5}$`; HMAC verify before any DB write |

### 1.1 Path-allow-list helpers

The canonical helpers live in `src-tauri/src/commands/backup/path_validation.rs`:

- `validate_path_within(requested: &Path, allowed_root: &Path) -> Result<PathBuf>` — canonicalises, rejects `..` traversal, enforces root containment.
- `app_data_subdir(state, subdir: &str)` — returns a canonical `<app_data_dir>/<subdir>` ready to pass to `validate_path_within`.

### 1.2 Legacy note

Commands added before 2026-04 may still pass `String` paths straight to `std::fs`. These are flagged **GAP** in §3 below.

---

## 2. Command Inventory by Domain

### 2.1 Critical (file-system / path): 14 commands

| Command | File | Inputs | Validation | Status |
|---|---|---|---|---|
| `backup_create` | `commands/backup/` | — | path allow-list | ✅ |
| `backup_delete` | `commands/backup/` | `name: String` | UUID-like, path allow-list | ✅ |
| `backup_export_db` | `commands/backup/` | `dest: String` | path allow-list | ✅ |
| `backup_import_db` | `commands/backup/` | `src: String` | path allow-list | ✅ |
| `backup_list` | `commands/backup/` | — | — | ✅ (read-only) |
| `backup_open_folder` | `commands/backup/` | — | opens fixed dir | ✅ |
| `backup_restore` | `commands/backup/` | `name: String` | path allow-list, DB integrity check | ✅ |
| `reports_generate_pdf` | `commands/reports.rs` | `input: ReportInput` | typed struct; binary output | ✅ |
| `reports_generate_excel` | `commands/reports.rs` | `input: ReportInput` | typed struct; binary output | ✅ |
| `parsing_parse_file` | `commands/parsing/mod.rs` | `request: ParseRequest` | typed struct; path inside app scope | ✅ |
| `test_fixtures_read` | `commands/fixtures.rs` | `name: String` | fixed-list check | ✅ |
| `test_fixtures_parse` | `commands/fixtures.rs` | `name: String` | fixed-list check | ✅ |
| `experiments_export_to_file` | `commands/experiments/export/` | `path: String` | path allow-list | ✅ |
| `experiments_import` | `commands/experiments/` | `payload: Value` | typed deser, schema-version check | ✅ |

### 2.2 Security & Licensing: 19 commands

| Command | File | Inputs | Validation | Status |
|---|---|---|---|---|
| `licensing_activate_full` | `commands/licensing/` | `key: String` | format regex + HMAC verify | ✅ |
| `licensing_check` | `commands/licensing/` | — | — | ✅ |
| `licensing_get_status` | `commands/licensing/` | — | — | ✅ |
| `licensing_deactivate` | `commands/licensing/` | — | DB transaction | ✅ |
| `licensing_can_save` | `commands/licensing/` | — | read-only | ✅ |
| `licensing_register_experiment` | `commands/licensing/` | — | demo-counter | ✅ |
| `licensing_machine_id` | `commands/licensing/` | — | read-only | ✅ |
| `licensing_was_ever_licensed` | `commands/licensing/` | — | read-only | ✅ |
| `licensing_checkpoint_db` | `commands/licensing/` | — | DB admin | ✅ |
| `licensing_reset_experiments` | `commands/licensing/` | `user_id: Option<String>` | UUID regex | ✅ |
| `licensing_reset_all_experiments` | `commands/licensing/` | `user_id: String` | UUID regex + admin role | ✅ |
| `get_update_channel` | `commands/licensing/` | — | read-only | ✅ |
| `api_keys_list` | `commands/api_keys/` | — | read-only | ✅ |
| `api_keys_active` | `commands/api_keys/` | — | read-only | ✅ |
| `api_keys_check_active` | `commands/api_keys/` | — | read-only | ✅ |
| `api_keys_create` | `commands/api_keys/` | `name, key: String` | length cap, format, encrypt-at-rest | ✅ |
| `api_keys_set_active` | `commands/api_keys/` | `id: String` | UUID regex | ✅ |
| `api_keys_validate` | `commands/api_keys/` | `key: String` | format, HTTP probe | ✅ |
| `api_keys_delete` | `commands/api_keys/` | `id: String` | UUID regex | ✅ |

### 2.3 CRUD on domain entities: 28 commands

Every `*_create / update / delete / get` on the four reference tables (`experiments`, `reagents`, `operators`, `laboratories`) uses:

1. `uuid::Uuid::parse_str(&id)` — rejects malformed IDs.
2. Typed `Payload` struct with `serde(deny_unknown_fields)`.
3. Size caps on all string fields (`name: 256`, `notes: 4096`).
4. `rusqlite` parameter binding — no string concatenation in SQL.

| Group | Commands |
|---|---|
| Experiments | `experiments_check_existence`, `experiments_count`, `experiments_delete`, `experiments_export_laboratories`, `experiments_filter_metadata`, `experiments_get`, `experiments_get_batch`, `experiments_last_context`, `experiments_list`, `experiments_save`, `experiments_water_sources` (11) |
| Reagents | `reagents_create`, `reagents_delete`, `reagents_export`, `reagents_import`, `reagents_list`, `reagents_seed`, `reagents_update` (7) |
| Operators | `operators_create`, `operators_delete`, `operators_list`, `operators_update` (4) |
| Laboratories | `laboratories_create`, `laboratories_delete`, `laboratories_list`, `laboratories_update` (4) |
| Analysis | `analysis_analyze_full`, `analysis_detect_steps`, `analysis_regroup_by_pattern` (3) |

**Status:** ✅ All commands use typed structs and parameter binding. `laboratories_create` additionally strips control chars from `name` (WP-1.5 follow-up).

### 2.4 Data-flow / sync queue: 23 commands

Low-risk — they manipulate internal queues rather than raw filesystem. IDs are UUIDs; payloads are typed.

| Group | Commands |
|---|---|
| Sync engine | `sync_export_delta`, `sync_import_delta`, `sync_resolve_conflict`, `sync_list_conflicts` (4) |
| Sync queue | `sync_inbox_list`, `sync_inbox_receive`, `sync_outbox_list`, `sync_outbox_mark_synced`, `sync_outbox_retry`, `sync_status` (6) |
| Conflicts | `conflicts_list`, `conflicts_resolve` (2) |
| Data flow read-only | `experiment_payloads_list`, `import_batches_get`, `import_batches_list`, `parser_artifacts_get`, `parser_artifacts_list`, `report_artifacts_list`, `report_artifacts_delete`, `report_artifacts_save`, `search_projections_list` (9) |
| Parsing cache | `parsing_release_cache` (1) |
| Fixtures list | `test_fixtures_list` (1) |

**Validation highlights:**
- `sync_export_delta`: `since_timestamp: String` — parsed via `chrono::DateTime::parse_from_rfc3339`; rejects future timestamps.
- `sync_import_delta`: `file_path: String` — path allow-list (app_data_dir/sync/).
- `sync_resolve_conflict`: `conflict_id: String` — UUID regex; `resolution` enum with `deny_unknown_fields`.
- `report_artifacts_save`: base64 blob capped at 10 MiB before decode.

### 2.5 Logger & diagnostics: 2 commands

| Command | Input | Validation |
|---|---|---|
| `log_info` | `message: String` | Length ≤ 4096; no control chars; written via `tracing::info!` |
| `log_error` | `message: String` | Length ≤ 4096; no control chars; written via `tracing::error!` |

---

## 3. Known Gaps & Planned Hardening

No open gaps as of 2026-04-19. Previously-tracked items are closed:

| Item | Closed by | Date |
|---|---|---|
| `experiments_export` path traversal | Command removed (orphan) | 2026-04-17 |
| `backup_import_db` missing DB-integrity check | `sqlite3_check_integrity()` added | 2026-04-11 |
| `licensing/crypto.rs` timing leak | Replaced with `hmac::verify_slice` | 2026-04-17 (WP-1.2) |
| `.gitleaks.toml` missing key patterns | Added in WP-1.6 | 2026-04-17 |

---

## 4. Review Checklist for New Commands

When adding a new `#[tauri::command]`, verify each line:

- [ ] Command is registered in `src-tauri/src/lib.rs` `generate_handler!` list.
- [ ] Command is re-exported via `src/lib/tauri/bridge/index.ts` to the frontend.
- [ ] Every `String` path input uses `validate_path_within(...)`.
- [ ] Every `id: String` is parsed via `Uuid::parse_str()` **or** regex `^[A-Za-z0-9_-]{1,64}$`.
- [ ] Every JSON payload is a typed struct with `#[serde(deny_unknown_fields)]`.
- [ ] Every `Vec<u8>` / base64 input has an explicit length cap before decode.
- [ ] No `format!("SELECT … {var} …")` — use `?` parameters or `rusqlite::params!`.
- [ ] Error responses do not leak absolute paths or internal SQL.
- [ ] Command is covered by either a Rust unit test or a Playwright e2e test.
- [ ] If command mutates state, there is a corresponding rollback-on-error path.

---

## 5. References

- **HashiCorp Tauri IPC threat model:** <https://tauri.app/v2/security/>
- **OWASP ASVS v4.0.3, §5 Input Validation**
- **Trail of Bits “Security Ownership Map”** (skill `security-ownership-map`) — run on `src-tauri/src/commands/`.
- **Internal:** `docs/adr/ADR-0005-licensing-architecture.md`, `docs/adr/ADR-0007-parser-pipeline.md`.

---

*This checklist is generated semi-automatically. Regenerate the command inventory via `node scripts/audit/snapshot-metrics.js` and check `tauriCommands.defined == 89`.*
