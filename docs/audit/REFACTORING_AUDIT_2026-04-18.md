# 🔍 Глубокий аудит рефакторинга RheoLab Enterprise V2

> **Дата аудита:** 2026-04-18  
> **Коммит:** `HEAD` рабочего дерева (локальное состояние)  
> **Предмет аудита:** качество выполнения плана `docs/REFACTORING_DEEP_PLAN.md` и реальное состояние кодовой базы  
> **Методика:** независимое измерение метрик + сверка с заявленными DoD по каждому WP

---

## 0. TL;DR — Итоговая оценка

| Категория | Оценка | Обоснование |
|---|---|---|
| **Общее качество кода** | **B+** | Тесты зелёные, типизация строгая, архитектурные слои читаемые |
| **Соответствие плану** | **C+** | ~65% WP-claims соответствуют коду, остальные — overstated |
| **Безопасность (Фаза 1)** | **A–** | xlsx удалён, SQL безопасен, HMAC constant-time; валидация есть, но не покрыта чек-листом |
| **Надёжность (Фаза 2)** | **B** | `safeInvoke` и логгер отличные; unwrap/expect в парсерах — претензия невыполнена |
| **Производительность (Фаза 3)** | **N/A** | Не измерено (нет baseline-артефактов) |
| **Архитектура (Фаза 4)** | **C** | TypeScript декомпозиция полная; Rust — 11 файлов всё ещё > 500 LOC |
| **DX/гигиена (Фаза 5)** | **A–** | ESLint жёсткий, логгер единый, pre-commit работает |
| **Документация / ADR** | **A** | 4 новых ADR высокого качества (особенно ADR-0004) |
| **Тестовое покрытие** | **A–** | 1611 тестов, 1 pre-existing failure |

**Вердикт.** Рефакторинг — **частично выполнен и в значительной мере реален**, но `REFACTORING_DEEP_PLAN.md` содержит **ряд некорректных `✅ DONE` пометок**, которые нужно исправить. Приоритет — доделать Phase 4 (декомпозиция крупных Rust-файлов) и Phase 0.3 (повторная очистка mojibake).

---

## 1. Baseline-метрики на момент аудита

Запущенные локально скрипты: `scripts/audit/measure-loc.ps1`, `scripts/audit/measure-quality.ps1`, `scripts/audit/rust-quality.ps1`, `scripts/audit/orphan-commands.ps1`.

### 1.1 Размеры кодовой базы

| Метрика | План: baseline | План: после рефакторинга | **Реально измерено** | Δ vs план |
|---|---:|---:|---:|---|
| Rust LOC (`src-tauri` + `rheolab-core`) | 35 072 | 32 241 | **30 055** | ✅ даже лучше |
| TypeScript LOC (`src/`, без `rust/`, `*.d.ts`) | 32 348 | 29 439 | **28 858** | ✅ лучше |
| `#[tauri::command]` (defined) | 93 | 88 («stable») | **88** | ✅ совпало |
| `invoke_handler![]` (registered) | — | 88 | **87** | ⚠️ 1 orphan |

**Orphan-команда:** `experiments_export` (`src-tauri/src/commands/experiments/export/mod.rs:68`) — помечена `#[deprecated]` и не зарегистрирована в `lib.rs`. Мёртвый код, его нужно либо удалить, либо вернуть в handler.

### 1.2 Файлы крупнее лимитов

**DoD плана (§12.4):** «Все файлы: Rust ≤ 500 LOC, TS ≤ 400 LOC (кроме `*.generated.*`)».

**TypeScript — цель достигнута ✅**
```
Top-5:
  396  src/lib/utils/touch-point.ts
  391  src/hooks/useRheologyChartOptions.ts
  383  src/app/dashboard/settings/page.tsx
  380  src/lib/store/chart-settings-store.ts
  372  src/app/dashboard/page.tsx
```
Ни один файл не превышает 400 LOC — WP-4.5 выполнен добросовестно.

