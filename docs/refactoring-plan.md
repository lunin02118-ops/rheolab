# 📋 Детальный план рефакторинга RheoLab Enterprise

> Сформирован на основе аудита кодовой базы. Дата: 2026-04-17.

План разбит на **6 фаз** и **27 рабочих пакетов (WP)**. Каждый WP содержит: затронутые файлы, порядок работ, критерии приёмки (DoD) и стратегию тестирования/отката. Фазы упорядочены по риску: сначала безопасность и стабильность, затем производительность, затем архитектурные преобразования.

---

## Фаза 0 — Подготовка инфраструктуры рефакторинга

Цель: создать «страховочную сетку» до того, как трогать прод-код.

### WP-0.1 — Baseline метрик и защитная сеть
- **Файлы:** `scripts/audit/`, `.github/workflows/v2-desktop.yml`
- **Действия:**
  1. Запустить и зафиксировать текущие baseline: `npm run test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run test:e2e:smoke`, `npm run perf:benchmark`, `npm run audit:build` (bundle size), `cargo build --release` (размер бинарника и время).
  2. Сохранить baseline-артефакты в `runtime/refactor-baseline/` (git-ignored).
  3. Добавить в CI шаги: `cargo clippy -D warnings` (non-blocking warn для старта), `cargo fmt --check`, `npm run lint -- --max-warnings=0` (как non-blocking отчёт).
- **DoD:** вся зелёная baseline зафиксирована, CI-отчёты видны в PR.
- **Откат:** не требуется.

### WP-0.2 — Запрет новых `unwrap` / `panic!` в целевых модулях
- **Файлы:** `src-tauri/src/db/migration.rs`, `src-tauri/src/db/columnar.rs`, `src-tauri/src/commands/licensing/*.rs`
- **Действия:** добавить `#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]` в начале этих файлов (warn — не break, позволяет постепенно чинить).
- **DoD:** clippy-warning'и видны, но CI проходит.
- **Откат:** удалить атрибуты.

### WP-0.3 — Bundle-visualizer и size-gates
- **Файлы:** `vite.config.ts`, `scripts/audit/`
- **Действия:** подключить `rollup-plugin-visualizer` в dev-only режиме, добавить `npm run audit:bundle`, записать текущий размер чанков.
- **DoD:** отчёт `runtime/refactor-baseline/bundle.html` создаётся.

### WP-0.4 — Кодировка комментариев в Rust
- **Файлы:** все `.rs` в `src-tauri/src/commands/licensing/`, другие с побитой кириллицей (grep на `в"`).
- **Действия:** пакетный `iconv -f WINDOWS-1251 -t UTF-8`, проверить diff вручную, добавить `.editorconfig`:`charset = utf-8` + pre-commit hook `check-encoding`.
- **DoD:** комментарии читаемы, `file -i` показывает UTF-8 для всех `.rs`.

---

## Фаза 1 — Безопасность (Critical)

### WP-1.1 — Устранение `panic!` в licensing и hot-path
- **Файлы:**
  - `src-tauri/src/commands/licensing/types.rs` (строки 195, 202)
  - `src-tauri/src/db/columnar.rs` (строка 378: `panic!("missing channel …")`)
  - `src/rust/rheolab-core/src/report_generator/chart_generator.rs:1367`
- **Действия:**
  1. Ввести/использовать варианты `LicenseError` и `DbError` для случаев, которые сейчас паникуют.
  2. Заменить `panic!` на возврат `Err(…)` или `debug_assert!` (для инварианта в chart_generator — если это инвариант).
  3. Пройтись по цепочке вызовов и завернуть в `Result` там, где раньше был `unwrap` результата.
- **DoD:** `grep -rn 'panic!\|todo!\|unimplemented!' src-tauri/src src/rust/rheolab-core/src` → 0 вне тестов; unit-тест для каждого нового error-варианта; сборка проходит.
- **Откат:** изменения локализованы в 3 файлах — revert одного коммита.

