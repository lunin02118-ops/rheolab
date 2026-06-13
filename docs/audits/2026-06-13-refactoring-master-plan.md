# RheoLab — полный план аудита, стабилизации и рефакторинга

Дата: 2026-06-13
Статус: agent-ready execution plan
Цель: безопасно улучшить архитектуру, стабильность, производительность, безопасность и maintainability без «большого взрыва» и без неконтролируемого переписывания.

---

## 0. Основная стратегия

Рефакторинг выполняется маленькими проверяемыми PR. Каждый PR должен иметь:

1. Одну главную цель.
2. Минимальный diff.
3. Явный список затронутых файлов.
4. Список команд, которые агент выполнил.
5. Результаты команд с exit code.
6. Скрин/лог или короткий excerpt для падений.
7. Rollback plan.
8. Отдельный блок «Поведенческие изменения: да/нет».

Запрещено:

- смешивать форматирование и функциональные изменения в одном PR;
- делать массовый reformat всего репозитория;
- одновременно менять архитектуру, тесты, CI и бизнес-логику без необходимости;
- скрывать failing tests;
- удалять legacy API без compile/test gate;
- менять license/security behavior без отдельного security review;
- коммитить production secrets, private keys, live `.env`, реальные дампы данных;
- коммитить тяжёлые generated artifacts, если они не являются curated summary.

Рекомендуемый рабочий процесс:

```text
main
 ├─ audit/00-baseline
 ├─ audit/01-error-boundary
 ├─ audit/02-ipc-policy
 ├─ audit/03-reports-split
 ├─ audit/04-security-capabilities
 ├─ audit/05-db-backup-hardening
 ├─ audit/06-performance-budgets
 └─ audit/07-release-platform
```

Каждая ветка создаётся от актуального `main` или от предыдущего уже принятого PR.

---

## 1. Definition of Done для любого PR

PR считается готовым только если:

```text
[ ] проект собирается;
[ ] lint/typecheck проходят или явно задокументировано, почему нет;
[ ] Rust tests проходят или явно задокументировано, почему нет;
[ ] frontend tests проходят или явно задокументировано, почему нет;
[ ] security-sensitive изменения имеют отдельную секцию review;
[ ] performance-sensitive изменения имеют baseline до/после;
[ ] public IPC surface обновлён в документации/registry/audit;
[ ] нет новых секретов;
[ ] нет новых больших generated files без причины;
[ ] rollback plan понятен;
[ ] агент оставил отчёт в PR body или progress summary.
```

Базовые команды, которые агент должен проверить в репозитории и использовать как canonical gate:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:release-gate
npm run audit:frontend-ipc
npm run audit:large-ipc
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Если какая-то команда отсутствует, агент фиксирует это в отчёте и предлагает корректный script, но не подменяет факт успешного выполнения.

Для подпроектов:

```bash
npm --prefix website ci
npm --prefix website run build
composer --working-dir=license-server validate
composer --working-dir=license-server test
```

Если `website` или `license-server` имеют другую систему команд, агент обязан указать фактическую.

---

## 2. Поток отчётности агента

После каждого шага агент должен предоставить владельцу и проверяющему:

```markdown
## Agent status

Branch:
Commit:
PR:
Phase:

## Что изменено
- ...

## Файлы
- ...

## Команды
| Команда | Exit code | Результат |
|---|---:|---|
| npm run lint | 0 | ok |
| npm run typecheck | 0 | ok |
| cargo test ... | 1 | падает test X |

## Падения / отклонения
- ...

## Риски
- ...

## Нужна проверка человеком
- ...

## Rollback
- revert commit ...
```

Raw logs не коммитить в репозиторий, кроме маленьких curated summaries. Большие logs должны быть CI artifacts или прикреплены к PR как файл.

---

## 3. Приоритеты

### P0 — остановить и чинить немедленно

- утечка секретов;
- private key в репозитории;
- production build не собирается;
- критическая уязвимость авторизации/license gate;
- DB restore может потерять данные;
- updater может принять неподписанный/неверный артефакт;
- команда IPC позволяет читать/писать произвольный путь без проверки.

