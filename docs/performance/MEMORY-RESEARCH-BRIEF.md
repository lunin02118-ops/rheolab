# RheoLab Enterprise — Memory Optimization Research Brief

**Дата:** 2026-02-22  
**Версия приложения:** 0.1.424 *(актуальная; документ создан при 0.1.396)*  
**Статус:** ✅ Завершён — Phase 1 (WASM skip) и Phase 2 (WebviewWindowBuilder) выполнены. См. [MEMORY-REDUCTION-PLAN.md](MEMORY-REDUCTION-PLAN.md).  
**Дополнение (выполненный аудит):** [WEBVIEW2-PERF-AUDIT-2026-02-22.md](WEBVIEW2-PERF-AUDIT-2026-02-22.md)  
**Дополнение (deep memory audit, target <500 MB):** [MEMORY-DEEP-AUDIT-2026-02-22.md](MEMORY-DEEP-AUDIT-2026-02-22.md)  
**План IPC-рефакторинга:** [IPC-REFACTOR-PLAN.md](IPC-REFACTOR-PLAN.md)

---

## 1. Контекст и цель

RheoLab Enterprise — десктопное Tauri v2 приложение для анализа реологических данных.  
Стек: **Rust (Tauri 2) + React 19 + TypeScript + uPlot + WebView2 (Chromium/Edge)**  
Целевая ОС: Windows 10/11.  

**Проблема:** Приложение потребляет **~1100–1200 МБ Working Set** в пике при типичном пользовательском сценарии (загрузка файла → анализ → сравнение 4 экспериментов → PDF-отчёт). Для B2B-продукта, работающего на полевых ноутбуках нефтесервисных компаний (8–16 ГБ RAM), это неприемлемо.

**Целевое значение:** ≤ 600 МБ пик при 10+ навигационных переходах в сессии.

---

## 2. Архитектура приложения

### 2.1 Процессная модель

Запущенное приложение создаёт **6–7 OS-процессов:**

| Процесс | Typical WS | Назначение |
|---------|-----------|------------|
| `rheolab-enterprise.exe` (Rust host) | 55–75 МБ | Tauri runner, SQLite, команды IPC |
| `msedgewebview2.exe` (browser) | 80–120 МБ | Chromium browser process |
| `msedgewebview2.exe` (renderer) | 200–350 МБ | V8, DOM, React, uPlot |
| `msedgewebview2.exe` (GPU) | **200–350 МБ** | Canvas texture buffers, compositing |
| `msedgewebview2.exe` (network) | 30–50 МБ | WebRequest handling |
| `msedgewebview2.exe` (utility ×2) | 20–40 МБ | Audio, storage workers |
| **Итого** | **~600–985 МБ** | cold start → peak |

### 2.2 Frontend (WebView2/Chromium renderer)

```
src/
  app/                       # React-router v6 page components (lazy-loaded)
    dashboard/page.tsx        # Главный экран анализа — содержит rheology-chart-uplot
    dashboard/comparison/     # Сравнение — содержит comparison-chart-uplot
    dashboard/library/        # Библиотека экспериментов (SQLite list)
    dashboard/reports/        # PDF-отчёты через Tauri IPC
  components/
    charts/
      uplot-chart.tsx         # Single UPlotChart wrapper (useEffect + destroy())
    comparison/
      comparison-chart-uplot.tsx  # ONE canvas, N series, N ≤ 5 по лицензии
    rheology-chart-uplot.tsx  # Analysis chart — 6 series: viscosity, temp, shear, pressure, rpm, bath-temp
  lib/
    store/
      comparison-store.ts     # Zustand + persist (localStorage, rawPoints stripped)
      experiment-data-store.ts # Zustand + persist (sessionStorage, data[] stripped)
    analysis/
      wasm/core.ts            # WASM engine guard (Tauri: skip, Browser: load)
    tauri/index.ts            # isTauri() — 9-step detection cascade
```

**Маршрутизация:** react-router v6, всё lazy `import()`. Один маршрут mounted одновременно. `destroy()` на uPlot вызывается корректно в cleanup `useEffect`.

