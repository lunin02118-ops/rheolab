# Performance + Memory Deep Audit (2026-02-27)

## 1) Цель и фокус аудита

- Проверка производительности и потребления оперативной памяти по всей кодовой базе.
- Приоритет: UI-пути (рендер, аллокации, повторные вычисления, нагрузка на WebView2).
- Проверка качества текущего perf-harness (надежность метрик, gate-ready состояние).

---

## 2) Источники данных и артефакты

### Основные отчеты

- `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-02-26.md`
- `docs/performance/memory-performance-report-2026-02-26.md`
- `outputs/e2e/perf/tauri-soak-summary-20260226-215843.json`

### Использованные runtime-логи

- `runtime/audit/20260226-214606746-frontend-ipc-deep-audit/logs/D-WARMUP_npm_run_perf_workflow_tauri_fast.log`
- `runtime/audit/20260226-214606746-frontend-ipc-deep-audit/logs/D-WORKFLOW-1_npm_run_perf_workflow_tauri_fast.log`
- `runtime/audit/20260226-214606746-frontend-ipc-deep-audit/logs/D-SOAK-1_npm_run_perf_soak_tauri_fast.log`

### Исторические workflow артефакты

- `outputs/e2e/perf/workflow-*-tauri.json` (31 запуск)

### Сборка для bundle-профиля

- `dist/assets/*` (после `npm run build`)

---

## 3) KPI snapshot (факт на момент аудита)

## 3.1 Frontend IPC deep audit status

- Статус gate: `WARNING`
- Причина: в текущем run нет валидных свежих workflow/soak/native артефактов.
- Подтверждение: `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-02-26.md:30-33`.

## 3.2 Soak aggregate (20 прогонов, skip-playwright mode)

Источник: `outputs/e2e/perf/tauri-soak-summary-20260226-215843.json`

- `runCount`: 20
- `pass_count / fail_count`: 20 / 0
- `peak_heap_max_mb`: 6.86
- `peak_heap_mean_mb`: 5.97
- `peak_node_max`: 1153
- `peak_node_mean`: 579.65

Вывод: явной деградации/утечки JS-heap в soak-агрегате не обнаружено.

## 3.3 Исторические Tauri workflow метрики (31 run)

Агрегация по `outputs/e2e/perf/workflow-*-tauri.json`:

- `peakHeapMb`: p50 9.06, p95 9.56, max 11.79
- `peakNodes`: p50 2886, p95 3045.5, max 3082
- `totalWallMs`: p50 20360, p95 25890.5, max 50115

## 3.4 Native memory baseline (из deep audit baseline)

Из `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-02-26.md`:

- `totalWsMb` baseline p50: 867.21
- `rendererWsMb` baseline p50: 355.55

Вывод: главный memory pressure остается в native/WebView2 слое, не в JS heap.

## 3.5 Bundle snapshot (production build)

Из `dist/assets`:

- `main-CDo7Hr4C.js`: 288 KB (gzip ~92.0 KB)
- `vendor-radix-CQmDVzgS.js`: 113 KB (gzip ~36.9 KB)
- `vendor-charts-C0E1tMOL.js`: 52 KB (gzip ~23.2 KB)
- `page-DNPjt35n.js`: 119 KB (gzip ~31.9 KB)

---

## 4) Критичные проблемы (приоритет по влиянию)

## P0-1: SoA -> AoS материализация в основном UI пути анализа

Суть:

- Store хранит SoA (`columnarData`) и намеренно очищает `data[]` для экономии памяти.
- В Dashboard данные снова материализуются в AoS через `rawPointsFromParseResult(...)`.
- Для таблицы эта конверсия вызывается дополнительно в render-path.

Подтверждение:

- `src/lib/store/experiment-data-store.ts:95-105`
- `src/components/dashboard/DashboardContent.tsx:77-80`
- `src/components/dashboard/DashboardContent.tsx:239`
- `src/lib/utils/columnar.ts:19-35`
- `src/lib/utils/columnar.ts:128-136`

Риск:

- Лишние крупные аллокации и GC пульсации при больших файлах.
- Рост latency при переключении вкладок и повторных рендерах.

---

## P0-2: Comparison add-flow не применяет columnar-конверсию

Суть:

- В store есть helper `toColumnarExperiment`, но в `addExperiment` эксперимент добавляется как есть.
- При выборе из библиотеки грузится full experiment и попадает в comparison без немедленного перехода в SoA.

Подтверждение:

- `src/lib/store/comparison-store.ts:14-20`
- `src/lib/store/comparison-store.ts:73-88`
- `src/components/comparison/comparison-selector.tsx:61-67`

Риск:

- Увеличенный heap footprint в comparison с несколькими экспериментами.
- Лишние AoS->SoA трансформации на более поздних стадиях.

---

## P1-1: Comparison file-upload path принудительно создаёт AoS

Суть:

- При добавлении эксперимента из файла используется `rawPointsFromParseResult(parseResult)`.
- В итоге хранится `rawPoints`, хотя comparison chart умеет работать с `columnarData`.

Подтверждение:

- `src/components/comparison/comparison-selector.tsx:81-90`
- `src/components/comparison/comparison-chart-uplot.tsx:231-240`