### P1 — ближайший цикл

- raw error logging на IPC boundary;
- direct heavy IPC payload в production;
- слишком широкий Tauri capability;
- reports/export монолит;
- release gate можно обойти;
- long-running job нельзя отменить или безопасно завершить;
- backup/restore без atomic rollback;
- отсутствие crash diagnostics при `panic=abort`.

### P2 — roadmap

- application layer;
- declarative IPC policy;
- DB performance indexes;
- perf budgets;
- subproject quality gates;
- documentation/version drift;
- generated runtime artifacts policy.

### P3 — качество и DX

- naming;
- docs cleanup;
- small duplication cleanup;
- локальное упрощение hooks/components;
- улучшение developer scripts.

---

# 4. План PR по этапам

---

## PR-001 — Baseline audit и унификация проверок

### Цель

Зафиксировать текущее состояние без изменения поведения. Этот PR создаёт baseline: какие проверки реально проходят, какие падают, какие команды существуют, какие подпроекты выпадают из общего gate.

### Тип изменения

Documentation + scripts only. Без изменения runtime behavior.

### Ветка

```bash
git checkout -b audit/00-baseline
```

### Задачи агента

1. Проверить наличие и поведение команд:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:release-gate
npm run audit:frontend-ipc
npm run audit:large-ipc
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npm --prefix website run build
composer --working-dir=license-server validate
composer --working-dir=license-server test
```

2. Зафиксировать фактический status matrix.
3. Проверить, какие scripts есть в `package.json`, `website/package.json`, `license-server/composer.json`.
4. Проверить, какие директории исключены из ESLint/TS checks.
5. Создать `docs/audits/progress/2026-06-13-baseline.md`.
6. Не исправлять падающие тесты в этом PR, кроме очевидной поломки самого baseline-doc.

### Acceptance criteria

```text
[ ] создан baseline report;
[ ] команды перечислены с exit code;
[ ] указаны unavailable/missing commands;
[ ] указаны подпроекты без quality gate;
[ ] нет runtime behavior changes;
[ ] PR можно безопасно revert-нуть без последствий.
```

### Rollback

Удалить baseline report и любые добавленные helper scripts.

---

## PR-002 — Чистая сериализация ошибок и безопасный IPC error boundary

### Цель

Убрать side effect логирования из serialization ошибки. Сериализация должна только сериализовать. Логирование должно происходить на IPC boundary с redaction.

### Тип изменения

Backend reliability/security.

### Риск

Средний. Ошибки и логи — sensitive area. Нужны тесты.

### Задачи агента

1. Найти `AppError` и `impl Serialize for AppError`.
2. Убрать `tracing::error!` или любой logging side effect из `serialize`.
3. Добавить отдельную функцию/модуль:

```rust
pub fn log_ipc_error(command: &'static str, err: &AppError, request_id: Option<&str>) {
    tracing::error!(
        command,
        request_id = request_id.unwrap_or("unknown"),
        kind = err.kind_str(),
        message = err.safe_message(),
        "IPC command failed"
    );
}
```

4. Если `kind_str()` отсутствует, добавить safe метод без раскрытия raw internals.
5. Обновить command wrappers / safe invoke boundary, если есть общий wrapper.
6. Если общего wrapper нет — добавить небольшой helper без массового переписывания всех commands.
7. Добавить unit tests:

```text
- AppError serialization returns {kind, message};
- serialization does not panic;
- safe_message does not expose raw SQL/IO path details;
- log helper uses safe_message, not Display/raw error.
```

8. Проверить, что frontend error response не изменил contract, если contract уже используется.

### Acceptance criteria

```text
[ ] Serialize implementation не логирует;
[ ] IPC/log boundary использует safe_message;
[ ] тесты ошибок проходят;
[ ] нет raw secrets/path dumps в стандартном IPC response;
[ ] cargo test проходит или documented failures.
```

### Команды

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npm run typecheck
```

### Rollback

Revert PR. Поведение IPC errors вернётся к старому.