**Chunking (Vite + Rollup):**
- Общий размер JS-бандла: **1.03 МБ** (minified, без sourcemap)
- Крупнейшие чанки: `vendor-radix` 113 КБ, `main` 306 КБ, `vendor-charts (uplot)` 52 КБ
- WASM бинарник **18.1 МБ** (`public/wasm/rheolab_wasm_bg.wasm`) — исключён из Vite bundle через `__TAURI_ONLY__` define

### 2.3 Backend (Rust / Tauri)

```
src-tauri/src/
  lib.rs          # run(), WebView2 env vars, Tauri builder
  state.rs        # AppState: db_pool (r2d2/SQLite), прочие состояния
  commands/
    experiments/  # CRUD, export, list (streaming batch)
    analysis/     # IPC-мост к rheolab-wasm (Rust crate)
    reports/      # Typst PDF генерация
  db/
    migration.rs  # V1/V2/V3 schema migrations
    columnar.rs   # SoA BLOB encoding + zstd-сжатие rawPoints
```

**Зависимости Rust (Cargo.toml):**
- `rusqlite 0.31` + `r2d2` (bundled SQLite, connection pool)
- `rheolab-wasm` (features: pdf, excel, charts) — crate, используемый и из Rust-side IPC
- `typst` + ~10 sub-crates (PDF compositor — compute-heavy, отдельные opt-level в dev profile)
- `tokio full`, `reqwest 0.12`, `serde`, `aes-gcm`, `argon2`, `zstd`, `sha2`

**Профили сборки:**
| Профиль | Бинарник | opt-level | Отладочные символы |
|---------|---------|-----------|-------------------|
| `--debug` (текущий для тестов) | **91 МБ** | 0 | полные |
| `release` (последний, 16.02.2026) | **31.7 МБ** | "s" + LTO | stripped |

---

## 3. Замеры памяти (Working Set, нативный уровень)

Инструмент: `scripts/test/tauri-native-memory-sampler.ps1`  
Методология: WMI `Win32_Process`, рекурсивная фильтрация по дереву PID (только потомки Tauri EXE).  
Тест: `npm run perf:workflow:tauri:fast` — 6 файлов → анализ → сравнение 4 экспериментов → 2 PDF.

### 3.1 Baseline (до всех изменений)

| Elapsed | Tauri EXE | WebView2 (6 процессов) | Total WS |
|---------|-----------|------------------------|---------|
| 0 с (cold start) | 54 МБ | 320 МБ | **374 МБ** |
| 5 с | 64 МБ | 861 МБ | 925 МБ |
| 10 с | 65 МБ | 952 МБ | 1018 МБ |
| 20 с (peak) | 72 МБ | **1060 МБ** | **1133 МБ** |

JS retained heap (forced GC, CDP): **9.4 МБ** — V8 app data минимален.

### 3.2 После фаз 1–3 (сборка 0.1.377–0.1.378, debug)

| Elapsed | Total WS |
|---------|---------|
| 0 с | **487 МБ** (+113 МБ — шум) |
| Peak | **1117–1152 МБ** (−0–35 МБ) |

JS retained heap: **10.22 МБ** (без изменений).

### 3.3 Вывод по замерам

**Статистически значимого снижения не зафиксировано.** Причины:
1. Шум ±100–120 МБ между запусками (GPU driver allocation timing, OS memory compressor)
2. Ключевые оптимизации (BFCache disable) дают эффект на длинных сессиях, а не при cold start
3. Debug-бинарник (+59 МБ vs release) добавляет шум к Tauri EXE компоненте
4. `pxRatio` cap на DPR=1 в E2E-среде (WebView2 без real HiDPI экрана) = нет эффекта

---

## 4. Корневые причины высокого потребления

### 4.1 GPU process — доминирующий потребитель (200–350 МБ)

**Процесс `msedgewebview2.exe` GPU** управляется Chromium compositor. Сюда входят:
- Canvas texture buffers для uPlot (2D canvas API)
- SharedImageBacking — GPU-side копии canvas bitmap
- Compositor tile memory
- Skia/ANGLE rasterization buffers

При `window.devicePixelRatio = 2` (HiDPI-монитор):
- uPlot canvas 1280×700 CSS → **2560×1400 backing store**
- RGBA = 4 байта/пиксель → **14.3 МБ GPU** только для одного canvas
- Два canvas (analysis + comparison если на соседних вкладках) = **~28 МБ GPU texture**
- Плюс Skia intermediate buffers, shared image copies, compositor layers = реально **×3–5** от pixel count