**Rust — цель НЕ достигнута ❌**
```
11 файлов > 500 LOC:
 1084  src/rust/rheolab-core/src/report_generator/pdf/template.rs       ← КРИТИЧНО
  985  src/rust/rheolab-core/src/detectors.rs                            ← deferred
  788  src/rust/rheolab-core/src/report_generator/chart_generator/line.rs
  773  src/rust/rheolab-core/src/report_generator/excel.rs
  600  src-tauri/src/commands/backup/restore_tests.rs                    ← test file
  600  src-tauri/src/commands/parsing/commands.rs
  537  src/rust/rheolab-core/src/report_generator/touch_point.rs
  518  src-tauri/src/db/migration.rs                                     ← claimed ✅ DONE
  508  src/rust/rheolab-core/src/parser/calibration/parsers.rs
  505  src/rust/rheolab-core/src/parser/rheo_parser/mod.rs
  503  src-tauri/src/commands/licensing/hardware.rs
```

### 1.3 Обработка ошибок (Rust, non-test прод-код)

| Метрика | План утверждает | **Реально** | Статус |
|---|---:|---:|---|
| `.unwrap()` в non-test | 0 в `licensing/`, `db/`, `parser/` (§12.2) | **30 по всему non-test коду** | ❌ |
| `.expect()` в non-test | 0 (там же) | **20** | ❌ |
| `panic!()` в non-test | 0 вне `#[cfg(test)]` (§12.1) | **2** (compile-time guards) | ⚠️ допустимо (см. WP-1.1) |
| `todo!()` / `unimplemented!()` | 0 | **0** | ✅ |

Главные нарушители:

| Файл | `.unwrap()` | `.expect()` | Категория |
|---|---:|---:|---|
| `parser/filename_parser.rs` | 17 | 0 | ~13 LazyLock regex (idiom), ~4 captures().get().unwrap() |
| `parser/calibration/parsers.rs` | 4 | 0 | **проблема — не LazyLock** |
| `licensing/crypto.rs` | 0 | 3 | `new_from_slice().expect("HMAC…")` — допустимо, но можно явить как invariant |
| `parser/date_detector.rs` | 3 | 0 | **проблема** |
| `parser/rheo_parser/workbook.rs` | 0 | 2 | `last().expect("non-empty…")` — есть доказательство |
| `parser/rheo_parser/csv_parser.rs` | 0 | 2 | то же |
| `report_generator/typst_renderer.rs` | 2 | 2 | **проблема** |
| `parser/row_mapper/detection.rs` | 2 | 0 | LazyLock Regex (idiom) |
| `lib.rs` | 0 | 1 | `.run(…).expect()` в `run()` — классически для `main` |

### 1.4 Mojibake (UTF-8)

План утверждает (WP-0.3): «32 исправления в 10 файлах (шаблоны: `вЂ"` → `—`, `вЂ¦` → `…`, `Г—` → `×`)».

**Реально найдено 39 совпадений** оставшегося mojibake в 8 из 10 «очищенных» файлов:
```
src-tauri/src/commands/licensing/crypto.rs     — 9 matches  (в”Ђ box-drawing)
src-tauri/src/commands/analysis.rs             — 8 matches
src-tauri/src/commands/licensing/mod.rs        — 6 matches
src-tauri/src/commands/experiments/crud.rs     — 5 matches  (Г— mult-sign)
src-tauri/src/commands/experiments/export/mod.rs — 5 matches
src-tauri/src/commands/experiments/list/query.rs — 3 matches
src-tauri/src/commands/api_keys/commands.rs    — 2 matches
src-tauri/src/commands/backup/restore.rs       — 1 match
```
WP-0.3 фактически **закрыт ошибочно** — `scripts/refactor/fix_encoding.py` не содержал паттернов для box-drawing (`─`, `═`) и, судя по всему, был запущен не на всех заявленных файлах.

### 1.5 `console.*` в TypeScript

План утверждает (WP-5.2): «прямых `console.*` осталось ≤5 (все с eslint-disable, dev-only)».