---

## PR-003 — IPC policy inventory и high-risk command metadata

### Цель

Сделать IPC surface управляемым: каждая команда получает policy metadata. Сначала inventory без изменения runtime behavior.

### Тип изменения

Architecture/security tooling.

### Задачи агента

1. Найти текущий Tauri command registry.
2. Создать `src-tauri/src/ipc_policy.rs` или аналогичный модуль.
3. Ввести структуры:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpcRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IpcCommandPolicy {
    pub name: &'static str,
    pub risk: IpcRisk,
    pub requires_license: bool,
    pub requires_audit_log: bool,
    pub allowed_in_demo: bool,
    pub allows_external_network: bool,
    pub allows_file_write: bool,
    pub allows_db_mutation: bool,
}
```

4. Создать статический список политик для всех зарегистрированных команд.
5. Добавить тест:

```text
- every registered command has a policy entry;
- every HIGH command requires audit log or documented exception;
- file write commands are marked;
- external network commands are marked;
- license-sensitive commands are marked.
```

6. В этом PR не менять actual command list, кроме очевидных test/demo cfg-guards, если они compile-safe и отдельно описаны.

### Acceptance criteria

```text
[ ] IPC policy inventory добавлен;
[ ] тесты проверяют полноту registry → policy;
[ ] high-risk commands видны одной таблицей;
[ ] runtime behavior не изменён;
[ ] docs обновлены.
```

### Команды

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run audit:frontend-ipc
npm run audit:large-ipc
```

### Rollback

Удалить policy module и тесты.

---

## PR-004 — Удаление direct heavy comparison IPC из production path

### Цель

Оставить production export comparison только через by-IDs path. Direct payload commands должны быть либо удалены, либо доступны только под test/debug cfg.

### Тип изменения

Performance/security/stability.

### Риск

Высокий, потому что меняется публичная IPC surface. Нужна проверка frontend usage.

### Задачи агента

1. Найти commands вида:

```text
reports_generate_comparison_pdf
reports_generate_comparison_excel
reports_generate_comparison_pdf_by_ids
reports_generate_comparison_excel_by_ids
```

2. Найти frontend usages.
3. Перевести frontend на by-IDs methods.
4. Direct payload methods:

Вариант A, предпочтительно:

```rust
#[cfg(any(test, debug_assertions))]
#[tauri::command]
pub async fn reports_generate_comparison_pdf(...) -> ...
```

Вариант B:

полностью удалить, если не нужны для тестов.

5. Добавить тест/audit:

```text
- production registry does not expose direct comparison payload commands;
- frontend does not call legacy comparison export methods;
- by-IDs commands exist and are covered;
- max IPC payload audit passes.
```

6. Обновить docs/API notes.

### Acceptance criteria

```text
[ ] frontend не использует direct payload comparison export;
[ ] prod registry не регистрирует direct payload comparison export;
[ ] by-IDs export работает;
[ ] audit:large-ipc проходит;
[ ] typecheck проходит;
[ ] cargo test проходит или failures documented.
```

### Команды

```bash
npm run typecheck
npm run lint
npm run audit:frontend-ipc
npm run audit:large-ipc
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

### Rollback

Вернуть registry entries и frontend methods.

---

## PR-005 — Reports module split, фаза 1: mechanical extraction

### Цель

Разбить большой `reports.rs` на модули без изменения поведения. Это должен быть почти чистый move/extract PR.

### Тип изменения

Maintainability.

### Риск

Средний. Большой diff, но без логики.

### Целевая структура

```text
src-tauri/src/commands/reports/
  mod.rs
  single.rs
  comparison.rs
  validation.rs
  license_gate.rs
  response.rs
  cache.rs
  jobs.rs
  tests.rs