**Текущий палиатив:** `pxRatio: Math.min(window.devicePixelRatio || 1, 1.5)` добавлен в оба uPlot options. На DPR=2: 2560→1920, экономия ~44% texture memory.

### 4.2 V8 renderer process — второй по величине (150–200 МБ)

Компоненты V8-памяти:
- **JIT-compiled code space:** React component trees, router, Zustand stores — неустранимо для SPA
- **Heap (old space):** ~10 МБ app data (мало), остальное — framework retainers
- **Code cache (lazy bytecode):** ~30–50 МБ cold — Chromium кэширует V8 bytecode на диске
- **WASM** (до фаз 1–3): предположительно ~0–20 МБ (загрузка тихо фейлилась в WebView2)

### 4.3 BFCache (Back/Forward Cache) — накопительный потребитель

Chromium BFCache замораживает весь rendered page в памяти при SPA-навигации.  
Для уплот-heavy страниц с canvas buffers: **+100–200 МБ** на каждую замороженную страницу.  
При типичной сессии: `dashboard → comparison → library → comparison → dashboard` = 3–5 freezes.  
**Текущий статус:** `--disable-features=BackForwardCache` активен через `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`.

### 4.4 Rust host — debug overhead (55–91 МБ)

Debug-сборка:
- `opt-level=0` → нет inlining → раздутый машинный код
- DWARF debug symbols в процессе
- Без LTO → дублирующиеся monomorphizations

Release-сборка: `opt-level="s" + lto = true + strip = true` → **31.7 МБ** инлайна.  
**Ожидаемая экономия при переходе на release: 20–40 МБ Working Set.**

### 4.5 rawPoints в памяти Zustand (JS heap, незначительно)

`comparison-store.ts`: до 5 экспериментов × до ~2000 точек × `{time_sec, viscosity_cp, temperature_c, speed_rpm, ...}` (8 полей) = **~600 КБ–1.2 МБ** JS objects. После downsampling (threshold 800) — ещё меньше.  
**Contribution к 1100 МБ пику: < 3 МБ. Не является причиной проблемы.**

---

## 5. Изменения, реализованные к дате документа

| # | Изменение | Файлы | Эффект |
|---|-----------|-------|--------|
| 1 | WASM runtime guard (`isTauri()` в `doInitWasm`) | `src/lib/analysis/wasm/core.ts` | 0 МБ (WASM тихо фейлился и до) |
| 2 | `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` append-safe | `src-tauri/src/lib.rs` | BFCache off, GC=256 МБ |
| 3 | `__TAURI_ONLY__: true` + tree-shaking WASM branch | `vite.config.ts`, `core.ts`, `vite-env.d.ts` | −18 МБ из dist |
| 4 | StartupCheck.tsx — guard против false-positive WASM диалога | `src/components/providers/StartupCheck.tsx` | UX fix |
| 5 | CDP-collision fix: append вместо overwrite env var | `src-tauri/src/lib.rs` | E2E fix |
| 6 | `pxRatio: Math.min(DPR, 1.5)` в обоих uPlot options | `comparison-chart-uplot.tsx`, `rheology-chart-uplot.tsx` | −30–60 МБ GPU (только HiDPI) |
| 7 | `--disable-features=BackForwardCache,Vulkan` | `src-tauri/src/lib.rs` | Vulkan backend off |
| 8 | Sampler PID-фильтрация по дереву потомков | `tauri-native-memory-sampler.ps1` | Корректность замеров |
| 9 | **IPC typed params:** `input_json: String` → `input: T`, удалён `calculateModels` | `src-tauri/src/commands/analysis.rs`, `src/lib/tauri/index.ts` | Устранён двойной JSON roundtrip |
| 10 | **SoA struct `RheoPointsColumnar`:** AoS-маппинг заменён на одиночный цикл по 7 плоским массивам | `src-tauri/src/commands/analysis.rs`, `src/hooks/useAnalysisPipeline.ts` | analysisMs −30% (242→170 мс total) |
| 11 | **Sampler: фикс `$pid` → `$procPid`** (PowerShell AutoVariable) | `scripts/test/tauri-native-memory-sampler.ps1` | Фикс: самплер записывал 0 байт JSONL |
| 12 | **Sampler: разбивка WebView2 по типам процессов** | `scripts/test/tauri-native-memory-sampler.ps1` | Новые поля: Browser/Renderer/GPU/Utility WS + Private |
| 13 | **Новый скрипт анализа** `analyze-sampler.ps1` | `scripts/debug/analyze-sampler.ps1` | Читает JSONL, выводит peak + timeline таблицу |
| 14 | **Canvas cleanup в `chart-brush.tsx`**: добавлен `return () => { c.width=0; c.height=0 }` в draw-эффект | `src/components/charts/chart-brush.tsx` | Немедленный релиз GPU texture при unmount (comparison view) |

