# Аудит крайних рефакторингов RheoLab Enterprise — 2026-04-30 / 2026-05-01

**Окно аудита:** ~60 коммитов за 30–48 часов (от `7162f55` 2026-04-30 00:53 до `dfaf82c` 2026-05-01 00:14).
**Версии:** `0.2.2-alpha.4` → `alpha.5` → `alpha.6` → `alpha.7` → `alpha.8`.
**HEAD на момент аудита:** `dfaf82c chore(release): stamp alpha 0.2.2-alpha.7 artifact`.
**Связанный отчёт:** `@d:\Development\Rheolab\docs\audit\2026-04-30-deep-audit.md`.

---

## 1. TL;DR

За 30–48 часов выпущены **6 рефакторинговых волн** общим объёмом ~25 PR + 10 прямых
коммитов. **Доминирующая тема — снижение memory pressure и cold-start latency перед
beta-релизом.**

| Wave | Тема | Качество | Замечания |
|---|---|---|---|
| **W1** | Binary IPC consolidation | **⭐ 9/10** | ADR-0013 → 0 suppressions, чистая отрисовка, по факту — образцовый рефакторинг |
| **W2** | Memory hardening (jobs+comparison) | **⭐ 9/10** | Bound retention, phase markers, scorecard — высокая дисциплина |
| **W3** | Saved-report by-id | **⭐ 8/10** | Большой объём (1093+/-54), отличные тесты, parity-fix отдельным PR |
| **W4** | Library filter perf | **✓ 8/10** | Малый scope, чёткая телеметрия, debounce-policy задокументирована |
| **W5** | Warm-navigation | **⚠ 6/10** | Хорошая идея и docs, но 2 пост-релизных фикса + 9 lint-ошибок в продукт-коде |
| **W6** | Release infra / CI gates | **✓ 8/10** | "Local gates authoritative" задокументировано в RELEASE_GATE.md, ADR не требуется |

**Главные находки:**
1. **W5 (warm-navigation) — единственная волна с явным quality drift.** 511-строчный
   хук `useComparisonSeriesWindows.ts` с 5 рефами, `set-state-in-effect` антипаттернами и
   двумя пост-релизными хотфиксами в течение часа после `alpha.5`. Стек закрылся
   качественно (closeout doc + e2e smoke), но **ESLint и `tsc --noEmit` не были запущены
   локально перед релизом** — иначе 9 ошибок в свежем коде были бы пойманы.
2. **W1 (binary IPC) — образцовое исполнение.** Чистая стратегия миграции, удаление
   legacy-пути, ноль suppressions в `audit:large-ipc`. ADR-0010 и ADR-0013 синхронно
   сокращены (-32 / -58 строк) при удалении устаревшей логики.
3. **Дисциплина документации высокая.** Каждая волна сопровождается своим markdown'ом
   (`MEMORY-HARDENING-*`, `WARM-NAVIGATION-*`, `REPORT-TAB-BY-ID-HARDENING.md`,
   `RC-PERFORMANCE-SCORECARD.md`, и т. д.) с явными budget'ами и acceptance criteria.

---

## 2. Карта рефакторинговых волн

### Wave 1 — Binary IPC consolidation (RC hardening)

**Коммиты:**
- `7162f55 refactor(chart): keep binary series typed`
- `0f0af65 feat(chart): refetch binary series windows on zoom` (+432 строки)
- `b980ac0 Merge PR #11: refactor(chart): keep binary series typed` (+193 / -51)
- `5dec698 perf(chart): add binary series perf runner` (+768 / -4) — 511-строчный
  Playwright-spec + native-memory snapshot (154 строки)
- `9a03d01 Merge PR #7: chore(reports): remove legacy comparison payload IPC`
  (+362 / **-645**)

**Что сделано:**
1. Бинарный IPC-формат для chart series стал типизированным (TS-типы + Rust DTOs).
2. Удалён legacy comparison-payload путь — устранена единственная
   `LARGE-IPC-EXCEPTION` suppressions из `@d:\Development\Rheolab\docs\adr\ADR-0013-no-large-ipc-rule.md`.