### WP-1.2 — Constant-time сравнение через `subtle`
- **Файлы:** `src-tauri/Cargo.toml`, `src-tauri/src/commands/licensing/crypto.rs`
- **Действия:**
  1. Добавить `subtle = "2"` в deps.
  2. В `verify_signature` декодировать hex обеих сторон в `[u8]`, сравнить через `ConstantTimeEq::ct_eq`.
  3. Провести audit-тест (тот же ввод даёт тот же результат, изменение одного бита — false).
- **DoD:** `licensing_tests` зелёные, добавлен новый тест на corner-cases (разная длина, пустая подпись, одинаковые байты).

### WP-1.3 — Обновление/замена уязвимых зависимостей
- **Файлы:** `package.json`, `package-lock.json`, тесты, использующие `xlsx`
- **Действия:**
  1. Перевести тесты-импортёры с `xlsx` на `exceljs` (уже в devDeps) либо на SheetJS CDN ≥ 0.20.2.
  2. Удалить `xlsx@0.18.5` из devDependencies, обновить lock.
  3. Проверить, что парсинг XLSX-фикстур в `tests/parsing/` работает.
- **DoD:** `npm audit` по этим advisories — clean; `npm run test:parsing` зелёный.

### WP-1.4 — Упрочнение `.gitleaks.toml` и secret-scan
- **Файлы:** `.gitleaks.toml`, `.pre-commit-config.yaml`
- **Действия:** добавить паттерны для `*_private.der`, `*.pem`, `PRIVATE KEY`, `BEGIN RSA PRIVATE`; включить gitleaks в pre-commit и в CI-job `security-scan`.
- **DoD:** gitleaks зелёный на текущем HEAD, падает на тестовом dummy-файле с приватным ключом.

### WP-1.5 — Валидация входов tauri-команд
- **Файлы:** `src-tauri/src/commands/**/*.rs`
- **Действия:** для каждой из 93 команд провести аудит: ограничения на длину строк, валидность enum-значений, проверка путей на path traversal (`backup/restore.rs`, `reports.rs`, `parsing/mod.rs`). Ввести общий helper `utils/validation.rs` (`validate_path_within`, `validate_bounded_str`).
- **DoD:** список 93 команд с checklist-строкой; для команд, принимающих пути/имена файлов, добавлены явные проверки.

---

## Фаза 2 — Надёжность

### WP-2.1 — Миграция `unwrap()` в `db/migration.rs` (51 шт)
- **Действия:**
  1. Преобразовать функции, возвращающие `()`, в `Result<(), MigrationError>`.
  2. Каждую миграцию обернуть в транзакцию с `?`-propagation.
  3. Старт приложения (в `lib.rs`) должен корректно показывать ошибку UI-диалогом, а не падать.
- **DoD:** clippy без `unwrap_used` warning в файле; integration-тест «миграция из v0 в текущую» на свежей временной БД.

### WP-2.2 — `columnar.rs` (22 `unwrap`)
- **Действия:** заменить `.unwrap()` при доступе к HashMap каналов на `.ok_or(ColumnarError::MissingChannel(name))`.
- **DoD:** unit-тест с пропущенным каналом возвращает ошибку, не панику.

### WP-2.3 — Парсеры (`filename_parser.rs`, `date_detector.rs`, `row_mapper.rs`, `rheo_parser.rs`, `calibration.rs`)
- **Действия:** 40+ `unwrap` по убывающей важности, использовать существующий `ParseError`. Пользовательский ввод — особо критично.
- **DoD:** fuzz-тест `proptest` на парсинг случайных байтов — 1000 итераций без паник.

### WP-2.4 — `safeInvoke` обёртка для frontend IPC
- **Файлы:** `src/lib/tauri/bridge/` (новая утилита), `src/lib/tauri/sync.ts`, `src/lib/tauri/experiments.ts`
- **Действия:**
  1. Создать `safeInvoke<T>(cmd, args): Promise<Result<T, AppError>>` с единообразным логированием.
  2. Мигрировать 8 «голых» `invoke()` на `safeInvoke`.
  3. В UI-слое добавить toast/UX для ошибок.