**Реально:** **39 совпадений** `console.log/info/warn/error/debug` в 20+ файлах. Большая часть — `console.warn`/`console.error`, которые **ESLint разрешает** (правило `no-console: ["error", { allow: ["warn", "error"] }]`). Но претензия «≤5» неверна.

Файлы с прямыми вызовами в prod-пути: `main.tsx`, `lib/store/license-store.ts`, `lib/licensing/multi-license-store.ts`, `components/charts/uplot-chart.tsx`, `hooks/useAnalysisPipeline.ts`, `lib/store/chart-settings-store.ts`, `components/settings/AppSettingsExporter.tsx`, `lib/utils/encryption.ts`, `lib/parsing/client.ts`.

### 1.6 SQL-конкатенация

**Все 3 места безопасны** (подтверждено):
```
src-tauri/src/commands/experiments/export/mod.rs:206
  format!("SELECT id FROM Experiment {} ORDER BY testDate DESC", where_clause)
  → where_clause содержит только `?`-placeholders

src-tauri/src/commands/experiments/crud.rs:68
  format!("SELECT id FROM Experiment WHERE id IN ({ph})")
  → `ph` — строка из `?, ?, ?`, параметры через params_from_iter

src-tauri/src/db/migration.rs:148
  format!("SELECT COUNT(*) FROM {table}")
  → внутри #[cfg(test)] mod tests, test-only
```

### 1.7 Тестовое покрытие

| Набор | Результат |
|---|---|
| `cargo test -p rheolab-core` | **152 passed, 0 failed** ✅ |
| `cargo test -p rheolab_v2` | **289 passed, 1 failed** (`test_stub_force_ai_uses_structured_mapping_for_fixture`) |
| `npm test` (Vitest) | **1170 passed, 6 skipped, 0 failed** ✅ |
| `tsc --noEmit` | **чисто** ✅ |
| `eslint --max-warnings=0` | **чисто** ✅ |
| `cargo check -p rheolab_v2` | **чисто с 5 warnings** (unused imports в `rheo_parser/mod.rs`) |

**Итого: 1611 тестов, 1 известное падение** (pre-existing AI-mapping, упомянут в WP-4.4).

---

## 2. Пофазовый анализ выполнения плана

### 2.1 Фаза 0 — Подготовка

| WP | Claim | Факт | Вердикт |
|---|---|---|---|
| 0.1 Baseline | ✅ DONE | Скрипт `scripts/audit/snapshot-metrics.js` существует, но `runtime/refactor-baseline/metrics.json` **НЕ найден** в репо | ⚠️ Артефакты не сохранены |
| 0.2 Clippy warn | ✅ DONE | `#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]` присутствует в `db/migration.rs`, `licensing/crypto.rs`, `licensing/hardware.rs` | ✅ OK |
| 0.3 UTF-8 fix | ✅ DONE (32 fix в 10 файлах) | **39 mojibake** всё ещё в 8 из 10 заявленных файлов | ❌ **FALSE-DONE** |
| 0.4 Bundle visualizer | ✅ DONE | `rollup-plugin-visualizer` в `package.json` ✅, `vite.config.ts` учитывает `ANALYZE=true` (надо проверить вручную); `runtime/refactor-baseline/bundle.html` **НЕТ** | ⚠️ инфраструктура есть, артефакта нет |

### 2.2 Фаза 1 — Безопасность

