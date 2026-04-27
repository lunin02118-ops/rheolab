# RheoLab Enterprise V2 — комплексный аудит кодовой базы

**Дата:** 23 апреля 2026  
**Версия:** `0.2.0-beta.25`  
**Scope:** React 19 + TypeScript + Vite · Tauri 2 + Rust · SQLite · тесты · release/audit tooling  
**Основание:** ручной code review по критичным контурам + выборочные проверки quality gates + воспроизведение ключевых тестов  
**Важно:** аудит выполнен по текущему локальному состоянию рабочей директории; дерево git грязное, поэтому выводы относятся к текущему in-progress snapshot.

---

## 1. Executive summary

**Итоговый вердикт:** **NO-GO** для релизного состояния на 23.04.2026.

Главные причины:

1. В Tauri backend найден **потенциальный bypass лицензирования экспортных операций**: `sync_export_delta` пишет файл на диск, но не проходит через `can_write_via_engine`, хотя соседние write/export-команды проходят.
2. Подтверждён **функциональный регресс в AI-assisted parsing**: интеграционный Rust-тест ожидает 82 строки, но фактически получает 5.
3. **Release gate уже красный**: enterprise audit зафиксировал `NO-GO`, отсутствующий PHP runtime и упавший ESLint gate.
4. На IPC boundary есть **несогласованная валидация пользовательских путей**: `sync_import_delta` открывает произвольный путь напрямую, в отличие от других file-import команд.

При этом у проекта есть сильная база:

- `npm audit --omit=dev` не нашёл production JS-уязвимостей.
- `cargo audit` завершается с exit code `0`.
- `npm run test:e2e:smoke` прошёл `13/13`.
- Основной массив Rust unit-тестов зелёный; проблема локализуется в одном регрессионном интеграционном сценарии парсинга.

---

## 2. Что проверено

- Архитектура frontend/backend и границы IPC.
- Лицензирование, export/write-пути и консистентность gate checks.
- Миграции/БД и file-path handling в Tauri командах.
- Парсинг и AI-assisted import path.
- Качество tooling: ESLint, smoke/e2e, Rust tests, dependency audit.
- Документация и release artefacts.

### Ограничения покрытия

- `license-server` не прошёл полноценный lint/review в этой среде, потому что в `PATH` отсутствует `php`.
- В репозитории были уже существующие незакоммиченные изменения; я их не откатывал и не нормализовал.

---

## 3. Findings

### [HIGH] 1. Экспорт delta-файла обходит write/license gate

**Где:** `src-tauri/src/commands/sync_engine.rs:62-141`  
**Контрастный baseline:**  
- `src-tauri/src/commands/backup/export.rs:55`
- `src-tauri/src/commands/backup/restore.rs:114`
- `src-tauri/src/commands/experiments/export/mod.rs:84`
- `src-tauri/src/commands/reports.rs:62,88,113,137`

**Наблюдение**

- `sync_export_delta` документирован как реальный offline-export механизм для передачи данных через USB/SFTP (`sync_engine.rs:1-18`, `62-67`).
- Команда создаёт JSON-файл в `<app_data_dir>/sync/` и возвращает путь в UI (`sync_engine.rs:92-141`).
- При этом в теле команды нет вызова `can_write_via_engine(...)`, хотя остальные write/export-команды его используют.
- Команда явно доступна с frontend-стороны через `src/lib/tauri/sync.ts:56-64`.

**Почему это важно**

Если лицензирование должно ограничивать экспорт/запись данных, то текущий delta-export является обходным путём: пользователь может экспортировать эксперименты через sync-механизм, даже если остальные export-команды заблокированы лицензией.

**Рекомендация**

- Добавить единый gate `can_write_via_engine(&state).await` в `sync_export_delta`.
- После фикса добавить regression test на запрет delta-export без нужного entitlement.
- Отдельно сверить продуктовую политику: если sync intentionally exempted от лицензии, это должно быть явно задокументировано и проверено продуктово, а не оставаться как неявная дыра в консистентности.

---

### [HIGH] 2. Подтверждён регресс AI-assisted parsing на known fixture

**Где:** `src-tauri/tests/ai_parsing.rs:502`  
**Воспроизведение:**  
`cargo test --manifest-path src-tauri/Cargo.toml test_stub_force_ai_uses_structured_mapping_for_fixture -- --exact --nocapture`

**Факт**

