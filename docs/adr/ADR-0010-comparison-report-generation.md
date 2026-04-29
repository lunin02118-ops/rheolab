# ADR-0010 — Сравнительный отчёт (Comparison Report)

- **Status**: Implemented (Phases 1–4); docs/release polish в Phase 5
- **Date**: 2026-04-22
- **Target version**: 0.2.0-beta.24 (shipped) → stabilization в последующих beta
- **Related**: ADR-0007 (parser pipeline), ADR-0009 (refactor modularization)

### История статуса

| Дата       | Статус                             | Комментарий |
|------------|------------------------------------|-------------|
| 2026-04-22 | Proposed                           | Первоначальный план внедрения. |
| 2026-04-22 | Implemented (Phases 1–4)           | Rust backend + TS builders + UI + Playwright E2E. Unit: Rust 144/144, Vitest 1254/1254, E2E 19 total. |

---

## 1. Контекст и мотивация

На данный момент отчёты в RheoLab генерируются **только для одного эксперимента** (Dashboard → Analysis → Report). Вкладка Comparison умеет только визуализировать график и не даёт «зафиксировать результат» — пользователь не может выгрузить PDF / Excel с набором сравниваемых тестов и своими настройками визуала.

Запрос пользователя:

> Нужен сравнительный отчёт для всех загруженных тестов. 1 лист — график с сериями (настройки взяты из отображения вкладки сравнения), а остальные листы — базовые отчёты по каждому тесту, который включен в сравнение. Должны быть настройки выбора языка, отображения точки касания и заполнения базовых отчётов — как для простого отчёта на дашборде. Пользователь выбирает необходимые тесты, настраивает визуал графика, выбирает тип отображения осей и т.д., настраивает точку касания и может сгенерировать (зафиксировать результаты анализа) в сравнительном отчёте.

---

## 2. Текущая архитектура (как есть)

### 2.1 Одиночный отчёт (Dashboard)

```
ReportsPanel.tsx
  └─ useReportExport (hook)
      ├─ buildPdfReportInput(ctx)  ─┐
      ├─ buildExcelReportInput(ctx) ─┤  — src/lib/reports/report-builders.ts
      └─ generatePdfReportBlob / generateExcelReportBlob
              │
              ▼
         bridge.reports.generatePdf / generateExcel   (Tauri IPC)
              │
              ▼
   src/rust/rheolab-core/src/report_generator/
     ├─ pdf/  (generate_pdf_from_input → Typst → PDF bytes)
     └─ excel/ (generate_excel_from_input → rust_xlsxwriter → XLSX bytes)
```

Вход (`ReportInput`, `src/rust/rheolab-core/src/report_generator/types.rs`):

- `raw_data`, `metadata`, `cycle_results`, `recipe`, `water_params`, `cycles`,
- `settings` (язык, единицы, отображение точки касания, target time, секции …),
- `chart_image_base64` — PNG чарта, сгенерированный на клиенте,
- `axis_values` — диапазоны осей для Typst.

### 2.2 Вкладка Comparison

`src/components/comparison/`:
- `comparison-chart-uplot.tsx` — uPlot с `uPlotRef`, легендой, brush’ом, touch-points плагином.
- `useComparisonChartData.ts` — сборка серий / осей / точек касания на нескольких экспериментах.
- `comparison-controls.tsx` — селекторы осей, тумблер легенды, touch-point управление.
- `comparison-selector.tsx` — модалка выбора экспериментов из библиотеки.

**Отчётного потока нет.** Сабтабов внутри Comparison на текущий момент не существует — экран монолитный.

### 2.3 Excel backend сейчас пишет **один** лист

`report_generator/excel/mod.rs` создаёт `workbook.add_worksheet()` → `set_name("Report")` + скрытый `DebugInfo`. Multi-sheet структуры сейчас нет → её придётся ввести.

### 2.4 PDF backend

