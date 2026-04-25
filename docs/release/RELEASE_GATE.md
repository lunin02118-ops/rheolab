# Release Gate — обязательный E2E-чек перед релизом

> Введено 2026-04-22 вместе с Comparison Report feature (ADR-0010 Phase 5).
> Текущий спек: `tests/e2e/reports/comparison-workflow-release-gate.tauri.spec.ts`.

## 1. Зачем

Comparison Report — это первая большая фича, которая пересекает **frontend (React) → IPC → Rust (report pipeline, Typst, rust_xlsxwriter) → файловая система**. Любая регрессия в этой цепочке делает релиз непригодным, но не ловится обычным юнит-тестом или браузерным E2E (там IPC мокается).

Release Gate — это один **живой workflow-тест**, который прогоняется на настоящем Tauri-бинарнике и проверяет:

| Область | Что гарантируется |
|---------|-------------------|
| Upload & analyze | 4 разных фикстуры (Chandler SST, Grace, BSL, Ofite) проходят анализ через real Rust. |
| Experiment store | Сохранение в SQLite через `experiments_save` работает. |
| Comparison view | Selector + лицензионный лимит + multi-series uPlot chart. |
| **Report sub-tab** | Рендер новой вкладки + все 4 section-toggle + language switch. |
| **Real PDF export** | `reports_generate_comparison_pdf` возвращает корректный PDF (magic bytes, > 5 KB). |
| **Real XLSX export** | `reports_generate_comparison_excel` возвращает корректный XLSX (PK, > 5 KB). |
| Size invariants | `B ≥ A` (все секции включены → больше) и `D ≤ A` (всё выключено → меньше). |
| Memory stability | Heap не растёт больше 20 MB за 7 экспортов. |

Если gate падает — релиз блокируется. Без обходных путей кроме явного `--skip-release-gate` (и с громким warning в логах).

## 2. Когда прогонять

**ОБЯЗАТЕЛЬНО:**

1. Перед каждым `npm run release:prepare` (вызывается автоматически после `tauri build`).
2. Перед ручным деплоем на VPS через `scripts/deploy/publish-update.js`.
3. После любых изменений в:
   - `src/components/comparison/reports/*`
   - `src/lib/reports/comparison-*`
   - `src-tauri/src/commands/reports/*`
   - `src-tauri/src/commands/experiments/*`
   - `src/stores/comparison-store.ts`

**Рекомендуется:**

4. Перед merge PR, который меняет что-либо из списка выше.
5. После upgrade Tauri, Typst, или `rust_xlsxwriter`.

## 3. Как прогнать

### Одной командой

```pwsh
npm run test:release-gate
```

Скрипт:

1. Проверяет, что `src-tauri/target/release/rheolab-enterprise.exe` существует. Если нет — собирает через `npm run tauri:build --no-bundle`.
2. Выставляет env (`FULL_EXPORT=1`, `TAURI_BINARY_PATH=...`, `TAURI_E2E_SKIP_BUILD=1`).
3. Запускает один Playwright-спек через `playwright.tauri.config.ts`.
4. Возвращает `exit 0` при успехе, иначе — блокирует release.

### С принудительной пересборкой бинарника

```pwsh
node scripts/test/run-release-gate.js --build
```

### В рамках `release:prepare`

Gate встроен в стандартный release flow между `tauri build` и генерацией manifest'a:

```
[release] ── running mandatory release gate ──
[release-gate] ✅ PASSED — release is green-lit
[release] ✓ release gate passed
```

### Обход (только для локальной отладки)

```pwsh
npm run release:prepare -- --skip-release-gate
```

Или переменная окружения:

```pwsh
$env:RHEOLAB_SKIP_RELEASE_GATE = "1"; npm run release:prepare
```

В обоих случаях в `release-manifest.json` появится поле `releaseGateExecuted: false`, а в stdout — warning. **Никогда не публикуйте manifest с `releaseGateExecuted: false` на VPS.**