```

Если Rust module visibility требует другую структуру — агент выбирает минимальную compile-safe структуру и объясняет.

### Задачи агента

1. Разделить файл по зонам ответственности:

```text
IPC handlers → single.rs / comparison.rs
validation → validation.rs
license checks → license_gate.rs
binary response helpers → response.rs
cache/artifacts → cache.rs
job orchestration → jobs.rs
tests/fixtures → tests.rs или рядом с модулем
```

2. Не менять логику, имена IPC commands и response contracts.
3. Сохранять git history насколько возможно через `git mv`, если применимо.
4. После каждого extract запускать `cargo check`.
5. В конце запустить полный Rust gate.

### Acceptance criteria

```text
[ ] старый reports.rs либо удалён, либо стал маленьким mod facade;
[ ] каждая зона ответственности в отдельном модуле;
[ ] behavior changes отсутствуют;
[ ] cargo test проходит;
[ ] размер самого большого reports module сильно меньше исходного;
[ ] PR description содержит mapping old → new modules.
```

### Команды

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
npm run typecheck
```

### Rollback

Revert PR. Так как изменение mechanical, rollback простой.

---

## PR-006 — Reports application layer

### Цель

После mechanical split вынести бизнес-сценарии report generation из `commands` в application layer.

### Тип изменения

Architecture.

### Риск

Средний/высокий. Меняется структура вызовов.

### Целевая структура

```text
src-tauri/src/application/reports/
  mod.rs
  generate_single_report.rs
  generate_comparison_report.rs
  build_report_input.rs
  artifact_cache.rs
  report_limits.rs
```

### Правило слоя

```text
commands/reports/*:
  - принимает IPC input;
  - парсит request;
  - вызывает application use case;
  - возвращает IPC response.

application/reports/*:
  - license/report policy;
  - DB read orchestration;
  - cache hit/miss orchestration;
  - report rendering call;
  - domain-level errors.
```

### Задачи агента

1. Выделить use case:

```rust
pub async fn generate_comparison_report_by_ids(ctx, input) -> Result<ReportBytes, AppError>
```

2. Commands должны стать thin wrappers.
3. License/report limits переместить в reusable policy module.
4. Добавить unit tests для policy без Tauri runtime.
5. Добавить integration tests для by-IDs flow.
6. Обновить IPC policy metadata.

### Acceptance criteria

```text
[ ] commands thin;
[ ] business/report orchestration вне commands;
[ ] policy тестируется без Tauri runtime;
[ ] public IPC contract не сломан;
[ ] report generation tests проходят.
```

