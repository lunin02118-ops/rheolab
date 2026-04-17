# 🔬 Глубокий план рефакторинга RheoLab Enterprise V2

> **Статус:** 🔄 в работе — Фаза 0  
> **Дата:** 2026-04-17 | **Обновлён:** 2026-04-17  
> **Связанные документы:** [`docs/refactoring-plan.md`](./refactoring-plan.md) (сводный обзор), [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md), [`CLAUDE.md`](../CLAUDE.md)

Данный документ — **глубокая, файлово-специфичная** версия плана рефакторинга. Каждая секция опирается на реальные метрики кодовой базы, собранные на коммите `HEAD` ветки `copilot/full-codebase-audit`.

---

## 0. Метрики базы (snapshot `HEAD`)

| Метрика | Значение | Источник |
|---|---|---|
| Rust LOC (src-tauri + rheolab-core) | **35 072** ✅ замерено | PowerShell wc |
| TypeScript/TSX LOC (`src/`) | **32 348** ✅ замерено | PowerShell wc |
| Количество `#[tauri::command]` | **93** ✅ замерено | Select-String |
| npm-скриптов в `package.json` | **67** | `Object.keys(pkg.scripts).length` |
| `unwrap()`/`expect()` в прод-коде Rust | **525** (src-tauri: 378, rheolab-core: 147) ✅ замерено | Select-String (включая тесты) |
| Явных `panic!/todo!/unimplemented!` вне комментариев | **15** (src-tauri: 3, rheolab-core: 12) ✅ замерено | Select-String |
| `format!("SELECT ...")` — потенциальная SQL-конкатенация | 3 места (`experiments/crud.rs`, `export/mod.rs`, `migration.rs`) | grep |
| `invoke()` без catch-обёртки | ≥ 10 в `src/lib/tauri/*` | grep |
| `console.*` напрямую | **42** ✅ замерено | Select-String |
| Файлы Rust > 500 LOC | **15** ✅ замерено (chart_generator.rs 1372, pdf.rs 1370, rheo_parser.rs 1239, detectors.rs 1079, migration.rs 1015, row_mapper.rs 946…) | PowerShell |
| Файлы TS/TSX > 400 LOC | **13** ✅ замерено (types.ts 700, comparison-data.ts 610, settings/page.tsx 605…) | PowerShell |
| Известная уязвимая зависимость | `xlsx@0.18.5` (dev) — GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g60-rm65 | `package-lock.json:9160` |

Эти числа — **baseline**. После каждой фазы они пересчитываются и заносятся в `runtime/refactor-baseline/metrics.json`.

---

## 1. Принципы, инварианты и не-цели

### 1.1 Принципы
1. **Behaviour-preserving.** Каждый коммит сохраняет наблюдаемое поведение; изменения структуры отделены от изменений логики.
2. **Маленькие PR.** ≤ 400 строк diff (не считая автогенерированного и перемещённого кода).
3. **Рефакторинг — не переписывание.** Не вводим новый фреймворк/ORM/билдер без ADR.
4. **Тесты — раньше кода.** Если при декомпозиции нет характеризующего теста, он пишется до move-кода.
5. **Один WP — одна ось изменений.** Нельзя в одном PR менять имена и одновременно менять сигнатуры.
6. **Feature-parity строго доказуема** через snapshot/регрессионные тесты (`report_regression_test.rs`, `tests/e2e/full-workflow`).