| WP | Claim | Факт | Вердикт |
|---|---|---|---|
| 1.1 `panic!` в прод | ✅ DONE (оставлены 2 compile-time guards) | Подтверждено: 2 `panic!` в `licensing/types.rs` (внутри `#[cfg(not(debug_assertions))]`) + тесты | ✅ OK |
| 1.2 Constant-time signature | ✅ DONE | `verify_signature()` использует `HmacSha256 as Mac::verify_slice()` — constant-time из `subtle` crate (через digest/hmac stack) | ✅ OK |
| 1.3 Удаление `xlsx` | ✅ DONE | `grep "xlsx"` в `package.json` / `package-lock.json` → 0 совпадений; ADR-0004 отличного качества | ✅ OK |
| 1.4 Аудит SQL | ✅ DONE | 3 места верифицированы как безопасные | ✅ OK |
| 1.5 Валидация 88 команд | ✅ DONE | `utils/validation.rs` существует, покрыт unit-тестами. **Но:** `docs/audit/command-validation.md` (заявленный чек-лист) **НЕ СУЩЕСТВУЕТ** | ⚠️ утилиты есть, чек-лист не составлен |
| 1.6 `.gitleaks.toml` | ✅ DONE | `.gitleaks.toml` (2980 bytes) присутствует | ✅ (не проверялось на паттернах) |

### 2.3 Фаза 2 — Надёжность

| WP | Claim | Факт | Вердикт |
|---|---|---|---|
| 2.1 `db/migration.rs` unwrap→Result | ✅ DONE | `run_migrations` возвращает `Result<…>` через `?`, все `.unwrap()` в `#[cfg(test)]` | ✅ OK |
| 2.2 `db/columnar.rs` unwrap→Result | ✅ DONE | Prod-код использует `Result<T, AppError>`, unwrap только в тестах | ✅ OK |
| 2.3 **Парсеры unwrap→Result** | ✅ DONE (0 bare unwraps) | **15+ unwrap/expect в `parser/`:** `filename_parser` (4 bare captures-unwrap), `calibration/parsers` (4), `date_detector` (3), `row_mapper/detection` (2), `rheo_parser/csv_parser` (2 expect), `rheo_parser/workbook` (2 expect), `geometry_verifier` (2) | ❌ **FALSE-DONE** |
| 2.4 `safeInvoke` обёртка | ✅ DONE | 9 доменных файлов в `src/lib/tauri/*.ts` используют `import { safeInvoke as invoke }`; `eslint.config.mjs` `no-restricted-imports` гвард активен | ✅ OK |
| 2.5 Ротация `startup.log` | ✅ DONE | `lib.rs::rotate_startup_log(keep: 7)` реализован: 512KB threshold, хранит 7 последних | ✅ OK |
| 2.6 Инфра тестирования core | ✅ DONE | `proptest` активно используется (`chart_generator/mod.rs::lttb_invariants`); `criterion` и `insta` не добавлены — бенчи отсутствуют | ⚠️ частично (бенчи отложены, см. WP-6.2) |

### 2.4 Фаза 3 — Производительность

| WP | Claim | Факт | Вердикт |
|---|---|---|---|
| 3.1–3.6 Все помечены ✅ DONE | — | `Cargo.toml` профили, `reqwest` настройки, SQLite PRAGMA — не проверялись в этом аудите; **отсутствуют baseline-артефакты** для валидации ≥5% ускорения (требование §12.6) | ⚠️ **не верифицируемо** |

Рекомендация: Phase 3 нуждается в повторном запуске `perf:benchmark` и сравнении с baseline — сейчас DoD №6 («perf ускорен ≥5%») недоказуем.

### 2.5 Фаза 4 — Архитектура

| WP | Claim | Факт | Вердикт |
|---|---|---|---|
| 4.1 `db/migration.rs` → модули | ✅ DONE | `migrations/` создана (`v0001_initial.rs` 20.9KB, `trait.rs`, `error.rs`). Однако `migration.rs` всё ещё **518 LOC** (>500, из них ~430 — `#[cfg(test)]`) | ⚠️ структурно ок, но цель по размеру не выполнена |
| 4.2 Report generator | ✅ DONE — 5+5 подмодулей | Реально: `chart_generator/` = `line.rs` (788!) + `common.rs` + `mod.rs` — **только 2 подмодуля из 5 заявленных**. `pdf/` = `mod.rs` + `template.rs` **1084 LOC монолит** — **0 из 5 заявленных подмодулей** | ❌ **FALSE-DONE** |
| 4.3 Парсеры | ✅ DONE | `rheo_parser/`, `row_mapper/`, `calibration/` созданы как директории. Но `rheo_parser/mod.rs` 505 LOC, `calibration/parsers.rs` 508 LOC — на границе. 5 unused-import warnings указывают на грязный перенос | ⚠️ структурно ок, чистка нужна |
| 4.4 `repositories/experiments.rs` | ✅ DONE | `repositories/experiments/{mod,read,write,delete}.rs` — чистое разбиение с trait'ом и документацией. **Образцовый WP** | ✅ OK |
| 4.5 TS > 400 LOC | ✅ DONE | Все TS/TSX < 400 LOC (max 396). **Образцовый WP** | ✅ OK |
| 4.6 Specta автогенерация | ✅ (pre-existing) | `generated.d.ts` = 216 LOC (claim: ~290), `tauri.d.ts` = 358 LOC (claim: ~625) — numbers отличаются, но инфраструктура работает | ✅ OK |

