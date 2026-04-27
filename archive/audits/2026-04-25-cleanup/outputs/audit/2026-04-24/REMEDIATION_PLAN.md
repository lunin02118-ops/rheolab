# RheoLab Enterprise V2 - Remediation Plan

Дата: 2026-04-24  
Источник: audit waves 1-5  
Режим: план исправлений, без product-code changes в этом документе

## Goal

Перевести результаты аудита в управляемый backlog исправлений: сначала закрыть release blockers и риски потери данных, затем стабилизировать gates и повторно пройти audit.

Current release status: **NO-GO**.

## Operating Rules

- Не чинить все одновременно: каждый блок должен иметь отдельный PR/commit set и проверяемый acceptance checklist.
- Любой High finding закрывать только с negative/regression tests.
- После каждого блока обновлять audit status: `open`, `mitigated`, `fixed`, `risk-accepted`.
- Не считать finding закрытым только по коду: нужен минимум один воспроизводимый test/gate.
- Сначала закрывать boundary/data-loss/release-chain risks, потом hygiene/performance.

## Phase 0 - Freeze Baseline

Priority: P0  
Goal: зафиксировать текущую точку отсчета.

Tasks:

- Считать `outputs/audit/2026-04-24/audit-artifacts-all-waves` baseline package.
- Создать issue/backlog entries для High/Medium findings Wave 3-5.
- Для каждого finding указать owner, severity, affected files, acceptance tests.
- Решить, какие Medium findings можно risk-accept до релиза, а какие блокируют релиз.

Acceptance:

- Есть backlog с traceability: `finding id -> task -> test -> status`.
- Release checklist явно ссылается на audit package и этот plan.

## Phase 1 - Tauri Boundary Lockdown

Priority: P0  
Primary source: Wave 4  
Why first: это главный security boundary. Пока renderer/remote origin имеют широкие capabilities, остальные риски усиливаются.

Scope:

- W4-01 remote origin shares default desktop capability set.
- W4-02 broad FS allowlist.
- W4-12/W4-13 over-provisioned updater/process/http/os/opener/shell capabilities.
- W5-06 renderer log IPC persistence sink, if exposed through broad boundary.
- W5-13 CSP/WebView hardening review.

Tasks:

- Разделить capabilities для local app и remote origin.
- Убрать или сузить `$HOME/**`, `$APPDATA/**`, `$LOCALAPPDATA/**` там, где не требуется.
- Отключить неиспользуемые plugin permissions или вынести в отдельные capability scopes.
- Зафиксировать CSP exception register: почему нужен `unsafe-inline`, кто owner, когда пересмотреть.
- Добавить static capability audit script или snapshot test.

Acceptance:

- Remote origin не имеет доступа к desktop FS/process/shell/plugin surface, кроме явно нужного минимума.
- Capability diff review показывает, что каждый permission имеет owner/justification.
- Negative test или static check падает при повторном расширении FS/plugin permissions.

Suggested verification:

- `npm run audit:enterprise:quick`
- targeted static check for `src-tauri/capabilities/*.json`
- manual review of `src-tauri/tauri.conf.json`

## Phase 2 - Systematic Mutating IPC Write Gate

Priority: P0  
Primary source: Wave 4  
Why second: сейчас часть mutating commands обходит license/write policy.

Scope:

- W4-03 experiments delete ungated.
- W4-04 sync import/resolve ungated.
- W4-05 backup create/delete/restore ungated.
- W4-06 systemic manual policy gap.
- W4-07 reagents mutations ungated.
- W4-08 operators/labs mutations ungated.
- W4-09 data-flow artifacts/conflicts ungated.

Tasks:

- Составить authoritative command registry: command name, read/write, destructive/non-destructive, required license capability.
- Ввести единый guard/helper для write operations вместо ручных scattered checks.
- Применить guard ко всем mutating IPC.
- Добавить negative tests: invalid/expired/read-only license cannot mutate.
- Добавить static regression check: new mutating command without guard fails audit.

Acceptance:

- Все mutating commands имеют единый gate или documented exception.
- Existing write-gated commands продолжают проходить.
- Tests покрывают at least: experiment delete, backup restore/delete/create, sync import/resolve, reagent/operator/lab mutation.

Suggested verification:

- `cargo test --manifest-path src-tauri/Cargo.toml`
- targeted Rust tests for licensing/write-denied paths
- command registry static scan

## Phase 3 - Data Safety: Restore, Import, Downgrade