### Команды

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run typecheck
npm run test:release-gate
```

### Rollback

Revert PR, если split из PR-005 уже принят.

---

## PR-007 — Tauri capabilities hardening и AI/API opt-in

### Цель

Сузить capability surface. Внешние network endpoints, особенно AI/API, должны быть явно opt-in и отдельно отключаемы.

### Тип изменения

Security/privacy.

### Риск

Высокий. Может повлиять на runtime permissions.

### Задачи агента

1. Инвентаризировать current Tauri capabilities:

```text
file read/write
http/network
shell/window
updater
logger
backup/restore
AI/Groq/API
```

2. Разделить capabilities:

```text
capabilities/default.json
capabilities/export.json
capabilities/backup.json
capabilities/ai.json
capabilities/updater.json
```

3. Вынести external AI/API endpoint в отдельный capability и feature/settings gate.
4. Добавить UI/setting флаг:

```text
AI integration disabled by default.
Перед отправкой данных во внешний API пользователь должен явно включить функцию.
```

5. Добавить tests/audit:

```text
- AI/network command недоступен без opt-in;
- export path не требует AI capability;
- backup path не получает лишних network permissions;
- capabilities do not contain unnecessary wildcards;
- docs/privacy updated.
```

6. Проверить CSP:

```text
- обосновать или убрать unsafe-inline;
- connect-src минимален;
- external endpoints documented.
```

### Acceptance criteria

```text
[ ] AI/API network access opt-in;
[ ] capabilities split;
[ ] external endpoints documented;
[ ] no broad wildcard permissions;
[ ] tauri dev/build smoke passes.
```

### Команды

```bash
npm run typecheck
npm run lint
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run tauri:build
```

Если `npm run tauri:build` слишком тяжёлый для агента, он должен хотя бы выполнить `cargo check` + frontend build и явно отметить, что full packaging не запускался.

### Rollback

Revert capabilities split. Вернуть прежний config.

---

## PR-008 — Backup/restore и DB import hardening

### Цель

Сделать backup/restore безопасными к сбоям, неправильным файлам, schema mismatch и path traversal.

### Тип изменения

Data safety/security.

### Риск

Высокий.

### Задачи агента

1. Найти команды:

```text
backup_create
backup_restore
backup_delete
backup_import
backup_export
sync import/export если есть
```

2. Добавить/проверить path validation:

```text
- canonicalize path;
- reject symlink traversal;
- allowed extensions;
- magic/header check для DB, JSON, ZIP если применимо;
- max file size;
- user-selected path only;
- no arbitrary overwrite.
```

3. Для DB restore:

```text
- открыть импортируемую DB read-only/temp;
- проверить schema_meta/version;
- проверить required tables/indexes;
- выполнить integrity_check;
- сделать pre-restore backup текущей DB;
- выполнить atomic swap;
- rollback on failure;
- audit log событие restore.
```

4. Добавить tests:

```text
- rejects ../ traversal;
- rejects symlink path;
- rejects wrong extension;
- rejects corrupt DB;
- rejects wrong schema version;
- pre-restore backup created;
- failure rolls back current DB;
- success updates schema_meta consistently.
```

### Acceptance criteria

```text
[ ] restore cannot overwrite arbitrary file;
[ ] corrupt/wrong DB rejected;
[ ] restore atomic;
[ ] rollback tested;
[ ] high-risk command policy updated;
[ ] tests pass.
```

### Команды

```bash
cargo test --manifest-path src-tauri/Cargo.toml backup -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run test:release-gate
```

### Rollback

Revert PR. Если миграции затронуты — нужен отдельный rollback note.

---

## PR-009 — DB performance/integrity indexes

### Цель

Проверить и добавить индексы/constraints под реальные read/write paths без риска порчи данных.

### Тип изменения

Performance/data integrity.

### Риск

Средний. Миграции требуют аккуратности.

### Задачи агента

1. Собрать список query patterns:

```text
experiment list/filter/search
experiment by date/status/operator/lab
report artifact lookup
analysis cache lookup by hash/experiment id
sync outbox/inbox by status/time
conflicts by status/entity
reagents/operators/labs lookup
```

2. Проверить existing indexes.
3. Предложить миграцию с `CREATE INDEX IF NOT EXISTS`.
4. Не добавлять индексы вслепую: каждый индекс должен иметь reason.
5. Добавить perf regression dataset/test, если уже есть infrastructure.
6. Проверить migration idempotency.

### Acceptance criteria

```text
[ ] каждый новый индекс имеет query justification;
[ ] migration idempotent;
[ ] DB perf test до/после приложен;
[ ] no full table scan на critical list/filter если возможно;
[ ] cargo tests pass.
```

### Команды

```bash
cargo test --manifest-path src-tauri/Cargo.toml migration -- --test-threads=1
npm run perf:db:regression
npm run perf:db:scale
```

Если perf scripts недоступны, агент фиксирует это и прикладывает альтернативный sqlite EXPLAIN QUERY PLAN.

### Rollback

Миграционный rollback должен быть описан отдельно. Для indexes обычно безопасно `DROP INDEX IF EXISTS`, но production rollback зависит от migration system.

---

## PR-010 — Performance budgets и large payload guardrails

### Цель

Сделать performance не разовой проверкой, а gate с бюджетами.

### Тип изменения

Performance CI/tooling.

### Задачи агента

1. Найти существующие perf scripts и budgets.
2. Зафиксировать baseline:

```text
single report PDF p50/p95
comparison PDF by IDs p50/p95
analysis by ID p50/p95
DB list/filter p95
frontend heap peak
native memory peak
IPC payload size
```

3. Добавить budget config:

```json
{
  "ipcMaxPayloadKb": 512,
  "comparisonPdfP95Ms": 5000,
  "singlePdfP95Ms": 2000,
  "dbFilterP95Ms": 150,
  "frontendHeapPeakMb": 512
}
```

Числа должны быть согласованы с фактическим baseline. Не ставить фантастические значения.

4. Добавить CI-friendly script:

```bash
npm run perf:budget
```

5. При превышении бюджета script должен падать с понятным diff.

### Acceptance criteria

```text
[ ] есть baseline;
[ ] есть budget config;
[ ] perf:budget deterministic enough for CI;
[ ] direct heavy IPC payloads fail audit;
[ ] PR содержит before/after таблицу.
```

### Команды

```bash
npm run perf:compare
npm run perf:budget
npm run audit:large-ipc
```

### Rollback

Удалить budget script/config. Runtime behavior не должен зависеть от PR.

---

## PR-011 — Subproject quality gates: scripts, website, license-server

### Цель

Закрыть blind spots: основной ESLint/TS не должен притворяться аудитом всего репозитория.

### Тип изменения

CI/tooling.

### Задачи агента

1. Для `scripts/`:

```text
- добавить tsconfig.scripts.json если нужны TS checks;
- eslint scripts или отдельный config;
- запретить silent process exits без error context;
- проверить shell/node scripts на paths/secrets.
```

2. Для `website/`:

```text
- npm --prefix website ci/build/lint;
- link check если есть;
- env.example без secrets;
- no tracking/network surprises.
```

3. Для `license-server/`:

```text
- composer validate;
- phpunit;
- PHPStan/Psalm level realistic;
- PHPCS если возможно;
- migration tests;
- rate-limit/auth/signature tests.
```

4. Добавить top-level scripts:

```json
{
  "check:scripts": "...",
  "check:website": "...",
  "check:license-server": "...",
  "check:subprojects": "npm run check:scripts && npm run check:website && npm run check:license-server"
}
```

### Acceptance criteria

```text
[ ] website quality gate есть;
[ ] license-server quality gate есть;
[ ] scripts quality gate есть;
[ ] top-level check:subprojects есть;
[ ] failing gates documented, not hidden.
```

### Команды

```bash
npm run check:subprojects
npm run check:release
```

### Rollback

Удалить новые scripts/configs.

---

## PR-012 — Release gate, signing verification и updater safety

### Цель

Сделать production release воспроизводимым и проверяемым: нельзя собрать/выпустить артефакт без обязательных проверок.

### Тип изменения

Release engineering/security.

### Задачи агента

1. Создать единый script:

```bash
npm run check:release
```

2. Включить в него:

```text
frontend lint/typecheck/tests;
Rust tests/clippy;
release-gate tests;
IPC audits;
large IPC audit;
subproject gates;
E2E smoke если среда позволяет;
secret scanning если есть;
version validation.
```

3. `pretauri:build` должен вызывать `check:release` или documented CI equivalent.
4. Добавить signing verification:

```text
Windows Authenticode signature present;
timestamp present;
updater package signature valid;
updater endpoint manifest valid;
public key matches expected;
private updater key absent from repo.
```

5. Добавить release checklist:

```text
- version bump;
- changelog;
- license server compatibility;
- migration compatibility;
- update smoke;
- rollback package.
```

### Acceptance criteria

```text
[ ] one canonical check:release;
[ ] production build cannot bypass critical checks without explicit CI override;
[ ] signing verification documented/scripted;
[ ] release checklist committed;
[ ] updater private key not in repo.
```

### Команды

```bash
npm run check:release
npm run tauri:build
npm run check:update
```

Если signing не может быть проверен локально без secrets, агент должен сделать script с CI-only path и local dry-run.

### Rollback

Revert scripts/checklist changes.

---

## PR-013 — Crash diagnostics и symbol archival

### Цель

Если release использует `panic=abort` и stripped symbols, нужен процесс диагностики падений.

### Тип изменения

Reliability/release.

### Задачи агента

1. Проверить release Rust profile.
2. Добавить panic hook:

```rust
std::panic::set_hook(Box::new(|info| {
    tracing::error!(panic = %info, "fatal panic");
}));
```

3. Добавить build metadata:

```text
version
git SHA
build timestamp
profile
target triple
```

4. Добавить symbol archive workflow:

```text
CI stores debug symbols separately;
release artifact contains stripped binary;
symbols accessible only to maintainers.
```

5. Добавить support bundle redaction:

```text
logs redacted;
paths sanitized where needed;
no secrets/API keys/license private data.
```

### Acceptance criteria

```text
[ ] panic hook exists;
[ ] build metadata visible in app/about/logs;
[ ] symbol archival documented;
[ ] support bundle redaction rules exist;
[ ] no sensitive logs.
```

### Команды

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run tauri:build
```