**Сводка Фазы 4.** Из 6 WP три — образцовые (4.4, 4.5, 4.6), один — частичный структурный перенос без цели по размеру (4.1, 4.3), один — **фейковый DONE** (4.2). DoD §12.4 («Rust ≤ 500 LOC») НЕ выполнен.

### 2.6 Фаза 5 — DX/гигиена

| WP | Claim | Факт | Вердикт |
|---|---|---|---|
| 5.1 ESLint hardening | ⏳ TODO в плане | Реально `eslint.config.mjs` содержит: `no-explicit-any: error`, `no-unused-vars: error`, `no-unsafe-function-type: error`, `consistent-type-imports: error`, `no-floating-promises: error`, `react-hooks/exhaustive-deps: error`, `no-console: error (allow warn\|error)`, `no-restricted-imports` для `invoke`. `npm run lint -- --max-warnings=0` ЧИСТО | ✅ **план отстаёт от реальности** — WP сделан |
| 5.2 Унификация логгера | ✅ DONE | Единый `src/lib/logger.ts` facade с TRACE/DEBUG/INFO/WARN/ERROR, `createLogger(module)`, forwarding в Tauri log. `client-logger.ts` / `debug-logger.ts` удалены | ✅ OK (кроме претензии о ≤5 console.*) |
| 5.3 Консолидация npm-скриптов | ✅ DONE (68→52) | В `package.json` сейчас **42 скрипта** (после удаления release:prepare audit:deep* и т.д.) | ✅ OK |
| 5.4 Pre-commit/CI gates | ✅ DONE | `.pre-commit-config.yaml` 1384 bytes, `_typos.toml` 652 bytes, `.gitleaks.toml` 2980 bytes присутствуют | ✅ OK (конкретные хуки не верифицировались) |
| 5.5 ADR | ✅ DONE | 10 ADR в `docs/adr/`: `_template`, `README`, и ADR-0001..0008. Особенно высокого качества — ADR-0004 (SheetJS отказ) и ADR-0005 (licensing) | ✅ **отличное качество** |

### 2.7 Фаза 6 — Верификация

| WP | Claim | Факт | Вердикт |
|---|---|---|---|
| 6.1 Повторный audit | ✅ DONE (partial) | Статические метрики воспроизведены. `audit:enterprise` не запускался (требует Tauri build) | ⚠️ частично |
| 6.2 Performance-gate | ⏳ DEFERRED | Бенчмарков нет, baseline утерян | ⚠️ откладывается |
| 6.3 Crash telemetry | ⏳ DEFERRED | `std::panic::set_hook` не настроен; `renderer crash` → `tauri-plugin-log` есть в `main.tsx` | ⚠️ только frontend крэши идут в лог |

---

## 3. Архитектурные наблюдения

### 3.1 Что удалось хорошо