- **DoD:** нет unhandled promise rejection в e2e-прогонке full workflow.

### WP-2.5 — Ротация `startup.log`
- **Файлы:** `src-tauri/src/lib.rs`
- **Действия:** rolling (3 файла по 4 МБ), при запуске ротировать, не удалять.
- **DoD:** тест: после достижения лимита старый лог переименован в `.1`, не потерян.

### WP-2.6 — Property-based и benchmark-инфраструктура для core
- **Файлы:** `src/rust/rheolab-core/Cargo.toml`, `src/rust/rheolab-core/tests/`, `benches/`
- **Действия:** добавить dev-deps `proptest`, `criterion`; создать 3–5 пилотных property-тестов и 3 criterion-бенчмарка. Интегрировать в CI как информационный шаг.
- **DoD:** бенчмарки запускаются локально; property-тесты проходят 256 итераций.

---

## Фаза 3 — Производительность

### WP-3.1 — Release-профиль Rust
- **Файлы:** `src-tauri/Cargo.toml`, `src/rust/rheolab-core/Cargo.toml`
- **Действия:**
  1. Включить `lto = "thin"` в `[profile.release]` `src-tauri`.
  2. Удалить неработающий `lto = true` из `rheolab-core/Cargo.toml`.
  3. Замерить: размер бинарника, время `perf:benchmark`, время сборки release.
- **DoD:** baseline до/после в PR-описании; прирост скорости ≥ 5%.

### WP-3.2 — `reqwest` feature-flags
- **Действия:** явно задать `default-features = false, features = ["json", "stream", "rustls-tls"]`. Подтвердить, что license-server на TLS 1.2+ с rustls работает.
- **DoD:** бинарник меньше на TLS-стек OpenSSL, licensing-e2e smoke зелёный.

### WP-3.3 — Индексы и `EXPLAIN QUERY PLAN` аудит БД
- **Файлы:** `src-tauri/src/db/migration.rs` (новая миграция), интеграционные тесты
- **Действия:**
  1. Собрать список всех SQL-запросов в `repositories/` и `commands/`.
  2. На тестовой БД прогнать `EXPLAIN QUERY PLAN`, выявить `SCAN table`.
  3. Добавить недостающие составные индексы: `experiments(laboratory_id, test_date DESC)`, `measurements(experiment_id, timestamp)`.
- **DoD:** `perf:db:large` ускоряется ≥ 20%; все критические query — `SEARCH` по индексу.

### WP-3.4 — React: мемоизация таблиц и списков
- **Файлы:** `src/components/library/experiment-table.tsx`, `experiment-card.tsx`, `src/components/comparison/comparison-selector.tsx`
- **Действия:**
  1. Вынести строку таблицы в отдельный `memo`-компонент.
  2. Заменить инлайн-стрелочные обработчики (36 мест) на `useCallback`.
  3. Применить `@tanstack/react-virtual` для больших списков.
- **DoD:** React Profiler — снижение rerender count ≥ 50% при изменении одного элемента.

### WP-3.5 — Разбиение крупных страниц + `React.lazy`
- **Файлы:** `src/app/dashboard/settings/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/dashboard/comparison/page.tsx`, `src/components/licensing/LicenseActivationDialog.tsx`
- **Действия:**
  1. `settings/page.tsx` разбить по вкладкам (`general`, `licensing`, `export`, `library`).
  2. Lazy-load вкладок и диалога активации через `React.lazy` + `<Suspense>`.
- **DoD:** initial-chunk меньше на ≥ 50 KB (gz); first-paint Lighthouse не ухудшается.

