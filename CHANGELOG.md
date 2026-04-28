# Changelog

Все значимые изменения RheoLab Enterprise документируются здесь.  
Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/).  
Версионирование: [Semantic Versioning](https://semver.org/lang/ru/).

---

## [0.2.0-alpha.1] — 2026-04-28

> Первый alpha-build после deep-optimization sprint (Phase 0-7). Только для Superuser-лицензии (project owner personal tier). Беты не будет, пока ручное тестирование не подтвердит стабильность — после этого следующая версия станет `0.2.0-beta.X`.

### Добавлено
- **DB-индексы (Phase 4b/4d)**: Три новых миграции `v0004` (default Library list composite index), `v0005` (`COLLATE NOCASE` индексы для `ReagentCatalog` и `Experiment.testType`), `v0006` (FK-индексы для `importBatchId` на `ExperimentPayload` / `ParserArtifact` / `ReportArtifact`). Все hot-path queries в `EXPLAIN QUERY PLAN` теперь используют index seek без `TEMP B-TREE` сортировок.
- **F1 fix**: `is_duplicate_name` (импорт каталога реагентов) переведён с `LOWER()`-обёртки на `COLLATE NOCASE`, теперь корректно использует `idx_reagent_category_name_nocase`.
- **F3**: Filter-metadata cache invalidation на фронтенде — `ExperimentFilters` и `ExperimentList` делят один module-level promise-кэш с явным TTL, без лишних IPC-дёргов при изменении состояния списка.

### Изменено
- **Phase 5a**: Удалено 5 неиспользуемых npm-зависимостей и 6 orphan-скриптов (`-54 packages, -1054 LOC`).
- **Phase 7a**: Закрыто 65/65 violations `eslint-plugin-react-hooks 7.x` — устранены `setState-in-effect` и `refs-in-render` паттерны в charts, useSaveDialogInit, BackupManager и ещё 11 файлах.
- **Refactor**: Разбиты три oversize Rust-файла — `touch_point_precompute.rs` (765 → 7 модулей), `pdf_comparison.rs` (1620 → 5 модулей), `report_generator/pdf/template/mod.rs` (646 → 3 модуля). Public API не менялся.

### Инфраструктура (только для разработчиков)
- **Phase 3 ecosystem bumps**: Vite 6→7→8 (Rolldown bundler), `@vitejs/plugin-react` 5→6, TypeScript 5→6, ESLint 9→10, `@types/node` 20→25, `typescript-eslint` 8.59.1, jsdom 27→29.
- **Phase 6 dep batches**: react/react-dom 19.2.1→19.2.5, lucide-react 0.561→1.11, ещё 17 пакетов в minor/patch ladder.
- **Audit hardening (Phase 0)**: Frontend-IPC deep audit gate PASS, gitleaks triaged, security-best-practices baseline зафиксирован в `docs/audit/2026-04-27-deep-optimization-plan.md`.
- **Performance regression hunt (Phase 3 follow-up)**: Apples-to-apples сравнение pre/post Phase 3 показало no regression на heap, DOM nodes, wall time или CPU. Benchmark suite leak slope улучшился с +2.7 → -0.1 MB/round. Полный отчёт: `docs/performance/PHASE-3-PERFORMANCE-DELTA-2026-04-28.md`.

### Известные ограничения
- В alpha-канал попадают только Superuser-лицензии (project owner personal tier). Beta/stable пользователи не получат это обновление автоматически.
- `madge@8.0.0` всё ещё требует `--legacy-peer-deps` для установки из-за устаревшего peerOptional на старый typescript-eslint.

---

## [0.2.0-beta.24] — 2026-04-22

### Исправлено
- **TP-FILTER-DYNAMIC**: Фильтр «Точка касания» в библиотеке теперь действительно находит эксперименты, пересекающие пользовательский порог — вместо бесполезного диапазонного поиска по самой вязкости в момент касания.
  - Было: три диапазонных поля (`crossingViscosityMin/Max` на precomputed колонке `touchCrossingViscosityCp`) выдавали 0 результатов для любого осмысленного ввода. Причина: по построению алгоритма `touchCrossingViscosityCp` — это viscosity **first-below-threshold** сэмпла, поэтому всегда сидит вплотную к 50 сП (в БД пользователя из 220 эксп. — 37.77 сП у единственного с пересечением). Диапазон «300..600 сП» никогда не попадал и не мог попасть.
  - Стало:
    - **UI** (`viscosity-threshold-selector.tsx`, `experiment-filters.tsx`): новый компонент `ViscosityThresholdSelector` с preset-пилюлями `авто (50) / 10 / 50 / 100 / 200 / 300 / 500` + свободный input для кастомных лабораторных значений. Пресеты покрывают типовые break-points для разных типов жидкостей (сликвотер → low, сшитый гель → 500). Disclaimer в секции теперь объясняет «момент падения вязкости ниже выбранного порога», лейбл `Достигнут порог X сП` динамически подстраивается.
    - **Rust slow path** (`commands/experiments/list/dynamic.rs`, новый модуль 343 строки): когда `viscosityThreshold` задан и положителен, query-билдер обходит precomputed колонки и прогоняет `smart_touch_points` on-the-fly против пользовательского порога. Coarse SQL-pruning по `maxViscosity ≥ threshold` (NULL-safe) отсекает заведомо непересекающие ряды, остальные декодируются из columnar zstd blob и пересчитываются. Фильтры `hasCrossing`, `crossingTime{Min,Max}`, `viscosityAtTarget{Min,Max}` применяются против свежих значений, в UI-карточках тоже показываются свежие (не stale 50 сП).
    - **Rust fast path** сохранён 1:1: пустой `viscosityThreshold` → existing precomputed SQL-путь, байт-в-байт тот же результат, что и раньше (не ломаем backward compat).
    - **Guard от started-below-threshold edge case**: если вся кривая лежит ниже порога (нет гельной фазы), алгоритм мог ложно сообщить о «пересечении» (slope guard пропускается при `run_start=0`). В slow path post-check `max(inputs.viscosity) > threshold` отбрасывает эти spurious crossings.
  - Убран бесполезный `RangeFilter` «Вязкость в точке касания (сП)» из UI. Rust-поля `crossing_viscosity_min/max` оставлены в `ExperimentsListQuery` для backward-compat API — просто игнорируются UI, а при отсутствии значения становятся no-op.
- **TP-FILTER-UX-EMPTY-STATE**: Пустой список в библиотеке при активных touch-point фильтрах теперь объясняет, почему всё скрылось, и даёт one-click выход.
  - Было: при 0 результатов показывалось безликое «Эксперименты не найдены. Попробуйте изменить параметры фильтрации», без намёка на причину.
  - Стало: extended `filter_metadata` (`touch_point_stats` агрегат на стороне Rust) отдаёт `{ totalExperiments, withCrossingCount, crossingTime{Min,Max}Minutes, crossingViscosity{Min,Max}Cp, viscosityAtTarget{Min,Max}Cp }`. UI использует их дважды:
    - **В сайдбаре** под каждым touch-point-ренджем показывается подпись `в БД: X..Y мин` (или «нет данных»), `«M из N эксп. достигли порога»` — так сразу видно какие диапазоны имеют смысл.
    - **В empty state** при активных touch-point-диапазонных фильтрах и 0 результатов рендерится контекстное сообщение вида «Из 220 эксп. только 1 достиг порога 50 сП. Остальные исключаются диапазонными фильтрами точки касания. Доступный диапазон — время: 0.02 мин, вязкость: 37.8 сП. Снимите или расширьте touch-point фильтры.» + кнопка **«Сбросить фильтры точки касания»** (включая `viscosityThreshold` и `hasCrossing`).
  - Исправлен dev-артефакт: Vite дёргал полный page-reload при edit'e Rust-исходников (`vite.config.ts` watch.ignored = `['**/src/rust/**']`) — ломало persist загруженных экспериментов в dashboard store при обычном программировании. Store уже отбрасывает тяжёлые Float64Array на уровне persist-конфига по памяти, но обычная navigation между вкладками больше не вызывает перемонтирование из-за reload.

### Инфраструктура
- Rust (TP-FILTER-DYNAMIC): новый модуль `src-tauri/src/commands/experiments/list/dynamic.rs` с собственным candidate-selection SQL (join с `ExperimentData`), per-row decode + recompute, in-memory sort/paginate + batch-reagent load. `touch_point_precompute.rs` получил новую функцию `compute_from_inputs_with_threshold(&inputs, threshold)`, старая `compute_from_inputs` стала обёрткой над ней с фиксированным `LIBRARY_THRESHOLD_CP`. `query.rs` зарефакторен на helper-функции `append_base_conditions` / `append_precomputed_touch_conditions` — общий код fast/slow путей теперь в одном месте.
- Rust (TP-FILTER-UX): в `ExperimentsFilterMetadataResponse` добавлено поле `touch_point_stats: TouchPointLibraryStats` с 9 полями (total / withCrossing / withTarget / 3 пары range). Единый агрегатный SELECT в `query_touch_point_stats` кэшируется под тем же `FILTER_META_TTL`.
- TypeScript: новый hook `src/hooks/useExperimentFilterMetadata.ts` с module-level promise-кэшем — `ExperimentFilters` и `ExperimentList` делят одну metadata-загрузку на сессию (+ `resetExperimentFilterMetadataCache()` для тестов). `src/lib/library/touch-point-hints.ts` — 5 pure-формтеров для сайдбарных и empty-state подсказок. `RangeFilter` получил опциональный `hint` + `hintTestId` props. `FilterState` расширен `viscosityThreshold`, удалены устаревшие `crossingViscosity{Min,Max}` поля, EMPTY_FILTERS синхронизирован.
- Тесты:
  - Rust: +5 тестов `dynamic_threshold_*` (crosslinked gel 500 сП, maxViscosity prune, crossing-time narrowing, junk-input fallback на fast path, hasCrossing=no) + 3 теста `touch_point_stats_*` (empty DB, actual ranges, pending-backfill ignored). Итого cargo: **296/296 ✅** (+8 lib, rheolab-core неизменен).
  - Vitest: `touch-point-hints.test.ts` — 19 pure-тестов на форматеры. `experiment-filters-touch-point.test.tsx` обновлён: новые тесты на пресеты threshold (`ViscosityThresholdPreset-500` / `-default`), кастомный input, динамический лейбл `Достигнут порог`, «Clear All» теперь сбрасывает и threshold. Итого: **193/193 ✅** (15 файлов), +22 против предыдущего прогона.
  - `tsc --noEmit`: clean.

### Добавлено
- **REPORT-COMPARISON**: Сравнительный отчёт для вкладки Comparison (ADR-0010).
  - Новая под-вкладка «Отчёт» / «Report» рядом с графиком в Comparison view (Radix Tabs).
  - PDF: страница 1 — сводный мульти-эксперимент SVG-чарт + сводная таблица (filename, date, instrument, #cycles, средняя вязкость, температура); страницы 2..N+1 — полный per-experiment отчёт (тот же формат, что и single-exp). Рендер вектором (Typst + Plotters SVG), не PNG.
  - Excel: лист `Сравнение`/`Comparison` — заголовок, сводная таблица, native Excel chart (редактируемый); листы 2..N+1 — компактный per-experiment отчёт (metadata + chart + stats + recipe + water + calibration + опц. raw data). Sheet name: truncate 31 символ + sanitize `[]:*?/\` + детерминированный суффикс `_2`, `_3` при коллизии.
  - UI: независимые section-toggles (Calibration / Raw data / Recipe / Water analysis), выбор языка (RU/EN) из `brandingStore`, счётчик экспериментов, индикатор прогресса при генерации.
- **IPC**: новые Tauri-команды `reports_generate_comparison_pdf`, `reports_generate_comparison_excel` (HMAC-gated, такой же паттерн, как single-exp отчёты).
- **TP-PRECOMPUTE (PR2)**: библиотека теперь хранит и фильтрует результаты по точкам касания (ADR-0011).
  - Миграция БД `v0002_touch_point_metrics`: пять новых колонок в `experiments` (`touch_has_crossing`, `touch_crossing_time_min`, `touch_crossing_viscosity_cp`, `touch_viscosity_at_target_cp`, `touch_precompute_version`) + частичные индексы `idx_experiment_touch_has_crossing` и `idx_experiment_touch_crossing_time_min`. Зафиксированный контракт: threshold = 50 сП, target time = 10 мин.
  - Save-path: при сохранении эксперимента Rust-hook пересчитывает метрики и пишет precompute-колонки в одной транзакции с основной записью (без накладных расходов на чтение позже).
  - Read-path: `experiments_list` получил пять новых фильтров — `hasCrossing` (tri-state: `'' | 'yes' | 'no'`), `crossingTime{Min,Max}`, `crossingViscosity{Min,Max}`, `viscosityAtTarget{Min,Max}`. Все фильтры составляются через параметризованный SQL и используют новые индексы.
  - UI: в сайдбаре библиотеки появилась секция «Точка касания» с Radix Select для hasCrossing и тремя RangeFilter; привязано к `ExperimentFilters` через прямой spread в `listExperiments`, кнопка «Очистить всё» обнуляет и touch-point поля.

### Инфраструктура
- Rust: модуль `report_generator/comparison/` (`types`, `summary`, `excel_comparison`, `pdf_comparison`, `mod`), multi-experiment SVG-рендерер `chart_generator/line/multi_experiment.rs`, extraction общих helpers в `excel/mod.rs` и `pdf/template/mod.rs`.
- Rust (PR2): `src-tauri/src/db/migrations/v0002_touch_point_metrics.rs`, `src-tauri/src/db/touch_point_precompute.rs`, расширение `experiments::list::query` новыми WHERE-пунктами и маппингом колонок в `ExperimentListItem`.
- TypeScript: `src/lib/analysis/report-types/comparison-report-{inputs,converter}.ts` (camelCase ↔ snake_case), `src/lib/reports/comparison-{builders,experiment-adapter}.ts`, расширен `bridge.reports` + `src/lib/reports/client.ts` (retry-fallback).
- TypeScript (PR2): `src/types/experiment-filters.ts` расширен пятью новыми полями `FilterState`; `RangeFilter` получил опциональные `minTestId`/`maxTestId` для стабильных E2E-селекторов.
- Тесты:
  - Rust: `rheolab-core` 144/144 ✅, + comparison-golden-tests и integration-тесты в `src-tauri` (PDF magic bytes, XLSX ZIP structure, sheet names, bytes > threshold); +22 тест в `src-tauri` для touch-point precompute (`crud_tests`, `migration_tests`, `list_tests`), итоговый Rust-счёт 288 lib + 22 integration.
  - Vitest: +42 теста (converter / builders / adapter / client / hook) + 8 тестов на touch-point UI (`experiment-filters-touch-point.test.tsx`), все 1280 ✅.
  - Playwright: +6 новых E2E в `tests/e2e/reports/comparison-report.spec.ts` (sub-tab routing, PDF/Excel download, section toggles, empty-state disable, language switch) + 6 Tauri E2E для touch-point (`tests/e2e/library/touch-point-filters.tauri.spec.ts`: seed/correctness + query-latency benchmark + heap-stability soak). Бенчмарк на реальном Tauri-бинаре: p95 фильтрованного `experiments_list` ≤ 5 мс (SLA 250 мс), heap Δ = 0 MB за 30 циклов apply/clear.

### Исправлено
- **CHART-TIME-FORMAT-01**: Ось «Время» в PDF-графике и Excel-чарте теперь следует за выбором `rheologyUnits.timeFormat` в UI (как и таблица «Реология» до этого).
  - Было: и PDF, и Excel игнорировали выбранный `timeFormat` — ось всегда подписывалась «Время (мин)» / «Time (min)», тики рендерились в десятичных минутах (`0, 5, 10, …`), ячейки в Excel хранились в минутах с форматом `0.00`. Дашборд тем временем показывал `00:04:00`, если пользователь выбрал `hh:mm:ss`.
  - Стало:
    - **PDF (`chart_generator::common::ChartConfig::time_format` + Typst overlay `pdf/template/chart_page.rs::make_ticks`)**: подпись оси динамически строится через `time_axis_unit()`, bottom-tick labels форматируются через `format_time_value()` для `seconds`/`hh:mm:ss`, минуты сохраняют legacy-формат байт-в-байт.
    - **Excel (`excel/raw_data.rs` + `excel/chart.rs`)**: заголовок time-колонки, хранимое значение (минуты / целые секунды / Excel day-serial) и `num_format` (`0` / `0` / `[h]:mm:ss`) теперь подбираются per `time_format`; `x_axis.set_max` использует возвращаемый `max_time_display` в той же единице.
    - **Comparison PDF (`comparison/pdf_comparison.rs`)**: использует `resolve_units` anchor-эксперимента для выбора подписи оси — comparison-график согласован с per-experiment страницами.

### Инфраструктура
- Rust: `ChartConfig` получил поле `time_format: String` (пустая строка = `minutes` для обратной совместимости), `RawDataSummary` переименовал `max_time_minutes → max_time_display` и добавил `time_format`. `pdf/mod.rs`, `excel/mod.rs`, `pdf_comparison.rs` все вызывают `resolve_units` (единая точка резолва из UI).
- Тесты: +1 Rust-регрессионный тест `excel::tests::time_format_propagates_to_xlsx_output` — проверяет, что `minutes/seconds/hh:mm:ss` дают три различных XLSX-байт-стрима и каждый из них детерминирован на повторных запусках. Исторический `single_exp_output_is_deterministic` продолжает проходить (minutes-путь байт-в-байт не изменился). Итоговый rheolab-core счёт: 166/166 ✅ (+1).

### Исправлено
- **REPORT-UNITS**: Таблица «Реология» в PDF / Excel теперь показывает ровно те единицы, что выбраны в UI графика (ADR-0012).
  - Было: `unitSystem` выводился из **одного поля** `chartSettings.lines.viscosity.unit`, что ломало смешанные пресеты («сП вязкость + Pa·s^n K' + Pa·s PV» — UI показывал `K' (Pa·s^n) = 10.4618`, а отчёт выгружал `K' (lbf/100ft²) ≈ 500+`).
  - Стало: через TS `chartSettings.rheologyUnits` и Rust `ReportSettings.rheology_units` передаются **отдельные target-единицы** для каждой категории (viscosity / consistency / plasticViscosity / yieldPoint / time_format). Per-category overrides побеждают коарсовый `unit_system`, значения и подписи в отчёте совпадают с `CycleResultsTable` byte-for-byte.
  - Исправлен коэффициент конверсии K' для Imperial: было `47.88` (Pa → lbf/ft²), стало `2.0885` (Pa → lbf/100ft², API RP 13D, совпадает с YP). Старые отчёты на Imperial показывали K' в ~23× больше корректного значения.
  - Исправлена подпись K' для Imperial: было `lbf/100ft²` (как у стресса), стало `lbf·s^n/100ft²` (честная размерность стресс·время^n, синхронизирована с TS `IMPERIAL_UNITS.consistency`).
  - Колонка «Время» в таблице отчёта теперь рендерится согласно `rheology_units.time_format` выбранному в настройках графика: `Время (с)` → целые секунды, `Время (мин)` → десятичные минуты (как прежде), `Время (чч:мм:сс)` → `00:09:00`.

### Инфраструктура
- Rust: новая `RheologyUnits` структура в `report_generator::types`, публичные target-aware хелперы `render_k_with`/`render_pv_with`/`render_yp_with`/`render_viscosity_with` + `format_time_value` + `time_axis_unit` + `resolve_units` в `report_generator::formatters`. `pdf/template/stats.rs` и `excel/stats.rs` консолидированы на общий `resolve_units` вместо дубликатов.
- TypeScript: новый тип `ReportRheologyUnits` в `report-types/report-inputs.ts`, serializer в `report-converter.ts` (`plasticViscosity → plastic_viscosity`, `yieldPoint → yield_point`, `timeFormat → time_format`), плюминг в обеих сборщиках `report-builders.ts` (PDF + Excel). Comparison-report автоматически наследует фикс через делегирование `convertReportInputToWasm`.
- Тесты: +17 Rust unit-тестов в `formatters::tests::` (6 `resolve_units_*` для всех пресет-комбинаций включая user's mixed-custom + partial override + hh:mm:ss; 4 `render_*_with_targets`; 4 time-helpers; 3 viscosity-format). K'-factor-test обновлён с `47.88 → 2.0885`. Итоговый Rust-счёт: 165 lib (+17) + 230 integration.
- Документация: новый ADR-0012 `per-category-unit-overrides-in-reports.md` описывает архитектуру wire-format, коэффициенты API RP 13D, fallback-семантику и rationale для каждого решения.

### Исправлено (продолжение)
- **CHART-BATH-01**: Точки без `bath_temperature_c` (Sweep Data в мердже OFITE 1100 Sweep + Log Data) больше не рендерятся как `0` на uPlot-графике.
  - Было: при пропущенной температуре бани ряд попадал на X-ось → оранжевая штриховая линия падала вертикально к нулю в каждой такой точке, что визуально читалось как катастрофические сбои нагрева (хотя данных просто не было).
  - Стало: `useRheologyData` хранит `bathTemperatures` как `Array<number | null>` и пишет `null` для пропусков — uPlot рендерит `gap`; `sanitiseAndNormaliseColumnarDirect` (Comparison-pipeline) пишет `NaN` в `Float64Array`, далее `alignSeriesFromColumnarLinear` корректно эмитит `null`. Два затронутых пути: AoS (`useRheologyData.ts:166`) и columnar (`useRheologyData.ts:266`); плюс comparison columnar (`comparison/normalize.ts:280`).
- **CHART-BATH-02**: Правая Y-ось теперь подписана корректно, когда на ней одновременно находятся температура пробы и температура бани (shared-axes mode).
  - Было: `build-axes-series.ts` в shared-режиме пушил в `rightLabels` только `t.temperatureAxis`, и подпись «Темп. бани» не появлялась никогда, даже если линия была видна.
  - Стало: новая тройная ветвь — оба → `tempBathCombinedAxis` ("Температура / Темп. бани (°C)"), только баня → `bathTempAxis`, только температура → `temperatureAxis`. Individual-режим уже был корректен.

### Инфраструктура (продолжение)
- Тесты: +16 Vitest-тестов регрессии CHART-BATH.
  - `tests/hooks/useRheologyData.test.ts` (5 тестов): null-handling в AoS- и columnar-пути, сохранение `0` как валидного измерения, конверсия бани через °F-конвертер.
  - `tests/hooks/chart-options/build-axes-series.test.ts` (8 тестов): комбинаторика labels для shared- и individual-режимов × 4 сочетания температура/баня.
  - `tests/components/comparison-data.test.ts` (+3 теста): `sanitiseAndNormaliseColumnarDirect` пишет `NaN` вместо `0`, `alignSeriesFromColumnarLinear` эмитит `null`, паттерн OFITE 1100 (чередование bath/no-bath) не даёт `0` в выходе.
  - Full Vitest: 1296/1302 ✅ (+16 тестов, 0 регрессий, 6 skipped как раньше).

### Релиз
- Alpha installer собран локально: `RheoLab Enterprise_0.2.0-beta.24_x64-setup.exe` + `.sig`.
- Channel manifests: `runtime/release/channels/alpha/{latest-manifest,release-manifest-…}.json`.
- Release-gate PASSED на пересобранном бинарнике: 4 фикстуры × 4 настройки × 7 экспортов за 18 секунд, memory stability OK.

---

## [0.2.0-beta.9] — 2026-04-21

### Добавлено
- **UI-018**: Глобальный селектор единиц вязкости в настройках → «Общие». Три системы: **SI** (мПа·с, по умолчанию), **SI (Па·с)** и **Imperial** (сП). Выбор сохраняется в localStorage и применяется к:
  - таблице результатов циклов на дашборде (заголовок η@γ и значения),
  - экспорту Excel (колонки η@γ, сырые данные, таблица touch points и статистика),
  - экспорту PDF (таблица cycle-results, сырые данные, чарт: ось Y, легенда, порог, touch points).
- Адаптивная точность: 4 знака после запятой для Па·с (суб-единичный диапазон), 1 знак для мПа·с/сП.

### Изменено
- Хранение вязкости во всём pipeline остаётся в мПа·с; конвертация в display-unit происходит ровно один раз — на границе вывода. Это сохраняет численную консистентность touch-point алгоритма и порога (оба сравниваются в мПа·с).

### Инфраструктура
- Добавлен `display-settings-store` (Zustand + persist) с санитайзером недопустимых значений.
- Rust: helpers `convert_viscosity()`, `get_viscosity_unit()`, `viscosity_decimals()`, `viscosity_excel_format()` в `report_generator::formatters`.
- Тесты: +5 Rust-тестов (label formatting для всех 3 систем + invariant «storage unit preserved»), +18 Vitest-тестов для стора и helpers.

---

## [0.2.0-beta.4] — 2026-03-19

### Исправлено
- **PARSE-001**: Исправлен тест `test_stub_optional_ai_falls_back_to_heuristic_on_invalid_mapping` — при inline-загрузке файла (байты из браузера/API) опциональный AI-маппер теперь всегда запускается независимо от состояния эвристики. Ранее при здоровой эвристике функция возвращала результат досрочно и `ai_diagnostics.failure_reason` оставалось `None` вместо сообщения об ошибке.
- **PARSE-002**: Сообщение об ошибке AI-маппера в `ai_diagnostics.failure_reason` больше не содержит префикс варианта `"Parse error: "` — в поле записывается только текст ошибки.
- **PARSE-003**: Оптимизация и исправления специфичных BSL-файлов (например, фикстуры `t-12.03.26-3BSL`):
  - Исправлено определение времени (`fractional-minute` / дробные доли минуты) для BSL файлов, где заголовок содержит только "Время" без единиц измерения.
  - Починен парсинг кодировки времени через запятую-тысячные (bug ×1000).
  - Починен баг "dropped-decimal time encoding" (потеря десятичных знаков в BSL-таблицах).
  - Интеллектуальный парсинг: для сложных и неизвестных форматов (в т.ч. некоторых BSL) добавлен принудительный запуск AI-парсера (forceAI toggle).
  - Исправлена физическая эвристика: расчётное значение скорости сдвига больше не перезаписывается, если табличное значение превышает физическую оценку (never overwrite sr).
  - Добавлена интеграция native Groq HTTP для глубокой AI-обработки файлов в десктопе Tauri.

### Добавлено
- **LIC-BACKUP**: Добавлен Windows-скрипт `license-server/download-backup.ps1` для безопасного скачивания последнего backup-архива или SQL-дампа БД лицензирования с сервера на локальный ПК по SSH/SCP.
- **LIC-SERVER**: Добавлен серверный скрипт `license-server/cleanup.sh` для очистки истёкших `rate_limits`, ротации `license-backup.log` и удаления устаревшего временного мусора.
- **LIC-SERVER**: Скрипт `license-server/backup.sh` переведён на `mysqldump --single-transaction --no-tablespaces`, чтобы резервное копирование не ломалось из-за лишних привилегий MySQL.
- **LIC-S3**: Добавлена поддержка ежедневной выгрузки полного backup-архива сервера лицензирования в S3-совместимое хранилище (`latest` + `daily`) и восстановления напрямую из S3 через `restore.sh`.

---

## [0.2.0-beta.3] — 2026-03-16

### Исправлено
- **Сохранение отчётов**: Исправлен двойной баг в `saveBlob`, из-за которого диалог выбора пути сохранения не появлялся:
  1. **Регрессия beta.2**: E2E-флаг `__e2e_skip_dialogs` читался без `import.meta.env.DEV` защиты — в production-сборке диалог корректно блокировался, если `localStorage` был загрязнён.
  2. **Застревший localStorage**: флаг из E2E-сессии в `localStorage` оставался между запусками и мог блокировать диалог в dev-режиме.
- Фикс: переход с `localStorage` на `sessionStorage` для `__e2e_skip_dialogs` — флаг автоматически очищается при каждом запуске приложения. В production-сборке `import.meta.env.DEV === false`, поэтому диалог выбора файла всегда появляется.

---

## [0.2.0-beta.2] — 2026-03-16

### Исправлено
- **Сохранение отчётов**: Расширена зона разрешённых путей (`fs:scope`) — теперь PDF и Excel сохраняются в любую папку внутри домашнего каталога пользователя (`$HOME/**`), включая OneDrive, рабочие папки и кастомные директории. Ранее `writeFile` молча отказывал, если путь выходил за рамки Документов/Рабочего стола/Загрузок.
- **Сохранение отчётов**: Добавлено внятное сообщение об ошибке, если путь всё же недоступен (другой диск, сетевой ресурс).

---

## [0.2.0-beta.1] — 2026-03-16

### Исправлено
- **E2E**: Исправлена гонка состояний в тесте сравнения 4 инструментов — легенда чарта читалась до окончания 150ms debounce (`expect.poll`, timeout 5s).
- **E2E**: Исправлена проверка CSS-класса переключателя в настройках отчёта — `bg-slate-950` → `bg-background` после внедрения light/dark темы.
- **E2E**: Восстановлена корректная проверка сохранения типа жидкости — диалог сохранения теперь проверяется через фильтр библиотеки, а не через несуществующий бейдж.
- **E2E**: Убрана проверка фильтра «Автор» — поле удалено из UI в v0.1.537.
- **E2E**: Mock-файлы PDF/Excel увеличены до 6000 байт (порог `assertDownload` — 5000 байт).
- **E2E**: Тест `save_each_field_cleared_disables_save_button` приведён в соответствие реальным обязательным полям (имя + оператор; Field/Well необязательны).

---

## [0.1.538] — 2026-03-14

### Изменено
- Очистка репозитория: `license-server/vendor/` и `runtime/qa/` добавлены в `.gitignore`.
- Зафиксированы все незакоммиченные изменения v0.1.537 (security fixes, infra pipeline, тесты).
- Синхронизированы номера версий во всех конфигурационных файлах.

---

## [0.1.537] — 2026-03-14

### Безопасность
- **LIC-005**: Онлайн-валидация лицензии теперь сохраняет `last_check` при **любом** HTTP-ответе от сервера (включая 4xx/5xx), а не только при успехе. Предотвращает цикл повторных запросов при серверных отказах.
- **LIC-006**: Malformed JSON в сохранённой лицензии теперь отклоняется fail-closed (`return None`). Ранее `unwrap_or(json!({}))` допускал fail-open прохождение.
- **S-2**: Закрыт grace-period для legacy HMAC-only записей — все лицензии обязаны иметь RSA-подпись сервера.

### Исправлено
- **INF-001**: Устранён конфликт ESM/CommonJS в dev/release-скриптах.
- **INF-002**: Синхронизированы integration-тесты `ai_parsing` с текущим безопасным API.
- **INF-003**: Исправлен разбор `scripts/dev/.env.keys` в CRLF-формате — `INTEGRITY_SECRET_KEY` не подхватывался release-скриптом.
- Исправлены битые внутренние ссылки в документации после cleanup.

### Добавлено
- Регрессионные тесты на fail-closed malformed JSON и throttle при серверных отказах.
- Тест `build_validation_result_persists_last_check_for_http_rejection`.
- Тест `load_verified_rejects_malformed_json_even_with_valid_hmac`.

---

## [0.1.536] — 2026-03-12

### Исправлено
- **UI-018**: Тултипы на графике теперь корректно позиционируются после прокрутки, смены размера окна, сворачивания/разворачивания. Причина: тултип использовал `position: absolute` на `<body>` с viewport-координатами из `getBoundingClientRect()` — при ненулевом `window.scrollY` возникало смещение на высоту прокрутки. Исправлено на `position: fixed` + живой вызов `getBoundingClientRect()` вместо кэша.

---

## [0.1.535] — 2026-03-10

### Исправлено
- **UI-017**: При переключении между вкладками («Калибровка» → «График» и др.) страница теперь корректно прокручивается к строке вкладок с учётом высоты шапки (72px). Ранее `scrollIntoView` не компенсировал sticky-шапку, и вкладки уходили за её край.

---

## [0.1.534] — 2026-03-10

### Исправлено
- **UI-016**: При открытии / загрузке файла страница теперь корректно прокручивается к строке вкладок. Кнопки «Таблица данных», «Рецептура», «Анализ воды», «Калибровка» сразу видны. Используется `window.scrollTo` с компенсацией высоты шапки (72px) вместо `scrollIntoView`, Ь`behavior: instant` вместо `smooth` (не прерывается рендерингом графика).

---

## [0.1.533] — 2026-03-09

### Исправлено
- **UI-016**: При открытии теста вкладка «График» теперь автоматически прокручивает страницу к строке вкладок — поведение идентично переключению между вкладками. Ранее после загрузки теста кнопки навигации (Таблица данных, Рецептура, Анализ воды, Калибровка) оставались выше экрана.

---

## [0.1.532] — 2026-03-09

### Изменено
- **UI-014**: При переключении вкладок (График / Таблица / Рецептура / Анализ воды / Калибровка) экран автоматически прокручивается к строке вкладок — контент всегда начинается с одной позиции.
- **UI-015**: Карточки метрик на вкладке «Калибровка» переработаны: все 5 карточек размещены в один ряд (`grid-cols-5`), уменьшены отступы и размер шрифта, убран описательный текст из тела карточки (доступен через «Подробнее»). Освобождено место для графиков.

---

## [0.1.531] — 2026-03-09

### Изменено
- **LIC-004**: В debug-сборках (`debug_assertions`) интервал онлайн-проверки лицензии сокращён до 0 дней (каждый запуск) и 300 секунд (5 минут в рамках сессии). Release-сборки без изменений: 7 дней / 3600 секунд. Ускоряет тестирование отзыва лицензии без ожидания 7 дней.
- **CHORE**: Удалён временный крейт `tools/rsa_test/`, отладочные скрипты и временные файлы в корне проекта.

---

## [0.1.530] — 2026-03-09

### Изменено
- **LIC-002**: Рефакторинг встраивания RSA публичного ключа. Вместо `include_str!` + ручного PEM→DER декодирования в рантайме используется `include_bytes!` с предварительно сгенерированным `.der`-файлом. Устранён временный костыль из v0.1.529. Тест-хелперы аналогично переведены на `dev_private.der` + `from_pkcs8_der`.
- **LIC-003**: Удалено диагностическое логирование полного содержимого `signedPayload` и `serverSignature` из `lic_diag.log` (утечка чувствительных данных). Оставлены: первые 80 символов payload и длина подписи.
- `generate-license-keys.ts` теперь также создаёт `license_public.der` для встраивания в Rust-бинарник.

---

## [0.1.529] — 2026-03-09

### Исправлено
- **LIC-001**: Исправлена верификация RSA-подписи лицензии (`verify_server_signature`). Функция `from_public_key_pem` из крейта `pem-rfc7468` 0.7 некорректно обрабатывала CRLF-окончания строк в встроенном PEM-файле на Windows, возвращая ошибку `PreEncapsulationBoundary`. Исправлено заменой на ручное декодирование PEM-тела в DER и последующим вызовом `from_public_key_der`. Теперь подпись лицензии успешно проверяется и при старте приложение корректно отображает статус активной лицензии.

---

## [0.1.528] — 2026-03-09

### Изменено
- **DIAG-002**: Диагностика лицензирования теперь пишет в файл `lic_diag.log` в директории данных приложения напрямую через `std::fs`, без зависимости от tracing/log pipeline. Гарантированно работает в release-сборках.

---

## [0.1.527] — 2026-03-09

### Изменено
- **DIAG-001**: Добавлено подробное диагностическое логирование лицензионного пайплайна (`[LIC-DIAG]`)
  в `app.log` для выяснения причин DEMO-бейджа при запуске.
  Лог: `%APPDATA%\com.rheolab.enterprise\logs\app.log`

---

## [0.1.526] — 2026-03-09

### Исправлено
- **LIC-011**: Устранено кратковременное отображение бейджа «ДЕМО» при каждом запуске приложения. При успешной онлайн-проверке (`validate.php`) DB-запись теперь обновляется свежим `signedPayload` от сервера, что позволяет RSA-верификации проходить локально на всех последующих запусках без обращения в интернет (офлайн-first, TTL 7 дней).
- **TST-001**: Исправлены два провальных unit-теста RSA — добавлен `dev_public.pem` (парный ключ к `dev_private.pem`), тестовые сборки используют dev-пару вместо продакшн ключа.

---

## [0.1.525] — 2026-03-09

### Исправлено
- **LIC-010**: После обновления приложения лицензия автоматически восстанавливается при первом запуске (ранее при сбое RSA-верификации кэш блокировал повторную активацию и пользователь видел DEMO-режим)

---

## [0.1.524] — 2026-03-09

### Безопасность
- **LIC-009**: Аудит системы лицензирования — исправлены 4 уязвимости: RSA-проверка в `check_license_gate`, точная передача `signedPayload` с сервера, лимит 10 записей в `legacyMachineIds`

---

## [0.1.523] — 2026-03-09

### Исправлено
- **LIC-008**: Исправлен RSA публичный ключ — лицензия теперь верифицируется локально без обращения к серверу при каждом запуске

---

## [0.1.519] — 2026-03-09

### Изменено
- Поле «Месторождение» стало необязательным для заполнения

---

## [0.1.511] — 2026-03-08

### Удалено
- **UI-001**: Поле «Автор» удалено из интерфейса, отчётов и фильтров — остался только «Оператор» (фактический исполнитель теста). Поле `createdBy`/`created_by`/`author_name` убрано из PDF-шаблона, Rust-типов, TypeScript-типов, UI-компонентов и тестов

### Инфраструктура
- **INF-001**: Добавлен `scripts/package.json` с `"type": "commonjs"` — устранена ошибка `require is not defined in ES module scope` в benchmark/deploy скриптах

---

## [0.1.510] — 2026-03-07

### Исправлено
- **CHART-001**: Перерисовка графика вязкости при изменении порога/целевого времени теперь происходит мгновенно (ранее требовала перезагрузки данных)
- **EXCEL-001**: В режиме «раздельные оси» настройки стороны осей (left/right) теперь применяются корректно — ранее все серии, кроме вязкости, принудительно уходили вправо
- **EXCEL-002**: Ширина диаграммы в Excel-отчёте приведена в соответствие с шириной таблицы (9 фиксированных колонок вместо 7)

### Инфраструктура
- **UPD-001**: Система авто-обновления переведена на канальную маршрутизацию: пользователи с лицензией Developer получают обновления по бета-каналу, остальные — по стабильному

---

## [0.1.507] — 2026-05-15

### Исправлено
- **PERF-001**: Удалён флаг `--disk-cache-size=1` из `tauri.conf.json` — V8 bytecode cache был полностью отключён, что замедляло каждый запуск (~2x на холодном старте)
- **PERF-002**: Увеличен `--max-old-space-size` с 256 до 512 MB
- **LIC-001**: Инициализация лицензии в `license-store.ts` теперь использует `licensing_get_status` (Rust in-memory cache, 0 I/O) вместо `licensing_check` (DB-запрос) — устранён двойной DB-запрос при каждом старте

### Тесты
- Добавлено 43 регрессионных теста для auto-updater: `tests/release/tauri-updater-config.test.ts` (7 новых), `tests/release/update-manifest-format.test.ts` (22), `tests/store/update-store.test.ts` (15)

---

## [0.1.506] — 2026-05-14

### Исправлено
- **UPD-004**: Ошибки ручной проверки обновлений (`checkUpdateNow()`) больше не маскируются через `store.reset()` — теперь используется `store.setError()`; пользователь видит причину сбоя
- Логирование ошибок updater на диск через `clientLogger.error`

---

## [0.1.505] — 2026-05-14

### Исправлено
- **UPD-003**: `pub_date` в `stable.json` больше не содержит миллисекунды (`.replace(/\.\d{3}Z$/, 'Z')`) — Rust RFC-3339 парсер отклонял манифест с `.000Z`

---

## [0.1.504] — 2026-05-13

### Исправлено
- **UPD-001**: Endpoint авто-обновлятора исправлен с `{{target}}` → `{{target}}-{{arch}}` (было `…/windows/stable.json` → 404; теперь `…/windows-x86_64/stable.json` ✅)
- **UPD-002**: Формат `pubkey` в `tauri.conf.json` исправлен: теперь base64 полного `.pub`-файла (включая заголовок `untrusted comment:`) вместо голого `RWT…`-ключа; устранено `from_utf8()` panic в Rust

---

## [0.1.496] — 2026-03-07

### Исправлено
- **MEM-001**: Устранены утечки DOM-узлов при навигации между вкладками (+421 узел/цикл → 0)
  - `tooltip.ts`: обнулены DOM-ссылки замыкания (`tooltip`, `titleEl`, `itemsEl`) в хуке `destroy`
  - `zoom.ts`: обнулено closure-состояние (`isZoomed`, `originalXMin/Max`, `applyingFromStore`) в `destroy`
  - `uplot-chart.tsx`: добавлено `chart = null` после `destroy()` — разрывает цепочку React fiber-alternate → DOM; очистка GPU-текстуры через обнуление размеров canvas
  - `DashboardLayoutClient.tsx`: вызов `clearAnalysisCache()` при уходе с `/dashboard` — освобождает модульный кэш (`analysisCache`) с данными анализа (~5–15 MB)

---

## [0.1.490] — 2026-03-04

### Добавлено
- **Автообновление**: Полная реализация механизма доставки обновлений через `tauri-plugin-updater`
  - `update-store.ts` — Zustand-стор с состояниями: `idle / checking / available / downloading / ready / error`
  - `UpdateChecker.tsx` — фоновый компонент: проверяет обновления через 30 с после старта, затем каждые 4 часа
  - `UpdateBanner.tsx` — ненавязчивый баннер под хедером: показывает версию, прогресс загрузки, кнопки «Установить» / «Перезапустить»
- **Подпись артефактов**: Новая пара ключей minisign; `build.ps1` автоматически загружает `src-tauri/keys/updater.key`
- **Деплой**: скрипты `scripts/deploy/publish-update.js` (загрузка на VPS) и `scripts/deploy/setup-vps-releases.sh` (разовая настройка сервера)
- **Capability**: добавлена `updater:default` в `src-tauri/capabilities/default.json`
- Endpoint обновлений: `https://license.vizbuka.ru/releases/v1/update/{{target}}/{{arch}}/{{current_version}}?channel=stable`

---

## [0.1.489] — 2026-03-04

### Безопасность
- **SEC-001**: Удалены все plaintext-пароли, токены и ключи из `license-server/docs/CREDENTIALS.md` — заменены на `<ROTATED>` с инструкцией по ротации
- Все ранее хранившиеся в репозитории секреты считаются скомпрометированными и требуют ротации на сервере

### Исправлено
- **REL-005**: Устранён дрейф версии — `src/lib/version.ts` синхронизирован с `package.json`/`Cargo.toml`/`tauri.conf.json`
- ESLint: удалён неиспользуемый импорт `FLUID_TYPE_SHORT` (save-experiment-dialog.tsx)
- ESLint: удалён неиспользуемый аргумент `e` → `()` (experiment-card.tsx)
- ESLint: удалён устаревший `eslint-disable-next-line` (useSaveDialogInit.ts)

---

## [0.1.488] — 2026-03-04

### Исправлено — UI Библиотека
- **Таблица экспериментов** теперь заполняет всю ширину окна (`width: 100%`, `minWidth: 1100px`), шрифты нормализованы (`text-xs`/`text-sm`)
- **Сортировка по столбцам** перенесена на сервер: `ORDER BY` строится динамически в Rust с whitelist-валидацией поля; сброс страницы при смене сортировки
- **Кнопка «Загрузить ещё»** стала `sticky bottom-4` — остаётся видимой при росте списка
- **Карточка рецепта** показывает до 5 реагентов (было 3)
- **Боковая панель фильтров** получила собственный scroll-контейнер (`overflow-y-auto`) — прокрутка над фильтрами больше не двигает список экспериментов

### Добавлено — Rust Backend
- `ExperimentsListQuery`: поля `sort_by: Option<String>` и `sort_dir: Option<String>`
- `query.rs`: динамический `ORDER BY {col} {dir}` с whitelist (11 полей) вместо хардкода `ORDER BY e.testDate DESC`

---

## [0.1.459] — 2026-02-28

### Добавлено
- `docs/audit/LICENSE-SERVER-AUDIT-2026-02-28.md` — глубокий аудит лицензионного сервера (1 CRITICAL, 6 security, 4 data quality, 5 ops debt)
- `docs/audit/localization-audit-english-strings.md` — аудит локализации (~80 английских строк в UI)
- Демо-тесты: сериализация через `static Mutex<()>` для исключения race condition на `INTEGRITY_SECRET_KEY`
- `@deprecated` JSDoc на устаревшие bridge/client обёртки (`exportData`, `exportExperiments`)
- Новые Rust-тесты: data_flows (5), security (1), TOTAL: 76 Rust / 479 Vitest

### Исправлено — Rust Backend
- **10× `filter_map(|r| r.ok())`** замолчанных SQL-ошибок → `.collect::<Result<Vec<_>,_>>()` с `map_err` (export.rs, helpers.rs, sync_engine.rs, reagents/commands.rs, list.rs, crud.rs, migration.rs)
- **OOM-риск** в `sync_export_delta` → полная перезапись на streaming `BufWriter`
- **Mutex `.unwrap()`** → `map_err` в `PARSE_CACHE` (parsing.rs) — исключён panic при poisoned mutex
- **`unreachable!()`** → `return Err(...)` в sync_engine.rs — defense-in-depth
- **`unwrap_err()`** anti-pattern → `.ok_or(e)` в online.rs
- **5× `eprintln!`** → `tracing::debug!`/`tracing::warn!` (reports.rs, hardware.rs, types.rs)
- **Dev keys** в release-бинарнике: `DEV_INTEGRITY_KEY`/`DEV_ENCRYPTION_KEY` теперь под `#[cfg(debug_assertions)]`; `assert_production_keys()` делает `panic!` вместо `tracing::warn!`
- Удалён deprecated `experiments_export` из регистрации Tauri-команд

### Исправлено — Frontend
- **License init failure** оставлял приложение навсегда в loading → `isInitialized: true` в catch-блоке
- **Race condition** в experiment-list: stale fetch-ответы перезаписывали свежие → abort-флаг
- **APIKeyManager**: ошибка сети при добавлении ключа → теперь показывает `setOpError`
- **Dashboard**: race condition при загрузке эксперимента из URL → cancelled-флаг
- **comparison-store**: transient DB-ошибки при rehydrate молча удаляли эксперименты → теперь сохраняют

### Исправлено — Импорт/Экспорт
- Оператор-приоритет в auto-detect (`||` vs `&&`) — ExperimentExportImport.tsx
- Диалог подтверждения импорта убрано ложное обещание «обновления» записей + добавлен счётчик
- `extraFields` добавлен в экспорт/импорт реагентов (reagents/commands.rs)
- `durationSeconds`/`avgTemperatureC` теперь вычисляются из rawPoints вместо `null`

### Исправлено — Локализация
- ~80 английских строк переведены на русский в 20 файлах (см. аудит)

---

## [0.1.439] — 2026-02-27

### Добавлено
- `docs/ARCHITECTURE.md` — полное описание архитектуры (стек, IPC, схема БД, сборочные цели)
- `docs/CONTRIBUTING.md` — руководство для разработчиков (конвенции, инструкции, чек-лист)
- `scripts/README.md` — справочник по скриптам разработки, сборки, релиза и тестирования
- `docs/adr/ADR-0001`, `ADR-0002` — ретроспективные ADR: выбор Tauri v2 и SQLite/rusqlite
- `.github/PULL_REQUEST_TEMPLATE.md`, `ISSUE_TEMPLATE/` — шаблоны GitHub
- `CHANGELOG.md` — этот файл

### Изменено
- Схема БД: `SCHEMA_VERSION` снижен с 12 до 1; все V2–V12 миграции객 сведены в единый `V1_DDL`  
  (21 таблица, FTS5, составные индексы, FK CASCADE — всё в одной DDL-транзакции)
- `run_migrations` упрощён до двух веток: новая установка / нормализация legacy-БД

### Исправлено
- README, `DEVELOPER_GUIDE.md`, `MAINTENANCE_RU.md`: устаревшие версии и `SCHEMA_VERSION`
- `TEST_METHODOLOGY.md`: сломанная ссылка на `AUDIT_REPORT_RU.md`
- Удалён дублирующий файл `FRONTEND-IPC-DEEP-AUDIT-LATEST.md`

### Удалено
- ~600 строк мёртвого кода миграций (функции `migrate_v2`–`migrate_v12`)
- Секция «Adding a WASM Function» из README (WASM устранён в v0.1.422)
- `.agent/workflows/build-wasm.md` помечен как архивный

---

## [0.1.438] — 2026-02-26

### Добавлено
- Описания реагентов из российских TDS-PDF (Mirrico, Econotech): ГУАМИН, ATREN, серии WG/WGXL
- Предупредительный баннер в `ReagentDetailDrawer` о непроверенных технических данных
- 4 новых теста Rust: `migration_v1_creates_all_tables`, `migration_is_idempotent`, `migration_normalises_legacy_version`, `experiment_data_fk_cascades_on_delete`

### Исправлено
- `fix(reagents)`: синтаксическая ошибка — точки с запятой вместо запятых в кортежах WGXL-8.1/8.2/9.1
- SQL P0: устранены `INSERT OR REPLACE` CASCADE, добавлены FK CASCADE, пошаговые checkpoint-и миграций
- V8 migration idempotency: повторный запуск миграции больше не создаёт дублей

### Улучшено
- Производительность: renderer/browser WS −8.7 MB, p95 total WS −239 MB (Baseline #17)
- IPC: устранена двойная JSON-сериализация (SoA input, типизированные команды)
- Zustand: атомарные селекторы на 9 сайтах, очистка 8 таймеров `setTimeout`

---

## [0.1.422] — 2026-02-23

### Изменено
- **Расчёты перенесены из WASM (WebAssembly) в нативный Rust через Tauri IPC** (ADR-0003)  
  Устранены: 40–80 MB WASM heap, двойная сериализация JSON, нестабильность WebView2 worker

### Удалено
- WASM крейт `src/rust/rheolab-wasm/` и WebWorker `src/workers/`
- Зависимости `wasm-pack`, `wasm-bindgen`
- `public/wasm/` директория

---

## [0.1.410] и ранее

Версии до 0.1.410 не документировались в CHANGELOG.  
Историческая информация: `git log --oneline`.

---

[0.1.459]: https://github.com/rheolab/reallab-enterprise/compare/v0.1.439...v0.1.459
[0.1.439]: https://github.com/rheolab/reallab-enterprise/compare/v0.1.438...v0.1.439
[0.1.438]: https://github.com/rheolab/reallab-enterprise/compare/v0.1.422...v0.1.438
[0.1.422]: https://github.com/rheolab/reallab-enterprise/compare/v0.1.410...v0.1.422