### Rollback

Revert diagnostics additions.

---

## PR-014 — Runtime/generated artifacts policy

### Цель

Сократить шум в репозитории и сделать audit artifacts управляемыми.

### Тип изменения

Repository hygiene/CI.

### Задачи агента

1. Инвентаризировать `runtime/`, `coverage/`, generated reports.
2. Классифицировать:

```text
keep in repo:
  README
  curated summary
  budget baselines
  small fixtures

do not commit:
  raw logs
  huge JSON
  coverage dumps
  generated screenshots/videos
  temporary perf traces
```

3. Обновить `.gitignore`.
4. Перенести raw artifacts в CI artifacts, если pipeline есть.
5. Сохранить исторически важные summaries.

### Acceptance criteria

```text
[ ] generated artifacts policy documented;
[ ] .gitignore updated;
[ ] repo no longer accumulates huge raw logs;
[ ] required baselines remain tracked;
[ ] CI artifact path documented.
```

### Команды

```bash
git status --ignored
npm run audit:enterprise:quick
```

### Rollback

Revert `.gitignore` and docs changes.

---

# 5. Отдельные технические спецификации

---

## 5.1. IPC policy specification

Цель: ни одна IPC команда не должна быть «просто зарегистрированной». У неё должен быть policy record.

Минимальные поля:

```rust
pub struct IpcCommandPolicy {
    pub name: &'static str,
    pub risk: IpcRisk,
    pub requires_license: bool,
    pub requires_audit_log: bool,
    pub allowed_in_demo: bool,
    pub allows_external_network: bool,
    pub allows_file_read: bool,
    pub allows_file_write: bool,
    pub allows_db_read: bool,
    pub allows_db_write: bool,
    pub returns_binary: bool,
    pub max_payload_class: IpcPayloadClass,
}

pub enum IpcPayloadClass {
    Tiny,
    Small,
    Medium,
    LargeBinaryByDesign,
    ProhibitedLargeJson,
}
```

Policy tests:

```text
- all registered commands have policy;
- all High commands require audit log;
- all file write commands have path validation tests;
- all external network commands require opt-in or license/update exception;
- all LargeBinaryByDesign commands return binary response, not JSON arrays;
- ProhibitedLargeJson commands are not registered in production.
```

---

## 5.2. Reports refactor specification

Проблема: reports/export domain слишком крупный и рискованный.

Целевые границы:

```text
commands/reports:
  IPC DTO, thin wrappers, response mapping.

application/reports:
  use cases: generate single/comparison/by IDs, cache orchestration.

domain/reports:
  limits, license policy, report metadata, validation rules.

infrastructure/reports:
  PDF renderer, XLSX renderer, artifact store, cache storage.
```

Правила:

```text
[ ] commands не читают DB напрямую, если это часть report use case;
[ ] commands не знают details PDF/XLSX renderer;
[ ] license/report limit policy тестируется отдельно;
[ ] comparison export только by IDs в production;
[ ] binary outputs возвращаются binary response, не JSON number array;
[ ] report job cancel-safe;
[ ] temporary files cleanup-safe.
```

---

## 5.3. Backup/restore safety specification

Restore должен быть транзакционно безопасным на уровне файловой системы:

```text
1. user selects file;
2. canonicalize path;
3. reject symlink/traversal/disallowed extension;
4. copy candidate to temp location;
5. open candidate read-only;
6. integrity_check;
7. schema/version check;
8. required tables/indexes check;
9. create pre-restore backup current DB;
10. atomic swap;
11. reopen app DB;
12. verify schema_meta;
13. if failure → rollback to pre-restore backup;
14. audit log.
```