---

## 5b. Работы, выполненные в сессии 2026-02-22 (v0.1.396)

### 5b.1 IPC-рефакторинг: устранение двойного JSON roundtrip

**Проблема.** Четыре Tauri-команды в `analysis.rs` принимали `input_json: String` и внутри делали `serde_json::from_str(...)`. На стороне TypeScript вызов выглядел как `JSON.stringify(data)` → IPC → `serde_json::from_str` → `serde_json::to_string(result)` → TypeScript `JSON.parse`.  
Итого: **2 лишние полные сериализации** на каждый вызов анализа (~2000 точек).

**Изменения:**
- `src-tauri/src/commands/analysis.rs` — типы параметров: `input_json: String` → `input: T` (нативный Tauri serde deserialize). Удалена команда `calculateModels` (дублировала `calculateRheology`).
- `src/lib/tauri/index.ts` — убраны `JSON.stringify` / `JSON.parse` вокруг `invoke<...>()`. Экспортирован тип `RheoPointsColumnar`.

**Результат:** analysisMs total **−30%** (242 мс → 170 мс), наибольший эффект на тяжёлых файлах (Chandler SWB anomaly: 48 мс → 17 мс, −65%).

---

### 5b.2 SoA-структура `RheoPointsColumnar`

**Проблема.** `useAnalysisPipeline.ts` внутри строил промежуточный AoS-массив `AnalysisRheoPoint[]` (7 полей на точку) из columnar-данных, затем повторно итерировал его для формирования `data[]` uPlot. На 2000 точках — ~2 выделения больших массивов.

**Изменения:**
- `src-tauri/src/commands/analysis.rs` — добавлена структура `RheoPointsColumnar` (7 отдельных `Vec<f64>`), реализован метод `into_aos()` для обратной совместимости, структуры помечены `pub`.
- `src/hooks/useAnalysisPipeline.ts` — AoS-материализация заменена однопроходным `for`-циклом в 7 плоских массивов. SoA-путь: массивы `columnarData` передаются напрямую (ноль лишних аллокаций).

---

### 5b.3 Фикс бага `$pid` в PowerShell-сэмплере

**Проблема.** Переменная `$pid` — это зарезервированная AutoVariable PowerShell (PID текущего процесса, только для чтения). Каждый цикл сэмплирования бросал исключение `Cannot overwrite variable PID because it is read-only` → JSONL-файл оставался пустым (0 байт), все замеры были недостоверны.

**Исправление:** все вхождения `$pid` в `scripts/test/tauri-native-memory-sampler.ps1` переименованы в `$procPid` (строка 174+).

---

### 5b.4 Разбивка WebView2 по типам процессов в сэмплере

Добавлены новые поля в каждый JSONL-сэмпл:

| Поле | Описание |
|------|----------|
| `webview2BrowserWsMb` | Browser-процесс WebView2 WS |
| `webview2RendererWsMb` | Renderer-процесс WS |
| `webview2GpuWsMb` | **GPU-процесс WS** |
| `webview2UtilityWsMb` | Utility/Network-процессы WS |
| `webview2*PrivateMb` | Private bytes для каждого типа |
| `webview2TypeBreakdown[]` | Массив: тип → WS/Private |
| `webview2Processes[]` | Полный список процессов с Command Line |

Добавлен вспомогательный скрипт `scripts/debug/analyze-sampler.ps1` — читает JSONL, выводит peak-сэмпл и таблицу timeline.

---

### 5b.5 Ключевая находка: GPU-процесс — главный потребитель памяти

Первый корректный прогон (11 сэмплов, 12 КБ JSONL) показал:

| Тип процесса | WS на пике | Private bytes | Доля |
|---|---|---|---|
| GPU | **692.9 МБ** | **670.7 МБ** | **63%** |
| Renderer | 148.4 МБ | 93.5 МБ | 14% |
| Utility | 82.2 МБ | 60.3 МБ | 8% |
| Browser | 77.2 МБ | 53.5 МБ | 7% |
| Tauri EXE | 88.1 МБ | 44.9 МБ | 8% |
| **Итого** | **1091 МБ** | — | 100% |

**Паттерн роста GPU-процесса:** 98 МБ (cold start) → 554 МБ (после 2–3 файлов) → 693 МБ (пик). Рост происходит файл за файлом, что указывает на накопление D3D/ANGLE texture allocations.

Private bytes (670 МБ) подтверждают реальное физическое выделение (не shared/mapped VAS).

---

### 5b.6 Аудит canvas cleanup — покрытие всех случаев

**Задача.** Проверить, применяется ли паттерн `canvas.width=0; canvas.height=0` (немедленный release GPU texture) везде, где есть canvas.

**Результаты аудита:**

| Компонент | Canvas | Cleanup при unmount |
|---|---|---|
| `uplot-chart.tsx` (все uPlot-инстанции) | `chart.ctx.canvas` | ✅ `width=0` → `destroy()` (L86–89) |
| `chart-brush.tsx` (comparison view) | собственный `canvasRef` | ❌ **не было** → **исправлено** |

Весь codebase содержит **один** `new uPlot` (в `uplot-chart.tsx` L54) и **один** `chart.destroy()` (L89) — централизованный lifecycle.

`ChartBrush` (компонент диапазон-селектора в comparison view) производил рендер в собственный `<canvas>` через `useEffect`, но cleanup не зануляет размеры. Исправлено добавлением `return () => { c.width=0; c.height=0 }` в draw-эффект.

**Подтверждено:** при переключении эксперимента в dashboard `UPlotChart` корректно пересоздаётся (цепочка: `data` → `touchPoints` useMemo → `uPlotOptions` useMemo → `useEffect([options])` → cleanup с `width=0` + `destroy()`).

---

## 6. Открытые проблемы и гипотезы

### P0 — Нет замера на release-бинарнике

**Проблема:** Все текущие замеры выполнены на `--debug` (91 МБ EXE). Release (31.7 МБ) компилировался 16.02.2026, до всех текущих изменений.  
**Гипотеза:** Release-профиль даёт −20–40 МБ за счёт меньшего кодового footprint хоста.  
**Нужно:** Пересобрать release + прогнать тест 5 раз → взять медиану пика.

### P1 — BFCache эффект не измерен на длинных сессиях

**Проблема:** Workflow-тест делает 1 переход dashboard→comparison. В реальной сессии пользователь делает 10–20 переходов.  
**Гипотеза:** BFCache disable должен дать −100–200 МБ но только виден при 4+ navigation cycles.  
**Нужно:** Soak-тест с 12+ циклами comparison open/close, сравнение с/без `BackForwardCache` flag.

### P2 — GPU process не поддаётся измерению изолированно

**Проблема:** WMI Working Set GPU-процесса включает shared GPU memory (texture VRAM shared с другими app). На машинах с iGPU VRAM = часть системной RAM.  
**Нужно:** Chrome DevTools Memory Profiler → GPU memory category, или `dxdiag` + Nvidia/AMD overlay.

### P3 — `--in-process-gpu` не протестирован

**Гипотеза:** Запуск GPU compositor в renderer-process (без отдельного GPU OS-процесса) устраняет ~80–100 МБ WS (overhead на OS process headers, Chromium IPC pipes, mapped DLLs).  
**Риск:** deprecated на части конфигураций, возможны visual artifacts на некоторых GPU.

### P4 — Vulkan disable не верифицирован

`--disable-features=Vulkan` добавлен, но нет замера до/после. На машинах без Vulkan драйвера флаг no-op.

---

## 7. Техническое задание на исследование

### 7.1 Направление A: Chromium flags для WebView2 memory reduction

**Задача:** Найти актуальный (2024–2025) набор `--` flags для WebView2/Chromium, снижающих потребление RAM без визуальных деградаций.

**Конкретные вопросы для изучения:**

