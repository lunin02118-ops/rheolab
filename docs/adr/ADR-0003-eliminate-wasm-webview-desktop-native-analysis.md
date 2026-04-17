# ADR-0003: Eliminate WASM Analysis Pipeline in WebView2 — Move to Native Rust (Tauri)

**Статус:** ✅ Реализовано  
**Дата принятия:** 2026-02-22  
**Дата завершения:** 2026-02-23 (финальная зачистка, Baseline #8)  
**Авторы:** Platform Team  
**Затронутые компоненты:** `src/lib/analysis/wasm/`, `src/workers/`, `src-tauri/src/commands/analysis.rs`, Playwright конфиги

---

## 1. Контекст

RheoLab Enterprise использовал следующий пайплайн анализа:

```
Файл Excel/CSV
  → Rust parser (IPC)
  → TypeScript WASM Worker (rheolab-wasm via WebWorker)
  → React store
```

WASM-модуль (`rheolab-wasm`) загружался внутри WebView2 через `src/lib/analysis/wasm/core.ts` и выполнял полный анализ реологии (Power Law, Bingham, Herschel-Bulkley, геометрия, temp-сдвиг). Модуль компилировался из Rust в WebAssembly отдельным крейтом `src/rust/rheolab-wasm/`.

**Проблемы:**
1. **Память:** WASM-модуль занимал 40–80 MB дополнительной heap-памяти в renderer-процессе сверх V8.
2. **Двойная сериализация:** данные JSON-сериализовались дважды (Rust→TS→WASM→TS), добавляя ~200–400 мс latency на больших датасетах.
3. **Сложность:** два независимых Rust-крейта (Tauri + WASM) с разными инструментами сборки (`wasm-pack`, `wasm-bindgen`), синхронизируемыми вручную.
4. **Нестабильность в WebView2:** WASM Worker иногда failing при инициализации в Tauri-контексте (CPU-spin bug в `waitForWasm()`).
5. **Тестируемость:** WASM-путь и Rust-путь могли давать расхождения (golden parity тесты).

---

## 2. Решение

Перенести весь пайплайн анализа в нативный Rust через существующую Tauri IPC-команду:

```
Файл Excel/CSV
  → analysis_analyze_full (Tauri IPC)  ← единственный путь
  → React store
```

**Конкретные изменения:**
- `src/lib/analysis/wasm/core.ts`: добавлен Tauri-guard — при работе в Tauri контексте WASM не загружается и не используется.
- Команда `analysis_analyze_full` в `src-tauri/src/commands/analysis.rs` покрывает полный пайплайн.
- Удалён файл `wasm-ai-bridge.ts` (WebWorker для AI-парсинга через WASM).
- Удалены устаревшие TypeScript тесты: `force-ai-integration`, `golden-ai-parity`, `wasm-ai-integration`.
- Исправлен `waitForWasm()` early-exit bug (бесконечный loop при WASM failure в Tauri).

~~**WASM-крейт остался** в репозитории (`src/rust/rheolab-wasm/`, `public/wasm/`) для поддержки браузерного режима (тестирование, демо). В Tauri-контексте он загружается но не вызывается.~~

> **2026-02-26 — Полная зачистка WASM-кода (Refactoring Phase 1):**
> Все WASM-артефакты удалены из репозитория:
> - Удалены 13 файлов из `src/lib/analysis/wasm/` (оставлены только `types.ts` и `converters.ts`, используемые нативным Tauri IPC)
> - Удалён `src/lib/analysis/wasm-engine.ts`, `src/lib/parsing/RheoParser.ts`
> - Удалены `src/workers/` (Web Workers), `public/wasm/` (WASM-бинарники)
> - Удалён `scripts/build/compress-wasm.js`
> - Удалены WASM-тесты из `tests/wasm/`, `tests/analysis/wasm/`
> - Удалён `src/contexts/license-context.tsx` (WASM-зависимый контекст лицензий)
> - `src/lib/reports/client.ts` полностью переписан: убран WASM-fallback, только Tauri-native
> - `src/lib/parsing/` — удалены WASM-пути, оставлен только Tauri IPC
> - Создан `src/lib/analysis/client.ts` — тонкий фасад поверх PlatformBridge
> - Все 467 Vitest-тестов проходят, TypeScript компилируется без ошибок.

---

## 3. Основание (Why this ADR)

**Почему нативный Rust, а не WASM:**
1. В Tauri-контексте у нас уже есть нативный Rust — нет причин делать двойной round-trip через WebAssembly.
2. Исключение WASM из renderer-процесса снижает peak Working Set на 40–80 MB (Baseline #5/#6).
3. Единый код-путь упрощает отладку, тестирование и поддержку.
4. Latency analysis_analyze_full < latency WASM Worker за счёт устранения JSON redundancy.

**Почему не удалили WASM совсем:**
- Браузерный режим (vite dev без Tauri) используется для unit-тестирования WASM-крейта.
- Плановое удаление WASM-крейта — отдельное решение, не принято в рамках этого ADR.

---

## 4. Последствия

### Позитивные
- Renderer peak MS снизился: ~390 MB → ~310–340 MB (Baseline #5, 2026-02-22).
- Устранена двойная сериализация (F1 из WEBVIEW2-PERF-AUDIT-2026-02-22).
- Упрощена CI-конфигурация (удалён `playwright.perf.config.ts` для browser WASM path).
- Команда `perf:workflow` (browser benchmark) помечена как deprecated.

### Негативные / Риски
- Browser-only режим теряет реальный анализ (fallback на мок-данные или stub).
- `rheolab-wasm` крейт должен регулярно синхронизироваться с нативным анализом.

### Нейтральные
- `public/wasm/` файлы продолжают включаться в сборку — размер bundle не изменился.
- E2E тесты теперь **требуют** Tauri контекст для полноценного покрытия анализа.

---

## 5. Связанные документы

| Документ | Связь |
|----------|-------|
| [BASELINES.md](../performance/BASELINES.md) — Baseline #5, #6, #8 | Замеры памяти до/после |
| [MEMORY-REDUCTION-PLAN.md](../performance/MEMORY-REDUCTION-PLAN.md) — Phase 1 | WASM skip = Phase 1 item |
| [WEBVIEW2-PERF-AUDIT-2026-02-22.md](../performance/WEBVIEW2-PERF-AUDIT-2026-02-22.md) — F1 | IPC double-serialization: исправлено |
| [IPC-REFACTOR-PLAN.md](../performance/IPC-REFACTOR-PLAN.md) | IPC refactor plan (п. 2.1.5 подтверждает исправление) |
| [MEMORY-RESEARCH-BRIEF.md](../performance/MEMORY-RESEARCH-BRIEF.md) | Research brief с рекомендациями |
| [RENDERER_OPTIMIZATION.md](../performance/RENDERER_OPTIMIZATION.md) | Renderer optimizations (после ADR-0003) |

---

## 6. Версии Baseline

| Baseline | Дата | Описание | WS Renderer p50 |
|----------|------|----------|-----------------|
| #4 | 2026-02-22 | Before ADR-0003 | ~390 MB |
| #5 | 2026-02-22 | Post WASM Elimination | ~310 MB |
| #6 | 2026-02-22 | First Tauri Native E2E | ~320 MB |
| #8 | 2026-02-23 | ADR-0003 Final Cleanup | ~300 MB |

---

*Документ создан: 2026-02-25 (ретроспективно — решение принято 2026-02-22)*