Required tests:

```text
- corrupt DB rejected;
- wrong schema rejected;
- missing table rejected;
- symlink rejected;
- traversal rejected;
- partial failure rolls back;
- pre-restore backup exists;
- success has audit event.
```

---

## 5.4. AI/API privacy specification

External AI/API integration must be disabled by default.

Requirements:

```text
[ ] setting explicitly disabled by default;
[ ] user sees what data may be sent;
[ ] no experiment raw data sent without explicit action;
[ ] API key stored securely;
[ ] logs never contain API key or payload body;
[ ] enterprise/global disable possible;
[ ] offline mode unaffected;
[ ] network capability separate from default/export/backup.
```

---

## 5.5. Release/signing specification

Production release must verify:

```text
[ ] version consistency;
[ ] changelog;
[ ] clean git tree;
[ ] dependency lockfiles;
[ ] frontend lint/typecheck/test;
[ ] Rust test/clippy;
[ ] IPC audits;
[ ] large payload audit;
[ ] E2E smoke;
[ ] secret scan;
[ ] updater private key absent;
[ ] updater package signed;
[ ] Windows installer signed;
[ ] timestamp exists;
[ ] rollback artifact available;
[ ] release notes generated.
```

---

# 6. Финальный порядок исполнения

Рекомендуемый порядок:

```text
1. PR-001 Baseline
2. PR-002 Error boundary
3. PR-003 IPC policy inventory
4. PR-004 Remove direct heavy comparison IPC
5. PR-005 Reports mechanical split
6. PR-006 Reports application layer
7. PR-007 Capabilities/AI opt-in
8. PR-008 Backup/restore hardening
9. PR-009 DB indexes/integrity
10. PR-010 Performance budgets
11. PR-011 Subproject quality gates
12. PR-012 Release/signing verification
13. PR-013 Crash diagnostics
14. PR-014 Runtime artifacts policy
```

Можно параллелить:

```text
A. PR-001/002/003/004 — основной backend/security поток.
B. PR-011/014 — tooling/repo hygiene поток.
C. PR-007/012/013 — security/release поток.
```

Нельзя параллелить без координации:

```text
PR-005 и PR-006;
PR-004 и PR-005;
PR-007 и PR-012;
PR-008 и PR-009 если оба меняют DB/migrations.
```

---

# 7. Что агент должен передавать на проверку

После каждого PR агент должен отправить:

```text
1. Ссылка на PR или branch.
2. Commit hash.
3. Diff summary.
4. Список изменённых файлов.
5. Команды и результаты.
6. Какие тесты падали до изменений.
7. Какие тесты падают после изменений.
8. Что изменилось в поведении.
9. Что нужно проверить вручную.
10. Риски и rollback.
```

Проверяющий смотрит:

```text
- не смешаны ли unrelated changes;
- не удалена ли функциональность без replacement;
- не скрыты ли failing tests;
- не расширены ли permissions;
- не появились ли secrets;
- не ухудшен ли IPC contract;
- нет ли regression в perf/security tests;
- понятен ли rollback.
```

---

# 8. Итоговая цель

После выполнения плана проект должен иметь:

```text
[ ] тонкий IPC layer;
[ ] управляемый IPC policy registry;
[ ] report/export domain без монолитного reports.rs;
[ ] только by-IDs heavy export path в production;
[ ] безопасную error/log redaction модель;
[ ] строгие Tauri capabilities;
[ ] opt-in external AI/API integration;
[ ] atomic DB backup/restore;
[ ] performance budgets;
[ ] один canonical release gate;
[ ] signing/updater verification;
[ ] crash diagnostics;
[ ] quality gates для всех подпроектов;
[ ] чистую generated artifacts policy.
```

Главный критерий успеха: проект становится не просто «рабочим», а контролируемым production platform, где риски видны, измеримы и блокируются автоматически.
