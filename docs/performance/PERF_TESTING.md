# Performance Testing Guide

Система мониторинга производительности RealLab Enterprise V2 состоит из двух уровней:
- **Browser-level** — CDP-метрики (JS Heap, DOM nodes, timing) через Playwright
- **Process-level** — CPU/RAM нативного процесса Tauri через PowerShell

---

## Быстрый старт

```powershell
# 1. Снять baseline (Tauri native — актуальный метод после ADR-0003)
npm run perf:workflow:tauri

# Повторный запуск без пересборки (если .rs и frontend не менялись):
$env:TAURI_E2E_SKIP_BUILD=1; npm run perf:workflow:tauri

# 2. После оптимизации — снять новый замер
npm run perf:workflow:tauri

# 3. Сравнить два baseline-файла
npm run perf:compare -- outputs/e2e/perf/workflow-СТАРЫЙ-tauri.json outputs/e2e/perf/workflow-НОВЫЙ-tauri.json

# 4. Мониторинг нативного процесса (требует запущенного Tauri-билда)
npm run perf:benchmark -- --process --duration 120

# 5. Глубокий browser benchmark (heap + nav leak + chart timing, без реального анализа)
npm run perf:benchmark

# 6. Frontend + IPC deep audit (Tauri-first)
npm run audit:frontend-ipc
# quick + non-blocking profile (useful for CI smoke)
npm run audit:frontend-ipc -- --quick --windows-runner --non-blocking
# short command timeout for harness-cleanup smoke/debug runs
npm run audit:frontend-ipc -- --quick --non-blocking --command-timeout-ms=60000
```

> ⚠️ **`perf:workflow` (браузер, без Tauri) устарел после ADR-0003.**
> `useAnalysisPipeline` использует только Tauri IPC — в headless Chromium анализ не запускается,
> uPlot не рендерится. Используйте `perf:workflow:tauri` для полного замера.

---

## Тесты и конфиги

| Файл | Назначение |
|------|-----------|
| `tests/e2e/multi-fixture-perf.spec.ts` | Workflow performance — полный цикл с метриками |
| `tests/e2e/perf-benchmark.spec.ts` | Deep benchmark: idle heap, nav leak, analysis timing |
| `playwright.workflow-perf.config.ts` | Конфиг для workflow perf теста |
| `playwright.benchmark.config.ts` | Конфиг для deep benchmark |
| `scripts/test/run-perf-benchmark.js` | Runner с поддержкой Mode A/B/C |
| `scripts/test/compare-perf-baselines.js` | Сравнение двух JSON-эталонов |
| `scripts/test/poll-process-resources.ps1` | Мониторинг процесса (CPU/RAM) |

---

## Workflow Performance Test (`multi-fixture-perf.spec.ts`)

### Что измеряется

На каждом шаге снимается CDP snapshot:

| Метрика | Описание |
|---------|---------|
| `heapUsedMb` | JS Heap Used (MB) в момент измерения |
| `heapTotalMb` | JS Heap Total (MB) |
| `nodes` | Кол-во DOM-узлов |
| `heapDeltaMb` | Прирост Heap к предыдущему шагу |
| `nodesDelta` | Прирост DOM-узлов |
| `analysisMs` | Время WASM-анализа (из `window.__perfMon`) |
| `uplotInitMs` | Время инициализации uPlot |
| `wallMs` | Wall-clock время шага |

Итоговые метрики: `peakHeapMb`, `peakNodes`, `totalWallMs`.

### Шаги теста

1. **initial** — показания при пустом экране (baseline)
2. **after_chandler_sst** — загрузка + анализ + сохранение Chandler SST
3. **after_chandler_swb** — Chandler SWB
4. **after_grace_report** — Grace Report
5. **after_brookfield_4** — Brookfield 4
6. **after_bsl_report** — BSL Report
7. **after_ofite_1100** — Ofite 1100
8. **comparison_4_loaded** — открытие сравнения с 4 экспериментами
9. **pdf_chandler_sst** — генерация PDF (Chandler SST)
10. **pdf_grace_report** — генерация PDF (Grace Report)

### Запуск

```powershell
# Базовый запуск (требует запущенного dev-server на :3100)
npx playwright test --config playwright.workflow-perf.config.ts --reporter=list

# Через npm script
npm run perf:workflow
```

### Выходные файлы

Результат сохраняется в `outputs/e2e/perf/workflow-<runId>.json`.

**Структура JSON:**
```json
{
  "scenario": "workflow-perf",
  "runId": "1771614458865",
  "generatedAt": "2026-02-20T19:07:54.395Z",
  "totalWallMs": 15530,
  "peakHeapMb": 31.17,
  "peakNodes": 5568,
  "steps": {
    "initial": { "heapUsedMb": 3.61, "nodes": 286, ... },
    "after_chandler_sst": { "heapUsedMb": 8.55, "analysisMs": 111, ... },
    ...
  }
}
```

---

## Сравнение эталонов (`compare-perf-baselines.js`)

```powershell
npm run perf:compare -- path/to/old.json path/to/new.json
```

Вывод — цветная таблица в терминале:

```
─── Top-level ───

──────────────────────────────────────────────────────────────────────
Metric                         Baseline   Candidate     Delta       %
──────────────────────────────────────────────────────────────────────
Peak Heap (MB)                    31.17       24.50     -6.67   -21.4% ✓
Peak DOM nodes                     5568        4200     -1368   -24.6% ✓
Total wall time (ms)              15530       14100     -1430    -9.2% ✓
──────────────────────────────────────────────────────────────────────
```

**Цветовая маркировка:**
- ✓ зелёный — улучшение ≥ 5%
- ~ жёлтый — изменение < 5%
- ✗ красный — регрессия ≥ 5%