Риск:

- Избыточные аллокации при загрузке больших файлов в comparison.

---

## P1-2: Reports page повторно запускает heavy analysis pipeline

Суть:

- При каждом входе на страницу отчетов вызывается `useAnalysisPipeline`.
- Это дублирует тяжелые вычисления, уже выполненные на dashboard/analysis.

Подтверждение:

- `src/app/dashboard/reports/page.tsx:29-37`
- `src/hooks/useAnalysisPipeline.ts:188-196`

Риск:

- Дополнительная CPU/latency нагрузка в UI-навигации.

---

## P1-3: ReportsPanel держит дополнительную full-copy структуру raw data

Суть:

- `rawDataMapped = parseResult.data.map(...)` формирует отдельный массив объектов.
- Это копия большого набора данных для PDF/Excel/preview.

Подтверждение:

- `src/components/reports/ReportsPanel.tsx:96-106`
- `src/components/reports/ReportsPanel.tsx:154`

Риск:

- Пиковый memory spike при открытии/экспорте отчетов.

---

## P2-1: Library mapper остается AoS-first и расходится с SoA-стратегией

Суть:

- Маппер библиотечных экспериментов всегда формирует AoS `data`.
- Комментарий в файле указывает, что columnar path не нужен, что противоречит текущей архитектуре store/chart.

Подтверждение:

- `src/lib/experiments/mappers.ts:24-32`
- `src/lib/experiments/mappers.ts:34-38`

Риск:

- Непоследовательный data-path, усложнение оптимизаций и лишние конверсии.

---

## P2-2: Hot-path аллокации в comparison/downsample

Суть:

- `sanitiseAndNormaliseColumnar` превращает columnar обратно в массив объектов.
- `downsampleLTTBMultiChannel` многократно вычисляет/создает нормализованные массивы в циклах.

Подтверждение:

- `src/lib/utils/comparison-data.ts:105-133`
- `src/lib/utils/downsample.ts:93`
- `src/lib/utils/downsample.ts:115`
- `src/lib/utils/downsample.ts:127`

Риск:

- Дополнительная CPU и memory churn на больших datasets в comparison.

---

## 5) Стабильность перф-инфраструктуры (отдельный блок риска)

## 5.1 Tauri e2e/perf harness нестабилен

Наблюдения:

- `localStorage` SecurityError в `beforeEach` setup.
- CDP reconnect issue: `ECONNREFUSED 127.0.0.1:9222`.
- `Target page, context or browser has been closed` в soak run.

Подтверждение:

- `tests/e2e/base-test.tauri.ts:128-132`
- `runtime/audit/.../D-WARMUP...log:26`
- `runtime/audit/.../D-WORKFLOW-1...log:26`
- `runtime/audit/.../D-SOAK-1...log:26,41`

Эффект:

- Невозможно получить свежий authoritative dynamic snapshot (workflow + soak + native mem) в одном запуске.
- Текущий deep audit имеет advisory характер до стабилизации harness.

---

## 6) Приоритетный remediation план

## Этап A (P0, сразу)

1. Убрать повторные SoA->AoS конверсии в dashboard path:
   - В `DashboardContent` использовать единый memo-результат для chart и table.
   - По возможности перевести table на columnar-friendly источник без полной материализации.

2. В comparison store применять `toColumnarExperiment` при `addExperiment`:
   - Нормализовать входящий experiment в SoA сразу.

Ожидаемый эффект:

- Снижение аллокаций и GC churn в основном UI потоке.
- Более предсказуемый memory profile при больших файлах.

## Этап B (P1)

1. Reports: переиспользовать уже посчитанные `cycles/cycleResults` (или кэшировать pipeline).
2. Минимизировать копии в `ReportsPanel`:
   - Убрать full-copy map там, где можно читать напрямую из исходного представления.
3. File->comparison path: сохранять columnar-first структуру для синтетического эксперимента.

Ожидаемый эффект:

- Меньше latency при навигации к отчетам.
- Ниже пик памяти в отчетных сценариях.

## Этап C (P2)

1. Синхронизировать library mappers с SoA-first стратегией.
2. Оптимизировать downsample/comparison utility hot loops (уменьшить промежуточные аллокации).

---

## 7) Verification checklist после исправлений

- `npm run perf:workflow:tauri:fast`
- `npm run perf:soak:tauri:fast`
- `npm run perf:memory:aggregate -- --input-glob soak-*.json --last-runs 20`
- `npm run audit:frontend-ipc:quick`
- Сравнение до/после:
  - `peakHeapMb`, `peakNodes`, `totalWallMs`
  - `totalWsMb`, `rendererWsMb`
  - build chunk sizes (`dist/assets`)

---

## 8) Итог

- Главный bottleneck в текущем состоянии: не чистая heap-утечка, а регулярные крупные data-конверсии и дублирование структур в UI-path.
- Второй критичный фактор: нестабильность Tauri perf-harness, из-за которой отсутствует свежий authoritative full-run snapshot.
- До стабилизации harness и фикса P0/P1 любые выводы о "финальном улучшении" нужно считать предварительными.