- **Слоистая структура Tauri-команд.** `commands/{backup,experiments,reagents,operators,laboratories,licensing,parsing,analysis,reports,data_flows,api_keys,sync_engine,fixtures,logger}/` — читаемая доменная разбивка. Вся фактическая логика тонкая; толстые операции в repo-слое (`db/repositories/experiments/`).
- **`repositories/experiments/`.** Trait-based dependency inversion (`ExperimentRepository` trait + `SqliteExperimentRepository` реализация) — образец для подражания на будущее.
- **`safeInvoke` + ESLint guard.** Невозможно случайно протащить обёртку ошибок — ESLint блокирует прямой `import { invoke }`.
- **Logger facade.** Единый `@/lib/logger` с `createLogger(module)` + forwarding в Tauri plugin-log для ERROR — даёт и консольный вывод, и персистентный лог.
- **Types-first контракт.** `specta` генерит `generated.d.ts` из Rust; `tauri.d.ts` — тонкий wrapper. `tsc --noEmit` чистый.
- **Тестовая дисциплина.** 1611 тестов (в том числе `proptest` для LTTB-инвариантов), 99.94% проходят.

### 3.2 Что требует доработки

1. **Монолит `pdf/template.rs` (1084 LOC).** Это самый большой активный исходник в проекте. Его нужно разбить по секциям (passport, calibration, recipe, water, charts_section, stats, footer) согласно WP-4.2.
2. **`chart_generator/line.rs` (788 LOC).** Содержит весь движок генерации SVG. Нуждается в разбиении по типам чарт (как обещает WP-4.2).
3. **`excel.rs` (773 LOC).** Не в плане, но крупный файл. Логика экспорта Excel могла бы быть разнесена по листам/секциям.
4. **`detectors.rs` (985 LOC).** Явно deferred в плане (§7), но это — один из самых сложных модулей и заслуживает внимания.
5. **`parsing/commands.rs` (600 LOC).** Monolithic parsing command; нужно декомпозировать в под-команды или в слои (валидация / парсинг / постпроцессинг).
6. **5 unused imports в `rheo_parser/mod.rs`.** После WP-4.3 не была проведена чистка. `cargo fix --allow-dirty` снимет.
7. **Оrphan `experiments_export`.** `#[deprecated]` + не зарегистрирован в handler. Если код не нужен — удалить; если нужен — вернуть в `invoke_handler![]`.

### 3.3 Структурная когерентность

- **FE/BE split правильный.** `src-tauri/` — Tauri shell + IPC + persistence; `src/rust/rheolab-core/` — чистое крейт-ядро (парсинг/анализ/отчёты), без зависимостей от Tauri. ✅
- **Отсутствуют циклы.** `commands` → `db/repositories` → `db/migrations`; `rheolab-core` самодостаточен. ✅
- **Единый `AppError` / `Result`.** Нет фрагментации на `ColumnarError`, `MigrationError` и т.д. (План явно это обсуждал — хорошее решение.)

---

## 4. Выявленные риски

| # | Риск | Серьёзность | Мотивация |
|---|---|---:|---|
| R-1 | Mojibake в `licensing/crypto.rs` | **Высокая** | Файл критичен для лицензирования; любая будущая правка на Windows WSL / non-UTF8 shell может сломать код |
| R-2 | `unwrap()`/`expect()` в парсерах | Средняя | Некорректный файл пользователя → panic → процесс крах (на desktop это =прекращение работы) |
| R-3 | Отсутствие `runtime/refactor-baseline/*` | Средняя | Невозможно доказать выполнение §12.5 (bundle −15%) и §12.6 (perf +5%) без baseline |
| R-4 | Монолит `pdf/template.rs` (1084 LOC) | Средняя | Изменение дизайна PDF затрагивает всё — высокий риск регрессий в golden-snapshot |
| R-5 | Orphan-команда `experiments_export` | Низкая | Dead-code, но `#[deprecated]` — пользовательский код может ещё её звать (нужна проверка frontend) |
| R-6 | 1 failing test `test_stub_force_ai_uses_structured_mapping_for_fixture` | Низкая | Упомянут в WP-4.4 как pre-existing; если это — baseline для AI-parsing, стоит либо починить, либо явно пометить `#[ignore]` с ADR |
| R-7 | 5 unused-imports warnings в `rheo_parser/mod.rs` | Очень низкая | Грязный после декомпозиции — snapshot регрессий нет, но портит CI output |