### WP-3.6 — SQLite PRAGMA fine-tuning
- **Файлы:** `src-tauri/src/db/pool.rs`, новая миграция
- **Действия:** оценить включение `PRAGMA page_size = 8192` и настройку `wal_autocheckpoint` — только если измерение показывает выгоду.
- **DoD:** измеренный прирост при seq-scan на большой БД, иначе WP закрывается без изменений.

---

## Фаза 4 — Архитектура и декомпозиция

### WP-4.1 — Разбиение `db/migration.rs` (1015 LOC)
- **Действия:** вынести каждую миграцию в `db/migrations/v{NNNN}_{name}.rs`, оставить регистрацию в массиве.
  ```
  db/migrations/
    mod.rs            // registry
    v0001_initial.rs
    v0002_reagents.rs
    ...
  ```
- **DoD:** integration-тест «миграция c чистой БД до HEAD» зелёный; каждый файл ≤ 250 LOC.

### WP-4.2 — Разбиение `chart_generator.rs` (1372 LOC) и `pdf.rs` (1370 LOC)
- **Действия:**
  - `chart_generator/` → `mod.rs`, `line.rs`, `flow_curve.rs`, `viscosity.rs`, `bar.rs`, `common.rs`.
  - `pdf.rs` → `pdf/mod.rs`, `pdf/header.rs`, `pdf/charts_section.rs`, `pdf/measurements_table.rs`, `pdf/footer.rs`.
- **DoD:** каждый файл ≤ 400 LOC; snapshot-тесты отчётов не меняются.

### WP-4.3 — Разбиение парсеров `rheo_parser.rs` (1239), `row_mapper.rs` (946), `detectors.rs` (1079), `calibration.rs` (649)
- **Действия:** детектор на файл, парсер-пайплайн на модули (input → normalize → classify → extract → assemble).
- **DoD:** каждый файл ≤ 400 LOC; существующие parser-тесты полностью зелёные.

### WP-4.4 — Разбиение `repositories/experiments.rs` (748)
- **Действия:** по командам: `read.rs`, `write.rs`, `aggregate.rs`, `delete.rs`, общие — в `shared.rs`.
- **DoD:** API репозитория остаётся прежним; все тесты `crud_tests.rs` зелёные.

### WP-4.5 — Разбиение крупных TS-файлов
- **Файлы:** `src/lib/analysis/report-types/types.ts` (700 LOC), `src/lib/utils/comparison-data.ts` (610 LOC), `src/lib/parsing/client.ts` (468 LOC)
- **Действия:** разнести типы по доменам (`types/measurement.ts`, `types/report.ts`, …), утилиты — по подтеме.
- **DoD:** tree-shaking не ухудшается, сборка проходит, тесты зелёные.

### WP-4.6 — Автогенерация `src/types/tauri.d.ts` через `specta`
- **Файлы:** `src-tauri/src/commands/**/*.rs`, `src/types/tauri.generated.d.ts`
- **Действия:**
  1. Аннотировать все 93 команды `#[specta::specta]`.
  2. Добавить npm-скрипт `typegen:tauri`, который экспортирует типы.
  3. В pre-commit — проверка, что сгенерированный файл соответствует коду.
- **DoD:** устранён drift между Rust и TS; команды без аннотации считаются ошибкой lint.

---

## Фаза 5 — DX / Гигиена

### WP-5.1 — Усиление ESLint
- **Файлы:** `eslint.config.mjs`
- **Действия:**
  1. `@typescript-eslint/no-unsafe-function-type` → `error`.
  2. `no-console` → `error` с allowlist `warn`/`error`, остальное через общий `logger`.
  3. Включить `@typescript-eslint/consistent-type-imports`, `@typescript-eslint/no-floating-promises`.
- **DoD:** `npm run lint --max-warnings=0` зелёный; 42 «сырых» `console.*` заменены на `logger`.