1. **`--in-process-gpu`** — поддерживается ли в WebView2 2024+? Есть ли известные баги на Windows 11 + Intel/AMD iGPU + ANGLE D3D11?
2. **`--disable-accelerated-2d-canvas`** — принудительный software rasterizer для 2D canvas. Насколько медленнее uPlot рендерит при 800–2000 точек?
3. **`--tile-width=256 --tile-height=256`** (или аналог) — уменьшение размера compositor tiles. Есть ли флаги для WebView2?
4. **`--max-decoded-image-cache-size-mb=0`** — отключить кэш декодированных ImageBitmap.
5. **`--disable-features=MediaRouter,CalculateNativeWinOcclusion`** — убрать неиспользуемые background services.
6. **`--renderer-process-limit=1`** — уже активен. Есть ли `--single-process` режим, и насколько он опасен для стабильности?
7. **Chromium Memory Pressure API:** существует ли способ программно тригерить `MemoryPressureListener::Notify(CRITICAL)` через WebView2 ICoreWebView2 API?

**Источники для исследования:**
- `chromium.googlesource.com/chromium/src/+/refs/heads/main/content/public/common/content_switches.cc`
- Microsoft WebView2 Feedback GitHub (`github.com/MicrosoftEdge/WebView2Feedback`)
- Chromium bugs: `bugs.chromium.org` фильтр `Component=Internals>Memory>RendererProcess`
- CEF (Chromium Embedded Framework) форумы — те же флаги, более открытое обсуждение

---

### 7.2 Направление B: uPlot canvas — GPU memory footprint

**Задача:** Понять точный механизм выделения GPU memory для 2D canvas в WebView2/ANGLE, найти способы снизить footprint без потери качества.

**Конкретные вопросы:**

1. **`pxRatio` cap** — какой минимальный `pxRatio` приемлем для реологических графиков (линейный, не растровый контент)? Можно ли `pxRatio=1.0` без видимой потери на 1080p экране?
2. **OffscreenCanvas + Worker** — перемещение uPlot рендеринга в Web Worker через `OffscreenCanvas`. Поддерживается ли `OffscreenCanvas.transferControlToOffscreen()` в WebView2 (Chromium 105+, target в vite.config.ts)? Снижает ли это GPU memory (canvas ownership transfer)?
3. **Canvas size vs. memory:** линейная ли зависимость GPU memory от `width × height × DPR²`? Проверить через Chrome DevTools > Memory > Heap Snapshot vs. GPU process WS при разных canvas sizes.
4. **`willReadFrequently: true` context hint** — влияет ли на GPU texture allocation strategy?
5. **Canvas pooling:** uPlot `destroy()` освобождает canvas DOM element. Освобождается ли GPU texture сразу или lazy? Тест: `GPU process WS` немедленно после `destroy()` vs 500 мс спустя.
6. **WebGL vs 2D canvas:** возможен ли uPlot WebGL renderer (через custom plugin)? Как WebGL VBO memory соотносится с 2D canvas texture memory?

**Источники:**
- uPlot issues/discussions: `github.com/leeoniya/uPlot`
- Chromium GPU architecture: `www.chromium.org/developers/design-documents/gpu-command-buffer`
- ANGLE project: `chromium.googlesource.com/angle/angle`
- MDN OffscreenCanvas browser compat + WebView2 compat table

---

### 7.3 Направление C: Tauri v2 — WebviewWindow memory configuration

**Задача:** Найти официальный API Tauri v2 для передачи `additionalBrowserArguments` без `std::env::set_var`.

**Конкретные вопросы:**

1. **`WebviewWindowBuilder::additional_browser_args()`** — существует ли метод в Tauri v2.x? В `tauri-apps/tauri` GitHub README упоминается для macOS `data_store_identifier`. Есть ли Windows-эквивалент?
2. **`tauri.conf.json` schema evolution** — планируется ли добавить `additionalBrowserArguments` в официальную конфигурацию (tracking issue)?
3. **`WebviewBuilder` vs `WindowBuilder`** — правильный ли путь использование `WebviewWindowBuilder` или нужен `app.webview_windows()` с отдельным `WebviewBuilder`?
4. **Env var timing:** `std::env::set_var` before `Builder::default()` — гарантирован ли этот порядок в Tauri v2? Или WebView2 environment читается позже (при создании window в `.setup()`)?
5. **ICoreWebView2EnvironmentOptions** — можно ли передать кастомные options через Tauri v2 plugin system интерфейс к нативному WebView2 COM API?