## 4. Что проверяет workflow-тест

Тест разбит на 4 фазы, имитирующие путь пользователя:

```
┌─ Phase 1: Load 4 fixtures ──────────────────────────────────┐
│   Dashboard → Upload → Analyze → Save × 4                   │
│   (Chandler SST, Grace, BSL, Ofite — разные инструменты)    │
└─────────────────────────────────────────────────────────────┘
┌─ Phase 2: Comparison view ──────────────────────────────────┐
│   Comparison → add 4 experiments → verify chart + legend    │
└─────────────────────────────────────────────────────────────┘
┌─ Phase 3: Open Report sub-tab ──────────────────────────────┐
│   Switch to "Отчёт" tab → assert export buttons enabled     │
└─────────────────────────────────────────────────────────────┘
┌─ Phase A: defaults (recipe ON, rest OFF, RU) ───────────────┐
│   Export PDF + XLSX                                         │
├─ Phase B: all sections ON ──────────────────────────────────┤
│   Flip calibration, rawData, waterAnalysis ON               │
│   Export PDF + XLSX  (expect PDF ≥ Phase A PDF)             │
├─ Phase C: English language + all sections ON ───────────────┤
│   Language → EN                                             │
│   Export PDF + XLSX                                         │
├─ Phase D: minimal (all sections OFF, RU) ───────────────────┤
│   Export PDF  (expect ≤ Phase A PDF)                        │
└─────────────────────────────────────────────────────────────┘
┌─ Invariants ────────────────────────────────────────────────┐
│   • All 7 files > 5 KB                                      │
│   • All 7 files match magic bytes (%PDF / PK)               │
│   • Phase B PDF ≥ Phase A PDF (more sections = bigger)      │
│   • Phase D PDF ≤ Phase A PDF (fewer sections = smaller)    │
│   • Phase B XLSX ≥ Phase A XLSX                             │
│   • Heap growth initial→final < 20 MB                       │
└─────────────────────────────────────────────────────────────┘
```

## 5. Baseline (на момент введения)

`0.2.0-beta.24 release build`, 2026-04-22:

| Phase | Format | Size (B) | Wall ms | Heap Δ |
|-------|--------|---------:|--------:|-------:|
| A_defaults | PDF | 62,465 | 297 | +0.07 MB |
| A_defaults | XLSX | 347,902 | 371 | +0.01 MB |
| B_all_sections | PDF | 363,488 | 1,638 | +0.07 MB |
| B_all_sections | XLSX | 348,967 | 374 |  0 MB |
| C_english | PDF | 344,879 | 1,776 | +0.01 MB |
| C_english | XLSX | 347,932 | 373 | +0.01 MB |
| D_minimal | PDF | 62,465 | 259 | +0.04 MB |

Общий heap growth: **+5.58 MB** (budget 20 MB). Total wall: **~18 s** на release, **24 s** end-to-end.

## 6. Если gate упал

1. Посмотрите `playwright-report/index.html` (автооткрывается Playwright'ом).
2. Проверьте `outputs/e2e/perf/native-memory-*.jsonl` — есть ли пики памяти.
3. Соотнесите с последними изменениями в `src/components/comparison/reports/*` или `src-tauri/src/commands/reports/*`.
4. **Не** публикуйте релиз. Сначала фикс + повторный gate.

## 7. Почему не в CI

Пока gate требует Windows + WebView2 + собранный release-бинарник с `ALPHA_CHANNEL_SECRET`. GitHub Actions windows-latest runner это всё может, но пайплайн не настроен. Текущая политика: **дёргать локально** перед каждым релизом. Будущая работа — ADR-0011 (не написан).

## 8. Связанные документы

- `docs/RELEASE_AND_DEPLOY.md` — основной release flow.
- `docs/adr/ADR-0010-comparison-report.md` — архитектура фичи.
- `docs/performance/BASELINES.md` — perf-базлайны общие.