---

## Deep Benchmark (`perf-benchmark.spec.ts`)

Четыре сценария:

| Сценарий | Что измеряет |
|----------|-------------|
| Idle Heap per Route | Heap + DOM на каждом маршруте в idle-состоянии |
| Analysis Pipeline | WASM-время + uPlot-init для 2 фикстур |
| Navigation Roundtrip | Leak detection: 10 циклов навигации, рост heap/nodes |
| Full Summary | Агрегированный отчёт (все сценарии в одном тесте) |

```powershell
npm run perf:benchmark
# Или через конфиг:
npx playwright test --config playwright.benchmark.config.ts
```

---

## Мониторинг нативного процесса

Мониторит `rheolab-enterprise.exe` (или другой процесс через `$env:RHEOLAB_POLL_PROCESS`).

```powershell
# Собирать 120 секунд, писать в CSV + JSON
npm run perf:benchmark -- --process --duration 120

# Параллельно с browser benchmark
npm run perf:benchmark -- --combined --duration 300
```

Результаты в `outputs/e2e/perf/process-resources-<runId>.csv` — колонки:
`timestamp, pid, working_set_mb, private_bytes_mb, cpu_pct, handles, threads`

---

## Порядок работы при оптимизации

```
1. npm run perf:workflow   → получить baseline (outputs/e2e/perf/workflow-XXX.json)
2. Внести изменения в код
3. npm run perf:workflow   → получить новый замер (outputs/e2e/perf/workflow-YYY.json)
4. npm run perf:compare -- workflow-XXX.json workflow-YYY.json
5. Если всё зелёное — commit. Если красное — откатить или исправить.
6. npm test (или npx playwright test tests/e2e/multi-fixture-workflow.spec.ts) — убедиться, что функциональность не сломана
```

---

## Пороговые значения (Soft Assertions)

Тест не упадёт, но покажет WARNING если:

| Метрика | Порог |
|---------|-------|
| `peakHeapMb` | < 500 MB |
| `peakNodes` | < 30 000 |

Пороги намеренно generous — они фиксируют катастрофические регрессии, не строгие требования.

---

## Известные ограничения

- **CDP-метрики** измеряют JS Heap браузерного движка, а не RAM нативного Tauri-процесса
- **Headless Chromium** может показывать другие цифры, чем реальный пользователь в production
- **WASM analysis время** доступно только если `window.__perfMon` инициализирован в приложении (src/lib/perf-monitor.ts)
- **uPlot init время** для загруженных из БД экспериментов не записывается (mark происходит только при свежем парсинге)

---

## Интерпретация результатов аудита (`audit:frontend-ipc`)

### Статус и уровни нарушений

| Статус | Значение |
|--------|---------|
| `pass` | Ни одного нарушения gate |
| `warning` | Нарушения присутствуют, но флаг `--non-blocking` не прерывает CI |
| `fail` | Нарушения присутствуют + `--non-blocking` НЕ указан → `process.exit(1)` |
| `skipped` | Динамическое профилирование пропущено (`--skip-dynamic`) |

`--command-timeout-ms=<ms>` задаёт per-step timeout для динамических команд аудита. При timeout runner завершает дерево дочерних процессов и запускает Tauri E2E teardown, чтобы не оставлять WebView2/Tauri процессы и не блокировать последующий `cargo test`.

### Bucket-классификация находок

| Bucket | Описание | Примеры |
|--------|---------|---------|
| **P0** | Критические сбои pipeline | Gate GATE-001..005 (нет артефактов) |
| **P1** | Проблемы фронтенда | Голые `useStore()`, таймеры без `clearTimeout` |
| **P2** | Производительность IPC/аллокации | JSON.stringify в IPC-путях, allocation hotspots |

### Пороги регрессионных gate

| Gate | Метрика | Порог | Severity |
|------|---------|-------|----------|
| `GATE-HEAP` | Peak heap P50 | +20% к rolling baseline (5 запусков) | high |
| `GATE-HEAP-ABS` | Peak heap P50 абсолютный | > 50 MB | high |
| `GATE-WALL` | Total wall time P50 | +25% к rolling baseline | medium |
| `GATE-NODES` | Peak DOM nodes P50 | +30% к rolling baseline | medium |
| `GATE-NODES-ABS` | Peak DOM nodes P50 абсолютный | > 10 000 | medium |
| `GATE-NATIVE` | Native working set P95 | > 1200 MB (calibrated B#12–B#14: 851–896 MB historical peak) | high |

> **Rolling baseline** — среднее последних 5 удачных `workflow-*-tauri.json` артефактов перед текущим запуском.

### Ложные срабатывания (известные исключения сканера)

Следующие паттерны **намеренно исключены** из статического сканера:

- `await new Promise(resolve => setTimeout(resolve, N))` — sleep-хелпер в async-функции; утечки невозможны (таймер разрешается inline).
- `setTimeout(() => window.location.reload(), N)` — перезагрузка страницы уничтожает весь контекст, clearTimeout не нужен.
- `JSON.stringify` в `src/lib/tauri/bridge/*.ts` — HTTP-fetch обёртки, не Tauri IPC; overhead безопасен.

### Поэтапный ввод gate в строгий режим

Сейчас все CI-прогоны используют `--non-blocking` (gate-нарушения = предупреждения, не ошибки).
Переход к enforcement:

1. **Phase 1 (текущая):** `--non-blocking` — нарушения в Summary, CI не падает.
2. **Phase 2:** Убрать `--non-blocking` для `GATE-HEAP-ABS` и `GATE-NATIVE` (абсолютные потолки).
3. **Phase 3:** Убрать `--non-blocking` для всех gate после стабилизации baseline (≥ 10 запусков).