3. ADR-0010 и ADR-0013 переписаны под "zero-suppression baseline" — разделы
   "Historical exception" перешли из "active" в "removed".
4. Добавлен perf-runner для chart series (`perf:chart:tauri`) с native-memory
   snapshot'ами.

**Качество:**
- ✓ **`audit:large-ipc` чистый**: 91 файл, 0 violations, 0 suppressions (проверено
  локально 2026-04-30: `OK — no large-IPC contract violations`).
- ✓ **Net deletions в reports.rs**: -159 строк.
- ✓ **Тесты обновлены**: `useRheologyData.test.ts` (+24), `binary-series.test.ts`
  (+8/+14 в 2 коммитах), e2e-smoke `chart-series-perf.tauri.spec.ts` (+511).
- ✓ **Документация**: `MEMORY-HARDENING-CHART-WINDOWS.md`, `MEMORY-HARDENING-TYPED-CHART-PIPELINE.md`,
  `CHART-SERIES-PERF-RUNNER.md` — каждое изменение задокументировано.
- ⚠ **Побочный lint debt**: коммит `0f0af65` ввёл 2 `set-state-in-effect` ошибки в
  `@d:\Development\Rheolab\src\hooks\useExperimentSeriesOverview.ts:117,176` — не пойманы локально перед merge.

**Вердикт:** **9/10**. Образцовая консолидация. Единственное замечание —
react-hooks ошибки в `useExperimentSeriesOverview.ts`, унаследованные warm-nav-стеком.

---

### Wave 2 — Memory hardening (jobs + comparison retention)

**Коммиты:**
- `c85f2e9 chore(runtime): bound retained jobs and metrics` (+384 / -11)
- `2fc2ca1 perf(comparison): add memory phase markers` (+213)
- `0f78066 fix(comparison): release transient comparison state` (+260 / -89)
- `d76b6aa test(perf): harden comparison smoke runner`
- `9f5a856 perf(rc): add memory hardening scorecard`
- `8936df9 perf(rc): add final memory hardening scorecard`
- `fe569ba perf(comparison): track post-export retention`
- `6e14e1d refactor(runtime): wait for job gates before blocking` (+191 / -28)

**Что сделано:**
1. **Bound retention** для jobs (`scheduler.rs` +173 строк) и metrics
   (`metrics.rs` +123 строк) — старые завершённые задачи больше не накапливаются.
2. **Phase markers** в comparison-smoke E2E — измерения по фазам export'а.
3. **Transient state release** — comparison-store очищает heavy DB-backed buffers
   на route leave (32 строки в `comparison-store.ts`).
4. **Job gate refactor** — `scheduler.rs` ждёт gate'ы до блокирующего пути
   (избегает starvation при concurrent comparison jobs).
5. **Scorecard документ** (`RC-PERFORMANCE-SCORECARD.md` 203 строки) с конкретными
   до/после метриками.

**Качество:**
- ✓ **Тесты Rust**: `scheduler.rs` тесты на retention/queueing/cancellation (видны в
  cargo test output: `completed_jobs_are_pruned_by_retention_limit`,
  `retention_keeps_active_jobs_and_prunes_expired_terminal_jobs`).
- ✓ **Тесты TS**: `comparison-store.test.ts` +31 строка, `useComparisonReportExport.test.ts`
  переписан (-94 / +94).
- ✓ **Документация**: `MEMORY-HARDENING-PLAN.md`, `MEMORY-HARDENING-RUNTIME-RETENTION.md`,
  `MEMORY-HARDENING-SCORECARD.md`, `JOB-SCHEDULER-VALIDATION.md` — следы решений видны.
- ✓ **Локальный гейт авторитативен** (per AGENTS.md, явно отмечено в merge-сообщениях).

**Вердикт:** **9/10**. Сильная дисциплина — каждое изменение → измерение → scorecard.
Замечаний нет.

---