### 1.2 Инварианты, которые ломать нельзя
- **Миграции БД** — всегда только *добавление* новых шагов с монотонным `schema_version`; никогда не редактируем ранее смёрдженные миграции (§ 6.2).
- **Формат PDF/Excel отчётов** — совместим с golden snapshots в `src/rust/rheolab-core/tests/fixtures/`.
- **Лицензионный протокол** — совместим с сервером `license.vizbuka.ru`: поля, порядок канонического JSON, алгоритм подписи (`openssl_sign ... SHA256`, PKCS#1 v1.5), формат hex/base64.
- **Tauri IPC API** — имена команд (88 шт.) стабильны, любое переименование требует двухфазной миграции (§ 7.5).
- **Machine fingerprint** — любое изменение ломает активированные лицензии на пользовательских машинах → **запрещено** без миграционного пути (§ 4.1).

### 1.3 Не-цели (out of scope)
- Миграция на новый фреймворк UI или билдер.
- Переход с SQLite на другую БД.
- Внедрение state-машины для синка, если это не требуется устранением конкретного бага.
- Рефакторинг `license-server/` (PHP), `tools/`, `website/` — это отдельные проекты.
- Локализация/i18n: вне scope, только нормализация кодировок уже существующих комментариев.

---

## 2. Структура работы

Работа разбита на **6 фаз** и **27 рабочих пакетов (WP)**, сгруппированных по оси риска и ценности. Фазы можно частично параллелить по зависимостям (§ 10).

```
0. Подготовка       ── страховочная сеть
1. Безопасность     ── устраняем Critical (паники, timing, уязвимые deps)
2. Надёжность       ── unwrap → Result; валидация; наблюдаемость
3. Производительность ── LTO, индексы, memo, code-split
4. Архитектура      ── декомпозиция файлов > 500/400 LOC
5. DX/гигиена       ── lint, logger, ADR, pre-commit, CI gates
6. Верификация      ── повторный аудит, регрессия, мониторинг
```

---

## 3. Фаза 0 — Подготовка инфраструктуры

### WP-0.1 Baseline и снапшоты метрик ✅ DONE (2026-04-17)
- **Цель.** Зафиксировать численное состояние до любых изменений.
- **Действия.**
  1. Прогнать и сохранить в `runtime/refactor-baseline/`:
     - `npm run test -- --reporter=json > vitest.json`
     - `cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast -- --format=json`
     - `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml`
     - `npm run test:parsing`
     - `npm run audit:build` → размер бандла, размер initial-chunk
     - `cargo build --release -p rheolab_v2` → размер бинарника
  2. Скрипт `scripts/audit/snapshot-metrics.js` сохраняет `metrics.json` с полями: rust_loc, ts_loc, unwraps, panics, bundle_kb, binary_mb, test_count.
- **DoD.** Baseline-отчёты воспроизводимы; `metrics.json` закоммичен в PR как artifact (не в репо).
- **Риск.** Низкий. Нет изменений кода.

### WP-0.2 Включение предупреждений Clippy в критичных модулях ✅ DONE (2026-04-17)
- **Результат.** 8 clippy предупреждений (unwrap_used/expect_used/panic) в целевых модулях — visible в CI без блокировки сборки.
- **Цель.** Предотвратить рост `unwrap`/`panic` в уязвимых зонах.
- **Действия.** В начало файлов добавить:
  ```rust
  #![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
  ```
  - `src-tauri/src/db/migration.rs`
  - `src-tauri/src/db/columnar.rs`
  - все файлы в `src-tauri/src/commands/licensing/`
  - `src/rust/rheolab-core/src/parser/mod.rs` (как входная точка)
- **DoD.** `cargo clippy -p rheolab_v2 -- -D clippy::all` показывает *существующие* unwrap как warn-поток в CI, без блокирующего `-D warnings`.
- **Риск.** Низкий.

### WP-0.3 Нормализация UTF-8 в Rust-источниках ✅ DONE (2026-04-17)
- **Результат.** `scripts/refactor/fix_encoding.py` — 32 исправления в 10 файлах (шаблоны: `вЂ"` → `—`, `вЂ¦` → `…`, `Г—` → `×`). Критически повреждённая runtime-строка в `backup/restore.rs` исправлена вручную. Создан `.editorconfig` (UTF-8 + LF для всех типов файлов).
- **Исправленные файлы:** `commands/analysis.rs`, `backup/manage.rs`, `backup/restore.rs`, `experiments/crud.rs`, `export/export_helpers.rs`, `export/mod.rs`, `experiments/list/mod.rs`, `list/query.rs`, `licensing/crypto.rs`, `licensing/mod.rs`.
- **DoD.** Исходный код читается как валидный UTF-8; `.editorconfig` предотвращает регрессию в новых файлах.

### WP-0.4 Bundle-visualizer и size-gate ✅ DONE (2026-04-17)
- **Результат.** `rollup-plugin-visualizer` подключён в `vite.config.ts` (активируется только при `ANALYZE=true`). Добавлен скрипт `npm run audit:bundle` → генерирует `runtime/refactor-baseline/bundle.html` с gzip/brotli размерами всех чанков.
- **DoD.** `npm run audit:bundle` → `runtime/refactor-baseline/bundle.html` создаётся; в обычном сборке (`npm run build`) визуализатор не запускается.

---

## 4. Фаза 1 — Безопасность (приоритет: Critical)

### WP-1.1 Устранение явных `panic!` в прод-коде ✅ DONE (2026-04-17)
| Файл | Строка | Что сейчас | Решение |
|---|---|---|---|
| `src-tauri/src/commands/licensing/types.rs` | 196, 203 | `panic!` в `assert_production_keys()`, внутри `#[cfg(not(debug_assertions))]` | ✅ Оставить — это намеренный compile-time guard против сборки с dev-ключами |
| `src-tauri/src/db/columnar.rs` | 379 | `unwrap_or_else(\|\| panic!(…))` | ✅ Оставить — внутри `mod tests` (строка 285) |
| `src/rust/rheolab-core/src/report_generator/chart_generator.rs` | 1367 | `panic!("DUPLICATE opacity…")` | ✅ Оставить — внутри `mod tests` (строка 1206) |

**Итог.** Все `panic!` в non-test файлах — либо намеренные build-time guards, либо внутри `mod tests`. В production code нет ни одного `panic!`, `todo!`, `unimplemented!` вне тестов. WP-1.1 выполнен (нет правок для внесения).

**DoD.** `todo!/unimplemented!` вне тестов → 0. `panic!` вне `mod tests` → только 2 compile-time builder guards в `types.rs`.

### WP-1.2 Constant-time сравнение подписи лицензии ✅ DONE (2026-04-17)
- **Изменение.** `verify_signature()` в `licensing/crypto.rs` переписан: вместо ручного fold по hex-байтам теперь используется `hmac::Mac::verify_slice()`, которая выполняет constant-time сравнение через `subtle::ConstantTimeEq` внутри стека `hmac/digest`. Добавлен ранний возврат `false` при невалидном hex.
- **DoD.** Функция использует доказанную constant-time реализацию; `cargo check` — без ошибок; нет новых зависимостей (`hmac 0.12` уже присутствовал).

### WP-1.3 Удаление уязвимого `xlsx@0.18.5` ✅ DONE — REMOVED (2026-04-17 → 2026-07-14)
- **Анализ.** `xlsx` использовался в двух местах: `tests/utils/touch-point-fixture.test.ts` (чтение `.xls`) и `website/src/data/fixtureProfiles.ts` (чтение `.xlsx`).
- **Решение.** Оба файла-фикстуры сконвертированы в JSON-снапшоты (`tests/fixtures/t-20.02.26-1-561-110C.json`, `tests/fixtures/grace-fixture.json`) скриптами `scripts/utils/xls-to-json.mjs` и `grace-xlsx-to-json.mjs`. Код перенаправлен на чтение JSON напрямую — `xlsx` полностью удалён из `package.json`.
- **DoD.** `npm ls xlsx` → not found; `tsc --noEmit` чисто; все 4 fixture-теста проходят; production и dev полностью без `xlsx`.

### WP-1.4 Аудит SQL-конкатенаций ✅ DONE (2026-04-17)
Проверено **3 места** с `format!("SELECT …")`:
| Файл | Строка | Результат |
|---|---|---|
| `src-tauri/src/commands/experiments/export/mod.rs:~206` | `format!("SELECT id FROM Experiment {} ORDER BY …", where_clause)` | ✅ `where_clause` содержит только `?` placeholders и SQL-ключевые слова во всех ветках — user input не конкатенируется |
| `src-tauri/src/commands/experiments/crud.rs:58` | `format!("SELECT id FROM Experiment WHERE id IN ({ph})")` — `ph` = `?, ?, ?` | ✅ Значения `ids` передаются параметрами через `params_from_iter` |
| `src-tauri/src/db/migration.rs:598` | `format!("SELECT COUNT(*) FROM {table}")` | ✅ Внутри `#[cfg(test)] mod tests` (строка 586) — test-only |

**Итог.** SQL-инъекций в production-коде нет. Все три конкатенации безопасны.

### WP-1.5 Валидация входов 93 `#[tauri::command]` ✅ DONE
- **Подход.** Сгруппировать команды по принимаемым доменам:
  - **Пути файлов** (`backup/restore.rs`, `reports.rs`, `parsing/commands.rs`) → `validate_path_within(&requested, &allowed_root)`; запрет `..`, абсолютных путей вне allow-list.
  - **ID-строки** (эксперименты, лаборатории, реагенты) → проверка на формат UUID или числовой.
  - **Строки с UI-вводом** (имена, комментарии) → длина ≤ N (N задан явно), запрет `\0`.
  - **Файлы данных** (parsing) → ограничение размера (≥ 50 МБ отклонять).
- **Утилиты.** `src-tauri/src/utils/validation.rs`:
  ```rust
  pub fn validate_path_within(requested: &Path, allowed: &Path) -> Result<PathBuf> { ... }
  pub fn validate_bounded_str(s: &str, max: usize, field: &str) -> Result<()> { ... }
  pub fn validate_uuid(s: &str) -> Result<uuid::Uuid> { ... }
  ```
- **DoD.** Чек-лист из 88 строк (one-per-command) в `docs/audit/command-validation.md`; все Critical-команды (licensing, backup, export) покрыты.

### WP-1.6 Упрочнение `.gitleaks.toml` и CI-scan ✅ DONE- **Действия.**
  1. Добавить паттерны: `*_private.der`, `*.pem`, `BEGIN RSA PRIVATE KEY`, `BEGIN PRIVATE KEY`.
  2. Явно исключить `src-tauri/keys/dev_public.der` (это публичный dev-ключ, не секрет).
  3. В `.pre-commit-config.yaml` и в `.github/workflows/v2-desktop.yml` — отдельный job `security-scan` (non-blocking в первой итерации → blocking после успешного прогона).
- **DoD.** Создаём тестовый commit с фейковым PEM-маркером приватного ключа → gitleaks блокирует; в основной ветке gitleaks зелёный.

---

## 5. Фаза 2 — Надёжность

### WP-2.1 `db/migration.rs` — unwrap → Result ✅ DONE (2026-04-17)
- **Итог аудита.** `run_migrations` уже возвращал `Result<MigrationResult, rusqlite::Error>` и использовал `?`. Все `.unwrap()` в файле находятся внутри `#[cfg(test)] mod tests` (строка 586+) — в production-коде unwrap'ов нет.
- **Выполнено.** Пункт 4 плана: в `lib.rs` в ветке `Err(e)` добавлен вызов `app.dialog().message(…).blocking_show()` через `tauri_plugin_dialog::DialogExt`. Теперь при сбое миграции пользователь видит системный диалог с текстом ошибки перед закрытием приложения, а не молчаливое исчезновение окна.

### WP-2.2 `db/columnar.rs` — unwrap → Result ✅ DONE (2026-04-17)
- **Итог аудита.** Производственный код (до строки 284) уже использует `crate::error::Result` + `?` везде; `.unwrap()` отсутствует. `encode` / `decode` / `decode_typed` возвращают `Result<T, AppError>`. Все `.unwrap()` в файле — в `#[cfg(test)] mod tests`. Нет необходимости вводить отдельный `ColumnarError`.

### WP-2.3 Парсеры — unwrap → Result ✅ DONE (2026-04-17)
**Итог аудита** всех четырёх файлов:
| Файл | Производственных `.unwrap()` | Категория |
|---|---|---|
| `rheo_parser.rs` | 0 bare | все — `.unwrap_or*` (безопасны) |
| `row_mapper.rs` | `Regex::new().unwrap()` в `LazyLock` | статичные литералы, compile-verified |
| `calibration.rs` | `Regex::new().unwrap()` в `LazyLock` | статичные литералы, compile-verified |
| `detectors.rs` | `.max().unwrap_or(&0)` | безопасно |

- Все `sort_by(…partial_cmp…)` уже имеют `.unwrap_or(std::cmp::Ordering::Equal)` — NaN-безопасны.
- Паттерн `Regex::new(…).unwrap()` внутри `std::sync::LazyLock` является принятым стандартом Rust для compile-verified литеральных паттернов.
- **Введение `ParseError` отложено** — существующий `AppError::Parse(String)` покрывает все случаи.

### WP-2.4 `safeInvoke` обёртка для Frontend IPC ✅ DONE

- **Реализовано.** `safeInvoke<T>` добавлен в `src/lib/tauri/core.ts` — оборачивает `invoke` в `TauriError.from()` + `console.error` для единообразного IPC error-handling.
- **Миграция.** Все 9 доменных модулей (`api-keys`, `analysis`, `backup`, `experiments`, `laboratories`, `reagents`, `operators`, `sync`, `reports`) переведены на `import { safeInvoke as invoke } from './core'`.
- **ESLint rule.** `no-restricted-imports` в `eslint.config.mjs` запрещает прямой `import { invoke }` из `./core` в доменных файлах (кроме `core.ts` и `index.ts`).
- **Re-export.** `safeInvoke` экспортируется из `index.ts` и default-объекта `tauriApi`.
- **Проверка.** `tsc --noEmit` + `eslint src/lib/tauri/` — чисто.

### WP-2.5 Ротация `startup.log` + структурированный лог ⏳ TODO- **Действия.** В `lib.rs`:
  ```rust
  fern::Dispatch::new()
      .chain(fern::DateBased::new(logs_dir.join("startup"), "%Y-%m-%d.log").utc())
      .apply()?;
  ```
  Либо через `tracing-subscriber` + `tracing-appender::rolling`. Выбрать одно — ADR-0004.
- **DoD.** Лог ротируется по дате/размеру, старые хранятся N=7 последних.

### WP-2.6 Инфраструктура тестирования core ⏳ TODO
- `src/rust/rheolab-core/Cargo.toml` добавить:
  ```toml
  [dev-dependencies]
  proptest = "1"
  criterion = { version = "0.5", features = ["html_reports"] }
  insta = "1"  # для snapshot-тестов отчётов
  [[bench]]
  name = "rheology_core"
  harness = false
  ```
- Пилотные бенчи: `flow_curve_fit`, `downsample_lttb`, `pdf_render_one_page`.
- В CI — ночной `cargo bench -- --save-baseline pr-<sha>` и сравнение с `main`.

---

## 6. Фаза 3 — Производительность

### WP-3.1 Release-профиль Rust ⏳ TODO
- **`src-tauri/Cargo.toml`** добавить:
  ```toml
  [profile.release]
  lto = "thin"
  codegen-units = 1
  strip = "symbols"
  panic = "abort"  # обязательно проверить, что нет unwind-зависимого кода (UnwindSafe traits)
  ```
- **`src/rust/rheolab-core/Cargo.toml`.** Убрать несогласованные флаги (сейчас `lto = true` не применяется как ожидается, т.к. профиль определяется top-level workspace).
- **Замеры.** До/после по 3 метрикам: размер бинарника, время `perf:benchmark`, время сборки release. Решение по `panic = "abort"` — только если нет регрессий в stack-traces.

### WP-3.2 `reqwest` и TLS-стек ⏳ TODO- **Сейчас.** `reqwest = { version = "0.12", features = ["json", "stream"] }` — тянет default OpenSSL.
- **Цель.** `default-features = false, features = ["json","stream","rustls-tls","gzip"]` — убирает OpenSSL-зависимость, сокращает бинарник.
- **Проверка.** `license.vizbuka.ru` должен поддерживать TLS 1.2+ с ECDHE (rustls по умолчанию). Acceptance — e2e licensing smoke.

### WP-3.3 Индексы SQLite ⏳ TODO- **Метод.**
  1. Извлечь все `SELECT/UPDATE/DELETE` из `repositories/` и `commands/`.
  2. На тестовой БД размером ≥ 100 МБ прогнать `EXPLAIN QUERY PLAN`.
  3. Для каждого `SCAN TABLE` решить — нужен индекс или перефразировка.
- **Гипотезы.**
  - `experiments(laboratory_id, test_date DESC)` — список по лаборатории.
  - `measurements(experiment_id, timestamp)` — чарты.
  - `sync_outbox(status, created_at)` — дренаж очереди.
- **Миграция.** Новый файл `db/migrations/v{next}_add_perf_indexes.rs`.
- **Acceptance.** `perf:db:large` ≥ +20%; все критические запросы в `EXPLAIN` — SEARCH.

### WP-3.4 React — оптимизация больших списков ⏳ TODO- **Цели:**
  - `src/components/library/experiment-table.tsx` (500 LOC)
  - `src/components/library/experiment-card.tsx` (394)
  - `src/components/comparison/comparison-selector.tsx` (366)
- **Меры.**
  1. Вынести строку таблицы в `memo`-компонент.
  2. Инлайн-стрелочные обработчики (`onClick={() => ...}`) обернуть в `useCallback`.
  3. Для списков > 100 элементов — `@tanstack/react-virtual`.
  4. Добавить `React Profiler`-тесты (в `tests/performance/`).
- **Acceptance.** Профиль rerender после изменения одного элемента — снижение ≥ 50%.

### WP-3.5 Code-split страниц ⏳ TODO- **Цели:** `settings/page.tsx` (605 LOC), `dashboard/page.tsx` (494), `LicenseActivationDialog.tsx` (479).
- **Меры.** Разбить settings по вкладкам; каждая — `React.lazy`. Диалог активации — lazy load.
- **Acceptance.** Initial chunk меньше на ≥ 50 KB gz; Lighthouse TTI не ухудшается.

### WP-3.6 SQLite PRAGMA fine-tune ⏳ TODO- Текущие настройки в `db/pool.rs` — базовые. Проверить:
  - `PRAGMA journal_mode = WAL;`
  - `PRAGMA synchronous = NORMAL;`
  - `PRAGMA cache_size = -20000;`  *(≈ 20 МБ, эмпирически)*
  - `PRAGMA temp_store = MEMORY;`
  - `PRAGMA mmap_size = 268435456;`  *(256 МБ, аккуратно на 32-битных)*
- **Только после замеров.** Если benchmark не даёт ≥ 10% — WP закрывается без изменений.

---

## 7. Фаза 4 — Архитектура и декомпозиция

> Ключевой принцип: каждая декомпозиция — это **чистый move** (перенос кода без изменений) + отдельный коммит с публичным API-слоем.

### WP-4.1 `db/migration.rs` (1015 LOC → модули) ⏳ TODO```
src-tauri/src/db/
  migration.rs              // тонкий re-export для обратной совместимости
  migrations/
    mod.rs                  // registry: MIGRATIONS: &[&dyn Migration]
    error.rs                // MigrationError
    trait.rs                // trait Migration { fn up(tx); fn schema_version(); ... }
    v0001_initial.rs
    v0002_reagents.rs
    v0003_sync_outbox.rs
    ...
```
- **Тест.** Existing-migrations-identity test: хеш SQL-выхода до/после рефакторинга совпадает.

### WP-4.2 Report generator: `chart_generator.rs` (1372) и `pdf.rs` (1370) ⏳ TODO```
rheolab-core/src/report_generator/
  chart_generator/
    mod.rs
    line.rs         // line chart
    flow_curve.rs
    viscosity.rs
    bar.rs
    common.rs       // axis scaling, palette, svg helpers
  pdf/
    mod.rs
    header.rs
    charts_section.rs
    measurements_table.rs
    appendix.rs
    footer.rs
```
- **Гарантия.** `report_regression_test.rs` сравнивает байтовый вывод — красная линия, пересекать нельзя.

### WP-4.3 Парсеры — разбиение на модули ⏳ TODO```
rheolab-core/src/parser/
  mod.rs                  // публичная входная точка parse_file / parse_stream
  rheo/
    mod.rs
    header.rs             // header_detector.rs (376 LOC)
    rows.rs               // row_mapper.rs (946 LOC) → split on responsibility
    classify.rs
    assemble.rs
  detectors/
    mod.rs                // detectors.rs (1079 LOC) → по типу датасета
    device_kinexus.rs
    device_mcr.rs
    device_ares.rs
    device_fallback.rs
  calibration/
    mod.rs                // calibration.rs (649 LOC) → split
    coefficients.rs
    verification.rs
```
- **Тесты.** Все существующие fixtures из `tests/parsing/fixtures/` должны проходить покапотно идентично.

### WP-4.4 `repositories/experiments.rs` (748 LOC → модули) ⏳ TODO```
src-tauri/src/db/repositories/experiments/
  mod.rs
  read.rs           // list/get/paginate
  write.rs          // insert/update/upsert
  delete.rs
  aggregate.rs      // statistics, counts, report-support
  mapping.rs        // row -> domain types
```

### WP-4.5 TS-файлы > 400 LOC ⏳ TODO| Текущий файл | Размер | Цель разбиения |
|---|---|---|
| `src/lib/analysis/report-types/types.ts` | 700 | `types/measurement.ts`, `types/report.ts`, `types/chart.ts` |
| `src/lib/utils/comparison-data.ts` | 610 | `comparison/normalize.ts`, `comparison/align.ts`, `comparison/diff.ts` |
| `src/app/dashboard/settings/page.tsx` | 605 | tabs: `settings/general.tsx`, `settings/licensing.tsx`, ... |
| `src/components/library/experiment-table.tsx` | 500 | `row.tsx`, `filters.tsx`, `toolbar.tsx` |
| `src/app/dashboard/page.tsx` | 494 | `DashboardHeader`, `DashboardMainPanel`, `DashboardSidebar` |
| `src/components/licensing/LicenseActivationDialog.tsx` | 479 | `steps/SystemInfoStep`, `steps/KeyStep`, `steps/ResultStep` |
| `src/lib/analysis/report-types/converters.ts` | 471 | по целевому формату |
| `src/lib/parsing/client.ts` | 468 | `client/read.ts`, `client/write.ts`, `client/transform.ts` |
| `src/components/calibration/CalibrationChartsUplot.tsx` | 466 | hooks + subcomponents |

### WP-4.6 Автогенерация `tauri.d.ts` через `specta` ⏳ TODO- **Сейчас.** `src/types/tauri.d.ts` (403 LOC) — ручной; есть риск drift'а от реальных сигнатур (88 команд).
- **Цель.**
  1. Annotate: `#[tauri::command, specta::specta]` на всех 88 командах.
  2. `cargo run --bin export-bindings` → `src/types/tauri.generated.d.ts`.
  3. npm script `typegen:tauri`; pre-commit — генерировать и проверять diff.
  4. CI-gate: в PR файл-`generated` должен быть в sync с кодом.
- **Риск.** Средний — некоторые команды возвращают `serde_json::Value`, `specta` требует явного `Type`. Для таких оставить ручной override с комментарием.

---

## 8. Фаза 5 — DX / гигиена

### WP-5.1 ESLint hardening (пошагово) ⏳ TODO1. `@typescript-eslint/consistent-type-imports` → error.
2. `@typescript-eslint/no-floating-promises` → error (требует type-aware linting; убедиться, что `tsconfig` подключён).
3. `no-console` → `error` с allow-list `warn|error` (только во временных ситуациях, в целом — через `logger`).
4. `@typescript-eslint/no-unsafe-function-type` → error.
5. React: `react-hooks/exhaustive-deps` → error.
- **DoD.** `npm run lint -- --max-warnings=0` зелёный.

### WP-5.2 Унификация логгера ⏳ TODO- Сегодня в `src/` три логгера: `src/lib/logger.ts`, `src/lib/client-logger.ts`, `src/lib/utils/debug-logger.ts`. Плюс 42 прямых `console.*`.
- **Цель.** Единый `logger` facade с уровнями (`trace/debug/info/warn/error`), в desktop-mode пишет через Tauri `plugin-log`, в web-mode — console.
- **Миграция.** Скрипт `scripts/refactor/codemod-logger.ts` (jscodeshift/ts-morph) — заменить `console.log(X)` → `logger.debug(X)`.

### WP-5.3 Консолидация npm-скриптов (67 → ≤ 50) ⏳ TODO- Выявлено дублирование семейств: `perf:*:fast` / `perf:*`, `test:e2e:*` по 5 вариантов.
- **План.**
  1. Единый runner `scripts/dev/run.js` с flag-driven режимами.
  2. Старые имена оставить как deprecated-shim: `"perf:bench:fast": "echo [deprecated] use 'npm run perf -- --fast'; npm run perf -- --fast"`.
  3. В `docs/README.md` — чёткая таблица «что чем запускается».

### WP-5.4 Pre-commit / CI gates ⏳ TODO- **`.pre-commit-config.yaml`** добавить:
  - `cargo fmt --check`
  - `cargo clippy -D warnings` *(только после завершения WP-2.1..2.3, иначе не пройдёт)*
  - `eslint --max-warnings=0`
  - `typos` (опечатки)
  - `gitleaks`
- **CI.** `.github/workflows/v2-desktop.yml` — каждый job имеет `needs:` зависимости, fail-fast включён.

### WP-5.5 ADR и миграционные заметки ⏳ TODO- **Новые ADR:**
  - `docs/adr/0001-licensing-architecture.md`
  - `docs/adr/0002-sync-engine-contract.md`
  - `docs/adr/0003-parser-pipeline.md`
  - `docs/adr/0004-logging-and-telemetry.md`
- **Миграции.** Для каждой DB-миграции — `docs/migrations/v{NNNN}.md` с описанием ручных действий (если нужны).
- **Шаблон ADR.** `docs/adr/_template.md` (MADR 4).

---

## 9. Фаза 6 — Верификация, регрессия, governance

### WP-6.1 Повторный audit ⏳ TODO- `npm run audit:enterprise`, `npm run audit:frontend-ipc`, `npm run audit:rust-commands` — сравнение с baseline из WP-0.1.
- Регрессия unwrap/panic → CI-block.

### WP-6.2 Performance-gate ⏳ TODO- В CI nightly job: `cargo bench --baseline pr-<sha>` vs `main`; при регрессии > 10% — PR блокируется, требует комментария-обоснования.

### WP-6.3 Crash/panic телеметрия (опционально) ⏳ TODO
- `std::panic::set_hook` → пишет stack-trace (без PII) в `crash.log`, ротируется.
- Диалог пользователю: «Приложение столкнулось с внутренней ошибкой. Файл `crash.log` сохранён. Отправить разработчикам?» — явный opt-in.

---

## 10. Граф зависимостей между WP

```
WP-0.1  WP-0.3  WP-0.4
   │       │       │
   └───────┴───────┴──► WP-0.2 (предупреждения)
                          │
   ┌──────────────────────┼──────────────────────┐
   ▼                      ▼                      ▼
WP-1.1 .. 1.6        WP-2.1 .. 2.6        WP-5.1 .. 5.5
(Security Critical)   (Reliability)          (DX)
   │                      │                      │
   │                      ▼                      │
   │                  WP-3.x (Perf)              │
   │                      │                      │
   └──────────────────────┼──────────────────────┘
                          ▼
                     WP-4.x (Decomposition)
                          │
                          ▼
                     WP-6.x (Verification)
```

Critical-цепочка: **0.1 → 1.1 → 1.2 → 1.3 → 2.1 → 4.1 → 6.1**.

---

## 11. Стратегия PR и ревью

| Правило | Значение |
|---|---|
| Размер PR (нетто diff) | ≤ 400 строк |
| Один WP = один PR | Исключение: WP-4.x — по одному файлу-источнику на PR |
| Conventional commits | `refactor:`, `perf:`, `fix(sec):`, `feat(db):`, `chore:` |
| Security PR | Минимум 2 ревьюера; ярлык `security` |
| Merge | squash + rebase; в описании — before/after метрики |
| Rollback-план | Каждый PR описывает, какой commit откатывать и какие данные затрагиваются |

**Шаблон описания PR** (`.github/PULL_REQUEST_TEMPLATE.md` — если нет, создать):
```
## WP
- ID: WP-X.Y
- Ссылка: docs/REFACTORING_DEEP_PLAN.md#wp-xy

## Before / After
- (метрики, замеры, тесты)

## Rollback
- git revert <sha> достаточно / нужны дополнительные шаги
```

---

## 12. Критерии «готово»

Рефакторинг считается завершённым, когда **одновременно**:

1. Rust: 0 `panic!`/`todo!`/`unimplemented!` вне `#[cfg(test)]`.
2. Rust: 0 `unwrap`/`expect` в `licensing/`, `db/`, `parser/` (разрешено в тестах; в других местах требует `#[allow]` + комментарий).
3. `npm audit` (prod+dev) — 0 high/critical.
4. Все файлы: Rust ≤ 500 LOC, TS ≤ 400 LOC (кроме `*.generated.*`).
5. Initial bundle chunk уменьшен ≥ 15% относительно baseline.
6. `perf:benchmark` ускорен ≥ 5% относительно baseline.
7. CI gates: clippy `-D warnings`, ESLint `--max-warnings=0`, gitleaks, fmt — все зелёные и обязательные.
8. Все 88 tauri-команд типизированы `#[specta::specta]`; `tauri.generated.d.ts` генерируется автоматически.
9. ADR зафиксированы для: licensing, sync, parsing pipeline, logging.
10. Повторный audit (WP-6.1) показывает отсутствие регрессий.

---

## 13. Риски и митигации

| Риск | Вероятность | Последствие | Митигация |
|---|---|---|---|
| Ломаем формат лицензий | низкая | активация не работает у пользователей | wire-format frozen tests + RC-канал на dev-сервере |
| Ломаем схему БД | средняя | потеря данных | только additive-миграции + backup в WP-1.5 |
| Регрессия отчётов (PDF/Excel) | средняя | несоответствие snapshot | byte-level snapshot tests |
| Переход на rustls ломает licensing | низкая | недоступность активации | feature-flag: fallback на native-tls, смена включается по фазам |
| `panic = "abort"` нарушает unwind | низкая | silent crashes | acceptance — полный e2e-прогон на всех ОС |
| Drift specta-типов | средняя | багрепорты по IPC | CI-gate на re-generation |
| ESLint `max-warnings=0` блокирует работу | высокая | PR-инфляция | включать правила поэтапно, не все сразу |

---

## 14. Governance и прогресс-трекинг

- **Трекер.** Каждый WP = GitHub issue с lable `refactor/phase-N` + `refactor/wp-x.y`.
- **Доска.** GitHub Project view «Refactoring 2026».
- **Прогресс.** После каждого завершённого WP — обновление `runtime/refactor-baseline/progress.md` с актуальными метриками (таблица из § 0).
- **Связи.** Каждый PR ссылается на свой WP + issue.

---

## Приложение A. Быстрый чек-лист для ревьюера PR-рефакторинга

- [ ] PR затрагивает только один WP.
- [ ] `git diff --stat` ≤ 400 строк (без move-only коммитов).
- [ ] Все изменения покрыты тестами; ни один существующий тест не удалён/не ослаблен без ADR.
- [ ] Rust: нет новых `unwrap()`, `expect()`, `panic!()` (кроме тестов).
- [ ] TS: нет `any`, `as any`, `@ts-ignore` без комментария-обоснования.
- [ ] SQL: нет `format!("SELECT …")` без параметризации.
- [ ] Commit message — conventional.
- [ ] Before/after метрики в описании (если WP из Phase 3).
- [ ] Нет изменений в `docs/adr/` ранее смёрдженных записей.

## Приложение Б. Порядок работы агента

1. Создать issue для WP.
2. Ветка `refactor/wp-<id>-<slug>`.
3. Запустить baseline-тест по затронутым тестам.
4. Внести минимальное изменение (чистый refactor → отдельный commit от поведенческих изменений).
5. Повторно запустить тесты.
6. Открыть PR, заполнить шаблон, назначить ревьюеров.
7. После merge — обновить `progress.md`.