Тест падает с assertion:

- expected: `82`
- actual: `5`

Фактический вывод:

```text
thread 'test_stub_force_ai_uses_structured_mapping_for_fixture' panicked at tests\ai_parsing.rs:502:5:
assertion `left == right` failed
  left: 5
 right: 82
```

**Почему это важно**

Это не косметика и не flaky-симптом: AI-assisted parsing path возвращает усечённый набор данных для известного fixture. Для лабораторного ПО это уже риск некорректного анализа, экспорта и downstream-вычислений.

**Вероятная зона проблемы**

По пройденному коду риск концентрируется в AI-hinted workbook parsing path:

- `src-tauri/src/commands/parsing/commands/ai.rs`
- `src/rust/rheolab-core/src/parser/rheo_parser/mod.rs`
- `src/rust/rheolab-core/src/parser/rheo_parser/ai_candidates.rs`
- `src/rust/rheolab-core/src/parser/rheo_parser/workbook.rs`

**Рекомендация**

- Заблокировать релиз до разбора root cause.
- Локально сравнить обычный parsing path и AI-hinted path на том же fixture.
- Добавить golden test, который валидирует не только `data.len()`, но и ключевые первые/последние строки и shape выбранной секции.

---

### [MEDIUM] 3. `sync_import_delta` принимает произвольный путь без общей валидации IPC boundary

**Где:** `src-tauri/src/commands/sync_engine.rs:155-162`  
**Контрастный baseline:**  
- `src-tauri/src/commands/backup/restore.rs:103`
- `src-tauri/src/commands/backup/export.rs:46`
- `src-tauri/src/utils/validation.rs:114`

**Наблюдение**

- `sync_import_delta` получает `file_path: String` с фронта и сразу делает `std::fs::File::open(&file_path)`.
- В соседних file-based командах используется `validate_user_file_path(...)` перед доступом к файловой системе.

**Почему это важно**

Это создаёт несогласованный IPC boundary: часть Tauri-команд нормализует и валидирует пользовательские пути централизованно, а часть работает с raw path напрямую. Даже если сейчас это не даёт немедленной RCE/priv-esc, такой разнобой ухудшает безопасность, тестируемость и поддержку.

**Рекомендация**

- Перед `File::open` прогонять путь через `validate_user_file_path(&file_path, true)?`.
- Добавить negative tests на невалидные/неожиданные пути.

---

### [HIGH] 4. Release gate уже в состоянии NO-GO, а серверная PHP-часть не покрыта в этой среде

**Где:**  
- `runtime/audit/2026-04-22-enterprise-deep-audit/release-gate-decision.md:3`
- `runtime/audit/2026-04-22-enterprise-deep-audit/release-gate-decision.md:34-36`
- `runtime/audit/2026-04-22-enterprise-deep-audit/logs/18_node_scripts_audit_php_lint_license_server_js.log:2-3`

**Факт**

- Enterprise audit уже вынес решение **`NO-GO`**.
- Там же зафиксировано:
  - `ENV-005 | HIGH | PHP runtime is unavailable for license-server checks`
  - `LIC-PHP-LINT | HIGH | License-server PHP lint failed`
  - `QG-ESLINT | HIGH | ESLint gate is red`
- Лог lint-а подтверждает: `php runtime is unavailable in PATH` и `spawnSync php ENOENT`.

**Почему это важно**

Нельзя считать аудит действительно комплексным по всем направлениям, пока серверная лицензирующая PHP-часть физически не прогоняется и не lint-ится в CI/локальной audit-среде.

**Рекомендация**

- Починить environment parity для audit pipeline: PHP должен быть обязательной зависимостью для enterprise audit.
- До этого не закрывать аудит как fully complete.

---

### [MEDIUM] 5. Quality gate сломан: ESLint красный, и часть ошибок влияет на поведение

**Где:** `runtime/audit/2026-04-22-enterprise-deep-audit/logs/05_npx_eslint.log:3-27`

**Подтверждённые ошибки**

- `src/components/comparison/comparison-chart-uplot.tsx:309`  
  missing dependency в `useMemo`: `chartSettings.rheologyUnits?.timeFormat`
- `src/components/shared/UpdateChecker.tsx:133`  
  floating promise / side-effect без явного ignore-handling
- `src/hooks/useRheologyVisibility.ts:39-40`  
  неиспользуемые параметры `previewMode`, `captureMode`