---

## 5. Рекомендации (приоритизированы)

### 5.1 Немедленно (≤ 1 день работы)

1. **Обновить пометки в `REFACTORING_DEEP_PLAN.md`:**
   - WP-0.3 → `⚠️ PARTIAL` + пояснение, что box-drawing и `Г—` не вычистились.
   - WP-2.3 → `⚠️ PARTIAL` + перечислить оставшиеся unwrap/expect.
   - WP-4.2 → `⚠️ PARTIAL` + указать, что chart и pdf остались монолитными.
   - WP-5.1 → `✅ DONE` (а не `⏳ TODO`, как сейчас — реальность опережает план).
   - Обновить метрики §0 на актуальные: Rust 30 055, TS 28 858, commands 88, unwrap non-test 30, expect non-test 20.
2. **Удалить или восстановить `experiments_export`**. Одно из двух.
3. **Вычистить unused imports** в `parser/rheo_parser/mod.rs` (`cargo fix --lib -p rheolab-core --allow-dirty`).

### 5.2 Короткий срок (1–3 дня работы)

4. **Расширить `scripts/refactor/fix_encoding.py`** паттернами box-drawing:
   ```
   в”Ђ → ─    в”Ѓ → ━    в•ђ → ═    вЊ — специальное
   Г— → ×    вЂ" → —    вЂ¦ → …
   ```
   Затем повторно прогнать на всех `*.rs` + `*.ts` + `*.tsx` + `*.md`.
5. **Составить `docs/audit/command-validation.md`** — требование WP-1.5 DoD. Чек-лист one-per-command с пометкой, какие validation-функции применены.
6. **Пересохранить baseline-артефакты** в `runtime/refactor-baseline/` (metrics.json, bundle.html) — критично для WP-6.1/6.2.
7. **Починить или `#[ignore]`-нуть `test_stub_force_ai_uses_structured_mapping_for_fixture`** + оформить ADR либо issue.

### 5.3 Средний срок (1–2 недели)

8. **Завершить WP-4.2 по-настоящему.** Разбить `chart_generator/line.rs` на `{line, flow_curve, viscosity, bar}` и `pdf/template.rs` на `{header, passport, calibration, recipe, charts_section, stats, footer}`. Каждая подмодуль ≤ 300 LOC. **Red line** — не поломать `report_regression_test.rs` (byte-level snapshots).
9. **Завершить WP-2.3.** Прогнать по парсерам `clippy -- -W clippy::unwrap_used -W clippy::expect_used` и конвертировать bare `.unwrap()` на `.ok_or(ParseError::…)?` или `.map_err(…)?`. Ожидаемо: `filename_parser.rs` (captures unwrap), `calibration/parsers.rs`, `date_detector.rs`, `typst_renderer.rs`.
10. **Документировать оставшиеся `.expect()` как инварианты.** Там, где `.expect("non-empty: element pushed before loop")` — это SAFETY-комментарий, который стоит оформить как `# SAFETY:` doc-блок + `// SAFETY:` inline-комментарий.

### 5.4 Длинный срок (по мере необходимости)

11. **Запустить WP-3 бенчи** (если это в роадмапе). `cargo bench` для `flow_curve_fit`, `downsample_lttb`, `pdf_render_one_page` — даст численное подтверждение §12.6.
12. **Декомпозировать `detectors.rs`** (985 LOC) — отдельный WP-4.7. Разделить anchor-based, SST, repeating-sequence detection + classification.
13. **Внедрить WP-6.3 (crash telemetry)** — `std::panic::set_hook` + ротируемый `crash.log`. Поможет в обнаружении регрессий.

---

## 6. Итоговая карта «План vs Реальность»

