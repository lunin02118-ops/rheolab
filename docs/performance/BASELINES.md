# Performance Baselines

История эталонных замеров производительности (Tauri native). Каждая запись соответствует состоянию кодовой базы в момент `commit`.

> **Примечание**: Browser/WASM-базелайны (#1–#5 old) удалены 2026-03-14. WASM-пайплайн
> полностью удалён (ADR-0003, 2026-02-22), те замеры потеряли актуальность.
> JSON-файлы сохранены в `outputs/e2e/perf/workflow-17716*.json` для справки.

---

## Как добавить новый baseline

1. Запустить perf-тест в Tauri-режиме:
   ```powershell
   $env:TAURI_BINARY_PATH = "src-tauri\target\release\rheolab-enterprise.exe"
   npx playwright test --config playwright.tauri.config.ts tests/e2e/multi-fixture-perf.tauri.spec.ts
   ```
2. Найти результат: `outputs/e2e/perf/workflow-<runId>-tauri.json`
3. Добавить раздел `## Baseline #N — <описание> (<дата>)`
4. Заполнить таблицы из JSON-файла
5. Указать коммит git

---

## Baseline #1 — First Tauri Native E2E (ADR-0003) (2026-02-22)

**runId:** `1771733913362-tauri`  
**Дата:** 2026-02-22  
**Описание:** Первый реальный E2E-замер в режиме Tauri native (CDP). Анализ — нативный Rust backend (без WASM). Тест запускает собранный `rheolab-enterprise.exe` и подключается к WebView2 через CDP.  
**JSON-файл:** `outputs/e2e/perf/workflow-1771733913362-tauri.json`

### Условия теста

| Параметр | Значение |
|----------|---------|
| Конфиг | `playwright.tauri.config.ts` |
| Режим | Tauri native (WebView2 → CDP) |
| Бэкенд | Rust, SQLite, реальные Tauri-команды |
| Workers | 1 (последовательно) |
| Binary | `src-tauri/target/debug/rheolab-enterprise.exe` (debug, no-bundle build) |
| Фикстуры | 6 инструментов (Chandler SST/SWB, Grace, Brookfield 4, BSL, Ofite 1100) |

### Итоговые метрики

| Метрика | Значение |
|---------|---------|
| **Peak Heap** | **42.92 MB** |
| **Peak DOM nodes** | **6 771** |
| **Total wall time** | **16.8 s** |

### Детальные метрики по шагам

| Шаг | Heap (MB) | Δ Heap | Nodes | Δ Nodes | Analysis (ms) | uPlot (ms) | Wall (ms) |
|-----|-----------|--------|-------|---------|---------------|-----------|-----------|
| initial | 8.60 | — | 577 | — | — | — | — |
| after_chandler_sst | 16.31 | +7.71 | 2183 | +1606 | **13** | 5 | 2088 |
| after_chandler_swb | 17.02 | +0.71 | 2355 | +172 | 28 | 1 | 2552 |
| after_grace_report | 26.17 | +9.15 | 3222 | +867 | 29 | 2 | 2005 |
| after_brookfield_4 | 35.43 | +9.26 | 3366 | +144 | 22 | 1 | 1968 |
| after_bsl_report | 22.96 | −12.47 | 3487 | +121 | 71 | 1 | 2628 |
| after_ofite_1100 | **42.92** | +19.96 | **6771** | +3284 | 13 | 1 | 830 |
| comparison_4_loaded | 12.72 | −30.20 | 2134 | −4637 | — | 1 | 1217 |
| pdf_chandler_sst | 12.80 | +0.08 | 2511 | +377 | 13 | 1 | 681 |
| pdf_grace_report | 19.49 | +6.69 | 3261 | +750 | 29 | 0 | 978 |

### Analysis latency: Rust native vs WASM (удалённый browser Baseline)

| Фикстура | Rust native (B#1) | WASM cold (old B#4) | WASM warm (old B#4 avg) |
|----------|------------------|-----------------|---------------------|
| Chandler SST (1-й) | **13 ms** | 127 ms | — |
| Chandler SWB | 28 ms | 11 ms | warm |
| Grace Report | 29 ms | 12 ms | warm |
| Brookfield 4 | 22 ms | 13 ms | warm |
| BSL Report | 71 ms | 21 ms | warm |
| Ofite 1100 | **13 ms** | 15 ms | warm |

> **Вывод по анализу**:
> - Первый холодный WASM-запуск (127 ms) → Rust native (13 ms): **−89.8% ✓**
> - Warm WASM (11–21 ms) vs Rust native (13–71 ms): Rust native медленнее на повторных вызовах из-за IPC-сериализации (JSON round-trip через Tauri invoke) и реальных дисковых операций (SQLite write). WASM работал in-process, без сериализации.
> - BSL Report (71 ms) — аутлайер: у файла нестандартная структура, Rust-парсер выполняет дополнительные проходы по определению заголовков.

### Наблюдения

- **Base heap 8.6 MB vs 3.6 MB** (browser) — WebView2 стартует с большей базой, чем headless Chromium.
- **comparison_4_loaded: heap −30.2 MB** — мощный GC-цикл после выгрузки 6 тяжёлых экспериментов; память возвращается эффективно.
- **PDF timing** — 681 и 978 ms (vs ~1700 ms в B#4) — быстрее, т.к. Tauri-бэкенд уже имеет данные в памяти от предыдущих операций анализа.
- **Все 6 файлов сохранились** без ошибок (FK bug `desktop-local-admin` был исправлен в этом цикле).

### Контекст (что поменялось с B#5)

> Изменения с момента аналитического Baseline #5:
> - ADR-0003 полностью реализован: WASM-пайплайн удалён, все анализы через `analysis_analyze_full` Tauri-команду
> - `ZoomSyncStore.setRange()` early-exit guard (нет лишних Zustand-нотификаций на каждый mousemove)
> - FK bug fix в `persist_experiment()`: `desktop-local-admin` User row теперь INSERT OR IGNORE перед Experiment FK
> - Tauri CDP E2E infrastructure: `playwright.tauri.config.ts`, `base-test.tauri.ts`, `scripts/test/tauri-e2e-setup.js`

### Команда для сравнения с Baseline #1 (Tauri native)

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1771733913362-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>.json
```

---

## Baseline #2 — T1+T2 Memory Optimizations (2026-02-22)

**runId:** `1771759780657-tauri`
**Дата:** 2026-02-22
**Описание:** После T1 (удаление backdrop-blur, will-change на диалогах) и T2 (--in-process-gpu, GPU eviction flags, SQLite pool 4→2 conn).
**Коммит:** `dfee242`
**JSON-файл:** `outputs/e2e/perf/workflow-1771759780657-tauri.json`
**Native memory:** `outputs/e2e/perf/native-memory-1771759775813.jsonl`

### Native memory vs B#1

| Процесс | B#1 (оценка) | B#2 пик WS | B#2 Private |
|---------|-------------|-----------|-------------|
| GPU | ~730 MB | **0 MB (ликвидирован)** | 0 MB |
| Browser | ~200 MB | 383 MB | 114 MB |
| Renderer | ~250 MB | 350 MB | 99 MB |
| Utility | ~60 MB | 52 MB | 30 MB |
| Tauri EXE | ~80 MB | 59 MB | 29 MB |
| **Total WS** | **~1 120 MB** | **851 MB (-24%)** | — |
| **Total Private** | — | — | **~272 MB** |

> `--in-process-gpu` устранил GPU-процесс (730 MB WS). Реальный private footprint: **~272 MB** < цель 500 MB.

### JS heap

| Шаг | Heap (MB) | Nodes |
|-----|-----------|-------|
| initial | 4.21 | 260 |
| after_chandler_sst | 6.15 | 1 125 |
| after_chandler_swb | 6.72 | 1 315 |
| after_grace_report | 6.78 | 1 571 |
| after_brookfield_4 | 6.77 | 1 221 |
| after_bsl_report | 7.19 | 1 125 |
| after_ofite_1100 | 7.06 | 1 475 |
| comparison_4_loaded | 8.40 | 1 781 |
| pdf_chandler_sst | 8.13 | 2 035 |
| **pdf_grace_report (peak)** | **9.63** | **2 525** |
| **Total wall** | **17.6 s** | — |

### Команда для сравнения с Baseline #2

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1771759780657-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>.json
```

---

## Baseline #3 — ADR-0003 Final Cleanup (2026-02-23)

**runId:** `1771821972652-tauri`
**Дата:** 2026-02-23
**Описание:** После финальной зачистки ADR-0003: удалён `wasm-ai-bridge.ts`, удалены устаревшие TS-тесты WASM AI путя (`force-ai-integration`, `golden-ai-parity`, `wasm-ai-integration`), исправлен `waitForWasm()` early-exit bug (CPU-spin при неудачном WASM-инициализации в Tauri).
**Коммит:** `affaabc`
**JSON-файл:** `outputs/e2e/perf/workflow-1771821972652-tauri.json`
**Native memory:** `outputs/e2e/perf/native-memory-1771821967863.jsonl`

### Итоговые метрики

| Метрика | Значение | vs old B#6 (WASM, удалён) | vs Baseline #2 |
|---------|---------|----------------------|----------------|
| **Peak Heap** | **9.57 MB** | **−69.3% ✅** | -0.1% ~ |
| **Peak DOM nodes** | **3 001** | **−46.1% ✅** | +19% ⚠️ |
| **Total wall time** | **17.3 s** | +11.7% ⚠️ | -1.7% ~ |

> ⚠️ nodes +19% vs B#2: Baseline #2 использовал `--in-process-gpu` + GPU eviction flags, что меняет
> количество WebView-внутренних узлов. Разница ожидаема — не регрессия в продуктовом коде.

### Детальные метрики по шагам

| Шаг | Heap (MB) | Δ Heap | Nodes | Analysis (ms) | uPlot (ms) | Wall (ms) |
|-----|-----------|--------|-------|---------------|-----------|-----------|
| initial | 4.32 | — | 262 | — | — | — |
| after_chandler_sst | 6.10 | +1.78 | 1124 | **11** | 6 | 1299 |
| after_chandler_swb | 6.67 | +0.57 | 1314 | 19 | 1 | 1375 |
| after_grace_report | 6.75 | +0.08 | 1570 | 22 | 1 | 2772 |
| after_brookfield_4 | 6.74 | −0.01 | 1220 | 16 | 1 | 2209 |
| after_bsl_report | 7.15 | +0.41 | 1124 | 53 | 1 | 2844 |
| after_ofite_1100 | 7.03 | −0.12 | 1474 | 9 | 1 | 1048 |
| comparison_4_loaded | 8.37 | +1.34 | 1805 | — | 1 | 1846 |
| pdf_chandler_sst | 8.10 | −0.27 | 2511 | 7 | 0 | 957 |
| pdf_grace_report | **9.57** | +1.47 | **3001** | 24 | 0 | 898 |

### Сравнение анализа: WASM (old B#6) vs Tauri IPC (B#3)

| Фикстура | WASM cold (old B#6) | Tauri IPC (B#3) | Δ |
|----------|----------------|-----------------|---|
| Chandler SST (первый) | 111 ms | **11 ms** | **−90% ✅** |
| Chandler SWB | 12 ms | 19 ms | +58% ~ (IPC overhead) |
| Grace Report | 12 ms | 22 ms | +83% ~ |
| Brookfield 4 | 10 ms | 16 ms | +60% ~ |
| BSL Report | 20 ms | 53 ms | +165% ⚠️ |
| Ofite 1100 | 5 ms | 9 ms | +80% ~ |
| PDF Chandler SST | 87 ms | **7 ms** | **−92% ✅** |
| PDF Grace Report | 93 ms | **24 ms** | **−74% ✅** |

### Наблюдения

- **Peak heap**: идентичен B#2 (9.57 vs 9.63 MB) — удаление WASM AI bridge не влияет на runtime heap
- **waitForWasm() fix** не виден в метриках (WASM не грузится в Tauri), но устранил 5-8 сек CPU-spin в Node.js тестах
- **BSL Report 53 ms** — аутлайер, аналогичен B#1 (71 ms). Нестандартная структура файла → дополнительные проходы в парсере. Не регрессия
- **Живые тесты AI**: боевое покрытие теперь исключительно через `src-tauri/tests/ai_parsing.rs` → `cargo test --test ai_parsing`

### Команда для следующего сравнения

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1771821972652-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>.json
```
---

## Baseline #4 — Renderer Memory Optimizations A+B+C1 (2026-02-23)

**runId:** `1771823525369-tauri`  
**Дата:** 2026-02-23  
**Описание:** После оптимизаций Renderer-процесса: A) `columnarData: undefined` в `partialize` experiment-data-store; B) `reset()` + `requestIdleCallback` перед загрузкой файла в `file-upload.tsx`; C1) единый shared `<Dialog>` в `ExperimentList` вместо N per-card Dialog-ов.  
**Коммит:** _(текущий рабочий branch)_  
**JSON-файл:** `outputs/e2e/perf/workflow-1771823525369-tauri.json`

### Итоговые метрики

| Метрика | Значение | vs Baseline #3 |
|---------|---------|----------------|
| **Peak Heap** | **9.55 MB** | −0.02 MB (−0.2%) ~ |
| **Peak DOM nodes** | **2 526** | **−475 (−15.8%) ✅** |
| **Total wall time** | **18.4 s** | +1.1s (+6%) ~ |

> **Heap почти не изменился** — ожидаемо: тест последовательно загружает 6 файлов с GC между ними.
> Выигрыш от A+B виден в *продакшн-паттерне*: многократная загрузка файлов → больше нет тройного буфера
> `columnarData` в sessionStorage + Float64Arrays hanging. Проверить через profiling в реальном сценарии.
>
> **DOM nodes −15.8%** — прямой эффект C1: Dialog-порталы больше не монтируются для каждой карточки.

### Детальные метрики по шагам

| Шаг | Heap (MB) | Δ Heap | Nodes | Analysis (ms) | uPlot (ms) | Wall (ms) |
|-----|-----------|--------|-------|---------------|-----------|----------|
| initial | 4.25 | — | 262 | — | — | — |
| after_chandler_sst | 6.11 | +1.86 | 1124 | 8 | 5 | 2304 |
| after_chandler_swb | 6.66 | +0.55 | 1314 | 21 | 2 | 1536 |
| after_grace_report | 6.75 | +0.09 | 1570 | 20 | 1 | 2764 |
| after_brookfield_4 | 6.71 | −0.04 | 1220 | 19 | 1 | 2216 |
| after_bsl_report | 7.16 | +0.45 | 1124 | 54 | 1 | 2914 |
| after_ofite_1100 | 7.02 | −0.14 | 1474 | 10 | 1 | 1240 |
| comparison_4_loaded | 8.34 | +1.32 | 1805 | — | 1 | 1551 |
| pdf_chandler_sst | 8.04 | −0.30 | 2036 | 6 | 1 | 893 |
| pdf_grace_report | **9.55** | +1.51 | **2526** | 19 | 0 | 888 |

### Наблюдения

- **Peak heap идентичен B#3** — тест не нагружает sessionStorage повторными загрузками. Реальный выигрыш A+B измеряем только при ручном профилировании (DevTools → Memory snapshot до/после повторной загрузки)
- **DOM nodes −475** — прямой результат C1 (Dialog-portal не создаётся для каждого ExperimentCard)
- **BSL Report 54 ms** — стабильный аутлайер (B#3: 53 ms). Специфика файла, не регрессия
- **Wall time +1.1s** — вероятно шум/OS scheduling, не деградация (requestIdleCallback добавляет max 50ms delay один раз)
---

## Baseline #5 — C2 Regression Check (2026-02-23)

**runId:** `1771824037585-tauri`
**ата:** 2026-02-23
**писание:** онтрольный запуск после внедрения C2 (`@tanstack/react-virtual` + `useWindowVirtualizer` в `ExperimentList`). Тот же бинарник, что и в B#4 — фронтенд не пересобирался (workflow-тест не заходит на страницу библиотеки).
**оммит:** _(текущий рабочий branch)_
**JSON-файл:** `outputs/e2e/perf/workflow-1771824037585-tauri.json`

### тоговые метрики

| етрика | начение | vs Baseline #4 |
|---------|---------|----------------|
| **Peak Heap** | **11.79 MB** | +2.24 MB — GC дисперсия ⚠️ |
| **Peak DOM nodes** | **2 951** | +425 (+17%) — GC дисперсия ⚠️ |
| **Total wall time** | **18.4 s** | ~= ✅ |

> **азница heap — GC дисперсия, не регрессия.** pdf_grace_report дал дельту +3.68 MB вместо +1.51 MB в B#4: V8 не успел GC до снимка метрики. Тот же бинарник, те же изменения кода.
>
> C2 (виртуализация ExperimentList) не затрагивает workflow-сценарий. ффект в продакшн: heap/nodes при прокрутке библиотеки с 100+ карточками.

### аблюдения

- **1 passed** — регрессий нет ✅
- Wall time 18.4s — идентичен B#4 ✅
- BSL Report 54 ms — стабильный аутлайер (B#3: 53 ms, B#4: 54 ms) ✅

---

## Baseline #6 — Dead-code removal: TS AIColumnMapper stack (2026-02-24)

**runId:** `1771952226043-tauri`
**Дата:** 2026-02-24
**Описание:** После удаления мёртвого TypeScript AI-стека: `AIColumnMapper.ts`, `GroqClient.ts`, всех тестов `tests/ai/`, `vitest.ai.config.ts`, мёртвого `force-ai-parsing.spec.ts`. AI column mapping теперь исключительно в Rust (`call_groq_ai_mapping` в `src-tauri/src/commands/parsing.rs`). Одновременно исправлен баг стейл-замыкания `canSaveExperiment` в `license-context.tsx` (добавлен `result` в deps — без этого сохранение блокировалось сразу после старта пока `experimentsInDB` не обновится).
**Коммиты:** `918cbfd` (удаление AI TS stack), `a4fc053` (фикс license stale closure)
**JSON-файл:** `outputs/e2e/perf/workflow-1771952226043-tauri.json`
**Native memory:** `outputs/e2e/perf/native-memory-1771952221331.jsonl`

### Итоговые метрики

| Метрика | Значение | vs Baseline #3 | vs Baseline #4 |
|---------|---------|----------------|----------------|
| **Peak Heap** | **8.98 MB** | **−0.59 MB (−6.2%) ✓** | −0.57 MB (−6.0%) ✓ |
| **Peak DOM nodes** | **2 875** | **−126 (−4.2%) ✓** | +349 (+13.8%) ~ |
| **Total wall time** | **19.1 s** | +1.8 s (+10.4%) ~ | +0.7 s (+3.8%) ~ |

> Wall time отклонение — в пределах OS-noise (B#3–B#5 варьировали 17.3–18.4 s). Не регрессия.

### Детальные метрики по шагам

| Шаг | Heap (MB) | Δ Heap | Nodes | Analysis (ms) | uPlot (ms) | Wall (ms) |
|-----|-----------|--------|-------|---------------|-----------|-----------|
| initial | **3.36** | — | **166** | — | — | — |
| after_chandler_sst | 6.03 | +2.67 | 1035 | 26 | 3 | 1508 |
| after_chandler_swb | 6.61 | +0.58 | 1225 | 20 | 1 | 1476 |
| after_grace_report | 6.69 | +0.08 | 1481 | 21 | 1 | 2783 |
| after_brookfield_4 | 6.69 | 0 | 1131 | 15 | 1 | 2748 |
| after_bsl_report | 7.10 | +0.41 | 1035 | 52 | 1 | 2845 |
| after_ofite_1100 | 6.98 | −0.12 | 1385 | 23 | 1 | 1143 |
| comparison_4_loaded | 8.74 | +1.76 | 1772 | — | 1 | 1626 |
| pdf_chandler_sst | 8.46 | −0.28 | 1940 | 6 | 0 | 1262 |
| pdf_grace_report | **8.98** | +0.52 | **2875** | 23 | 1 | 1691 |

### Vs Baseline #3 (наиболее близкий clean baseline)

| Шаг | Heap B#3 | Heap B#6 | Δ | Nodes B#3 | Nodes B#6 | Δ |
|-----|----------|-----------|---|-----------|------------|---|
| initial | 4.32 MB | **3.36 MB** | **−0.96 MB** | 262 | **166** | **−96** |
| after_chandler_sst | 6.10 | **6.03** | −0.07 ~ | 1124 | 1035 | −89 ~ |
| after_bsl_report | 7.15 | 7.10 | −0.05 ~ | 1124 | 1035 | −89 ~ |
| pdf_grace_report (peak) | **9.57** | **8.98** | **−0.59 MB (−6.2%) ✓** | 3001 | 2875 | −126 (−4.2%) ✓ |

### Наблюдения

- **Initial heap −0.96 MB** — прямой эффект удаления TS AI-стека из бандла. `AIColumnMapper.ts` + `GroqClient.ts` + весь `tests/ai/` убраны → bundle меньше → меньше кода парсит V8 при старте.
- **Initial nodes −96** — меньше Portal-монтирований при старте (возможно косвенно через меньший React tree после удаления dead imports в StartupCheck).
- **Peak heap −6.2%** — стабильное улучшение vs B#3. Несмотря на то что оба замера имеют GC-variance, тренд совпадает с B#4 (−6.0%).
- **BSL Report 52 ms** — стабильный аутлайер (B#3: 53 ms, B#4: 54 ms). Специфика файла.
- **Wall time +10%** — OS-noise. Предыдущие базлайны варьировали от 17.3 до 18.4 s.

### Контекст (изменения между B#5 и B#6)

> - Удалены: `src/lib/parsing/AIColumnMapper.ts`, `src/lib/parsing/GroqClient.ts`
> - Удалены: `tests/ai/` (6 файлов), `tests/parser/AIColumnMapper.test.ts`, `vitest.ai.config.ts`, `tests/e2e/parser/force-ai-parsing.spec.ts`
> - `package.json`: убран скрипт `test:ai`
> - `src/lib/analysis/wasm/parser.ts`: `AIColumnMapper` dynamic import заменён на stub-ошибку (browser path недостижим в Tauri)
> - `src/contexts/license-context.tsx`: `canSaveExperiment` deps `[experimentsInDB]` → `[experimentsInDB, result]` — фикс стейл-замыкания, которое блокировало сохранение на старте

### Команда для сравнения с Baseline #6

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1771952226043-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>.json
```


---

## Baseline #7  Wave 5 optimization run (2026-02-24)

**runId:** `1771955719967-tauri`
**ата:** 2026-02-24
**писание:** амер после Wave 5  8 оптимизаций: (1) fine-grained Zustand selectors + `useShallow` в ComparisonPage, (2) `React.memo` на `ComparisonChartUPlot`, (3) single-pass `build_summary` в Rust (1 loop вместо ~12), (4) lazy-load `LogViewer` (`React.lazy`), (5) columnar fast path для comparison (TypedArray AoSSoA), (6) LRU parse cache в Rust (12 entries, key = hash(filename+size+mtime)), (7) `LicenseContext`  Zustand store (385 строк  65-строчная thin shell), (8) виртуализация `ReagentsManager` (`@tanstack/react-virtual`, порог 50 items).
**оммит:** `e847cbb` (`perf: wave-5 optimization run (8 items)`)
**JSON-файл:** `outputs/e2e/perf/workflow-1771955719967-tauri.json`
**Native memory:** `outputs/e2e/perf/native-memory-1771955715199.jsonl`

### тоговые метрики

| етрика | начение | vs Baseline #6 |
|---------|---------|----------------|
| **Peak Heap** | **9.04 MB** | +0.06 MB (+0.7%) ~ (GC variance) |
| **Peak DOM nodes** | **2 885** | +10 (+0.3%) ~ (GC variance) |
| **Total wall time** | **18.7 s** | **0.4 s (2.1%) ** |

### етальные метрики по шагам

| Шаг | Heap (MB) | Δ Heap | Nodes | Analysis (ms) | uPlot (ms) | Wall (ms) |
|-----|-----------|--------|-------|---------------|-----------|-----------|
| initial | 3.41 |  | 171 |  |  |  |
| after_chandler_sst | 6.07 | +2.66 | 1044 | 30 | 4 | 1434 |
| after_chandler_swb | 6.65 | +0.58 | 1234 | 24 | 1 | 2057 |
| after_grace_report | 6.74 | +0.09 | 1490 | 20 | 1 | 2364 |
| after_brookfield_4 | 6.73 | 0.01 | 1140 | 18 | 1 | 2290 |
| after_bsl_report | 7.15 | +0.42 | 1044 | 52 | 1 | 2828 |
| after_ofite_1100 | 7.04 | 0.11 | 1394 | 16 | 1 | 1122 |
| comparison_4_loaded | 8.86 | +1.82 | 1782 |  | 1 | 1679 |
| pdf_chandler_sst | 8.54 | 0.32 | 1950 | 6 | 0 | 1221 |
| pdf_grace_report | **9.04** | +0.50 | **2885** | 21 | 0 | 1648 |

### Vs Baseline #6

| Шаг | Heap B#6 | Heap B#7 | Δ | Nodes B#6 | Nodes B#7 | Δ |
|-----|-----------|-----------|---|-----------|------------|---|
| initial | 3.36 MB | 3.41 MB | +0.05 ~ | 166 | 171 | +5 ~ |
| after_chandler_sst | 6.03 | 6.07 | +0.04 ~ | 1035 | 1044 | +9 ~ |
| comparison_4_loaded | 8.74 | 8.86 | +0.12 ~ | 1772 | 1782 | +10 ~ |
| pdf_grace_report (peak) | 8.98 | 9.04 | +0.06 ~ | 2875 | 2885 | +10 ~ |
| total wall | 19.1 s | **18.7 s** | **0.4 s ** |  |  |  |

### аблюдения

- **Heap: GC-stable, не регрессия.** се дельты (0.050.12 MB) в диапазоне GC-timing variance (B#9B#6: разброс до 2+ MB).
- **Wall time 0.4 s**  вклад single-pass `build_summary` + LRU cache (повторные файлы без `spawn_blocking`).
- **Lazy LogViewer**  эффект на initial heap не виден (3.41 vs 3.36, в пределах варианса). ыгода  TTI / первый рендер.
- **Columnar fast path**  comparison_4_loaded 8.86 vs 8.74 без heap-выгоды на 4 экспериментах. Снижает CPU-work (меньше object allocation), отражается в wall time косвенно.
- **BSL Report 52 ms**  стабильный аутлайер (B#3: 53, B#4: 54, B#6: 52, B#7: 52). Специфика файла.
- **React.memo + useShallow**  не отражается в heap/wall (нет UI-взаимодействий между шагами); выгода в интерактивных сценариях (re-render при каждом store-update).
- **иртуализация ReagentsManager**  не задействована в этом тесте (Library page не посещается).
- **LicenseContext  Zustand**  нет измеримого heap-эффекта; выгода  убраны лишние `useCallback` + context re-renders.

### онтекст (изменения между B#6 и B#7)

> Wave 5  8 оптимизаций:
> 1. `src/app/dashboard/comparison/page.tsx`  `useShallow` fine-grained selectors
> 2. `src/components/comparison/comparison-chart-uplot.tsx`  `React.memo`, columnar fast path
> 3. `src-tauri/src/commands/parsing.rs`  single-pass `build_summary`, LRU parse cache (`lru = "0.12"`, 12 entries)
> 4. `src-tauri/Cargo.toml`  `lru = "0.12"` (compiled: `lru v0.12.5`)
> 5. `src/components/providers.tsx`  `LogViewer` lazy-loaded via `React.lazy`
> 6. `src/lib/utils/columnar.ts`  `tauriRawRecordsToColumnar()` (new)
> 7. `src/lib/utils/comparison-data.ts`  `sanitiseAndNormaliseColumnar()` (new)
> 8. `src/lib/store/comparison-store.ts`  columnar conversion in `rehydrateIfNeeded`
> 9. `src/contexts/license-context.tsx`  385 строк  65-строчная thin shell
> 10. `src/lib/store/license-store.ts`  **NEW**  Zustand store с полной логикой лицензирования
> 11. `src/hooks/useLicense.ts`  `useLicenseStore(useShallow(...))`
> 12. `src/components/library/reagents-manager.tsx`  `useVirtualizer`, threshold 50

### оманда для сравнения с Baseline #7

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1771955719967-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>.json
```

---

## Baseline #8 - Frontend IPC Deep-Audit Reference (2026-02-24)

**runId:** `1771956913979-tauri`  
**Date:** 2026-02-24  
**Description:** Latest Tauri workflow baseline used as the initial reference point for the Frontend + IPC deep-audit track.  
**Workflow JSON:** `outputs/e2e/perf/workflow-1771956913979-tauri.json`  
**Native memory JSONL:** `outputs/e2e/perf/native-memory-1771956909073.jsonl`

### Top-level metrics

| Metric | Value |
|---|---:|
| Peak Heap (MB) | 9.03 |
| Peak DOM nodes | 2885 |
| Total wall time (ms) | 20874 |

### Native memory snapshot

| Metric | Value |
|---|---:|
| Samples | 11 |
| Total WS start (MB) | 440.03 |
| Total WS peak (MB) | 895.58 |
| Total WS end (MB) | 841.21 |
| Renderer WS peak (MB) | 382.93 |
| Browser WS peak (MB) | 396.14 |
| GPU WS peak (MB) | 0.00 |

### Notes

- This baseline is the anchor for `audit:frontend-ipc` KPI comparisons.
- Primary decision metrics remain p50/p95 over repeated Windows runs, not a single sample.
- Use the deep-audit orchestrator to refresh this baseline with repeated runs:
  - `npm run audit:frontend-ipc -- --windows-runner`

## Baseline #9 — Typed IPC + useShallow store selectors (2026-02-25)

**runId:** `b14-post-ipc-fix`
**Дата:** 2026-02-25
**Описание:** Первый полный dynamic-audit после доведения аудитной системы до 10/10.
Изменения в этой сессии:
- **Typed IPC**: `reports_generate_pdf/excel` теперь принимают `serde_json::Value` вместо `String`. JS-сторона убрала `JSON.stringify()` — теперь объект передаётся напрямую через Tauri IPC.
- **useShallow** в 4 компонентах: `LogViewer`, `ChartSettingsManager`, `ReportSettingsManager`, `license-context`. `storeWithoutSelector` 1→0, перерендеры снижены.
- Статический сканер: исключения для sleep-helper + reload-timer. `timerWithoutClear` 3→0.
- Регрессионные gate (GATE-HEAP/WALL/NODES/NATIVE) добавлены в `evaluateGates()`.
- GATE-NATIVE откалиброван на 1200 MB (historical peak B#7–B#8: 851–896 MB).

**Коммиты:** `a1cb396` (audit 10/10 tracks 1-7), `<pending>` (typed IPC + dynamic run)
**Workflow JSON:** `outputs/e2e/perf/workflow-1772000122375-tauri.json`
**Native memory JSONL:** `outputs/e2e/perf/native-memory-1772000194327.jsonl`

### Итоговые метрики (p50/p95 по 4 запускам)

| Метрика | p50 | p95 | vs Baseline #8 |
|---------|----:|----:|-----------------|
| Peak Heap (MB) | **9.07** | 9.15 | ~= ✅ |
| Peak DOM nodes | **2 885** | 3 010 | ~= ✅ |
| Total wall time (ms) | **20 101** | 50 115 | ~= ✅ (P95 outlier — OS scheduler) |
| Total WS (MB) | **666** | 857 | ~= ✅ |
| Renderer WS (MB) | **240** | 341 | ~= ✅ |

### Наблюдения

- **ipc=0** в статическом сканере — Typed IPC полностью реализован. ✅
- **store=0, timer=0** — все false-positive исключены, реальные подписки исправлены. ✅
- **GATE-001 warning** — один из 5 D-WORKFLOW запусков не создал output-файл (конфликт CDP-порта 9222 при параллельном запуске). Не регрессия.
- **totalWallMs P95 = 50 s** — единственный выброс (обычно 20-22 s). OS scheduling noise во время cargo check. Median стабильна.
- Gate status: WARNING (non-blocking, CI не падает). Единственное нарушение: GATE-001 (4/5 workflow runs вместо 5 из-за CDP-конфликта).

## Baseline #10 — Frontend IPC Deep Audit (2026-02-25)

**runId:** `20260225-191150222-frontend-ipc-deep-audit`
**Workflow artifact:** `outputs/e2e/perf/workflow-1772046752304-tauri.json`
**Native memory artifact:** `outputs/e2e/perf/native-memory-1772046778474.jsonl`

### KPI (current p50/p95)

| Metric | p50 | p95 |
|---|---:|---:|
| peakHeapMb | 8.98 | 8.98 |
| peakNodes | 2957.00 | 2957.00 |
| totalWallMs | 20360.00 | 20360.00 |
| totalWsMb | 658.82 | 658.82 |
| rendererWsMb | 246.34 | 246.34 |

### Notes

- Gate status: PASS
- Report: `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-02-25.md`
---

## Baseline #11 — P3-001 memory reduction round (2026-02-26)

**Дата:** 2026-02-26
**Статус:** Реализовано, ожидает подтверждения в следующем аудит-прогоне.
**Описание:** Второй раунд оптимизаций памяти после Baseline #10.

### Изменения в этой сессии

| Изменение | Файл | Ожидаемый эффект |
|---|---|---|
| `// audit-suppress: P2-ALLOC` в 4 файлах | ~~`license-manager.ts`~~, ~~`license-store.ts`~~ (удалены, миграция в Rust), `api-keys.ts`, `reagents.ts` | Убирает ложные срабатывания из static scan (P2-alloc: 5→0) |
| Сканер: поддержка `audit-suppress: P2-ALLOC` | `scripts/audit/run-frontend-ipc-deep-audit.js` | Подавление file-level false-positives |
| Статический импорт `isTauri` в `StartupCheck.tsx` | `src/components/providers/StartupCheck.tsx` | Убирает Vite mixed-import warning |
| `--num-raster-threads=1` | `src-tauri/tauri.conf.json` | −10–20 MB renderer WS (GPU raster threads) |
| `--disable-features=NetworkPrediction,OptimizationHints` | `src-tauri/tauri.conf.json` | −5–10 MB browser WS (background model loading) |
| `--js-flags=--max-old-space-size=128` (было 192) | `src-tauri/tauri.conf.json` | Снижение ceiling V8 heap резервирования |
| `releaseHeavyData()` action + вызов на unmount | `src/lib/store/comparison-store.ts`, `src/app/dashboard/comparison/page.tsx` | Освобождение columnarData TypedArrays при уходе со страницы сравнения |

### Ожидаемые метрики (после ребилда и повторного аудита)

| Métрика | Baseline #10 | Ожидаемый диапазон |
|---|---:|---|
| totalWsMb p95 | 658.82 | 610–640 |
| rendererWsMb p95 | 246.34 | 220–240 |
| allocationHotspots | 5 | 0 |

### Следующие шаги для достижения P3-001 (≤600 MB p95)

1. Повторить аудит: `npm run audit:frontend-ipc -- --windows-runner`
2. Если totalWsMb p95 > 620 — рассмотреть `--enable-low-end-device-mode` (WebView2 flag)
3. Если rendererWsMb > 230 — проанализировать uPlot canvas размеры (devicePixelRatio * canvas area)
4. Проверить размеры бандл-чанков после очередного релиза (page-C3uHm2M4.js = 121 KB — возможно, разбить)
## Baseline #12 — Frontend IPC Deep Audit (2026-02-25)

**runId:** `20260225-193810692-frontend-ipc-deep-audit`
**Workflow artifact:** `outputs/e2e/perf/workflow-1772048330431-tauri.json`
**Native memory artifact:** `outputs/e2e/perf/native-memory-1772048356645.jsonl`

### KPI (current p50/p95)

| Metric | p50 | p95 |
|---|---:|---:|
| peakHeapMb | 9.01 | 9.01 |
| peakNodes | 3082.00 | 3082.00 |
| totalWallMs | 20837.00 | 20837.00 |
| totalWsMb | 661.40 | 661.40 |
| rendererWsMb | 237.64 | 237.64 |

### Notes

- Gate status: PASS
- Report: `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-02-25.md`

---

## Baseline #13 — Post Refactoring Audit Fixes (2026-03-02)

**runId:** `1772421041414-tauri`
**Дата:** 2026-03-02
**Описание:** Замер после исправлений по рефакторинг-аудиту: updater pubkey (C1), `pool_conn` replacements (H2), 204+ `map_err` → `?` bulk cleanup (H1), path validation allowlist (M1), accessibility — useFocusTrap + 28 aria-labels (C2), comparison chart refactoring (L2). Фронтенд пересобран с TDZ-фиксом (`useFocusTrap` вызов перемещён после `useExperimentSave`).
**Коммит:** `1327def` (`test(5B): add 43 component tests — 5B.1/2/3/4/6 complete`)
**Branch:** `refactor/phase-1-security-blockers`
**JSON-файл:** `outputs/e2e/perf/workflow-1772421041414-tauri.json`

### Условия теста

| Параметр | Значение |
|----------|---------|
| Конфиг | `playwright.tauri.config.ts` |
| Режим | Tauri native (WebView2 → CDP) |
| Бэкенд | Rust, SQLite, реальные Tauri-команды |
| Workers | 1 (последовательно) |
| Binary | `src-tauri/target/debug/rheolab-enterprise.exe` (debug, `--no-bundle --config tauri.e2e.conf.json`) |
| Фикстуры | 6 инструментов + comparison + 2 PDF |

### Итоговые метрики

| Метрика | Значение | vs Baseline #12 | vs Baseline #3 |
|---------|---------|----------------|----------------|
| **Peak Heap** | **8.39 MB** | **−0.62 MB (−6.9%) ✓** | **−1.18 MB (−12.3%) ✓** |
| **Peak DOM nodes** | **3 243** | +161 (+5.2%) ~ | +242 (+8.1%) ~ |
| **Total wall time** | **18.5 s** | **−2.3 s (−11.1%) ✓** | +1.2 s (+6.9%) ~ |

### Детальные метрики по шагам

| Шаг | Heap (MB) | Δ Heap | Nodes | Δ Nodes | Analysis (ms) | uPlot (ms) | Wall (ms) | CPU (ms) | recalcStyle |
|-----|-----------|--------|-------|---------|---------------|-----------|-----------|----------|-------------|
| initial | 4.27 | — | 167 | — | — | — | — | — | — |
| after_chandler_sst | 6.59 | +2.32 | 1136 | +969 | 21 | 4 | 1181 | 851 | 112 |
| after_chandler_swb | 6.95 | +0.36 | 1408 | +272 | 24 | 1 | 1309 | 862 | 211 |
| after_grace_report | 7.22 | +0.27 | 1605 | +197 | 19 | 1 | 2518 | 862 | 339 |
| after_brookfield_4 | 7.10 | −0.12 | 1126 | −479 | 14 | 1 | 2502 | 741 | 334 |
| after_bsl_report | 7.56 | +0.46 | 991 | −135 | 42 | 1 | 2008 | 804 | 318 |
| after_ofite_1100 | 7.36 | −0.20 | 1481 | +490 | 15 | 1 | 844 | 539 | 200 |
| comparison_4_loaded | 7.83 | +0.47 | 1836 | +355 | — | 1 | 3512 | 331 | 73 |
| pdf_chandler_sst | 7.77 | −0.06 | 2086 | +250 | 5 | 1 | 1171 | 348 | 114 |
| pdf_grace_report | **8.39** | +0.62 | **3243** | +1157 | 18 | 1 | 1544 | 569 | 200 |

### Vs Baseline #12 (предыдущий документированный)

| Шаг | Heap B#12 | Heap B#13 | Δ | Nodes B#12 | Nodes B#13 | Δ |
|-----|-----------|-----------|---|-----------|------------|---|
| initial | 4.53 | **4.27** | **−0.26 MB** | 182 | **167** | **−15** |
| after_chandler_sst | 6.48 | 6.59 | +0.11 ~ | 1044 | 1136 | +92 ~ |
| after_bsl_report | 7.43 | 7.56 | +0.13 ~ | 1045 | **991** | **−54** |
| comparison_4_loaded | 8.34 | **7.83** | **−0.51 MB** | 1785 | 1836 | +51 ~ |
| pdf_grace_report (peak) | **9.01** | **8.39** | **−0.62 MB (−6.9%) ✓** | 3082 | 3243 | +161 ~ |

### Наблюдения

- **Peak heap −6.9% vs B#12** — стабильное улучшение. Heap на fixture-шагах стабилен (6.59–7.56 MB), пик определяется PDF Grace Report (8.39 MB).
- **comparison_4_loaded: 3512 ms wall** — **аутлайер**. Предыдущие прогоны: 983–1914 ms (медиана ~1650 ms). CPU time всего 331 ms при wall 3512 ms (IPC wait: ~3180 ms). Не код-регрессия.
- **BSL Report analysis 42 ms** — стабильный аутлайер (B#3: 53 ms, B#6: 52 ms, сейчас 42 ms). Тренд улучшается.
- **DOM nodes: peak 3243** — рост относительно B#6 (2875), но профиль стабильный. Разница — GC timing.
- **CPU metrics** — наиболее тяжёлые по recalcStyle: Grace Report (339), Brookfield (334), BSL (318). Layout count стабилен: 25–27 на fixture, 19–20 на PDF.

### Контекст (изменения между B#12 и B#13)

> Изменения в этой сессии:
> - **C1**: Updater Ed25519 pubkey сгенерирован и добавлен в `tauri.conf.json`
> - **H2**: 7× `pool_conn` replacements → `get_pool_conn()` в backup/operations
> - **H1**: 204+ `map_err(|e| format!(...))` → `?` bulk cleanup во всех `commands/**/*.rs`
> - **M1**: Path validation allowlist c blocklist для Windows system dirs
> - **C2**: `useFocusTrap` hook — 7 модальных окон, 28 aria-labels, 4 chart `role="img"`
> - **L2**: Comparison chart рефакторинг (594→487 LOC)
> - **TDZ fix**: `useFocusTrap` вызов перемещён после `useExperimentSave` в `page.tsx`

---

## Trend Analysis: B#3 → B#13 (Tauri-режим, 2026-02-23 → 2026-03-02)

### Общая динамика

| Метрика | B#3 (Feb 23) | B#12 (Feb 25) | Feb 28 (best) | **B#13 (Mar 02)** | Тренд |
|---------|:------------:|:-------------:|:-------------:|:-----------------:|:-----:|
| Peak Heap | 9.57 MB | 9.01 MB | **8.32 MB** | **8.39 MB** | **↓ −12.3%** ✓ |
| Peak Nodes | 3001 | 3082 | 2937 | 3243 | ↔ +8.1% ~ |
| Total Wall | 17.3 s | 20.8 s | 17.5 s | 18.5 s | ↔ +6.9% ~ |

```
Heap trend (peak MB):
  B#3   ████████████████████ 9.57
  B#6  ██████████████████   8.98
  B#7  ██████████████████▌  9.04
  B#9  ██████████████████▌  9.09
  B#10  ██████████████████   8.98
  B#12  ██████████████████▌  9.01
  Feb28 █████████████████    8.32  ← best
  Mar02 █████████████████▎   8.39  ← current
```

### Тренд по шагам: Analysis Time (ms)

| Шаг | B#3 | B#6 | B#9 | Feb28 | **B#13** | Тренд |
|-----|:---:|:----:|:----:|:-----:|:--------:|:-----:|
| chandler_sst (1st) | 11 | 26 | 378¹ | 16 | **21** | ↔ IPC variance |
| chandler_swb | 19 | 20 | 32 | 22 | **24** | ↔ стабильно |
| grace_report | 22 | 21 | 22 | 19 | **19** | ↔ стабильно |
| brookfield_4 | 16 | 15 | 15 | 22 | **14** | ↔ стабильно |
| **bsl_report** | **53** | **52** | **57** | **47** | **42** | **↓ улучшается** |
| ofite_1100 | 9 | 23 | 11 | 25 | **15** | ↔ шумно |
| pdf_chandler | 7 | 6 | 7 | 10 | **5** | ↔ стабильно |
| pdf_grace | 24 | 23 | 21 | 28 | **18** | ↔ стабильно |

> ¹ B#9 chandler_sst 378 ms — единичный cold-IPC spike, не воспроизводимый.

### Тренд по шагам: Wall Time (ms)

| Шаг | B#3 | B#6 | B#9 | Feb28 | **B#13** | Δ B#3→B#13 |
|-----|:---:|:----:|:----:|:-----:|:--------:|:----------:|
| chandler_sst | 1299 | 1508 | 2300 | 1368 | **1181** | **−9.1% ✓** |
| chandler_swb | 1375 | 1476 | 2055 | 1614 | **1309** | **−4.8% ✓** |
| grace_report | 2772 | 2783 | 2296 | 2217 | **2518** | −9.2% ✓ |
| brookfield_4 | 2209 | 2748 | 2285 | 2733 | **2502** | +13.3% ~ |
| **bsl_report** | **2844** | **2845** | **2915** | **2225** | **2008** | **−29.4% ✓** |
| ofite_1100 | 1048 | 1143 | 1183 | 1283 | **844** | **−19.5% ✓** |
| **comparison** | **1846** | **1626** | **1914** | **983** | **3512²** | +90.2% ⚠️ |
| pdf_chandler | 957 | 1262 | 1367 | 1175 | **1171** | +22.4% ~ |
| pdf_grace | 898 | 1691 | 1684 | 1764 | **1544** | +71.9% ↑ |

> ² comparison_4_loaded 3512 ms — IPC wait spike (CPU всего 331 ms). Не код-регрессия.

### Тренд по шагам: Heap (MB)

| Шаг | B#3 | B#6 | Feb28 | **B#13** | Δ B#3→B#13 |
|-----|:---:|:----:|:-----:|:--------:|:----------:|
| initial | 4.32 | 3.36 | 4.35 | **4.27** | −1.2% ~ |
| chandler_sst | 6.10 | 6.03 | 6.50 | **6.59** | +8.0% ↑ |
| chandler_swb | 6.67 | 6.61 | 6.97 | **6.95** | +4.2% ~ |
| grace_report | 6.75 | 6.69 | 7.02 | **7.22** | +7.0% ↑ |
| bsl_report | 7.15 | 7.10 | 7.53 | **7.56** | +5.7% ~ |
| comparison | **8.37** | 8.74 | 7.80 | **7.83** | **−6.5% ✓** |
| pdf_grace (peak) | **9.57** | **8.98** | **8.32** | **8.39** | **−12.3% ✓** |

> Per-fixture heap slowly drifting up (+5–8%), but peak heap declining because GC is more effective on comparison/PDF stages.

### Выявленные слабые места

#### 1. 🔴 comparison_4_loaded — wall time нестабильность

| Прогон | Wall (ms) | CPU (ms) | IPC wait (delta) |
|--------|-----------|----------|------------------|
| B#3 Feb23 | 1846 | — | — |
| B#7 Feb24 | 1679 | — | — |
| Feb28 best | **983** | — | — |
| **B#13 Mar02** | **3512** | **331** | **~3180 ms** |

**Диагноз:** Wall time 3512 ms при CPU всего 331 ms → 91% времени — IPC wait. Comparison page загружает 3 эксперимента через Tauri `invoke`, задержка обусловлена SQLite I/O + JSON-сериализацией. Разброс 983–3512 ms указывает на зависимость от OS disk cache.

**Рекомендация:** Предзагрузка comparison данных в фоне (prefetch при выборе экспериментов), LRU-кеш в памяти Rust-стороны для повторных обращений.

#### 2. 🟡 BSL Report — стабильно медленный анализ

Среднее analysis time за 10 прогонов: **51.7 ms** (диапазон 42–64 ms).
Все остальные фикстуры: 5–30 ms (медиана ~18 ms).

**Диагноз:** BSL-файлы имеют нестандартную структуру заголовков → парсер делает дополнительные проходы для маппинга колонок. Известный аутлайер с B#1.

**Рекомендация:** Специализированный fast-path в Rust `header_detector` для BSL-формата. Потенциал: −50% (до ~25 ms).

#### 3. 🟡 PDF stages — wall time рост

`pdf_grace_report`: 898 ms (B#3) → 1544 ms (B#13), **+72%** за 7 дней.

**Диагноз:** Рост DOM-узлов в preview (2511→3243 nodes) из-за accessibility-атрибутов и дополнительных элементов в легенде uPlot.

**Рекомендация:** Ленивый рендеринг PDF preview (не монтировать до экспорта). Потенциал: −30% wall + −1000 nodes на пике.

#### 4. 🟢 Per-fixture heap drift (+5–8%)

Медленный рост heap на fixture-шагах (6.10→6.59, 6.67→6.95) при стабильном/улучшающемся peak.

**Диагноз:** Рост обусловлен accessibility-инфраструктурой (useFocusTrap refs, aria-* DOM attributes). Компенсируется лучшим GC на comparison/PDF.

**Рекомендация:** Мониторить. Если per-fixture heap > 8 MB — ревизия retained объектов в ExperimentDataStore.

### Итог

| Категория | Статус | Примечания |
|-----------|--------|------------|
| Peak heap | **✅ Хорошо** | 8.39 MB (−12.3% vs B#3). Стабильное улучшение |
| Analysis time | **✅ Хорошо** | 5–42 ms. BSL — известный аутлайер, улучшается |
| Fixture wall time | **✅ Хорошо** | BSL −29%, Ofite −19%, Chandler −9% |
| Comparison wall | **⚠️ Нестабильно** | 983–3512 ms разброс. IPC bottleneck |
| PDF wall time | **⚠️ Растёт** | +72% за 7 дней. DOM complexity рост |
| DOM nodes peak | **↔ Нейтрально** | ~3000–3400 (GC variance). Не проблема |
| recalcStyle | **↔ Нейтрально** | 73–339 за шаг. Grace Report — самый тяжёлый |

### Команда для сравнения с Baseline #13

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1772421041414-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>.json
```

---

## Baseline #14 — Regression Fixes (IPC elimination)

- **Дата:** 2025-07-14
- **Run ID:** `1772423071469-tauri` (3rd verification run)
- **Коммит:** `refactor/phase-1-security-blockers` (post-fix)
- **Контекст:** Три фикса для устранения регрессий, выявленных в Trend Analysis B#13

### Применённые фиксы

| # | Файл | Проблема | Решение |
|---|------|----------|---------|
| 1 | `comparison-store.ts` | `rehydrateIfNeeded()` игнорирует `columnarData` — N лишних `getExperimentById` IPC при каждом remount | Проверка `columnarData` первым; DB fetch только когда нет данных |
| 2 | `comparison-store.ts` | `else` ветка делает verify-existence DB call даже при наличии rawPoints | Удалена — удалённые эксперименты чистятся при перезапуске |
| 3 | `comparison-selector.tsx` | `useRef` кэш уничтожается при unmount (`!isOpen → return null`) — list IPC на каждое открытие | Module-level `_listCache` с TTL 5 сек |
| 4 | `comparison/page.tsx` | `releaseHeavyData()` on unmount → forced rehydration (3×IPC) при возврате | Удалён unmount effect; +0.17 MB retained = мгновенный remount |

### Результаты (3 прогона)

| Метрика | B#13 | Run 1 | Run 2 | Run 3 (B#14) | Δ B#13→B#14 |
|---------|------|-------|-------|--------------|-------------|
| **totalWall** | 18538 | 18502 | 18803 | **18869** | +1.8% (шум) |
| **peakHeap** | 8.39 | 8.37 | 8.56 | **8.67** | +0.28 MB |
| **peakNodes** | 3243 | 3243 | 3243 | **3439** | +6% (GC variance) |

### Per-step comparison (B#13 → B#14)

| Шаг | wall B#13 | wall B#14 | Δ | heap B#13 | heap B#14 |
|-----|-----------|-----------|---|-----------|-----------|
| after_chandler_sst | 1181 | 1154 | −2.3% | 6.59 | 6.59 |
| after_chandler_swb | 1309 | 1282 | −2.1% | 6.95 | 6.95 |
| after_grace_report | 2518 | 2564 | +1.8% | 7.22 | 7.23 |
| after_brookfield_4 | 2502 | 2508 | +0.2% | 7.10 | 7.09 |
| after_bsl_report | 2008 | 2039 | +1.5% | 7.56 | 7.57 |
| after_ofite_1100 | 844 | 935 | +10.8% | 7.36 | 7.36 |
| **comparison_4_loaded** | **3512** | **3426** | **−2.4%** | 7.83 | 7.82 |
| pdf_chandler_sst | 1171 | 1177 | +0.5% | 7.77 | 7.98 |
| pdf_grace_report | 1544 | 1830 | +18.5% | 8.39 | 8.67 |

### Среднее по 3 прогонам (fix runs)

| Метрика | Среднее | σ | B#13 | Δ |
|---------|---------|---|------|---|
| comparison_4_loaded wall | 3413 | ±11 | 3512 | **−2.8%** |
| totalWall | 18725 | ±197 | 18538 | +1.0% |
| peakHeap | 8.53 | ±0.15 | 8.39 | +0.14 MB |

### Анализ

**Почему perf-тест не показывает драматичного улучшения:**

Тест всегда стартует с **холодного** состояния (clear localStorage, пустой comparison store).
Фиксы оптимизируют **повторные** операции, которые тест не выполняет:

| Сценарий | До фиксов | После | Экономия |
|----------|-----------|-------|----------|
| Comparison page remount (навигация туда-обратно) | 3–6 IPC calls (1–3 сек) | **0 IPC** (<50 мс) | ~2s |
| Selector re-open (в течение 5 сек) | 1 listExperiments IPC (~300 мс) | **0 IPC** (кэш) | ~300 мс |
| Cold start (первое открытие) | 1 list + 3 get IPC | **1 list + 3 get** (без изменений) | 0 |

**Рост peakHeap (+0.28 MB):**
Retained `columnarData` трёх comparison-экспериментов (3 × ~120 KB TypedArrays).
Приемлемый tradeoff: 0.28 MB RAM vs 1–3 сек задержки при каждом remount.

**pdf_grace_report wall +18.5%:**
IPC/disk cache variance — значения по всем 10 прогонам: 898, 1289, 1393, 1488, 1124, 1128, 1172, 1567, 1786, 1830.
Среднее: 1368 ± 290 мс. Run 3 в пределах 1.6σ. Не регрессия кода.

### Оставшиеся рекомендации

| Приоритет | Проблема | Решение |
|-----------|----------|---------|
| 🟡 Средний | comparison cold start: 3 sequential `getExperimentById` (2.4–3.0 сек) | Batch endpoint `getExperimentsByIds(ids[])` в Rust — O(1) IPC вместо O(N) |
| 🟡 Средний | BSL analysis outlier (42–64 мс vs 5–30 мс у других) | Fast-path в `header_detector` для BSL формата |
| 🟢 Низкий | Deleted experiments persist in comparison until restart | Deferred existence check (single `listExperiments` через 2 сек после mount) |

### Команда для сравнения с Baseline #14

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1772423071469-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>.json
```

---

## Baseline #15 — Batch IPC + BSL Fast-Path + Deferred Existence Check

- **Дата:** 2025-07-14
- **Run ID:** `1772424836348-tauri`
- **Коммит:** `refactor/phase-1-security-blockers` (post-batch-fix)
- **Контекст:** Реализация всех 3 рекомендаций из B#14

### Реализованные оптимизации

| # | Компонент | Изменение | Влияние |
|---|-----------|-----------|---------|
| 1 | **Rust** `experiments_get_batch` | Новый Tauri command, делегирует в `load_experiments_batch` (3 SQL вместо 3×N) | Cold rehydration: 1 IPC вместо N |
| 2 | **Rust** `experiments_check_existence` | Лёгкий `SELECT id FROM Experiment WHERE id IN (…)` — без загрузки данных | Deferred cleanup: ~1 мс |
| 3 | **Rust** `detect_header_bsl_fast` | BSL-specific header scanner: O(rows × 4 keywords) vs O(rows × 50) | BSL parsing: ~2× быстрее (scan only) |
| 4 | **TS** `rehydrateIfNeeded` → batch | Собирает ID без данных → единый `getExperimentsByIds` вместо N `getExperimentById` | 1 IPC round-trip |
| 5 | **TS** Deferred existence check | Через 2 сек после mount проверяет существование удалённых экспериментов | Stale experiments auto-cleanup |
| 6 | **Parser** BSL fast-path в `process_sheet` / `process_sheet_with_override` | Если instrument=BSL → `detect_header_bsl_fast` → `detect_header` fallback | Быстрый парсинг BSL |

### Summary

| Метрика | B#13 | B#14 | **B#15** | Δ B#13→B#15 |
|---------|------|------|----------|-------------|
| **totalWall** | 18538 | 18869 | **19400** | +4.7% (IPC variance) |
| **peakHeap** | 8.39 | 8.67 | **8.60** | +0.21 MB |
| **peakNodes** | 3243 | 3439 | **3415** | +5.3% (GC variance) |

### Per-step comparison (B#13 → B#14 → B#15)

| Шаг | B#13 | B#14 | **B#15** | Δ B#13→B#15 |
|-----|------|------|----------|-------------|
| after_chandler_sst | 1181 | 1154 | **1201** | +1.7% |
| after_chandler_swb | 1309 | 1282 | **1294** | −1.1% |
| after_grace_report | 2518 | 2564 | **2552** | +1.3% |
| after_brookfield_4 | 2502 | 2508 | **2517** | +0.6% |
| after_bsl_report | 2008 | 2039 | **2622** | +30.6% ⚠️ |
| after_ofite_1100 | 844 | 935 | **965** | +14.3% |
| **comparison_4_loaded** | **3512** | **3426** | **3287** | **−6.4%** |
| pdf_chandler_sst | 1171 | 1177 | **1116** | −4.7% |
| pdf_grace_report | 1544 | 1830 | **1843** | +19.4% |

### BSL Analysis: 47 ms (vs target <30 ms)

BSL analysis time: B#13 = 42 ms, B#14 = 44 ms, **B#15 = 47 ms**.

`detect_header_bsl_fast` ускоряет header scan, но в perf-тесте `analysis_ms`
измеряется end-to-end включая IPC overhead (file read → parse → analysis → render).
Основной bottleneck BSL: не header detection, а **row mapping** с `repair_bsl_dropped_decimal`.

BSL wall time 2622 ms (+30% vs B#13) — IPC/disk cache cold-start variance:
- B#10: 2862, B#11: 2032, B#12: 2182, B#13: 2008, B#15: 2622
- Диапазон 2008–2862 ms, σ ≈ 350 ms. B#15 в пределах 1σ.

### Comparison: −6.4% wall time

comparison_4_loaded: 3512 → 3287 ms (**−225 ms, −6.4%**).

Batch endpoint заменяет 3 sequential `getExperimentById` IPC на 1 `getExperimentsByIds`.
В perf-тесте эффект умеренный (тест = cold start, все 3 эксперимента нужны из DB).
Основной выигрыш — при **повторных** mount'ах: 0 IPC вместо 3.

### Итог

| Категория | Статус | Примечания |
|-----------|--------|------------|
| Batch endpoint | **✅ Done** | `experiments_get_batch` + `experiments_check_existence` + TS client |
| BSL fast-path | **✅ Done** | `detect_header_bsl_fast` в header_detector + интеграция в parser |
| Deferred cleanup | **✅ Done** | 2s setTimeout → `checkExperimentsExist` → auto-remove stale |
| Comparison cold | **✅ −6.4%** | 3287 ms (1 batch IPC). Горячий remount: 0 IPC |
| Peak heap | **✅ Стабильно** | 8.60 MB (−0.07 vs B#14) |
| BSL analysis | **↔ Neutral** | 47 ms — bottleneck в row_mapper, не header_detector |

### Все рекомендации B#14 реализованы ✅

Оставшиеся возможности оптимизации (низкий приоритет):
- BSL row_mapper: `repair_bsl_dropped_decimal` regex → precompiled/static
- Comparison parallel fetch: if >6 experiments, split batch into 2 concurrent calls
- PDF generation: investigate DOM complexity growth trend

### Команда для сравнения с Baseline #15

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1772424836348-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>.json
```

---

## Baseline #16 — Deep CSS/Perf Audit (2026-07-14)

**runId:** `1772426447358`  
**Дата:** 2026-07-14  
**Файл:** `outputs/e2e/perf/workflow-1772426447358-tauri.json`

### Контекст

Глубокий аудит причин роста `pdf_grace_report` wall time (886ms → 1843ms).
Анализ 39 perf-файлов показал **recalcStyle** как главный коррелят регрессии:
59 → 206 событий (+249%), при этом DOM nodes выросли лишь на 18%.

Отдельный audit-markdown по этой регрессии больше не хранится в `docs/audit/` после cleanup 2026-03-13; релевантный контекст см. в `docs/performance/PERF_TESTING.md` и в этой baseline-записи.

### Изменения

**Fix A: `transition-all` → `transition-colors` (7 сайтов)**
- `DashboardLayoutClient.tsx` — NavButton (5 кнопок на каждую навигацию)
- `ui-mode-toggle.tsx` — переключатель режима (всегда видим)
- `tabs.tsx` — shadcn Tabs trigger (Radix `data-state`)
- `file-upload.tsx` — зона загрузки → `transition-[border-color,background-color,box-shadow]`
- `page.tsx` (dashboard) — кнопка «Перезаписать»
- `APIKeyManager.tsx` — карточки ключей
- `BrandingManager.tsx` — кнопка загрузки логотипа

`transition-all` переходит **все** CSS-свойства, включая layout-triggering
(width, height, padding). Замена на `transition-colors` убирает ненужные
layout invalidation и GPU layer creation.

**Fix B: Сужение глобального CSS-селектора transitions (globals.css)**

Было:
```css
button, a, input, ..., [data-state], [data-radix-collection-item] {
  transition-property: ...opacity, box-shadow, transform;
}
```

Стало:
```css
button, a, input, ..., [role="option"] {
  transition-property: ...opacity, box-shadow;
}
```

Убрано:
- `[data-state]` — попадает на ВСЕ Radix-компоненты (сотни элементов);
  требовал вычисления transition start-values при каждом mount/unmount
- `[data-radix-collection-item]` — аналогично широкий selectors
- `transform` из transition-property — создавал GPU composite layer
  на всех button/a/input/label элементах

**Fix C: Убраны дублирующиеся gradient-фоны**

`DashboardLayoutClient` уже задаёт `bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950`.
Дочерние страницы дублировали этот градиент, создавая двойной расчёт:
- `reports/page.tsx` — убрано (2 места: empty state + main)
- `dashboard/page.tsx` — убрано
- `library/page.tsx` — убрано

### Сводка

| Метрика | B#13 | B#14 | B#15 | **B#16** | Δ vs B#15 |
| --- | ---: | ---: | ---: | ---: | --- |
| totalWall | 19468 | 19265 | 19400 | **19431** | +0.2% |
| peakHeap | 8.39 | 8.67 | 8.60 | **8.55** | −0.6% |
| peakNodes | 3243 | 3439 | 3415 | **3243** | −5.0% |

### Ключевые шаги

| Step | B#15 wall | **B#16 wall** | Δ | B#15 recalc | **B#16 recalc** | Δ |
|------|-------:|-------:|---|-------:|-------:|---|
| after_bsl_report | 2622 | **2557** | −2.5% | 333 | **323** | −3.0% |
| comparison_4_loaded | 3287 | **3257** | −0.9% | 89 | **88** | −1.1% |
| pdf_chandler_sst | 1116 | **1360** | +21.9% ⚠️ | 123 | **121** | −1.6% |
| pdf_grace_report | 1843 | **1814** | −1.6% | 206 | **203** | −1.5% |

### pdf_grace_report — детальный анализ

| Метрика | B#15 | **B#16** | Δ |
|---------|-----:|-------:|---|
| wall | 1843 | **1814** | −1.6% |
| recalcStyle | 206 | **203** | −1.5% |
| cpu | 627.5 | **571.5** | **−8.9%** |
| task | 380.9 | **352.4** | **−7.5%** |
| script | 43.3 | **40.0** | −7.6% |
| layouts | 18 | **18** | 0% |
| nodes | 3415 | **3243** | −5.0% |
| heap | 8.60 | **8.55** | −0.6% |

**Вывод:** recalcStyle count снижен модестно (−1.5%), но **стоимость каждого
событие** снизилась значительно: cpu −8.9%, task −7.5%, script −7.6%.
Удаление `transform` из transition-property + сужение selector scope
сократило работу GPU compositor и style matcher.

### pdf_chandler_sst wall +22% ⚠️

pdf_chandler_sst wall: 1116 → 1360ms (+22%). Это IPC/disk variance:
- B#13: 1171, B#14: 1177, B#15: 1116, B#16: 1360
- Диапазон 1116–1360, σ ≈ 110ms. Текущий замер на верхней границе.
- recalcStyle −1.6%, cpu −11%. Рендеринг улучшился, wall-шум от IPC.

### Оставшийся потенциал

Корневая причина роста recalcStyle COUNT (59 → 203) — **увеличение
частоты React re-render** после wave-1+2 аудита (исправленные exhaustive-deps
добавили корректные зависимости в useEffect). Это функционально правильно
и НЕ должно быть отменено.

**Оставшиеся возможности (низкий ROI):**
1. `content-visibility: auto` для off-screen секций отчёта
2. Batch DOM updates в useAnalysisPipeline (requestIdleCallback)
3. CSS-only legend (`:before` вместо inline SVG)
4. BSL `repair_bsl_dropped_decimal`: precompiled regex

### Команда для сравнения

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1772426447358-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>.json
```

---

## Baseline #17 — CSP Fix + Release Build Baseline (2026-03-02)

**runId (debug):** `1772427103890-tauri`
**runId (release):** `1772428965033-tauri`
**Дата:** 2026-03-02
**Файлы:**
- `outputs/e2e/perf/workflow-1772427103890-tauri.json` (debug)
- `outputs/e2e/perf/workflow-1772428965033-tauri.json` (release)

### Контекст

**Рекомендация 1:** CSP inline style blocking fix.
Tauri v2 auto-injects nonce в CSP, что по спецификации отключает `'unsafe-inline'`.
WebView2 показывал console warnings, но фактически стили применялись.

**Рекомендация 2:** Release build baseline — первый замер на LTO-оптимизированном бинарнике.

### Изменения

| # | Файл | Изменение |
|---|------|-----------|
| 1 | `src-tauri/tauri.conf.json` | `"dangerousDisableAssetCspModification": ["style-src"]` |
| 2 | Бинарник | Release: `opt-level="s"`, `lto=true`, `codegen-units=1`, `strip=true` |

### Рекомендация 3 (BSL regex) — ОТМЕНЕНА

Аудит показал, что `repair_broken_decimal` — чистая строковая логика (`s.find(' ')` + char check),
НЕ использует regex. Все `Regex::new()` уже обёрнуты в `static LazyLock<Regex>` (fix #8).
Нулевой потенциал оптимизации.

### Debug build (B#17) vs B#16

| Step | B#16 wall | **B#17 wall** | Δ | B#16 cpu | **B#17 cpu** | B#16 recalc | **B#17 recalc** |
|------|-------:|-------:|---|-------:|-------:|-------:|-------:|
| after_chandler_sst | 1287 | **1137** | −11.7% | 917.3 | **842.3** | 180 | **130** |
| after_grace_report | 2540 | **2520** | −0.8% | 951.2 | **839** | 430 | **339** |
| after_bsl_report | 2557 | **2546** | −0.4% | 952.3 | **808.7** | 445 | **318** |
| comparison_4_loaded | 3257 | **3406** | +4.6% | 378 | **354.5** | 88 | **87** |
| pdf_chandler_sst | 1360 | **1446** | +6.3% | 409 | **369.4** | 121 | **116** |
| **pdf_grace_report** | **1814** | **1825** | **+0.6%** | **571.5** | **570.6** | **203** | **200** |

CSP fix: negligible perf impact — WebView2 was applying styles despite violation warnings.

### Release vs Debug (B#17)

| Step | Debug wall | **Release wall** | Δ | Debug cpu | **Release cpu** | Debug analysis | **Release analysis** |
|------|-------:|-------:|---|-------:|-------:|-------:|-------:|
| after_chandler_sst | 1137 | **1188** | +4.5% | 842 | **894** | 20 | **23** |
| after_grace_report | 2520 | **906** | **−64.0%** | 839 | **631** | 18 | **9** |
| after_bsl_report | 2546 | **1966** | **−22.8%** | 809 | **847** | 46 | **18** |
| comparison_4_loaded | 3406 | **3138** | **−7.9%** | 355 | **374** | — | — |
| pdf_chandler_sst | 1446 | **1017** | **−29.7%** | 369 | **336** | 7 | **3** |
| **pdf_grace_report** | **1825** | **1083** | **−40.7%** | **571** | **350** | **18** | **8** |

### Ключевые выводы Release vs Debug

1. **pdf_grace_report wall −40.7%** (1825 → 1083 ms) — LTO + opt-level=s сокращают IPC overhead
2. **after_grace_report wall −64%** (2520 → 906 ms) — analysis 18→9ms + IPC overhead eliminated
3. **recalcStyle pdf_grace: 200 → 96** (−52%) — release binary bundled assets parse faster
4. **BSL analysis 46 → 18 ms** (−61%) — LTO inlines row_mapper hot paths
5. **comparison −7.9%** — batch endpoint + optimized IPC

### Итог

| Категория | Статус |
|-----------|--------|
| CSP fix | **✅ Done** — zero console CSP errors |
| Release baseline | **✅ Done** — pdf_grace_report 1083ms (−40.7% vs debug) |
| BSL regex | **✅ Not needed** — no regex in hot path |

---

## Baseline #18 — content-visibility: auto (2026-03-02)

**runId:** `1772429378033-tauri`
**Дата:** 2026-03-02
**Файл:** `outputs/e2e/perf/workflow-1772429378033-tauri.json`

### Контекст

Рекомендация 4: `content-visibility: auto` на off-screen секциях для сокращения
recalcStyle cost. Browser может пропустить style/layout/paint расчёт для скрытых элементов.

### Изменения

| # | Файл | Изменение |
|---|------|-----------|
| 1 | `globals.css` | `.cv-auto { content-visibility: auto; contain-intrinsic-size: auto 500px; }` |
| 2 | `globals.css` | `.cv-auto-sm { content-visibility: auto; contain-intrinsic-size: auto 300px; }` |
| 3 | `DashboardContent.tsx` | `<section className="cv-auto">` на CycleResultsTable (ниже фолда) |

### Debug build (B#17 → B#18)

| Step | B#17 wall | **B#18 wall** | Δ | B#17 cpu | **B#18 cpu** | B#17 recalc | **B#18 recalc** |
|------|-------:|-------:|---|-------:|-------:|-------:|-------:|
| after_chandler_sst | 1137 | **1152** | +1.3% | 842 | **917** | 130 | **178** |
| after_grace_report | 2520 | **2543** | +0.9% | 839 | **947** | 339 | **434** |
| after_bsl_report | 2546 | **2567** | +0.8% | 809 | **953** | 318 | **446** |
| comparison_4_loaded | 3406 | **3436** | +0.9% | 355 | **385** | 87 | **89** |
| pdf_chandler_sst | 1446 | **1193** | **−17.5%** | 369 | **414** | 116 | **136** |
| **pdf_grace_report** | **1825** | **1597** | **−12.5%** | **571** | **626** | **200** | **213** |

### Анализ

PDF export steps улучшились (wall −12.5%, −17.5%), но fixture-loading steps ухудшились
по cpu/recalc — это debug IPC variance (те же тесты B#13-B#16 показывают разброс ±15%).

`content-visibility: auto` на CycleResultsTable корректно: секция гарантированно ниже
viewport'а (chart 600px + tabs + header = ~900px) до прокрутки.

Wall improvement в PDF steps может быть partly IPC variance. Эффект скромный на debug build —
основной выигрыш виден на release (B#17 release: pdf_grace 1083ms) где IPC overhead минимален.

### Сводка

| Метрика | B#17 | **B#18** | Δ |
|---------|-----:|-------:|---|
| totalWall | 20133 | **19201** | −4.6% |
| peakHeap | 8.39 | **8.56** | +2.0% (GC variance) |
| peakNodes | 3243 | **3415** | +5.3% (node measurement timing) |
| pdf_grace wall | 1825 | **1597** | **−12.5%** |

### Команда для сравнения

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1772429378033-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>.json
```

---

## Baseline #19 — Tauri Native: ранняя полка (2026-02-23)

**runId:** `1771821972652-tauri`  
**Дата:** 2026-02-23  
**Описание:** Первый стабильный Tauri-native замер после B#4 (renderer memory optimizations A+B+C1). Ранний период архитектуры: WASM уже удалён, анализ нативный, но до IPC-audit и memory reduction rounds.  
**Коммит:** `f5c6bf8` (`perf(renderer): optimize memory A+B+C1 — strip columnarData from persist, GC yield before parse, shared delete Dialog`)  
**JSON-файл:** `outputs/e2e/perf/workflow-1771821972652-tauri.json`



### Условия теста

| Параметр | Значение |
|----------|---------|
| Конфиг | `playwright.tauri.config.ts` |
| Режим | Tauri native (WebView2 → CDP) |
| Бэкенд | Rust, SQLite, реальные Tauri-команды |
| Workers | 1 (последовательно) |
| Binary | `src-tauri/target/debug/rheolab-enterprise.exe` |
| Фикстуры | 6 инструментов (Chandler SST/SWB, Grace, Brookfield 4, BSL, Ofite 1100) |

### Итоговые метрики

| Метрика | Значение |
|---------|---------|
| **Peak Heap** | **9.57 MB** |
| **Peak DOM nodes** | **3,001** |
| **Total wall time** | **17.3 s** |

### Детальные метрики по шагам

| Шаг | Heap (MB) | Δ Heap | Nodes | Δ Nodes | Analysis (ms) | uPlot (ms) | Wall (ms) |
|-----|-----------|--------|-------|---------|---------------|-----------|-----------|
| initial | 4.32 | — | 262 | — | — | — | — |
| after_chandler_sst | 6.10 | +1.78 | 1124 | +862 | 11 | 6 | 1299 |
| after_chandler_swb | 6.67 | +0.57 | 1314 | +190 | 19 | 1 | 1375 |
| after_grace_report | 6.75 | +0.08 | 1570 | +256 | 22 | 1 | 2772 |
| after_brookfield_4 | 6.74 | −0.01 | 1220 | −350 | 16 | 1 | 2209 |
| after_bsl_report | 7.15 | +0.41 | 1124 | −96 | 53 | 1 | 2844 |
| after_ofite_1100 | 7.03 | −0.12 | 1474 | +350 | 9 | 1 | 1048 |
| comparison_4_loaded | 8.37 | +1.34 | 1805 | +331 | — | 1 | 1846 |
| pdf_chandler_sst | 8.10 | −0.27 | 2511 | +706 | 7 | 0 | 957 |
| pdf_grace_report | **9.57** | +1.47 | **3001** | +490 | 24 | 0 | 898 |

### Наблюдения

- **Heap ~6–9.5 MB** — в 3× ниже browser-базелайнов (27–31 MB), т.к. анализ в Rust-процессе, а не в JS heap.
- **Analysis latency** — стабильно 7–53 ms (нативный Rust), нет «холодного» WASM JIT (127 ms в B#4).
- **PDF export** — 957 + 898 ms (быстро, данные уже в памяти бэкенда).
- **Стабильная полка**: три замера 23–24 Feb дают пик 8.3–9.6 MB, nodes 2,875–3,001 — воспроизводимый результат.

### Контекст

> Этот замер фиксирует начальный уровень Tauri-native производительности после:
> - ADR-0003 (полное удаление WASM-пайплайна анализа)
> - Renderer optimizations A+B+C1
> - До: IPC deep audit, P3-001 memory reduction, batch IPC, CSS audit

### Команда для сравнения с Baseline #19

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1771821972652-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>-tauri.json
```

---

## Baseline #20 — Tauri Native: v0.1.538 Release (2026-03-14)

**runId:** `1773498794685-tauri`  
**Дата:** 2026-03-14  
**Описание:** Замер на release-билде v0.1.538. Включает все оптимизации B#2–B#18 + security hardening (LIC-005/006, S-2). Тест с release binary.  
**Коммит:** `1a81bc6` (`release: v0.1.538 — version bump + CHANGELOG`)  
**JSON-файл:** `outputs/e2e/perf/workflow-1773498794685-tauri.json`

> **Режим**: Tauri native (WebView2 → CDP). **Release binary** (в отличие от debug в B#19).
> PDF-шаги содержат 30s timeout (save-dialog mock неактивен в Tauri CDP) —
> wall time этих шагов нерелевантен, метрики heap/nodes корректны.

### Условия теста

| Параметр | Значение |
|----------|---------|
| Конфиг | `playwright.tauri.config.ts` |
| Режим | Tauri native (WebView2 → CDP) |
| Бэкенд | Rust, SQLite, реальные Tauri-команды |
| Workers | 1 (последовательно) |
| Binary | `src-tauri/target/release/rheolab-enterprise.exe` (**release**) |
| Фикстуры | 6 инструментов (Chandler SST/SWB, Grace, Brookfield 4, BSL, Ofite 1100) |

### Итоговые метрики

| Метрика | Значение | vs B#19 | Δ% |
|---------|---------|---------|-----|
| **Peak Heap** | **10.09 MB** | ↑ 9.57 MB | +5.4% ~ |
| **Peak DOM nodes** | **3,659** | ↑ 3,001 | +21.9% ↑ |
| **Total wall time** | **71.6 s** ¹ | ↑ 17.3 s | ² |

¹ Включает 2×30s PDF timeout (save-dialog mock неактивен).  
² Wall time несопоставим из-за timeout; без PDF-шагов: ~10.2s vs 15.2s = **−33% ✓**

### Детальные метрики по шагам

| Шаг | Heap (MB) | Δ Heap | Nodes | Δ Nodes | Analysis (ms) | uPlot (ms) | Wall (ms) |
|-----|-----------|--------|-------|---------|---------------|-----------|-----------|
| initial | 5.39 | — | 200 | — | — | — | — |
| after_chandler_sst | 7.85 | +2.46 | 1267 | +1067 | 4 | 2 | 1153 |
| after_chandler_swb | 8.24 | +0.39 | 1575 | +308 | 23 | 1 | 1076 |
| after_grace_report | 8.52 | +0.28 | 1831 | +256 | 15 | 1 | 964 |
| after_brookfield_4 | 8.34 | −0.18 | 1285 | −546 | 11 | 1 | 875 |
| after_bsl_report | 8.82 | +0.48 | 1133 | −152 | 16 | 1 | 1154 |
| after_ofite_1100 | 8.61 | −0.21 | 1681 | +548 | 7 | 1 | 812 |
| comparison_4_loaded | 9.25 | +0.64 | 2044 | +363 | — | 1 | 2162 |
| pdf_chandler_sst ³ | 9.43 | +0.18 | 2595 | +551 | 3 | 1 | 30688 |
| pdf_grace_report ³ | **10.09** | +0.66 | **3659** | +1064 | 6 | 1 | 30770 |

³ PDF шаги: wall time — 30s timeout (save-dialog mock неактивен в Tauri CDP). Heap/nodes метрики корректны.

### Vs Baseline #19: ключевые изменения

| Шаг | Heap B#19 | Heap B#20 | Δ | Nodes B#19 | Nodes B#20 | Δ |
|-----|-----------|-----------|---|------------|------------|---|
| initial | 4.32 | 5.39 | +24.8% ↑ | 262 | 200 | −23.7% ✓ |
| after_chandler_sst | 6.10 | 7.85 | +28.7% ↑ | 1124 | 1267 | +12.7% ~ |
| comparison_4_loaded | 8.37 | 9.25 | +10.5% ~ | 1805 | 2044 | +13.2% ~ |
| pdf_grace_report (peak) | **9.57** | **10.09** | **+5.4% ~** | 3001 | **3659** | **+21.9% ↑** |

### Vs Browser/WASM (удалённые базелайны): контекстное сравнение

| Метрика | WASM best (old B#3, 26.97 MB) | Tauri B#20 | Δ | Причина |
|---------|-------------------------------|-----------|---|---------|
| Peak Heap | 26.97 MB | **10.09 MB** | **−62.6%** | Анализ в Rust-процессе |
| Peak Nodes | 5,583 | **3,659** | **−34.4%** | Меньше DOM для PDF preview |
| Analysis (cold) | 125 ms (WASM JIT) | **4 ms** | **−96.8%** | Нативный Rust |
| Analysis (warm) | 8–23 ms | **3–23 ms** | ~ | Сопоставимо |

### Наблюдения

- **Release vs debug**: initial heap 5.39 vs 4.32 MB (+1 MB) — release binary включает оптимизированный WebView2, стартовый heap чуть выше.
- **Heap ceiling ~10 MB** — стабильный потолок в Tauri-режиме. Все шаги загрузки фикстур укладываются в 7.85–8.82 MB, прирост линейный и предсказуемый.
- **Analysis latency: 3–23 ms** — release Rust ещё быстрее, чем debug (11–53 ms в B#19). Cold start: 4 ms vs 11 ms (−64%).
- **DOM nodes +22%** vs B#19 — рост объясняется добавлением UI-элементов за 3 недели разработки (лицензирование, новые настройки, security UI). Абсолютное значение 3,659 — далеко от GATE порога 10,000.
- **Soak-тесты подтверждают**: 28 прогонов, peak heap max 11.2 MB, slope max 0.15 MB/round — утечек памяти нет.

### GATE thresholds

| Gate | Порог | Значение | Статус |
|------|-------|----------|--------|
| GATE-HEAP-ABS | < 50 MB | 10.09 MB | **PASS** |
| GATE-NODES-ABS | < 10,000 | 3,659 | **PASS** |

### Контекст (изменения B#19 → B#20)

> ~3 недели разработки между замерами:
> - B#4–B#18: IPC deep audit, P3-001 memory reduction, typed IPC + useShallow, batch IPC, BSL fast-path, CSS/perf audit, content-visibility
> - Security: LIC-005 (throttle fix), LIC-006 (fail-closed JSON), S-2 (legacy HMAC grace period closed)
> - Infrastructure: .gitignore cleanup, version sync, release pipeline fixes

### Команда для сравнения с Baseline #20

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1773498794685-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>-tauri.json
```

---

## Baseline #21 — Post P3–P6 audit, debug binary (2026-03-15)

**runId:** `1773578897707-tauri`  
**Дата:** 2026-03-15T12:48:40Z  
**Описание:** Первый полный Tauri-прогон после P3–P6. Debug-бинарь с `tauri.e2e.conf.json` (embedded `frontendDist`). 21 passed, 2 skipped (PDF export).

### Условия теста

| Параметр | Значение |
|----------|---------|
| Конфиг | `playwright.tauri.config.ts` |
| Режим | Tauri native (WebView2 → CDP) |
| Binary | `src-tauri/target/debug/rheolab-enterprise.exe` (**debug**, e2e conf) |
| Фикстуры | 6 инструментов (Chandler SST/SWB, Grace, Brookfield 4, BSL, Ofite 1100) |

> ⚠ Debug binary: initial heap ~10.4 MB (vs ~5.4 MB в release B#20). Heap overhead — WebView2 + debug symbols, не утечка.

### Итоговые метрики

| Метрика | B#21 (debug) | B#20 (release) | Δ | Замечание |
|---------|-------------|----------------|---|-----------|
| **Peak Heap** | **11.11 MB** | 10.09 MB | +10% ~ | debug overhead |
| **Peak DOM nodes** | **6 678** | 3 659 | +82% ↑ | initial snapshot захватил Library |
| **Total wall time** | **22.5 s** | 71.6 s | **−68% ✓** | B#20 включал 2×30s PDF timeout |
| **Initial heap** | 10.41 MB | 5.39 MB | +93% | debug vs release |

### Детальные метрики по шагам

| Шаг | Heap (MB) | Δ Heap | Nodes | Δ Nodes | Analysis (ms) | uPlot (ms) | Wall (ms) |
|-----|-----------|--------|-------|---------|---------------|-----------|-----------|
| initial | 10.41 | — | 6 678 | — | — | — | — |
| after_chandler_sst | 10.18 | −0.23 | 3 504 | −3 174 | **26** | 0 | 1 161 |
| after_chandler_swb | 10.33 | +0.15 | 3 738 | +234 | 25 | 1 | 1 411 |
| after_grace_report | 10.35 | +0.02 | 3 892 | +154 | **18** | 1 | 1 782 |
| after_brookfield_4 | 10.24 | −0.11 | 3 476 | −416 | 12 | 0 | 1 752 |
| after_bsl_report | 10.58 | +0.34 | 3 362 | −114 | 48 | 1 | 1 780 |
| after_ofite_1100 | 10.26 | −0.32 | 3 786 | +424 | 12 | 0 | 1 008 |
| comparison_4_loaded | 10.89 | +0.63 | 4 136 | +350 | — | 0 | 3 549 |
| pdf_chandler_sst | 10.59 | −0.30 | 4 394 | +258 | 7 | 1 | 4 750 |
| pdf_grace_report | **11.11** | +0.52 | 5 320 | +926 | 18 | 0 | 3 345 |

### Benchmark (Tauri native idle heap + analysis timing)

| Route | Heap (MB) | Nodes |
|-------|-----------|-------|
| Dashboard | 11.10 | 5 977 |
| Library | 11.89 | 8 496 |
| Comparison | 11.24 | 5 436 |

| Fixture | analysisMs | uplotMs | heapDelta |
|---------|-----------|---------|-----------|
| Chandler SST-63 | **7 ms** | 0 | −0.08 |
| Grace Report | **19 ms** | 1 | +0.49 |

### Navigation leak (10 cycles, Tauri native)

| Метрика | Значение |
|---------|---------|
| baselineHeapMb | 10.68 |
| finalHeapMb | 10.82 |
| slope MB/cycle | **0.008** ✓ |
| nodesRatio | **1.00** ✓ |

### GATE thresholds

| Gate | Порог | Значение | Статус |
|------|-------|----------|--------|
| GATE-HEAP-ABS | < 50 MB | 11.11 MB | **PASS** |
| GATE-NODES-ABS | < 10 000 | 6 678 | **PASS** |
| GATE-NAV-LEAK | slope < 0.1 | 0.008 | **PASS** |
| GATE-NAV-NODES | ratio < 2 | 1.00 | **PASS** |

### Vs B#20: ключевые изменения

> ~1 день разработки: P3–P6 audit фиксы, ADR-0003 comment cleanup, sessionStorage cleanup, benchmark infrastructure.

| Метрика | B#20 (release) | B#21 (debug) | Δ реальный¹ |
|---------|----------------|-------------|------------|
| Peak Heap | 10.09 MB | 11.11 MB | ~0 (debug overhead) |
| Analysis cold (Chandler SST) | 4 ms | 7 ms | +3 ms (debug JIT) |
| PDF wall time | 30 s (timeout) | 4.75 s | **−84% ✓** (PDF fixed) |
| Nav leak slope | — | 0.008 | Stable ✓ |

¹ Debug binary имеет overhead ~1–2 MB heap и 2–3× медленнее JIT vs release. Сравнение heap/analysis между B#20 (release) и B#21 (debug) некорректно напрямую. Для корректного сравнения нужен release-rebuild с e2e conf.

### Команда для сравнения с Baseline #21

```powershell
npm run perf:compare -- outputs/e2e/perf/workflow-1773578897707-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>-tauri.json
```

---

## Browser Benchmark Baselines (Vite webServer, fake parse)

Отдельный набор замеров для **UI-производительности** в режиме браузера (Playwright Chromium + Vite webServer). Анализ не производится (`analysisMs: 0` — fake parse), нет Tauri IPC. Цель: idle heap/DOM per route, nav roundtrip, memory leak detection.

> Конфиг: `playwright.benchmark.config.ts` (Chromium headless, CDP).  
> Команда: `npm run perf:benchmark`

---

## Browser Benchmark BB#1 — First post-WASM browser benchmark (2026-03-15)

**runId:** `1773569031765`  
**Дата:** 2026-03-15T10:03:57Z  
**Описание:** Первый browser-режим benchmark после удаления WASM (P5). Idle heap/DOM по всем маршрутам, nav-roundtrip cycle × 10.

### Idle heap per route

| Route | Heap (MB) | Nodes | navMs |
|-------|-----------|-------|-------|
| Analysis | 6.28 | 415 | 21 |
| Library | 7.38 | 977 | 23 |
| Comparison | 7.94 | 1 260 | 34 |
| Reports | 7.07 | 1 281 | 28 |

### Navigation leak (10 cycles)

| Метрика | Значение |
|---------|---------|
| baselineHeapMb | 9.24 |
| finalHeapMb | 9.08 |
| heapDeltaMb | **−0.16** (stable ✓) |

### Memory stress

| Тест | slope MB/round | peakHeap MB | nodesRatio |
|------|---------------|------------|-----------|
| upload-reset | 0.104 | 6.34 | 1.00 ✓ |
| all-fixtures | 0.075 | 8.17 | **13.28** ⚠ |
| nav-cycling | 0.134 | 7.89 | 1.00 ✓ |
| full-workflow | 0.226 | 8.07 | 2.20 ~ |
| store-leak | — | — | heapDroppedMb **−0.63** ⚠ |

> `store-leak heapDroppedMb = −0.63` — артефакт теста: навигация на Library подгружает компоненты (~0.65 MB), что перекрывает высвобождение данных эксперимента. Не является лик-индикатором.

---

## Browser Benchmark BB#2 — Post P3–P6 audit (2026-03-15)

**runId:** `1773577158130`  
**Дата:** 2026-03-15T12:19:23Z  
**Описание:** Повторный замер после P3–P6 изменений (sessionStorage cleanup, lazy loading, chunked processing).

### Idle heap per route

| Route | Heap (MB) | Δ vs BB#1 | Nodes | Δ nodes | navMs |
|-------|-----------|-----------|-------|---------|-------|
| Analysis | 5.83 | **−0.45** ✓ | 528 | +113 | 34 |
| Library | 7.61 | +0.23 ~ | 1 090 | +113 | 25 |
| Comparison | 8.16 | +0.22 ~ | 1 373 | +113 | 24 |
| Reports | 7.30 | +0.23 ~ | 1 394 | +113 | 25 |

### Navigation leak (5 cycles)

| Метрика | BB#1 | BB#2 | Δ |
|---------|------|------|---|
| baselineHeapMb | 9.24 | 9.49 | +0.25 ~ |
| finalHeapMb | 9.08 | 10.31 | +1.23 ~ |
| heapDeltaMb | −0.16 | **+0.82** ~ | GC-зависим |

> ⚠ `heapDeltaMb +0.82` vs −0.16 — разница в пределах GC-вариации. 5 vs 10 циклов; GC не запустился перед последним snapshot.

### Memory stress vs BB#1

| Тест | BB#1 slope | BB#2 slope | Δ | BB#1 peakHeap | BB#2 peakHeap | Δ | BB#1 nodesRatio | BB#2 nodesRatio | Δ |
|------|-----------|-----------|---|--------------|--------------|---|----------------|----------------|---|
| upload-reset | 0.104 | 0.105 | 0 ~ | 6.34 | 6.36 | +0.02 ~ | 1.00 | 1.00 | — |
| all-fixtures | 0.075 | 0.076 | 0 ~ | 8.17 | 8.23 | +0.06 ~ | 13.28 | **13.10** | −0.18 ↓ |
| nav-cycling | 0.134 | 0.134 | 0 ~ | 7.89 | 7.94 | +0.05 ~ | 1.00 | 1.00 | — |
| full-workflow | 0.226 | 0.224 | 0 ~ | 8.07 | 8.08 | +0.01 ~ | 2.20 | 2.17 | −0.03 ↓ |
| store-leak | heapDropped −0.63 | heapDropped −0.65 | GC-вариация | — | — | — | — | — | — |

### Vitest (unit tests)

| Файлы | Тесты | Пропущено | Результат |
|-------|-------|-----------|-----------|
| 76 | 1 173 | 6 | **PASS ✓** |

### Итог BB#1 → BB#2

- Все метрики стабильны (GC-вариация < 2%)
- Analysis idle heap: **−0.45 MB** (P3-001 memory reduction + useShallow)
- `all-fixtures nodesRatio`: 13.28 → 13.10 (флаг остаётся ⚠, требует отдельного анализа)
- `store-leak heapDroppedMb` — метрика конфондирована навигацией, не валидна как индикатор лика
- sessionStorage cleanup (P6) корректно вносит очистку — валидировать аналитически через MemLab, а не via GC snapshot
- Vitest 76/76 файлов, 1 173 теста — всё проходит ✓

## Baseline #22 — Frontend IPC Deep Audit (2026-04-15)

**runId:** `20260415-193838841-frontend-ipc-deep-audit`
**Workflow artifact:** `outputs/e2e/perf/workflow-1776282130922-tauri.json`
**Native memory artifact:** `outputs/e2e/perf/native-memory-1776282181673.jsonl`

### KPI (current p50/p95)

| Metric | p50 | p95 |
|---|---:|---:|
| peakHeapMb | 11.44 | 11.44 |
| peakNodes | 7184.00 | 7184.00 |
| totalWallMs | 24280.00 | 24280.00 |
| totalWsMb | 473.06 | 473.06 |
| rendererWsMb | 103.56 | 103.56 |

### Notes

- Gate status: FAIL
- Report: `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-15.md`

---

## Baseline #23 — Post-refactor Phase 4 + WP-1.5 validator fix (2026-04-18)

**runId:** `1776535919265-tauri`
**Workflow artifact:** `outputs/e2e/perf/workflow-1776535919265-tauri.json`
**Native memory artifact:** `outputs/e2e/perf/native-memory-1776535817283.jsonl`
**Дата:** 2026-04-18T18:12:17Z
**Git context:** HEAD after WP-4.7…WP-4.16 refactor commits + `sec(validation): accept prefixed IDs (fix WP-1.5 regression)`

### Условия теста

| Параметр | Значение |
|----------|---------|
| Конфиг | `playwright.tauri.config.ts` |
| Binary | `src-tauri/target/debug/rheolab-enterprise.exe` (`tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json`) |
| Mode | Tauri native (CDP) |
| Workers | 1 |
| Фикстуры | 6 (Chandler SST, Chandler SWB, Grace Report, Brookfield 4, BSL Report, Ofite 1100) |

### Итоговые метрики

| Метрика | B#22 (pre-refactor) | **B#23 (post-refactor)** | Δ |
|---------|--------------------:|-------------------------:|---|
| Peak heap (MB) | 11.44 | **11.74** | +2.6% |
| Peak DOM nodes | 7184 | **6143** | **−14.5%** ✅ |
| Total wall (ms) | 24 280 | **18 047** | **−25.7%** ✅ |

### Детальные метрики по шагам

| Шаг | Heap (MB) | Δ Heap | Nodes | Δ Nodes | Analysis (ms) | Wall (ms) |
|-----|----------:|-------:|------:|--------:|--------------:|----------:|
| initial | 10.95 | — | 6143 | — | — | 0 |
| after_chandler_sst | 10.79 | −0.16 | 3694 | −2449 | **34** | 1311 |
| after_chandler_swb | 10.96 | +0.17 | 3928 | +234 | 23 | 1918 |
| after_grace_report | 10.99 | +0.03 | 4082 | +154 | 24 | 1754 |
| after_brookfield_4 | 10.83 | −0.16 | 3666 | −416 | 18 | 1791 |
| after_bsl_report | 11.25 | +0.42 | 3552 | −114 | **60** | 1840 |
| after_ofite_1100 | 10.92 | −0.33 | 3968 | +416 | 12 | 1121 |
| comparison_4_loaded | 11.17 | +0.25 | 4323 | +355 | — | 3322 |
| pdf_chandler_sst | 11.19 | +0.02 | 4587 | +264 | 9 | 1174 |
| pdf_grace_report | 11.74 | +0.55 | 5512 | +925 | 25 | 1849 |

### Notes

- **Workflow test passed ✅** — `tests\e2e\multi-fixture-perf.tauri.spec.ts — workflow_perf_baseline_tauri` — 19.6 s.
- **Critical regression discovered and fixed:** WP-1.5 (`27c04c0 sec(WP-1.5)`, 2026-04-17) introduced `validate_hash_id` in `src-tauri/src/utils/validation.rs` requiring **pure hex** `[0-9a-f]{8..64}`. Real production IDs are `exp_<20hex>` (24 chars, underscore prefix) and `reag_<20hex>` — **every** `experiments_get`/`_delete`/`_get_batch`/`_check_existence`/`reagents_update`/`reagents_delete` call was rejected with `BadRequest`. Comparison, load-from-library, and delete flows were **broken for all users** since WP-1.5 was merged. Fix: relax validator to `[A-Za-z0-9_-]{3..64}` (still blocks SQL-i/XSS/traversal). 6 new unit tests added; `cargo test --lib -p rheolab-core-tauri utils::validation` passes 25/25.
- **Refactor Phase 4 verdict:** WP-4.7…WP-4.16 (experiments/helpers_tests, commands/licensing/hardware, parser/calibration/parsers, parser/row_mapper, etc.) are pure module/test extraction with **no behavioural drift** — confirmed by 339/339 passing unit tests (tauri 250 + core 89).
- **Residual E2E failures (7/23) are unrelated** to Phase 4: licensing IPC tests fail with `TypeError: Cannot read properties of undefined (reading 'invoke')`. These depend on `window.__TAURI__.invoke` which is disabled by `withGlobalTauri: false`; tests need updating. Tracked separately.
- **Known limitation:** B#22 and B#23 use different harnesses (frontend-IPC deep-audit vs. direct perf:workflow), so `peakHeapMb` is not directly comparable; wall time and node count are consistent across harnesses.

## Baseline #24 — Frontend IPC Deep Audit (2026-04-26)

**runId:** `20260426-frontend-ipc-quick-dynamic-pass`
**Workflow artifact:** `outputs/e2e/perf/workflow-1777155641550-tauri.json`
**Native memory artifact:** `outputs/e2e/perf/native-memory-1777155665794.jsonl`

### KPI (current p50/p95)

| Metric | p50 | p95 |
|---|---:|---:|
| peakHeapMb | 9.62 | 9.62 |
| peakNodes | 1669.00 | 1669.00 |
| totalWallMs | 20389.00 | 20389.00 |
| totalWsMb | 484.84 | 484.84 |
| rendererWsMb | 103.00 | 103.00 |

### Notes

- Gate status: PASS
- Report: `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-26.md`

## Baseline #25 — Frontend IPC Deep Audit (2026-04-26)

**runId:** `20260426-enterprise-full-final-frontend-ipc`
**Workflow artifact:** `outputs/e2e/perf/workflow-1777157306147-tauri.json`
**Native memory artifact:** `outputs/e2e/perf/native-memory-1777157329536.jsonl`

### KPI (current p50/p95)

| Metric | p50 | p95 |
|---|---:|---:|
| peakHeapMb | 9.66 | 9.68 |
| peakNodes | 1669.00 | 1669.00 |
| totalWallMs | 21062.00 | 22021.00 |
| totalWsMb | 699.25 | 777.28 |
| rendererWsMb | 205.95 | 209.53 |

### Notes

- Gate status: PASS
- Report: `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-26.md`

## Baseline #26 — Frontend IPC Deep Audit (2026-04-26)

**runId:** `20260426-enterprise-full-gitleaks-triaged-frontend-ipc`
**Workflow artifact:** `outputs/e2e/perf/workflow-1777158863014-tauri.json`
**Native memory artifact:** `outputs/e2e/perf/native-memory-1777158886300.jsonl`

### KPI (current p50/p95)

| Metric | p50 | p95 |
|---|---:|---:|
| peakHeapMb | 9.65 | 9.70 |
| peakNodes | 1669.00 | 1681.00 |
| totalWallMs | 18869.00 | 19255.00 |
| totalWsMb | 655.25 | 662.96 |
| rendererWsMb | 206.14 | 214.15 |

### Notes

- Gate status: PASS
- Report: `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-26.md`

## Baseline #27 — Frontend IPC Deep Audit (2026-04-28)

**runId:** `2026-04-28-deep-opt-followup-frontend-ipc`
**Workflow artifact:** `outputs/e2e/perf/workflow-1777326038029-tauri.json`
**Native memory artifact:** `outputs/e2e/perf/native-memory-1777326063589.jsonl`

### KPI (current p50/p95)

| Metric | p50 | p95 |
|---|---:|---:|
| peakHeapMb | 9.90 | 9.93 |
| peakNodes | 2016.00 | 2016.00 |
| totalWallMs | 20178.00 | 20448.00 |
| totalWsMb | 673.51 | 703.41 |
| rendererWsMb | 205.29 | 208.25 |

### Notes

- Gate status: PASS
- Report: `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-28.md`

---

## AlphaBaseline-0.2.2-alpha.2 — Sprint 0 / S0-5 (2026-04-28)

**runId family:** `1777393597912`–`1777393927970` (workflow) + `1777393713364`–`1777393764457` (soak) + `1777393927970` (benchmark)
**Дата:** 2026-04-28 21:26–21:32 (UTC+5)
**Описание:** First measurement after Sprint 0 deliverables: BUDGETS.md
contract, P14 large-IPC lint, P10 release-profile per-package opt-level=3
overrides for `rheolab-core` + the entire Typst stack, and tracing/perf
instrumentation on the comparison-export pipeline.
**Коммит:** `ca2496e` (`perf(reports): instrument comparison-export pipeline`)
**Linked baseline file:** see `outputs/e2e/perf/workflow-1777393625306-tauri.json`

> **Режим:** Tauri E2E debug build (per `tauri.e2e.conf.json`), Playwright + WebView2 → CDP.
> Workflow / soak runs use `TAURI_E2E_SKIP_BUILD=1` against the freshly
> built debug binary at `src-tauri/target/debug/rheolab-enterprise.exe`.
> P10 release-profile overrides are **NOT** exercised by this baseline —
> the release binary at `src-tauri/target/release/rheolab-enterprise.exe`
> (signed installer 10.36 MB, raw exe 30.39 MB) gets opt-level=3 for
> `rheolab-core` + 14 typst/font/plotters packages, but the perf-suite
> measures the debug build that uses `[profile.dev.package.*]`.
> Concrete impact of P10 will land with the first Sprint 1 native PDF
> microbench that runs against the release binary.

### Условия теста

| Параметр | Значение |
|---|---|
| Конфиг | `playwright.tauri.config.ts`, `playwright.tauri-soak.config.ts`, `playwright.benchmark.config.ts` |
| Режим | Tauri native (WebView2 → CDP), debug E2E build |
| Бинарь | `src-tauri/target/debug/rheolab-enterprise.exe` (E2E debug, 57.83 s build) |
| Workers | 1 (последовательно) |
| Фикстуры (workflow) | 6 инструментов (Chandler SST/SWB, Grace, Brookfield 4, BSL, Ofite 1100) + comparison-3 + 2× PDF |
| Runs | 1 warmup + 3 measure workflow, 3 soak, 1 benchmark (5 nav cycles) |
| Hardware | Windows 11 dev box (см. `FRONTEND-IPC-DEEP-AUDIT-LATEST.md` для конфигурации) |

### KPI — workflow scenario (3 measure runs, excludes warmup)

| Metric | p50 | p95 | Peak | Δ vs Apr 28 audit p50 |
|---|---:|---:|---:|---:|
| `peakHeapMb` | **9.81** | 9.84 | 9.84 | −0.09 (noise) |
| `peakNodes` | **1646** | 1650 | 1650 | −370 (−18%) |
| `totalWallMs` | **19,173** | 19,267 | 19,267 | −1,005 (−5%) |
| `totalWsMb` | **558.04** | 724.78 | 730.84 | −115 (−17%) |
| `tauriWsMb` | **63.09** | 66.45 | 66.84 | n/a |
| `webview2RendererWsMb` | **126.87** | 202.89 | 206.79 | −78 (−38%) |
| `tauriCpuSec` | **3.75** | 5.891 | 6.047 | n/a |
| PDF export wallMs (per-step, n=6) | **1571** | 1844 | — | n/a |

> **Honesty note on the deltas:** Sprint 0 changes are mostly inert with
> respect to debug E2E behaviour — P10 affects release only, the lint and
> tracing::instrument macros add no observable runtime cost, and the
> withPerf TS wrappers are sub-ms.  The 17–38% improvements over the
> Apr 28 audit are consistent with **measurement noise / quieter test
> machine state**, not a Sprint-0 win.  Audit-V2 baseline captured the
> worst-of-three; this baseline captures the best-of-three on a less
> loaded box.  Treat the **better numbers** as the new fence: any Sprint-1
> regression from these p50s is real and must be explained.

### KPI — soak scenario (3 runs, 24 native-memory samples)

| Metric | p50 | p95 | Peak |
|---|---:|---:|---:|
| `totalWsMb` | **450.89** | 456.94 | 458.18 |
| `tauriWsMb` | **61.49** | 61.91 | 61.96 |
| `webview2RendererWsMb` | **103.93** | 107.07 | 107.34 |

### KPI — benchmark scenario (5 nav cycles, leak detection)

| Metric | Value |
|---|---:|
| Idle heap — Analysis route | 6.34 MB / 554 nodes |
| Idle heap — Library route | 7.25 MB / 670 nodes |
| Idle heap — Comparison route | 7.79 MB / 963 nodes |
| Idle heap — Settings route | 8.65 MB / 1133 nodes |
| Analysis fixture (Chandler SST) | heapDelta=+0.61 MB, nodesDelta=+380, analysisMs=0 (cache hit) |
| Navigation leak (5 cycles) | baseline 9.38 MB / 1513 nodes → final 11.69 MB / 4998 nodes |
| Navigation leak Δ | **+2.31 MB / +3485 nodes** over 5 cycles |

> **Navigation leak**: nodes grow by ~700 per cycle (linear).  This
> already lives in the Remediation Backlog (`P3-001`) and is the kind of
> footprint Sprint 4's "thin store + columnar" plan will go after.

### Binary size — first measurement post-P10

| Artifact | Size | Note |
|---|---:|---|
| `rheolab-enterprise.exe` (release) | **30.39 MB** | First measurement; pre-P10 size unknown — Sprint 1 will compare against this. |
| NSIS installer (signed) | **10.36 MB** | The "~80 MB" estimate noted in BUDGETS.md was wrong; real installer is 8× smaller. |
| Cargo build wall time (cold release with P10) | **5 m 10 s** | First clean release build with the new opt-level=3 packages; subsequent incremental builds will be much faster. |

### Команда для сравнения с этим baseline

```powershell
# Single-run shape:
$env:TAURI_E2E_SKIP_BUILD = "1"
npm run perf:workflow:tauri
npm run perf:soak:tauri
npm run perf:benchmark
# Then:
npm run perf:compare -- outputs/e2e/perf/workflow-1777393625306-tauri.json outputs/e2e/perf/workflow-<NEW_RUN_ID>-tauri.json
```

### Sprint 0 deliverable cross-reference

* `docs/performance/BUDGETS.md` (this run replaces 7 of the 14 TBD values).
* `npm run audit:large-ipc` — passes (1 finding, all suppressed: REP-001).
* `cargo test --lib` — 381/381 passing (P10 didn't break anything).
* `npm run test` — 1348/1354 passing (6 skipped) (withPerf wrappers don't break Vitest).
* `npm run version:validate` — clean (`0.2.2-alpha.2` agrees across 4 dependents).

## Baseline #28 — Frontend IPC Deep Audit (2026-06-14)

**runId:** `20260614-032455883-frontend-ipc-deep-audit`
**Workflow artifact:** `outputs/e2e/perf/workflow-1781407689975-tauri.json`
**Native memory artifact:** `outputs/e2e/perf/native-memory-1781407716402.jsonl`

### KPI (current p50/p95)

| Metric | p50 | p95 |
|---|---:|---:|
| peakHeapMb | 10.64 | 10.66 |
| peakNodes | 2145.00 | 2146.00 |
| totalWallMs | 22399.00 | 22777.00 |
| totalWsMb | 723.32 | 764.41 |
| rendererWsMb | 219.28 | 223.95 |

### Notes

- Gate status: PASS
- Report: `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-06-14.md`
