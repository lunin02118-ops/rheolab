# RheoLab Enterprise V2 - Wave 5 Final Audit Report

Дата: 2026-04-24  
Режим: audit-only, без исправлений product code  
Цель волны: добить оставшиеся зоны риска после Wave 1-4 и подготовить финальную упаковку артефактов.

## Scope

Проверены дополнительные зоны, которые не были полностью закрыты предыдущими волнами:

- SQLite backup/restore/migration crash consistency.
- Release/update/signing pipeline: CI tag build, `release:prepare`, `deploy:update`, updater signatures.
- Logging/privacy/diagnostics: renderer errors, IPC log commands, retention.
- Tauri/WebView hardening: CSP, browser flags, production debug surfaces.
- Cross-wave reconciliation: отделение новых findings от уже найденных в Wave 2-4.

Использованы audit-skills:

- `audit-context-building`
- `audit-prep-assistant`

Использованы audit agents:

- Release/update/signing hardening explorer.
- Logging/privacy/diagnostics explorer.
- SQLite backup/restore/migration explorer.

## Executive Summary

Итоговый статус по всем волнам остается **NO-GO для release**. Новая финальная волна добавила критичные зоны вокруг релизного контура, восстановления БД и логирования. Самый опасный класс проблем не один баг, а расхождение между защищенными путями и обходными путями: часть проверок есть в `release:prepare`, но CI/deploy могут идти другой дорогой; часть IPC безопасно сериализует ответ пользователю, но сырые детали все равно попадают в persistent logs; часть backup flow валидирует входы, но сама операция восстановления не crash-safe.

Ключевые новые темы Wave 5:

- Restore заменяет базу через delete-before-copy и может оставить пользователя без рабочей БД при сбое.
- CI tag release и `deploy:update` могут обойти hardened release flow / release gate.
- Windows installer не имеет настроенного Authenticode certificate/timestamp.
- `app.log` хранится с `KeepAll`, а renderer/IPC ошибки пишутся без redaction и payload caps.
- Import/merge backup может потерять WAL-only данные или завершиться partial success.

## New Findings

### W5-01 - High - Pending restore is not atomic and can destroy the working DB on failure

Evidence:

- `src-tauri/src/commands/backup/restore.rs:91-99`
- `src-tauri/src/commands/backup/restore.rs:404-410`
- `src-tauri/src/startup/setup.rs:23-40`

`backup_restore` копирует выбранный backup прямо в `pending_restore.db`, затем вызывает `app.restart()`. На старте `pre_startup_restore` удаляет live DB, WAL и SHM, и только потом делает `fs::copy(&pending_path, db_path)`. Если copy падает после удаления live DB, либо процесс/ОС падают между remove и copy, приложение может остаться без основной базы. Это reachable path: startup явно вызывает `pre_startup_restore` до `AppState::build`.

Impact:

- Потеря рабочей БД при частичном restore.
- Невозможность автоматического восстановления без ручного вмешательства.
- Усиление риска из Wave 4, где `backup_restore` также попадает в ungated mutating IPC surface.

Recommended audit follow-up:

- Добавить crash-consistency тесты для restore.
- Проверить atomic temp+fsync+rename strategy на Windows.
- Проверить, что pending file валидируется до удаления live DB.

### W5-02 - High - CI tag release bypasses the hardened release flow

Evidence:

- `.github/workflows/v2-desktop.yml:399-407`
- `.github/workflows/v2-desktop.yml:416-421`
- `src-tauri/src/commands/licensing/types.rs:223-246`
- `scripts/release/prepare-production.js:476-492`

Tag workflow собирает release installer напрямую через `cargo tauri build`, передавая только updater signing env. Hardened path `scripts/release/prepare-production.js` делает дополнительные проверки: signing env, updater config, mandatory release gate, manifest generation. CI path их не использует. При этом production binary panic-guard требует compile-time `INTEGRITY_SECRET_KEY`, `BETA_CHANNEL_SECRET`, `ALPHA_CHANNEL_SECRET`; workflow их не задает. Updater `.sig` artifact загружается с `if-no-files-found: ignore`.

Impact:

- CI может собрать непригодный production binary или artifact без updater signature.
- Release gate может быть зеленым в одном пути, но bypassed в реальном tag release.
- Релизный процесс становится неаудируемым: статус зависит от выбранного entrypoint.

Recommended audit follow-up:

- Единый blessed release entrypoint для CI и ручного релиза.
- CI check, что release artifact имеет embedded production secrets, `.sig`, manifest, release-gate proof.

### W5-03 - High - `deploy:update` can publish stale or non-gated artifacts

Evidence:

- `scripts/deploy/publish-update.js:127-152`
- `scripts/deploy/publish-update.js:230-247`
- `scripts/deploy/publish-update.js:286-310`
- `scripts/test/run-release-gate.js:78-108`
- `scripts/release/prepare-production.js:476-492`

`deploy:update` берет version из `package.json`, ищет matching `.exe` в `src-tauri/target/release/bundle/nsis`, выбирает `matched[0]`, проверяет размер и наличие `.sig`, но не требует proof, что этот artifact был собран текущим release flow и прошел release gate. Это перекликается с Wave 3 stale-binary risk, но здесь найден конкретный deployment path, который может отправить старый или невалидированный installer.

Impact:

- Возможна публикация stale build с актуальной версией.
- Возможна публикация artifact, который не проходил mandatory workflow tests.
- Smoke test запускается уже после promotion manifest.

Recommended audit follow-up:

- Связать deploy только с release manifest/checksum/provenance от `release:prepare`.
- Блокировать upload без release-gate proof и artifact hash match.

### W5-04 - High - Persistent logs have no retention cap and can store unsanitized sensitive data

Evidence:

- `src-tauri/src/lib.rs:66-73`
- `src/lib/logger.ts:81-99`
- `src/lib/logger.ts:137-143`
- `src/lib/logger.ts:194-200`
- `src/main.tsx:21-33`

Tauri log plugin пишет `app.log`, rotate делает на ~2 MB, но strategy = `KeepAll`, то есть retention по числу файлов отсутствует. Renderer `ERROR` logs сериализуют `Error.stack` или `JSON.stringify(object)` и отправляют их в `@tauri-apps/plugin-log`. Global crash handler отправляет filename/line/stack. Redaction, max length, rate limiting и secret pattern filtering не обнаружены.

Impact:

- Логи могут бесконечно расти на диске.
- API keys, license-related payload fragments, file paths, machine identifiers или customer data могут попасть в persistent log.
- Privacy/compliance risk выше обычного, потому что приложение enterprise/desktop и работает с локальными пользовательскими данными.

Recommended audit follow-up:

- Ввести retention cap, payload cap, redaction policy и tests на secret-like strings.
- Разделить support-mode diagnostic logs и production default logs.

### W5-05 - Medium - Safe IPC errors still raw-log internal details

Evidence:

- `src-tauri/src/error.rs:83-100`
- `src-tauri/src/error.rs:108-116`

`safe_message()` возвращает обобщенные сообщения для SQL/IO/HTTP/Pool, но `Serialize for AppError` до сериализации делает `tracing::error!(error = %self, "IPC command error")`. Значит пользователь получает safe envelope, но persistent log может содержать raw SQL/IO/HTTP details, paths или payload fragments.

Impact:

- UI response выглядит безопасным, но forensic artifact сохраняет sensitive internals.
- В сочетании с W5-04 это повышает privacy risk.

Recommended audit follow-up:

- Проверить политику: что можно писать в production logs, а что только в support bundle после согласия пользователя.

### W5-06 - Medium - Renderer log IPC accepts arbitrary strings without size/redaction controls

Evidence:

- `src-tauri/src/commands/logger.rs:5-12`
- `src-tauri/src/startup/commands_registry.rs:85-87`
- `src/lib/tauri/api-keys.ts:68-80`

`log_info` и `log_error` принимают любой `String` и пишут его в tracing как `[Renderer] {message}`. Нет caps по длине, newline normalization, redaction или rate limit. Это не RCE само по себе, но при наличии широких Tauri capabilities и remote origin из Wave 4 превращает logger в persistence sink для произвольных renderer-controlled строк.

Impact:

- Log injection / log flooding.
- Сохранение sensitive frontend state в `app.log`.

Recommended audit follow-up:

- IPC payload size tests и redaction tests для logger commands.

### W5-07 - Medium - Backup import can silently lose WAL-only source data and still commit partial merges

Evidence:

- `src-tauri/src/commands/backup/restore.rs:163-182`
- `src-tauri/src/commands/backup/restore.rs:204-206`
- `src-tauri/src/commands/backup/restore.rs:241-244`
- `src-tauri/src/commands/backup/restore.rs:365-379`