Priority: P0  
Primary source: Wave 3 + Wave 5  
Why third: риск потери пользовательской БД и silent corruption.

Scope:

- W5-01 non-atomic pending restore delete-before-copy.
- W3-02/Wave5 reconfirmed downgrade rewrites future schema version.
- W5-07 import can lose WAL-only source data and commit partial merge.
- W5-11 durability policy needs release decision.

Tasks:

- Restore: перейти на temp validated DB + atomic replace strategy; не удалять live DB до успешной подготовки replacement.
- Restore: валидировать pending DB до swap; сохранять rollback copy.
- Downgrade: if stored schema version > current, fail closed or open read-only recovery mode; не upsert schema version down.
- Import: fail closed on WAL/SHM copy/checkpoint failure.
- Import: treat FK violations/per-table insert failures as operation failure unless explicitly accepted.
- Define SQLite durability policy: `NORMAL` for regular UI writes vs stricter mode for backup/import/restore critical sections.

Acceptance:

- Failure injection tests show restore cannot leave app without either old DB or new DB.
- Downgrade test asserts future schema version is preserved and unsafe migrations do not run.
- WAL-only source DB import test preserves data or fails loudly.
- Partial merge test fails operation instead of silently committing incomplete import.

Suggested verification:

- `cargo test --manifest-path src-tauri/Cargo.toml backup`
- `cargo test --manifest-path src-tauri/Cargo.toml migration`
- manual Windows filesystem behavior check for atomic rename/replace semantics

## Phase 4 - Release Pipeline Unification

Priority: P0  
Primary source: Wave 3 + Wave 5  
Why fourth: without this, fixes can still ship through the wrong path.

Scope:

- W5-02 CI tag release bypasses hardened release flow.
- W5-03 `deploy:update` can publish stale/non-gated artifacts.
- W5-08 no Windows Authenticode signing/timestamp config.
- W5-09 updater signature checks validate shape, not configured key.
- W5-10 `--from-manifest` promotes before remote artifact proof.
- W3-08 release gate stale binary risk.

Tasks:

- Make one blessed release entrypoint for CI and manual release, likely `scripts/release/prepare-production.js`.
- CI tag workflow must call the blessed entrypoint, not direct `cargo tauri build`.
- Enforce production compile-time secrets in CI: integrity, beta channel, alpha channel.
- Require updater `.sig`; `if-no-files-found: ignore` should not be acceptable for release artifacts.
- Deploy must consume manifest/checksum/provenance from release preparation, not scan arbitrary target folder.
- Add signature verification against configured `plugins.updater.pubkey`.
- Add pre-promotion remote artifact HEAD/hash verification for `--from-manifest`.
- Decide Authenticode policy: implement signing/timestamping or document explicit risk acceptance.

Acceptance:

- A tag release cannot produce artifact without release gate proof, updater signature and expected hashes.
- `deploy:update` refuses artifacts not listed in current release manifest.
- Wrong updater private key fails before promotion.
- Missing remote artifact fails before `{channel}.json` promotion.

Suggested verification:

- Dry-run release pipeline on CI-like environment.
- `npm run release:prepare -- --dry-run`
- `npm run test:release-gate -- --build`
- updater endpoint smoke + offline minisign verification against configured pubkey

## Phase 5 - Build/Test Gate Recovery

Priority: P1  
Primary source: Wave 2  
Why now: after safety/security blockers, restore green gates so regressions become visible.

Scope:

- TypeScript failures.
- ESLint failures.
- Vitest failures.
- Rust clippy failures.
- PHP runtime/license-server lint missing in quick audit.
- Dependency vulnerability policy clarity.

Tasks:

- Fix TypeScript compile errors first; they often hide downstream test/lint noise.
- Fix Vitest failing suites and ensure tests are meaningful, not just loosened.
- Fix ESLint errors or document rule changes.
- Fix Rust clippy for `rheolab-core`.
- Decide PHP dependency/runtime requirement or remove PHP gate from enterprise audit if not part of supported local workflow.
- Review `cargo audit` ignore policy and update dependency risk register.

Acceptance:

- `npx tsc --noEmit` passes.
- `npm run lint` passes.
- `npm test` passes.
- `cargo clippy --manifest-path src/rust/rheolab-core/Cargo.toml --all-targets` passes.
- `npm run audit:enterprise:quick` no longer false-green/NO-GO.

Suggested verification:

- `npm run audit:enterprise:quick`
- `npm run test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml`

## Phase 6 - Parser/Input Hardening and Fuzz Readiness