- `src/components/analysis/cycle-results-table.tsx:7`  
  неиспользуемый импорт `formatTime`
- `tests/e2e/licensing/real-license-ipc.tauri.spec.ts:159`  
  небезопасный `Function` type

**Почему это важно**

Не все lint ошибки одинаковы. Здесь минимум две уже имеют поведенческий риск:

- `comparison-chart-uplot.tsx:195-309` строит `uPlotOptions` через `useMemo`, а formatter внутри зависит от `chartSettings.rheologyUnits?.timeFormat` (`:260`). Без зависимости пользователь может переключить формат времени и получить stale chart tooltip/options.
- `UpdateChecker.tsx:133` запускает async IIFE внутри эффекта; линтер справедливо считает, что promise не помечен как сознательно проигнорированный. Это повышает риск тихих race/cleanup-проблем в update flow.

**Рекомендация**

- Вернуть ESLint в green-state до следующего release decision.
- Поведенческие lint-ошибки чинить первыми, а не смешивать их с косметикой.

---

### [LOW] 6. Документация отстала от фактической версии продукта

**Где:**  
- `README.md:13` → `0.2.0-beta.5`
- `docs/ARCHITECTURE.md:4` → `0.2.0-beta.21`
- `package.json:3` → `0.2.0-beta.25`
- `src-tauri/tauri.conf.json:4` → `0.2.0-beta.25`

**Почему это важно**

Это не ломает рантайм напрямую, но создаёт drift между кодом, архитектурной документацией и release-коммуникацией. Для аудита и onboarding это увеличивает стоимость верификации.

**Рекомендация**

- Синхронизировать версию в ключевых документах в рамках ближайшего release/docs pass.

---

### [LOW] 7. Browser bundle тянет модуль с Node `crypto`, хотя он размещён в frontend tree

**Где:**  
- `src/lib/utils/encryption.ts:16-19,51,68`
- `src/lib/licensing/multi-license-store.ts:8,47-50,79-80`

**Наблюдение**

- `src/lib/utils/encryption.ts` содержит и browser-obfuscation, и server-side ветку с `import('crypto')` / `require('crypto')`.
- Этот модуль реально импортируется из `multi-license-store.ts`, который работает с `localStorage`.
- Во время smoke-run Vite предупреждал: `Module "crypto" has been externalized for browser compatibility`.

**Почему это важно**

Судя по комментариям, это не прямой security bug: для клиента там используется только obfuscation, а не настоящая защита секретов. Но смешение Node/server и browser responsibilities в одном модуле:

- загрязняет frontend bundle warning-ами;
- усложняет reasoning;
- повышает шанс регрессий при сборке/рефакторинге.

**Рекомендация**

- Разделить `encryption.ts` на browser-only и server-only реализации или вынести server branch из `src/`.

---

## 4. Что выглядит хорошо

- Export/report/backup write-пути в целом уже проектировались с лицензирующим gate-слоем; проблема носит локальный характер, а не тотально архитектурный.
- В проекте есть сильная тестовая база: Rust unit tests проходят массово, smoke e2e тоже зелёный.
- Production dependency posture на текущий момент выглядит аккуратно:
  - `npm audit --omit=dev` → `0 vulnerabilities`
  - `cargo audit` → exit code `0`

---

## 5. Приоритетный план исправлений

### Немедленно, до релиза

1. Закрыть `sync_export_delta` через `can_write_via_engine`.
2. Разобрать root cause падения `test_stub_force_ai_uses_structured_mapping_for_fixture`.
3. Вернуть ESLint gate в green-state.
4. Восстановить PHP runtime в audit environment и прогнать license-server lint.

### Следующим пакетом

1. Привести `sync_import_delta` к общей модели `validate_user_file_path`.
2. Разделить browser/server encryption helpers.
3. Синхронизировать README/ARCHITECTURE с фактической версией продукта.

---

## 6. Итог

Проект в целом не выглядит хаотичным или деградировавшим: архитектурно он зрелее среднего, тестовый каркас хороший, а dependency hygiene у runtime-части аккуратный. Но в текущем snapshot есть три реальных release-blocker класса риска:

1. несогласованный export-license gate;
2. подтверждённый parsing regression;
3. сломанный release/audit perimeter вокруг ESLint и PHP license-server checks.

Пока эти пункты не закрыты, выпускать текущую сборку как надёжный enterprise release не рекомендую.