Import копирует WAL/SHM companions best-effort (`let _ = fs::copy(...)`), `wal_checkpoint(TRUNCATE)` также игнорируется, затем temp WAL/SHM удаляются. Во время merge per-table insert failures логируются и skipped, FK violations становятся warnings, после чего transaction commits. Это может дать partial import, который выглядит успешным на уровне операции.

Impact:

- Потеря source data, если важные транзакции были только в WAL.
- Частичная миграция/merge без явного fail-closed поведения.
- Пользователь может считать import завершенным корректно.

Recommended audit follow-up:

- Fail-closed policy для WAL copy/checkpoint/FK violations.
- Golden tests с backup DB, где данные находятся в WAL companion.

### W5-08 - Medium - Windows installer trust signing is not configured

Evidence:

- `src-tauri/tauri.conf.json:47-50`
- `scripts/release/build.ps1:133-151`

`certificateThumbprint` = `null`, `timestampUrl` = empty string. Release scripts generate Tauri updater `.sig` via `npx tauri signer sign`, but this is not the same as Windows Authenticode signing/timestamping for installer trust. Updater signature protects Tauri auto-update verification; it does not give Windows SmartScreen/Authenticode publisher trust for downloaded installer UX and supply-chain checks.

Impact:

- Unsigned installer / weaker Windows trust posture.
- Harder incident response and customer verification.
- More false friction from SmartScreen and less publisher accountability.

Recommended audit follow-up:

- Add explicit Authenticode signing gate or documented accepted risk.
- Verify timestamping and certificate expiry behavior.

### W5-09 - Medium - Updater signature checks validate presence/shape, not key provenance

Evidence:

- `scripts/deploy/publish-update.js:230-234`
- `scripts/test/check-update-endpoint.mjs:166-174`
- `src-tauri/tauri.conf.json:69-73`

Deploy precheck only verifies `.sig` existence and length. Endpoint smoke decodes base64 and checks for minisign comment text. Neither check proves that the signature was made by the private key corresponding to `plugins.updater.pubkey`. A wrong private key can pass shape checks and fail client update verification later.

Impact:

- Broken updates can be published.
- Failure shifts from CI/deploy time to customer update time.

Recommended audit follow-up:

- Add offline verify step against configured updater pubkey before promotion.

### W5-10 - Medium - `--from-manifest` can promote a live manifest before remote artifact proof

Evidence:

- `scripts/deploy/publish-update.js:105-122`
- `scripts/deploy/publish-update.js:249-254`
- `scripts/deploy/publish-update.js:255-258`
- `scripts/deploy/publish-update.js:286-310`

`--from-manifest` mode assumes installer already exists on the server, skips artifact upload, validates only manifest fields/signature shape, promotes `{channel}.json`, then runs smoke test after promotion. If remote artifact is absent or mismatched, clients can see a promoted manifest before failure is detected.

Impact:

- Short window of broken update metadata.
- Rollback/redeploy path is less safe than normal upload path.

Recommended audit follow-up:

- Pre-promotion remote artifact HEAD/hash/signature verification.

### W5-11 - Medium - SQLite durability mode is a deliberate performance tradeoff that needs release policy

Evidence:

- `src-tauri/src/db/pool.rs:23-31`
- `src-tauri/src/db/pool.rs:45-53`
- `src-tauri/src/state/app_state.rs:75-80`

All pooled connections use WAL and `PRAGMA synchronous = NORMAL`. This is common for desktop performance, but it weakens crash/power-loss durability compared with `FULL`. Given restore/import are not yet crash-safe, the durability policy should be explicit and tested under failure scenarios.

Impact:

- Recent committed transactions may be more exposed during OS crash/power loss.
- Risk compounds with backup/restore/import findings.

Recommended audit follow-up:

- Decide policy per operation: normal UI writes vs backup/import/restore critical sections.
- Add failure-injection tests or documented accepted risk.

### W5-12 - Low - Production debug LogViewer is always mounted

Evidence:

- `src/components/providers/providers.tsx:28-35`
- `src/lib/logger.ts:42-46`
- `src/lib/logger.ts:222-230`

`Providers` always lazy-mounts `LogViewer`, and logger default is enabled in production at INFO+. This may be intentional for support, but no environment/support-mode gate was observed. It is lower severity than persistent logs, yet it can expose diagnostic messages in the UI.