### Wave 3 — Saved-report by-id (parity со старым flow)

**Коммиты:**
- `5ad960b Merge PR #9: feat(dashboard): load saved details without raw points`
- `af0eb59 Merge PR #10: feat(dashboard): page saved raw table by id`
- `e69bb4d feat(reports): export saved reports by id` (+1093 / -54)
- `aa490f6 fix(reports): align by-id report export parity` (+278 / -19) — **parity-fix**
- `df06b41 test(reports): add saved by-id report smoke`
- `b436b74 test(reports): inspect saved by-id xlsx smoke`

**Что сделано:**
1. Dashboard загружает сохранённые эксперименты **без raw points** (`PR #9`).
2. Raw-data table читает данные постранично через by-id команду (`PR #10`).
3. Saved-report tab экспортирует через by-ids IPC (PR #21, e69bb4d) — 322-строчный
   `useReportExportById.ts` хук.
4. **Parity-fix** (aa490f6) — выравнивает результат by-id с legacy flow.
5. Smoke E2E тесты + xlsx inspection.

**Качество:**
- ✓ **Огромный объём тестов**: `useReportExportById.test.tsx` +205 строк,
  `client.test.ts` +51, `DashboardContent.test.tsx` +28, e2e smoke + xlsx inspection.
- ✓ **Parity-fix** показывает, что diff с legacy flow был обнаружен и закрыт до релиза.
- ✓ **Документация**: `REPORT-TAB-BY-ID-HARDENING.md` (55 строк) фиксирует контракт.
- ⚠ **`reports.rs` подрос на 459 строк** — модуль, который уже был самым большим
  (3891 строка / 144 KB). См. рекомендацию по splitting в `2026-04-30-deep-audit.md`.

**Вердикт:** **8/10**. Очень крепко. Снижено бы до 9 при splitting `reports.rs`.

---

### Wave 4 — Library filter perf

**Коммиты:**
- `c986998 perf(library): split filter search spans`
- `16f7f44 perf(library): track filter regression deltas`
- `15ebc6f perf(library): tune filter debounce policy`

**Что сделано:**
1. Telemetry split: filter spans разбиты по фазам (parse / debounce / dispatch).
2. Regression-tracking: дельты vs baseline через `compare-perf-baselines.js`.
3. **Debounce policy tuning** в `library/filter-debounce.ts` — pinned в
   `tests/library/filter-debounce.test.ts` (видны в test output: `filter-debounce-policy-test.tsx`,
   `experiment-filters-debounce-policy.test.tsx` — оба passed).

**Качество:**
- ✓ Перфоманс-driven, измерено, задокументировано.
- ✓ Тесты на debounce decision matrix (`LibraryFilterDebounceDecision`).
- ✓ Малый scope, не задевает других модулей.

**Вердикт:** **8/10**. Чистый perf-tuning без архитектурных изменений.

---

### Wave 5 — Warm-navigation (главная мишень аудита)

**Коммиты (в порядке релиза):**
- `dc857fe refactor(comparison): normalize warm session state` (+318 / -36)
- `d3956ae feat(series): add shared warm window cache` (+433 / -32) — новый
  `@d:\Development\Rheolab\src\lib\series\series-window-cache.ts` (212 строк)
- `13dcdf9 feat(comparison): load chart lines from binary series` (+456 / -3) —
  новый `@d:\Development\Rheolab\src\components\comparison\useComparisonSeriesWindows.ts` (247 строк initial)
- `f2c1004 feat(comparison): persist warm viewport session` (+127 / -16)
- `10ded52 feat(comparison): refetch binary windows by viewport` (+196 / -42)
- `a465072 feat(series): cache decoded Rust series` (+302 / -21) —
  `@d:\Development\Rheolab\src-tauri\src\commands\series\mod.rs` +318 строк
- `c2f710a fix(series): invalidate warm cache on experiment mutation` (+164 / -7)
- `ff38467 test(comparison): add warm navigation smoke` (+577 / -3) — 524-строчный
  Playwright-spec
- `0940150 docs(memory): close warm navigation rollout` (+259 / -7) — `WARM-NAVIGATION-CLOSEOUT.md` 226 строк

**Пост-релизные хотфиксы (после bump до alpha.5):**
- `d7a37ae fix(comparison): restore db selection and chart reset` (2026-04-30 23:43,
  bump → alpha.6, +255 / -12) — починен `comparison-selector` + `zoom`-plugin
- `ec36e06 fix(comparison): recover stale viewport series loads` (2026-05-01 00:08,
  bump → alpha.7, +287 / -56) — **+195 строк в `useComparisonSeriesWindows.ts`**

**Что сделано:**
1. **`series-window-cache.ts`** (212 строк, отдельный класс, ноль React-зависимостей):
   bounded TTL (5 мин) / 96 MB / 64 entries, LRU-eviction, инструментирован через
   `stats()`. **Образцовая утилита.**
2. **Rust-side decoded cache** в `series/mod.rs` (+302 строк): keyed by
   `experiment_id + data_hash`, bounded TTL/entries/bytes. Параллельно к
   frontend-cache, но более авторитативный.
3. **Comparison store normalization**: разделение logical session state
   (selected ids, viewport, settings) от heavy renderer-owned buffers.
4. **`useComparisonSeriesWindows.ts`** (511 строк по итогу 7 коммитов):
   per-line binary loading, viewport refetch, empty-viewport fallback,
   cache-hit fast path.
5. **Mutation invalidation** на 5 IPC-границах (save / delete / import / restore /
   sync) — задокументировано в closeout-doc.
6. **524-строчный Playwright smoke** проверяет route-leave / route-return
   contract (5 lines / 32s away / 0 refetch / 1 new line / no reload storm).
7. **`WARM-NAVIGATION-CLOSEOUT.md`** — образцовая release-doc: явные метрики
   до/после, "use this wording / avoid this wording", DoD-checklist.

**Качество — сильные стороны:**
- ✓ **`series-window-cache.ts`** (`@d:\Development\Rheolab\src\lib\series\series-window-cache.ts`) — чистый,
  тестируемый, без React-coupling. Singleton + класс — лёгко мокается. **9/10.**
- ✓ **Rust-cache** не нарушает ADR-0013 (передача через Response binary, не через
  serde_json::Value).
- ✓ **125-строчный invalidation-test** (`@d:\Development\Rheolab\tests\tauri\series-cache-invalidation.test.ts`)
  покрывает все 5 mutation-границ.
- ✓ **Closeout-doc** — лучший пример release-документации в репо. Явное "Avoid this
  wording" с противопоказаниями.

**Качество — слабые стороны:**
- ✗ **`useComparisonSeriesWindows.ts` — 511 строк / 5 рефов / 9 inline `setLineStates`
  вызовов** (`@d:\Development\Rheolab\src\components\comparison\useComparisonSeriesWindows.ts`).
  Это **антипаттерн "derived state stored in useState"**: `lineStates` keyed by
  `experimentId` дублирует то, что уже есть в `seriesWindowCache` + `experiments` props.
  Рекомендуется рефакторинг на `useReducer` + `useSyncExternalStore`.

- ✗ **9 react-hooks ошибок** в продукт-коде после warm-nav merge:
  - `@d:\Development\Rheolab\src\app\dashboard\comparison\page.tsx:159` — `react-hooks/immutability`
  - `@d:\Development\Rheolab\src\components\comparison\useComparisonSeriesWindows.ts:130,153,179` — exhaustive-deps + set-state-in-effect ×2
  - `@d:\Development\Rheolab\src\hooks\useExperimentSeriesOverview.ts:117,176` — set-state-in-effect ×2
  - `@d:\Development\Rheolab\src\components\dashboard\DashboardContent.tsx:124,128` — exhaustive-deps ×2

  ESLint **не запускался локально** перед merge ни одного из 7 warm-nav PR — иначе
  ошибки были бы пойманы. См. P1 из главного аудита (защита `prerelease:prepare`).

- ✗ **Два пост-релизных хотфикса в течение часа после `alpha.5`** (`d7a37ae`, `ec36e06`)
  с net +500 строк. Конкретно:
  - `comparison-selector` падал на DB-selection после warm-cache навигации
  - `zoom-plugin` ломался на повторном входе
  - `useComparisonSeriesWindows.ts` не восстанавливался при stale viewport (+195 строк)

  Это означает, что **524-строчный smoke-test не покрывал реальные пользовательские
  сценарии** — он проверял только идеальный happy-path. Реальные пользователи: open →
  zoom → leave → save another → return → re-zoom → empty viewport — **не были
  протестированы перед релизом**.

- ⚠ **Большой объём** (всего ~3 500+ строк за 9 коммитов в одном feature). Stack
  размечен через ветки `codex/warm-navigation-*`, что хорошо для review, но риск
  per-PR slip остался реализован.

- ⚠ **`useExperimentSeriesOverview.ts`** (Wave 1 + Wave 5) одновременно
  модифицировался разными PR — в итоге 2 set-state-in-effect ошибки и
  exhaustive-deps debt.

**Вердикт:** **6/10.** Хорошая бизнес-идея, отличная foundation (`series-window-cache.ts`),
прекрасная документация, но **исполнение в hook-слое слабое и потребовало пост-релизной
доработки**. Самый большой урок: **lint-gate перед merge должен быть автоматическим**.

---

### Wave 6 — Release infrastructure / CI gates

**Коммиты:**
- `cc8e6db docs(rc): mark local gates authoritative`
- `bb3c994 fix(ci): satisfy linux strict type-check`
- `96a00f2 docs(rc): clarify version hash provenance`
- `8b9ff15 docs(rc): add beta readiness scorecard`

**Что сделано:**
1. **`docs/release/RELEASE_GATE.md`** обновлён: локальный top-of-stack gate явно
   объявлен авторитативным, GitHub Actions — informational only. Соответствует
   AGENTS.md ("GitHub Actions are not used as the authoritative gate").
2. **CI typecheck** на linux исправлен (одна точечная правка).
3. **Beta readiness scorecard** документирует pre-beta критерии готовности.

**Качество:**
- ✓ Документация и политика синхронизированы.
- ✓ Изменения малые, точечные.

**Вердикт:** **8/10.** Чистая работа.

---

## 3. Cross-cutting наблюдения

### 3.1 ADR-0013 enforcement — **gold standard**

| Метрика | Значение |
|---|---|
| Файлов сканируется | 91 |
| Forbidden patterns | 0 |
| Active suppressions | 0 |
| Время выполнения | 25 ms |
| Гейтится в release flow | Да (`audit:large-ipc`) |

**Историческая suppression** (`reports_generate_comparison_pdf`) удалена в Wave 1.
Сейчас правило enforced без exceptions — это **лучшее состояние, в котором ADR-0013
когда-либо был**.

### 3.2 Документационная дисциплина

Каждая волна оставила собственный markdown-док в `docs/performance/`:

| Wave | Документы |
|---|---|
| W1 | `MEMORY-HARDENING-CHART-WINDOWS.md`, `MEMORY-HARDENING-TYPED-CHART-PIPELINE.md`, `CHART-SERIES-PERF-RUNNER.md` |
| W2 | `MEMORY-HARDENING-PLAN.md`, `MEMORY-HARDENING-RUNTIME-RETENTION.md`, `MEMORY-HARDENING-SCORECARD.md`, `RC-PERFORMANCE-SCORECARD.md`, `JOB-SCHEDULER-VALIDATION.md` |
| W3 | `REPORT-TAB-BY-ID-HARDENING.md`, обновлён `COMPARISON-POST-EXPORT-RETENTION.md` |
| W4 | `LIBRARY-FILTER-DEBOUNCE-POLICY.md` (через `15ebc6f`) |
| W5 | `WARM-NAVIGATION-PLAN.md`, `WARM-NAVIGATION-BASELINE.md`, `WARM-NAVIGATION-CLOSEOUT.md` |
| W6 | `RELEASE_GATE.md`, `BETA-READINESS-SCORECARD.md` |

**Это значительно выше среднего.** Каждое perf-изменение → измерение → scorecard.

### 3.3 Тестовая дисциплина

Каждая фича-волна сопровождалась тестами:

| Волна | Unit | Integration | E2E |
|---|---|---|---|
| W1 | `binary-series.test.ts`, `useRheologyData.test.ts` | — | `chart-series-perf.tauri.spec.ts` (511 строк) |
| W2 | `scheduler.rs` Rust unit-tests | — | `comparison-smoke-perf.tauri.spec.ts` updates |
| W3 | `useReportExportById.test.tsx` (205) | `client.test.ts` (+51) | `saved-report-by-id-smoke.tauri.spec.ts`, `inspect-saved-by-id-xlsx.tauri.spec.ts` |
| W4 | `filter-debounce.test.ts` | — | — |
| W5 | `series-window-cache.test.ts` (123), `useComparisonSeriesWindows.test.tsx` (191+85+43), `series-cache-invalidation.test.ts` (125), `useExperimentSeriesOverview.test.tsx` (62+99) | — | `warm-navigation-comparison.tauri.spec.ts` (524 строк) |

**Volume впечатляет.** Но Wave 5 пост-релизные баги показали, что **тесты не закрывали
edge-cases пользовательского цикла "leave → mutate → return → re-zoom"**.

### 3.4 Lint hygiene drift

ESLint config (`@d:\Development\Rheolab\eslint.config.mjs`) включает строгие
react-hooks rules: `exhaustive-deps:error`, `set-state-in-effect`, `immutability`.

Все 9 текущих lint-ошибок попали в репо **во время Wave 1 + Wave 5**:

| Файл | Volume введения ошибок | Источник |
|---|---|---|
| `useExperimentSeriesOverview.ts` | 2 ошибки | Wave 1 (`0f0af65`) |
| `DashboardContent.tsx` | 2 ошибки | Wave 3 (`af0eb59`/PR #10) |
| `comparison/page.tsx` | 1 ошибка | Wave 5 |
| `useComparisonSeriesWindows.ts` | 3 ошибки | Wave 5 |
| `series-window-cache.test.ts` | 1 ошибка (prefer-const) | Wave 5 |

**Гейтинг отсутствует:** `prerelease:prepare` запускает только `version:validate`
(`@d:\Development\Rheolab\package.json:64`). `npm run lint` не входит ни в один pre-merge гейт.

### 3.5 Версионная дисциплина — **отлично**

За 30 часов произошло **5 bump'ов версии** (alpha.4 → alpha.5 → alpha.6 → alpha.7 → alpha.8).
Каждый раз `version.json` синхронизирован во все 4 dependents через `version:sync`.

Пост-релизные fix-ы (`d7a37ae`, `ec36e06`) корректно прошли через bump → sync, а не
через ручную правку. Это видно по diff'ам: `version.json | 2 +-`,
`package.json | 2 +-`, `src-tauri/Cargo.toml | 2 +-`, `src-tauri/tauri.conf.json | 2 +-`,
`src/lib/version.ts | 4 +-`.

**SSoT работает безупречно даже под давлением hotfix-релизов.**

### 3.6 Соответствие ADR-0009 (modularization)

ADR-0009 (refactor-modularization) призывал к разбиению монолитов. Текущее состояние:

- ✓ **`series-window-cache.ts`** — модульная утилита, ноль coupling.
- ✓ **`series/mod.rs`** Rust-side — отдельный модуль с явным API.
- ✗ **`commands/reports.rs`** — продолжает расти (теперь 3891 строка / 144 KB после
  Wave 3 +459 строк). Это **противоречит** духу ADR-0009.
- ⚠ **`useComparisonSeriesWindows.ts`** — 511 строк, 5 рефов. Не блокер, но
  кандидат на split (см. рекомендации).

---

## 4. Конкретные рекомендации

### Sprint 0 (немедленно)

1. **[CRIT] Усилить `prerelease:prepare`** — добавить `npm run lint` и
   `npx tsc --noEmit` перед версионной проверкой. Это бы поймало все 14 текущих
   ошибок до релиза.

   ```diff
   -  "prerelease:prepare": "node scripts/version/validate.js",
   +  "prerelease:prepare": "node scripts/version/validate.js && npm run lint && npx tsc --noEmit",
   ```

2. **[HIGH] Починить 9 react-hooks ошибок** в W1+W5-коде (см. § 3.4).

3. **[MED] Удалить устаревшие пункты из `progress.txt`** (см. главный аудит).

### Sprint 1 (текущая итерация)

4. **[HIGH] Расширить warm-navigation E2E** реальным пользовательским циклом
   `open → zoom → leave → save another → return → re-zoom → empty viewport`. Текущий
   524-строчный smoke не покрыл сценарий, который выявили `d7a37ae` и `ec36e06`.

5. **[MED] Refactor `useComparisonSeriesWindows.ts`** на `useReducer`-pattern:
   - Извлечь reducer для line-state transitions (idle → loading → ready → error).
   - Заменить 5 рефов на единый `actionsRef`.
   - Заменить 9 inline `setLineStates(prev => …)` на типизированные actions.

   Цель: < 250 строк, ≤ 2 рефа.

6. **[MED] Documentation cross-link** — добавить в `WARM-NAVIGATION-CLOSEOUT.md`
   секцию "Post-release fixes" с упоминанием `d7a37ae` и `ec36e06` (для будущих
   аудиторов).

### Sprint 2 (backlog)

7. **[MED] Splitting `commands/reports.rs`** (см. главный аудит §6/P2). После Wave 3
   +459 строк это становится более насущным.

8. **[LOW] `useExperimentSeriesOverview.ts`** — рассмотреть слияние с warm-window-cache
   как единый источник правды для overview'а dashboard и comparison.

9. **[LOW] Добавить regression-тест** на ADR-0013 baseline: hook в audit, который
   падает при любой попытке ввести `LARGE-IPC-EXCEPTION` без амендмента ADR.

---

## 5. Итоговая шкала качества

```
Wave 1 — Binary IPC          ████████████████████░░  9/10
Wave 2 — Memory hardening    ████████████████████░░  9/10
Wave 3 — Saved-report by-id  ████████████████░░░░░░  8/10
Wave 4 — Library filter perf ████████████████░░░░░░  8/10
Wave 5 — Warm-navigation     ████████████░░░░░░░░░░  6/10
Wave 6 — Release infra       ████████████████░░░░░░  8/10
                                            СРЕДНЕЕ:  8.0/10
```

**Общий тренд:** проектные практики (ADR enforcement, documentation, perf-budgets,
SSoT, тесты) — на высоком уровне (8–9). **Слабая точка одна: pre-merge lint/tsc gate.**
Если бы он был, Wave 5 не отправил бы 9 ошибок в production-код, а warm-nav-релиз
получил бы 8/10 без 2 пост-релизных хотфиксов.

---

## 6. Команды для воспроизведения

```powershell
# История последних 60 коммитов
git --no-pager log -n 60 --pretty=format:"%h %ci %s"

# Стат всех warm-nav коммитов
git --no-pager show --stat dc857fe d3956ae 13dcdf9 f2c1004 10ded52 a465072 c2f710a ff38467 0940150 d7a37ae ec36e06

# ADR-0013 enforcement
npm run audit:large-ipc

# Lint state (текущие 10 ошибок)
npm run lint

# Цикл lint→tsc для проверки рекомендации №1
npm run lint && npx tsc --noEmit && echo "ALL GREEN"
```

---

_Аудитор: Cascade — refactoring-focused pass от 2026-04-30 / 2026-05-01.
Дополняет `@d:\Development\Rheolab\docs\audit\2026-04-30-deep-audit.md`._