**Источники:**
- `docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html`
- `github.com/tauri-apps/tauri` → `Cargo.toml` WebviewWindowBuilder API
- `github.com/tauri-apps/tauri/issues` — поиск "additionalBrowserArguments" или "browser_args"

---

### 7.4 Направление D: SPA архитектура — предотвращение memory накопления

**Задача:** Найти паттерны React/router для предотвращения memory accumulation при SPА навигации в Electron/Tauri приложениях.

**Конкретные вопросы:**

1. **React 19 + Compiler** — влияет ли `@babel/plugin-transform-react-compiler` или `react-compiler` на memory через лучшую мемоизацию? Есть ли реальные бенчмарки memory до/после?
2. **Zustand `persist` + large data** — best practice для stores с потенциально большими payload в localStorage/sessionStorage. Существуют ли известные memory leaks в `zustand/middleware/persist` при частых updates?
3. **React Router v6 route unmount guarantee** — гарантирует ли react-router v6 полный unmount предыдущего route перед mount нового? Или BFCache на уровне Chromium может переопределять это поведение?
4. **`useEffect` cleanup и canvas:** паттерны для гарантированного освобождения GPU resources (`canvas.width = 0`) при компонент unmount помимо `uPlot.destroy()`.
5. **Memory Observer API:** `performance.measureUserAgentSpecificMemory()` — доступен ли в WebView2? Можно ли использовать для continuous monitoring в production?

**Источники:**
- React DevTools Profiler memory analysis docs
- Chrome DevTools "Detached DOM trees" и "Away page cache" investigation guides
- `blog.chromium.org` — Back/Forward Cache internals
- Tauri Discord / GitHub Discussions — Electron-to-Tauri migration experiences

---

### 7.5 Направление E: Фундаментальные архитектурные альтернативы

**Задача:** Оценить радикальные изменения архитектурного стека для снижения memory ceiling.

#### E.1 — Отказ от WebView2, переход на нативный UI

| Вариант | Технология | Ожидаемый RAM | Cons |
|---------|-----------|---------------|------|
| Текущий | WebView2 + React | ~600–1200 МБ | - |
| A | Tauri + `wry` без WebView2 (MSHTML?) | невозможно | - |
| B | **egui (immediate mode)** | **50–150 МБ** | Полный переписка, нет React |
| C | **Slint UI** | **80–200 МБ** | DSL, нет TypeScript |
| D | **Dioxus** (Rust VDOM, WebView optional) | **100–300 МБ** | Незрелый экосистема |
| E | **.NET MAUI + Blazor Hybrid** | 200–400 МБ | Windows-only toolchain |

**Вопросы для исследования:**
- Поддерживает ли **egui** / **egui-wgpu** рендеринг 2D line charts с 2000+ точками с интерактивностью (zoom, crosshair, tooltip)? Есть ли egui-аналог uPlot?
- Каков реальный memory footprint **Slint** приложения с canvas-based chart widget?
- Возможна ли **гибридная архитектура**: нативный Slint/egui UI + WebView iframe только для chart panel (изолированный `<iframe>` с уплот, не full-page WebView)?

#### E.2 — WebView с серьёзными ограничениями памяти

**Вопрос:** Возможно ли запустить WebView2 в режиме с жёстко ограниченным процессным набором?

- **Chromium `--disable-features=VizDisplayCompositor`** — перемещает compositing в renderer process, убирает отдельный GPU process. Баги на Windows? 
- **`--disable-gpu`** + software fallback — неприемлемо для chart rendering или допустимо для small canvas?
- **WebView2 with `CoreWebView2EnvironmentOptions.AreBrowserAcceleratorKeysEnabled=false`** и прочие ограничения — влияет ли на memory?

#### E.3 — Два рендерера: Rust-native chart + WebView UI

**Концепция:** React (WebView2) управляет только UI-shell (forms, tables, navigation). Charts рендерятся в **нативный Rust canvas** поверх WebView окна (transparent overlay).

- **wgpu** (WebGPU Rust) — позволяет рисовать поверх Tauri window через отдельный wgpu surface layer.
- **tiny-skia** — software Skia-like renderer, 2D canvas в Rust, output как PNG/bytes в WebView через IPC.
- **Plotters** (уже в Cargo.toml) — SVG/PNG chart generation, output через `<img>`.