Impact:

- Accidental diagnostic exposure to end users.
- Extra runtime surface in production.

Recommended audit follow-up:

- Gate debug viewer behind support-mode, dev flag, or explicit user action.

### W5-13 - Low - CSP/WebView hardening needs a documented exception review

Evidence:

- `src-tauri/tauri.conf.json:28`
- `src-tauri/tauri.conf.json:31-35`
- `src/components/charts/plugins/tooltip.ts:153-158`

CSP allows `style-src 'unsafe-inline'` and disables Tauri asset CSP modification for `style-src`. A targeted source scan found no dangerous HTML sink in app code; the one `innerHTML`-related hit was an avoidance comment and uses `textContent`. Still, because Wave 4 found remote origin + broad capabilities, CSP exceptions should be reviewed and documented. `additionalBrowserArgs` also disables multiple WebView2 features in production config; this may be performance-driven, but should be explicitly threat-modeled.

Impact:

- Lower defense-in-depth if an injection bug appears later.
- Hardening exceptions can become invisible institutional knowledge.

Recommended audit follow-up:

- Maintain a CSP exception register with justification and owner.
- Keep targeted regression scan for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`.

## Reconfirmed Existing High Findings

These were reconfirmed during Wave 5, but should be counted under earlier waves to avoid duplicate severity inflation:

- W3-02: DB downgrade logs warning but then rewrites newer `schema_meta.schema_version` back to `CURRENT_SCHEMA_VERSION`. Evidence reconfirmed at `src-tauri/src/db/migration.rs:107-113` and `src-tauri/src/db/migration.rs:143-152`.
- W3-08: Release gate can test stale binary. Wave 5 adds `deploy:update` as a second concrete stale-artifact path.
- W4-06/W4-08/W4-09: Manual write-gate policy leaves mutating commands ungated. Wave 5 restore/import findings increase impact because backup restore/import are high-value mutation paths.

## Cross-Wave Rollup

### Wave 1

Initial implementation review and first audit triage. Main value: scoped high-risk areas and created starting artifact `wave1-summary.md`.

### Wave 2

Enterprise quick gate status: **NO-GO**.

Important results:

- `npm run audit:enterprise:quick`: 13 checks, 8 pass, 5 fail.
- `npx tsc --noEmit`: fail.
- `npm run lint`: fail.
- `npm test`: fail.
- Core Rust `cargo check` / `cargo test`: pass.
- Core Rust `cargo clippy`: fail.
- `npm audit --omit=dev`: pass.
- `cargo audit` raw checks found dependency vulnerabilities/policy ignores.

### Wave 3

Deep implementation audit surfaced product-behavior bugs:

- IPC reset commands accept caller-supplied user IDs.
- DB downgrade corrupts schema metadata.
- Report/export unit inconsistencies.
- Non-finite numeric parser acceptance.
- Enterprise audit false-green exit code.
- Release gate stale binary risk.

### Wave 4

Tauri boundary/licensing audit found the strongest security surface:

- Remote origin has same broad default desktop capabilities.
- Broad FS allowlist includes `$HOME/**` and user data directories.
- Multiple mutating IPC commands are not license/write gated.
- Backup/reagent/operator/data-flow/sync mutations need command-level policy.
- Parser/import payload caps and fuzzing are incomplete.

### Wave 5

Final hardening audit added:

- Crash consistency and backup restore/import risks.
- Release/update/signing path bypasses.
- Persistent log retention and privacy risks.
- CSP/WebView/debug-surface hardening notes.

## Overall Release Recommendation

Recommendation: **do not ship until at least High findings across Wave 2-5 are resolved or explicitly risk-accepted**.

Suggested priority order:

1. Tauri capability + remote origin lockdown from Wave 4.
2. License/write gates for all mutating IPC commands from Wave 4.
3. DB restore/import/downgrade crash/data safety from Wave 3/Wave 5.
4. Release pipeline single-path hardening from Wave 3/Wave 5.
5. Build/test gate failures from Wave 2.
6. Logging/privacy retention controls from Wave 5.

## Verification Notes

- This wave was static/source audit only.
- No product code was modified.
- No release/deploy commands were executed.
- No destructive filesystem operations were performed.
- Some earlier dynamic frontend IPC artifacts are partial because the dynamic run failed before completion; those artifacts are preserved in the final package as partial evidence, not as a full pass.