Priority: P1  
Primary source: Wave 3 + Wave 4  
Why: reduces malformed input, DoS and numeric correctness risks.

Scope:

- W3-06 non-finite numeric tokens can enter parsed points.
- W4-10 parser IPC no backend max-size cap.
- W4-11 sync delta import path no validation/size cap.
- W4-17 parser fuzzing not wired.

Tasks:

- Add backend payload caps for parser and sync import.
- Reject `NaN`, `Infinity`, `-Infinity` at parser boundary.
- Add property tests for numeric normalization.
- Wire fuzz target for parser/tokenizer in CI nightly or manual gate.

Acceptance:

- Malformed/non-finite fixtures fail closed.
- Oversized parser/sync payloads fail with safe error.
- Fuzz harness can run locally and has seed corpus from real fixtures.

Suggested verification:

- `npm run test:parsing`
- Rust parser tests in `src/rust/rheolab-core`
- cargo fuzz/manual fuzz smoke if harness is introduced

## Phase 7 - Report/Export Correctness

Priority: P1  
Primary source: Wave 3  
Why: user-facing correctness and regulatory/report trust.

Scope:

- W3-03 Imperial temp/pressure not honored in report stats.
- W3-04 comparison XLSX hardcodes cP label/format after conversion.
- W3-05 `showRawData=false` honored by PDF not XLSX.
- W4-15 report settings parity needs exhaustive contracts.

Tasks:

- Create report settings contract matrix: PDF/XLSX, single/comparison, SI/Imperial, raw data on/off.
- Add golden tests for units and visibility settings.
- Ensure labels and numeric transforms are tied to one shared unit formatter.

Acceptance:

- Contract tests pass for all report variants.
- Existing fixtures produce expected unit labels and hidden raw data behavior.

Suggested verification:

- report generator Rust tests
- Playwright release-gate report workflow
- XLSX/PDF snapshot assertions where stable

## Phase 8 - Logging/Privacy Controls

Priority: P1/P2 depending on customer release posture  
Primary source: Wave 5  
Why: not always release-blocking, but important for enterprise/privacy posture.

Scope:

- W5-04 persistent logs no retention cap and unsanitized sensitive data.
- W5-05 safe IPC errors raw-log internal details.
- W5-06 renderer log IPC arbitrary payloads.
- W5-12 production LogViewer always mounted.

Tasks:

- Add retention cap for `app.log` rotations.
- Add redaction for license keys, API keys, bearer tokens, file paths if needed.
- Add payload max length and newline normalization for log IPC.
- Decide production LogViewer policy: support-mode gate, dev-only, or documented product feature.
- Avoid raw `%self` infra error logging in production unless support mode enabled.

Acceptance:

- Tests prove secret-like strings are redacted.
- Large renderer log payload is truncated/rejected.
- Log retention cannot grow unbounded.
- Production debug viewer behavior is intentional and documented.

Suggested verification:

- unit tests for logger/redaction
- manual app log inspection after forced errors

## Phase 9 - Re-Audit and Release Candidate Gate

Priority: P0 before release  
Goal: prove closure, not just apply patches.

Tasks:

- Re-run all relevant automated gates.
- Re-run capability/write-gate static audit.
- Re-run backup/restore/import failure tests.
- Re-run release dry-run and deployment smoke.
- Produce `POST_REMEDIATION_AUDIT_REPORT.md` comparing open vs closed findings.

Acceptance:

- All P0 findings are `fixed` or formally `risk-accepted`.
- All required gates pass.
- Release candidate has auditable artifact provenance.

Suggested final command set:

- `npm run audit:enterprise:quick`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml`
- `cargo clippy --manifest-path src/rust/rheolab-core/Cargo.toml --all-targets`
- `npm audit --omit=dev`
- `cargo audit` from `src-tauri/`
- release dry-run / release-gate / updater verification

## Suggested Work Order

Recommended sequence:

1. Phase 1 - Tauri boundary lockdown.
2. Phase 2 - Mutating IPC write gate.
3. Phase 3 - DB restore/import/downgrade safety.
4. Phase 4 - Release pipeline unification.
5. Phase 5 - Build/test gate recovery.
6. Phase 6 - Parser/input hardening.
7. Phase 7 - Report/export correctness.
8. Phase 8 - Logging/privacy controls.
9. Phase 9 - Re-audit and release candidate gate.

If only one sprint is available before release, do Phases 1-4 and the minimal part of Phase 5 needed to make gates trustworthy. Everything else should be explicitly risk-accepted, not silently deferred.