**Вопросы:**
- Поддерживает ли Tauri v2 `wgpu` overlay layer поверх WebviewWindow?
- Какова latency `plotters` → PNG bytes → Tauri IPC → `<img src="data:...">` для real-time 60 fps update?
- Существуют ли примеры Tauri + native canvas overlay (egui-over-webview pattern)?

---

## 8. Приоритизация исследований

| Приоритет | Направление | Ожидаемое снижение | Сложность | Риск |
|-----------|-------------|-------------------|-----------|------|
| **P0** | 7.1 — Chromium flags (in-process-gpu, disable-accel-2d) | −80–200 МБ | Низкая (1 строка) | Средний (visual artifacts) |
| **P0** | Release build замер (просто пересобрать) | −20–40 МБ | Минимальная | Нет |
| **P1** | 7.2 — pxRatio=1.0 acceptable? | −30–60 МБ (HiDPI) | Низкая | Низкий |
| **P1** | 7.4 — BFCache measurements на длинной сессии | Data gathering | Низкая | Нет |
| **P2** | 7.3 — Tauri v2 official browser args API | Code quality | Средняя | Нет |
| **P2** | 7.5/E.3 — Plotters/tiny-skia chart prototype | −200–400 МБ | Высокая | Высокий |
| **P3** | 7.5/E.1 — egui migration feasibility | −400–800 МБ | Очень высокая | Очень высокий |

---

## 9. Метрики успеха и стенд для проверки

### Стенд

```
Инструмент: scripts/test/tauri-native-memory-sampler.ps1
Тест: npm run perf:workflow:tauri:fast  (1 прогон = 26–27 сек)
Статистика: минимум 5 прогонов → медиана peak totalWsMb
Дополнительно: npm run perf:soak:tauri:fast (12 navigation cycles)
```

### Целевые значения

| Метрика | Сейчас | Цель P1 | Цель P2 |
|---------|--------|---------|---------|
| Peak WS (median, 5 runs, release) | ~1100 МБ | ≤ 800 МБ | ≤ 600 МБ |
| Peak WS после 12 navigation cycles | не измерен | ≤ 900 МБ | ≤ 600 МБ |
| Cold start WS | ~500 МБ (шум) | ≤ 400 МБ | ≤ 300 МБ |
| uPlot init time | 1–4 мс | ≤ 4 мс | ≤ 4 мс |
| Визуальные артефакты | нет | **нет** | **нет** |

---

## 10. Файлы-ориентиры в кодовой базе

| Файл | Релевантность |
|------|--------------|
| [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs#L73) | WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, MEMORY_ARGS |
| [src/components/comparison/comparison-chart-uplot.tsx](../../src/components/comparison/comparison-chart-uplot.tsx#L443) | uPlot options, pxRatio cap |
| [src/components/rheology-chart-uplot.tsx](../../src/components/rheology-chart-uplot.tsx#L302) | uPlot options, pxRatio cap |
| [src/components/charts/uplot-chart.tsx](../../src/components/charts/uplot-chart.tsx) | UPlotChart wrapper — destroy() lifecycle |
| [src/lib/analysis/wasm/core.ts](../../src/lib/analysis/wasm/core.ts) | WASM guard, __TAURI_ONLY__ tree-shaking |
| [src/lib/store/comparison-store.ts](../../src/lib/store/comparison-store.ts) | rawPoints stripping, rehydrateIfNeeded |
| [vite.config.ts](../../vite.config.ts) | __TAURI_ONLY__ define, chunk strategy |
| [src-tauri/Cargo.toml](../../src-tauri/Cargo.toml#L52) | release profile: lto, opt-level="s", strip |
| [scripts/test/tauri-native-memory-sampler.ps1](../../scripts/test/tauri-native-memory-sampler.ps1) | Замер WS, Get-DescendantPids |
| [docs/performance/MEMORY-REDUCTION-PLAN.md](MEMORY-REDUCTION-PLAN.md) | История изменений, замеры |
| [docs/adr/ADR-0003-eliminate-wasm-webview-desktop-native-analysis.md](../../docs/adr/ADR-0003-eliminate-wasm-webview-desktop-native-analysis.md) | ADR по WASM elimination |