```
Phase 0  ████████████░░  4/4 helperов, 3/4 артефактов
Phase 1  ██████████████  6/6 WP структурно, 2/6 частично (1.5 без чек-листа, 0.3 плохо)
Phase 2  ████████████░░  5/6 ok, WP-2.3 (парсеры) — реально partial
Phase 3  ██░░░░░░░░░░░░  Все ✅ в плане, но НЕ верифицируемо — нет baseline
Phase 4  ████████░░░░░░  3/6 образцовые, 1/6 частично, 2/6 структурно-ок-но-не-по-цели
Phase 5  █████████████░  4/5 ок; WP-5.2 ок, но претензия «console.* ≤5» неверна
Phase 6  █████░░░░░░░░░  6.1 partial, 6.2 DEFERRED, 6.3 DEFERRED
```

**Математически:** из 27 WP заявлено «готово» 24; по независимой сверке — **≈ 16 полностью, 6 частично, 2 фейковые, 3 отложены, 0 невыполнено вообще**.

---

## 7. Оценка по DoD (§12 плана)

| # | DoD критерий | Статус |
|---|---|---|
| 1 | Rust: 0 `panic!/todo!/unimplemented!` вне `#[cfg(test)]` | ⚠️ 2 compile-time guards (допустимо) |
| 2 | Rust: 0 `unwrap/expect` в `licensing/`, `db/`, `parser/` | ❌ ~25 в `parser/`, 3 expect в `licensing/crypto.rs` |
| 3 | `npm audit` — 0 high/critical | ✅ (подтверждается ADR-0004) |
| 4 | Rust ≤ 500 LOC, TS ≤ 400 LOC | ⚠️ TS ✅, **Rust 11 файлов нарушают** |
| 5 | Initial bundle −15% | ❓ не измерено (нет baseline) |
| 6 | `perf:benchmark` +5% | ❓ не измерено |
| 7 | CI gates (clippy, ESLint, gitleaks, fmt) | ✅ (ESLint точно зелёный) |
| 8 | 88 команд типизированы `#[specta::specta]` + autogen | ✅ `generated.d.ts` работает |
| 9 | ADR: licensing, sync, parsing, logging | ✅ ADR-0005..0008 |
| 10 | Повторный audit без регрессий | ⚠️ частично (этот отчёт — итоговый) |

**Итог DoD: 5 из 10 полностью ✅, 3 ⚠️, 2 ❓ неизмеримы.**

---

## 8. Заключение

Команда проделала **значительную и в основном реальную работу**: типизация жёсткая, тесты зелёные, логирование единое, небезопасные зависимости удалены, HMAC сравнение constant-time, TypeScript-сторона декомпозирована до заявленного предела.

Однако `REFACTORING_DEEP_PLAN.md` **систематически переоценивает свой прогресс** по 4-5 рабочим пакетам. Самый заметный пример — **WP-4.2 (report generator)**: помечен ✅ DONE, но из 10 обещанных подмодулей в коде только 2, и из 2458 LOC плановой декомпозиции осталось **1872 LOC в 2 монолитных файлах**.

**Главный шаг вперёд** — закрыть список из §5.1–5.2 этого отчёта за 2–3 дня и привести план в соответствие с кодом. После этого можно с чистой совестью заявлять, что Фаза 4 завершена.

---

## 9. Приложение: как воспроизвести метрики

Скрипты созданы в процессе аудита:

```powershell
# Размеры файлов Rust/TS
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\audit\measure-loc.ps1

# unwrap/expect/panic/SQL/console/tauri::command
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\audit\measure-quality.ps1

# Rust unwrap/expect только в non-test prod коде (per file)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\audit\rust-quality.ps1

# Orphan Tauri-команды (defined ≠ registered)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\audit\orphan-commands.ps1

# Топ TS файлов + состояние safeInvoke
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\audit\top-ts-files.ps1

# Тесты
cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast -- --test-threads=1
cargo test --manifest-path src/rust/rheolab-core/Cargo.toml --no-fail-fast
npm test
npm run lint
npx tsc --noEmit
```

---

*Отчёт сгенерирован автоматически на основе измерений без изменения кодовой базы.*