Typst-renderer собирает один документ из Typst-шаблона и файла-логотипа. Сборка нескольких single-experiment фрагментов в один PDF **технически тривиальна** (просто добавить дополнительные страницы в шаблон), но шаблон надо рефакторить под «секционную» композицию.

---

## 3. Целевое поведение

### 3.1 UX

1. В Comparison добавляется **под-вкладка «Отчёт» / «Report»** (рядом с графиком).
2. Вкладка показывает:
   - счётчик выбранных экспериментов (`N тестов`);
   - сводный список экспериментов с чекбоксами «включить в отчёт» (умолчание: все);
   - язык отчёта (RU/EN) — читается из `brandingStore.reportLanguage`, можно переопределить локально;
   - формат: PDF / Excel / оба;
   - секции для per-experiment листов (Recipe, Water analysis, Calibration, Raw data) — чекбоксы, default = `brandingStore`;
   - read-only readout настроек графика (оси, режим, touch point) — «берётся из вкладки Comparison»;
   - кнопка «Сохранить как настройки по умолчанию» (только если пользователь изменил выбор секций локально).
3. Кнопка **«Сгенерировать»** запускает pipeline и сохраняет файл(ы) через стандартный Tauri save-dialog.

### 3.2 Структура сгенерированного документа

Для **Excel**:

| # | Лист | Содержимое |
|---|------|-----------|
| 1 | `Сравнение` / `Comparison` | Заголовок + embedded chart image + сводная таблица (filename, date, instrument, #cycles, средняя вязкость, температура). |
| 2..N+1 | `<filename_1>` … `<filename_N>` | На каждом листе — **полный базовый отчёт** по одному эксперименту в том же формате, что сейчас (секции: metadata, chart thumbnail, touch points, statistics, raw data, recipe, water analysis, calibration). |

Для **PDF**:

```
Страница 1: Сравнительный график + summary-таблица по всем экспериментам.
Страница 2..K: Полный per-experiment отчёт (обычно 1-2 страницы на эксперимент).
```

### 3.3 Настройки, которые «фиксируются» в сравнительном отчёте

| Источник | Поля |
|----------|------|
| `chartSettingsStore` | `comparisonAxisMode` (shared/individual), `rheologyUnits.timeFormat`, `downsampleMode`, `lines[*]` (цвета, ширина, стиль). |
| Comparison local UI | `primaryMetric`, `leftSecondaryMetric`, `secondaryMetric`, `tertiaryMetric`, `showLegend`, `brushRange` (если активно). |
| Touch-point controls | `showTouchPoints`, `viscosityThreshold`, `showTargetTime`, `targetTime`. |
| `brandingStore` | `companyName`, `companyLogo`, `reportLanguage`, section toggles (переопределяемые локально). |
| Per-experiment analysis results | `cycles`, `cycleResults`, `recipe`, `waterParams`, `calibration` — берутся из library/store. |

**Критично**: диапазоны осей (`brushRange`, axis min/max) должны быть захвачены **один раз на момент нажатия «Сгенерировать»** — чтобы отчёт точно соответствовал тому, что пользователь видит на экране.

---

## 4. Архитектура решения

### 4.1 Frontend

Новые файлы:

```
src/components/comparison/
  ├─ ComparisonReportTab.tsx             ← UI вкладки
  ├─ ComparisonReportSectionToggles.tsx  ← 4 секции, переиспользует логику ReportTab
  ├─ ComparisonReportExperimentList.tsx  ← чекбоксы "включить в отчёт"
  └─ hooks/
      └─ useComparisonReportExport.ts    ← pipeline сборки payload + IPC
  
src/lib/reports/
  └─ comparison-report-builders.ts       ← buildComparisonPdfInput / buildComparisonExcelInput
  
src/lib/analysis/report-types/
  └─ comparison-report-types.ts          ← типы payload
```

Существующие файлы обновляются минимально:

- `comparison-selector.tsx` — без изменений.
- `comparison-chart-uplot.tsx` — **добавляется** `forwardRef` / imperative `captureChartPng()` метод (см. §4.3).
- Parent-компонент Comparison-view — добавляется tab-nav (`Chart` / `Report`).

### 4.2 Backend (Rust)

Новые файлы:

```
src/rust/rheolab-core/src/report_generator/
  ├─ comparison/
  │    ├─ mod.rs           ← generate_comparison_pdf / generate_comparison_excel
  │    ├─ types.rs         ← ComparisonReportInput, SingleExperimentReport
  │    ├─ summary_sheet.rs ← build sheet 1 / page 1
  │    └─ per_exp_sheet.rs ← обёртка для reuse excel::* / pdf::* single-exp pipeline
  │
  └─ excel/mod.rs   ← refactor: выделить `write_experiment_to_sheet(sheet, input)` как публичную функцию
  └─ pdf/template/mod.rs  ← refactor: функция `build_experiment_fragment(input) -> Vec<Element>`
```

Новый публичный API Rust:

```rust
// report_generator/comparison/mod.rs
pub fn generate_comparison_pdf_from_input(input: &ComparisonReportInput) -> Result<Vec<u8>, String>;
pub fn generate_comparison_excel_from_input(input: &ComparisonReportInput) -> Result<Vec<u8>, String>;
```

### 4.3 Chart rendering (уточнение — никакой PNG, всё вектор)

**Важное подтверждение из кода**: в single-exp отчётах график рендерится **Rust-ом как SVG**, а не захватывается с frontend canvas:

- **PDF**: `chart_generator::line::generate_chart_svg(&[ChartPoint], &ChartConfig) -> (String_svg, ChartRanges)` в `@/d:/Development/Rheolab/src/rust/rheolab-core/src/report_generator/chart_generator/mod.rs:8`. Typst-шаблон встраивает результат через `#image("chart.svg")` (`@/d:/Development/Rheolab/src/rust/rheolab-core/src/report_generator/pdf/template/chart_page.rs:35`).
- **Excel**: `rust_xlsxwriter::Chart` — **нативный** Excel-чарт (серии ссылаются на диапазоны `"Report", r1, c1, r2, c2` в листе с raw_data) в `@/d:/Development/Rheolab/src/rust/rheolab-core/src/report_generator/excel/chart.rs:9-12`. Пользователь может редактировать его прямо в Excel.

**Следствие**: frontend **не захватывает PNG**, а просто присылает Rust-у точки + стили. Для comparison делаем то же самое:

- **Новый модуль** `report_generator/chart_generator/line/multi_experiment.rs` — принимает `Vec<ExperimentSeries>` + `ComparisonChartConfig`, возвращает `(String_svg, ChartRanges)`. Переиспользует `common.rs` (оси, сетка, touch-points, легенда).
- **Excel**: в comparison-листе 1 кладём raw_data **каждого эксперимента в свой блок колонок** (offset N × 7 колонок); chart добавляет по одной серии per experiment × per metric, ссылается на свои колонки через `set_categories/set_values` — тот же pattern, что сейчас в `excel/chart.rs:add_series`.
- **Forward-ref на uPlot чарт не нужен** — фронт вообще не взаимодействует с canvas, просто собирает payload из store + локального state вкладки.

Это снимает риск «пустой PNG при ре-рендере» полностью и даёт **векторный** output с бесконечным zoom в PDF + редактируемый chart в Excel.

### 4.4 Поток данных

```
[User] → [Generate button]
           │
           ├─▶ for each selected experiment:
           │     load full experiment (rawPoints, cycles, cycleResults,
           │       recipe, waterParams, calibration) from library/store
           │     — уже в памяти при добавлении в comparison
           │
           │     if !cycles || !cycleResults:
           │         — прогнать analysis pipeline (Rust command
           │           'analysis_run') и кэшировать в store
           │
           ├─▶ buildComparisonPdfInput({
           │       comparisonChart: {
           │         primaryMetric, leftSecondaryMetric, secondaryMetric,
           │         tertiaryMetric, axisMode, touchPoint, brushRange,
           │         lineSettings,    // per-line overrides из chartSettingsStore
           │         expColors,       // EXPERIMENT_COLORS массив
           │       },
           │       experiments: [ { displayName, reportInput, sectionToggles }, … ],
           │       language, companyName, companyLogo, unitSystem
           │     })
           │
           ├─▶ bridge.reports.generateComparisonPdf(payload)
           │    / generateComparisonExcel(payload)
           │
           │     Rust:
           │       1) build SVG chart (multi_experiment generator)
           │       2) assemble page/sheet 1
           │       3) for each exp → reuse write_single_experiment_fragment
           │       4) stitch PDF / finalize XLSX
           │
           └─▶ saveBlob(...) / saveBlobsToDir(...)
```

### 4.5 Payload-контракт (TS ↔ Rust)

```ts
interface ComparisonReportInput {
  // Settings snapshot
  language: 'ru' | 'en';
  unitSystem: 'SI' | 'SI_Pas' | 'Imperial';
  companyName: string;
  companyLogo: string | null;                   // base64 (логотип — единственное non-vector место, и то мелочь)
  generatedAt: string;                          // ISO-8601

  // Конфиг для сравнительного графика (вектор-рендеринг Rust'ом)
  comparisonChart: {
    metrics: {
      primary: string;                          // 'viscosity_cp'
      leftSecondary: string | 'none';
      secondary: string | 'none';
      tertiary: string | 'none';
    };
    axisMode: 'shared' | 'individual';
    brushRange?: [number, number];              // minutes, захвачен на момент Generate
    touchPoint: {
      enabled: boolean;
      viscosityThreshold: number;               // cP
      showTargetTime: boolean;
      targetTime: number;                       // minutes
    };
    lineSettings: ChartLineSettings;            // per-metric colors/widths/styles
    experimentColors: string[];                 // EXPERIMENT_COLORS из comparison-chart-constants.ts
    timeFormat: 'seconds' | 'minutes' | 'hh:mm:ss';
    downsampleMode: 'off' | 'smart' | 'fast';
    chartWidth: number;                         // default 1400 px (A4 landscape fit)
    chartHeight: number;                        // default 700 px
  };

  // Листы/страницы 2..N+1 — per-experiment
  experiments: Array<{
    id: string;
    displayName: string;                        // → sheet name (truncate 31, sanitize, suffix _2/_3)
    reportInput: ReportInput;                   // тот же shape, что используется сейчас в single-exp
    sectionToggles: {
      showCalibration: boolean;
      showRawData: boolean;
      showRecipe: boolean;
      showWaterAnalysis: boolean;
    };
  }>;
}
```

Зеркало в Rust — `comparison/types.rs::ComparisonReportInput`, с `#[serde(rename_all = "camelCase")]`.

**Важно**: `ReportInput.raw_data` в каждом `experiments[i].reportInput` — это уже готовые `DataPoint`-ы (не SVG, не PNG). Rust из них построит SVG для comparison-страницы 1 и отдельные SVG для страниц 2..N+1 через тот же `generate_chart_svg()`.

---

## 4.6 Post-Sprint-2 architecture — native by-IDs default

Sprint 2 changes the default export path without changing the downstream PDF/XLSX renderer contract:

```
useComparisonReportExport
  ├─ buildByIdsRequest({ experimentIds, settings, chartConfig, sectionToggles })
  └─ generateComparisonPdfReportByIdsBlob / generateComparisonExcelReportByIdsBlob
         │
         ▼
    reports_generate_comparison_pdf_by_ids / reports_generate_comparison_excel_by_ids
         │
         ├─ validate request + license caps before DB read
         ├─ load experiments from SQLite by ID list
         ├─ release pooled SQLite connection
         ├─ run native analysis / assemble ComparisonReportInput in Rust
         └─ call generate_comparison_pdf / generate_comparison_excel
```

The legacy payload commands remain registered only as rollback fallback for one alpha/beta window:

- `reports_generate_comparison_pdf`
- `reports_generate_comparison_excel`

The frontend uses that legacy path only when the by-IDs IPC command is missing or when the emergency flag is set:

```ts
localStorage.setItem('rheolab.comparisonReports.forceLegacy', '1')
```

This means the original `ComparisonReportInput` shape is still the renderer contract, but it is no longer the default IPC contract. The default IPC payload is now bounded by experiment IDs plus settings, which removes the heavy TypeScript-side `comparison-experiment-adapter` work from normal exports and prepares the Rust path for Sprint 3's AnalysisArtifact cache.

Validation is captured in `docs/performance/REPORTS-NATIVE-BY-IDS-VALIDATION.md`.

---

## 5. Фазы внедрения

### Phase 1 — Backend plumbing (Rust)

**Goal**: Rust умеет генерировать comparison PDF / Excel из синтетического `ComparisonReportInput`.

Deliverables:
1. `report_generator/comparison/{mod,types,summary_sheet,per_exp_sheet}.rs`.
2. Рефакторинг `excel/mod.rs`: вынести `write_single_experiment_to_sheet(&mut Worksheet, &ReportInput, &Styles, bool)` как `pub(crate)` функцию — чтобы single-sheet flow переиспользовал её + comparison вызывал её в цикле.
3. Рефакторинг `pdf/template/mod.rs`: выделить `pub(crate) fn build_single_experiment_typst_fragment(input) -> String` (возвращает фрагмент Typst), объединять фрагменты через include в comparison-template.
4. Новые Tauri-команды в `src-tauri/src/commands/reports/` (существующий паттерн):
   - `reports_generate_comparison_pdf(payload) -> Vec<u8>`
   - `reports_generate_comparison_excel(payload) -> Vec<u8>`
   Регистрация в `tauri::Builder::.invoke_handler`.
5. Unit-тесты в `rheolab-core/tests/comparison_report_tests.rs`:
   - 2 эксперимента → PDF содержит ≥2 страницы, ≥1 image stream.
   - 3 эксперимента → Excel содержит ровно `1 (summary) + 3 (per-exp) + 1 (DebugInfo hidden) = 5` worksheets; sheet name #1 = `Сравнение` (ru) / `Comparison` (en); sheet names 2..4 — first 31 chars of `displayName` (Excel sheet name limit).

**Acceptance**: `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml comparison_report` зелёный.

---

### Phase 2 — Client payload builders

**Goal**: TypeScript умеет собрать корректный `ComparisonReportInput` из текущего state вкладки Comparison.

Deliverables:
1. `comparison-report-types.ts` — типы TS, syncнутые с Rust.
2. `comparison-report-builders.ts`:
   - `buildComparisonPdfInput(ctx: ComparisonReportContext): ComparisonReportInput`
   - `buildComparisonExcelInput(...)` (в 1-й версии — тот же payload, differ только в IPC target).
3. Расширение `src/lib/tauri/bridge.ts` → `bridge.reports.generateComparisonPdf / generateComparisonExcel`.
4. `src/lib/reports/client.ts` → `generateComparisonPdfBlob / generateComparisonExcelBlob` — зеркало существующих `generatePdfReportBlob/generateExcelReportBlob`, с тем же retry-fallback паттерном.
5. Vitest:
   - `tests/reports/comparison-builders.test.ts` — входной mock из 2 experiments, убедиться что все секции корректно разложены, `sectionToggles` уважаются, `brushRange` пробрасывается.

**Acceptance**: Vitest зелёный, `npm run build` чистый.

---

### Phase 3 — UI вкладка

**Goal**: Пользователь видит вкладку «Отчёт» в Comparison, может настроить и сгенерировать.

Deliverables:
1. Минорный tab-nav внутри Comparison parent-view (если сейчас монолитно — добавить `<Tabs>` с `Chart` / `Report`; проверить где это компонент собирается — возможно в `App.tsx` / routing).
2. `ComparisonReportTab.tsx`:
   - header: «Сравнительный отчёт: {N} тест(ов)».
   - `ComparisonReportExperimentList` — список с чекбоксами.
   - `ComparisonReportSectionToggles` — 4 секции + «Сохранить как настройки по умолчанию» (патчит `brandingStore`).
   - read-only секция «Chart settings» — показывает текущие метрики / оси / touch point из Comparison state.
   - `LanguageSelector` (reuse из `ReportTab`).
   - `FormatPicker` (PDF/Excel/both) — reuse.
   - Кнопка «Сгенерировать».
3. `useComparisonReportExport.ts` — hook того же формата, что `useReportExport`:
   - `handleDownload / handleExcelDownload / handleDownloadAll`
   - использует `comparisonChartRef.capturePng()` перед сборкой payload.
4. `forwardRef` в `comparison-chart-uplot.tsx` + `useImperativeHandle({ capturePng })`.

**Acceptance**: Ручной smoke — выбрать 2-3 экспер., нажать Generate → файл корректный.

---

### Phase 4 — E2E + regression

Deliverables:
1. Playwright:
   - `tests/e2e/comparison-report.spec.ts`:
     1. загрузить 2 фикстуры → перетащить в comparison,
     2. открыть вкладку Report,
     3. отключить Recipe section,
     4. Generate PDF → проверить PDF magic bytes + `%PDF-` signature + size > 20 KB,
     5. Generate Excel → распаковать как ZIP, проверить наличие `xl/worksheets/sheet1.xml`…`sheetN.xml`, содержимое sheet names.
2. Rust golden test: фикстурой захватить заранее сгенерированный PDF/XLSX snapshot для бинарного diff (ограниченный, т.к. PDF содержит timestamp — сравнивать только количество страниц и хеш структуры).
3. Perf: новый кейс в `perf-benchmark.tauri.spec.ts` — «generate comparison report for 5 experiments» — бюджет: PDF < 1500 ms, Excel < 800 ms для ~5 экспериментов * ~500 точек.
4. Обновление `tests/e2e/README.md` + `progress.txt` pending-tests list.

**Acceptance**: `npm run test:e2e:full` + `npm run perf:benchmark:tauri` зелёные; новый тест виден в результатах.

---

### Phase 5 — Polish + docs

1. i18n строки (`src/i18n/ru.ts`, `en.ts`) — все метки вкладки.
2. Progress indicator во время генерации (для N=10+ экспериментов).
3. Error handling: эксперимент без `cycles` (не проанализирован) → skip + показать warning в UI.
4. Обновить `docs/reports.md` / `README` — раздел «Comparison report».
5. Скриншоты в `docs/screenshots/comparison-report-*.png` для next release notes.

---

## 6. Решения (подтверждены пользователем 2026-04-22)

1. **Глубина per-experiment листа в Excel** → **(a) один компактный лист на эксперимент** — metadata + chart + stats + recipe + water + calibration + (опц.) raw data. Итого для 5 экспериментов: 1 summary + 5 per-exp + 1 hidden DebugInfo = **7 листов**.

2. **Эксперимент без анализа (нет `cycleResults`)** → **(a) автоматически прогнать analysis pipeline** (`bridge.analysis.run(...)`) перед сборкой payload. Результаты кешировать в store. Показывать прогресс «Анализ 3/5…».

3. **Имя листа в Excel** → truncate до 31 символа, sanitize `[]:*?/\`, детерминированный суффикс `_2, _3` при коллизии. Логика в `comparison/mod.rs::sanitize_sheet_name()` + unit-тест для коллизий.

4. **Chart format** → **векторный SVG** (для PDF) и **native Excel chart** (для XLSX). Никакого PNG-capture с фронта. Frontend шлёт только структурированные данные + line settings.

5. **Где живёт UI** → **под-вкладка «Отчёт»** внутри Comparison.

### Параметры «по умолчанию», не требующие подтверждения

- **Размер SVG** в PDF: `1400×700` (как у existing single-exp PDF chart, подобрано под A4 landscape).
- **`showRawData`** на per-exp страницах comparison PDF — **выключено по умолчанию** (для 10 экспериментов включение raw data = +500-1000 строк × 10 = ~800 KB → 5 MB PDF). Пользователь может включить вручную.
- **Порядок per-exp страниц** — по порядку добавления в comparison (stable).
- **Логотип компании** — тот же, что и для single-exp (`brandingStore.companyLogo`).

---

## 7. Риски и их снижение

| Риск | Снижение |
|------|----------|
| **Excel sheet name collision** (2 эксперимента с одинаковым filename) | `sanitize_sheet_name()`: truncate(31) + strip `[]:*?/\` + детерминированный суффикс `_2, _3`; unit-тест. |
| **PDF раздувается** при 10+ экспериментах (raw data ≈ 100-300 KB/exp) | Для comparison `showRawData=false` на per-exp страницах по умолчанию. Пользователь может включить вручную в UI вкладки. |
| **Long generation time** (N=20 экспериментов × analysis pipeline) | Progress bar с этапами «Анализ X/N → Рендер → Экспорт». Async Tauri-команда. Бюджет p95 < 5 s для 10 экспериментов уже проанализированных. |
| **Рефакторинг `excel/mod.rs` ломает существующий single-exp flow** | Golden test: single-exp before/after refactor → бинарный diff == 0 (кроме timestamp в `DebugInfo`). |
| **Multi-experiment SVG слишком большой** (много серий → 100+ KB SVG на страницу) | Downsample per series до `max(400, base / log2(N))` точек — та же логика, что уже в `useComparisonChartData.ts:135-136`. |
| **Несовместимость color scheme** (брендинг user vs. EXPERIMENT_COLORS palette) | В shared axis-mode — серия красится в `EXPERIMENT_COLORS[i]`; в individual mode при N=1 — в line-settings color. Тот же паттерн, что в comparison UI. |

---

## 8. Acceptance checklist (до мержа)

- [x] Phase 1: Rust backend + unit tests — `rheolab-core` 144/144, `src-tauri` integration ✅
- [x] Phase 2: TS builders + Vitest — converters / builders / adapter / client ✅
- [x] Phase 3: UI + manual smoke — `ComparisonReportTab` + `ComparisonReportSettings` ✅
- [x] Phase 4: Playwright E2E — 6 новых кейсов `comparison-report.spec.ts`, 0 регрессий ✅
- [ ] Phase 5: i18n + docs + screenshots (in progress — CHANGELOG обновлён, docs/screenshots pending)
- [x] `npm run test` зелёный (1254 passed)
- [x] `cargo test --manifest-path src/rust/rheolab-core/Cargo.toml` зелёный (144 passed)
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` зелёный (reports integration ✅)
- [x] `npm run test:e2e:full` зелёный (19 specs, +6 новых)
- [ ] `npm run perf:benchmark:tauri` без регрессий >10% на existing benchmarks (baseline pending, build готов)
- [ ] `npm audit --omit=dev` + `cargo audit` — 0 уязвимостей (pending)
- [x] Version bump → `0.2.0-beta.24`
- [x] Release notes обновлены (`CHANGELOG.md`)

---

## 9. Оценка объёма

| Phase | Оценка (рабочих часов) |
|-------|------------------------|
| 1 — Backend | 8–12 |
| 2 — TS builders | 3–5 |
| 3 — UI | 4–6 |
| 4 — E2E + perf | 3–4 |
| 5 — Polish | 2–3 |
| **Total** | **20–30** |

---

## 10. Open questions → ответы пользователя

Нужно подтвердить п. 6.1 и 6.2 перед стартом Phase 1.  
Остальное — разумные defaults, могут быть изменены на ходу без rework.