### WP-5.2 — Унификация логгера
- **Файлы:** `src/lib/logger.ts`, `src/lib/client-logger.ts`, `src/lib/utils/debug-logger.ts`
- **Действия:** объединить в один фасад с уровнями, route-ить в Tauri `plugin-log` в десктопе.
- **DoD:** один `logger.debug/info/warn/error` во всём `src/`.

### WP-5.3 — Консолидация npm-скриптов
- **Файлы:** `package.json`, `scripts/dev/run-*.js`
- **Действия:** свести дубли `perf:*:fast` / `perf:*` в единый runner с флагами. Сократить до ≤ 60 скриптов. Старые имена сохранить как deprecated-shim.
- **DoD:** документация в `README.md` обновлена.

### WP-5.4 — Pre-commit и CI hardening
- **Файлы:** `.pre-commit-config.yaml`, `.github/workflows/v2-desktop.yml`
- **Действия:** добавить `cargo fmt --check`, `cargo clippy -D warnings`, `eslint --max-warnings=0`, `gitleaks`, `typos`.
- **DoD:** зелёный CI; пайплайн валит PR при несоблюдении.

### WP-5.5 — ADR и миграционные заметки
- **Файлы:** `docs/adr/0001-licensing.md`, `docs/adr/0002-sync-engine.md`, `docs/adr/0003-parser-pipeline.md`, `docs/migrations/`
- **Действия:** зафиксировать ключевые архитектурные решения; для каждой DB-миграции — заметка о необходимых ручных действиях.
- **DoD:** ADR включены в README; template для новой ADR добавлен.

---

## Фаза 6 — Верификация и мониторинг

### WP-6.1 — Повторный enterprise audit
- Запуск `npm run audit:enterprise` и `audit:frontend-ipc` — сравнение с baseline из WP-0.1.

### WP-6.2 — Performance regression gate
- Добавить в CI шаг: перф-бенчмарки сравниваются с baseline (±5%); регрессия > 10% → fail.

### WP-6.3 — Crash/panic телеметрия (опционально)
- В `lib.rs` установить `std::panic::set_hook`, логировать в `crash.log` (без PII).

---

## 🗺 Зависимости между фазами

```
Фаза 0 ─┬─► Фаза 1 ──┬─► Фаза 2 ──┬─► Фаза 3 ──► Фаза 6
         │            │            │
         └─► Фаза 5 ◄─┴────────────┴─► Фаза 4
```

- Фаза 0 обязательна до любой другой.
- Фаза 1 (безопасность) — наивысший приоритет.
- Фаза 4 (декомпозиция) — после/параллельно Фазе 2.
- Фазы 3 и 5 независимы, могут идти параллельно.

---

## 📦 Стратегия PR

| Правило | Значение |
|---|---|
| Размер PR | ≤ 400 строк diff нетто (без генерированных файлов) |
| 1 WP = 1 PR | Исключение: WP-4.x дробится на подкоммиты по одному файлу-источнику |
| Обязательная часть PR-описания | before/after метрики (если применимо), ссылка на WP |
| Ревью | Security WP (1.x) — минимум 2 ревьюера |
| Мёрж | squash, conventional commits (`refactor:`, `perf:`, `fix(sec):`) |

---

## ✅ Критерии завершения рефакторинга

1. `grep panic!\|unwrap!\|expect!` в прод-коде Rust → 0 вне тестов (или обоснованы комментарием).
2. `npm audit` по prod и dev — нет high/critical.
3. Ни одного файла > 500 LOC в Rust, > 400 LOC в TS (кроме автогенерированных).
4. Bundle initial chunk — на ≥ 15% меньше baseline.
5. `perf:benchmark` — на ≥ 5% быстрее baseline.
6. CI: clippy `-D warnings`, eslint `--max-warnings=0`, gitleaks — все зелёные и обязательные.
7. Каждая tauri-команда типизирована через `specta`; `tauri.generated.d.ts` генерируется автоматически.
8. ADR зафиксированы для licensing, sync-engine, parser-pipeline, миграций.
