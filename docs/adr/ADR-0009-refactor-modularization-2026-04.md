# ADR-0009: Поэтапная модуляризация кода (Apr 2026)

**Статус:** ✅ Реализовано  
**Дата принятия:** 2026-04-19 (старт W2)  
**Дата документирования:** 2026-04-21  
**Авторы:** Platform Team  
**Затронутые компоненты:** `src-tauri/src/lib.rs`, `src-tauri/src/startup/`, `src-tauri/src/commands/analysis/`, `src-tauri/src/db/migrations/`, `src/types/`, `src/hooks/chart-options/`, `src/app/dashboard/settings/`, `src/components/shared/UpdateChecker.tsx`

---

## 1. Контекст

Аудит кодовой базы на 2026-04-18 (`docs/audit/2026-04-21-codebase-audit.md`)
выявил 15 Rust-файлов > 500 LOC и 13 TypeScript-файлов > 400 LOC.
Самые крупные — `chart_generator.rs` (1372), `pdf.rs` (1370), `rheo_parser.rs` (1239),
а также “интерфейсные” монолиты: `src-tauri/src/lib.rs` (439 LOC),
`src/app/dashboard/settings/page.tsx` (605), `src/types/index.ts` (366),
`src/hooks/useRheologyChartOptions.ts` (430), `src-tauri/src/commands/analysis.rs` (444).

Проблемы:

- **Когнитивная сложность** — новичок не может за минуту понять “что такое lib.rs”: 439 строк мешают setup, логирование, регистрацию IPC и builder-chain.
- **Медленный код-ревью** — PR с точечной правкой в 600-строчный `settings/page.tsx` затрагивает файл, где одновременно живут 6 независимых tab-ов.
- **Bundle-weight** — один `UpdateChecker.tsx` тянул в main-бандл плагины `tauri-plugin-updater` и `tauri-plugin-process`, которые нужны **только** раз в 30 секунд после старта.
- **Нет рычагов для скорости тестов** — монолит сложно тестировать изолированными юнит-тестами.

Инициатива **не** включала переписывание парсеров/генераторов отчётов, т.к. они проходят под защитой golden-snapshot-тестов и изменения несут высокий риск регрессии.

## 2. Рассмотренные альтернативы

| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| **Инкрементальная декомпозиция без изменения API** | Behaviour-preserving, маленькие PR, тесты не ломаются | Требует дисциплины и нескольких итераций |
| Переписать crash-prone модули с нуля | Можно сразу принять идеалистичную архитектуру | Гигантский PR, высокий риск регрессии, сложно ревьюить |
| Оставить как есть, задокументировать | Ноль работы | Долговая спираль: новый код добавляется в те же файлы |
| Ввести микрофреймворк (DI, event-bus) | Красиво «правильно» | Overkill для desktop-приложения, ломает инварианты стабильности |

## 3. Решение

Четырёхнедельный поэтапный рефакторинг (**W1 → W2 → W3 → W4**), каждый шаг
оформлен отдельным коммитом и регрессионно проверен на фронтовых (vitest),
нативных (cargo test --lib) и security-аудит-инструментах (npm audit, cargo audit):

### W1 — стабильность (безопасность и CI)

- Все `.expect()` в production Rust-коде либо заменены на `?` + `AppError`, либо аннотированы как **документированно-инфаллибильные** (криптопримитивы с известной длиной).
- `npm audit fix` до нуля уязвимостей в `--omit=dev`.
- `cargo audit` и `npm audit` интегрированы в `.github/workflows/v2-desktop.yml` с кэшированием binary и timeout-ом.

### W2 — декомпозиция больших файлов (behaviour-preserving)

Два ключевых паттерна:

1. **“Module facade”** — создаём `mod.rs`/`index.ts`, разбиваем на подмодули по ответственности, сохраняем публичный API через re-export. Пример: `commands/analysis/{dto,cycle_detection,cycle_processing,commands}.rs`; `mod.rs` делает `pub use commands::*;` для автоматических `__cmd__*` helper'ов, которые генерирует `#[tauri::command]`.

2. **“Thin orchestrator”** — исходный файл остаётся, но становится оркестратором, делегирующим работу новым модулям. Пример: `src-tauri/src/lib.rs` → `startup/{logging.rs, setup.rs, commands_registry.rs}`; `useRheologyChartOptions.ts` → `hooks/chart-options/{time-format, translations, build-axes-series}`.

Декомпозированные файлы:

| До | После | Где живёт |
|----|-------|-----------|
| `lib.rs` 439 LOC | 12 + `startup/` | `src-tauri/src/` |
| `commands/analysis.rs` 444 LOC | удалён + `commands/analysis/` | `src-tauri/src/commands/` |
| `useRheologyChartOptions.ts` 430 LOC | 197 + `chart-options/` | `src/hooks/` |
| `settings/page.tsx` 605 LOC | 106 + 6 tab-компонентов + `_shared.tsx` | `src/app/dashboard/settings/` |
| `types/index.ts` 366 LOC | 48 barrel + 5 domain-файлов | `src/types/` |

### W3 — производительность

- **Bundle analyzer**: `rollup-plugin-visualizer` включается через `ANALYZE=true vite build`. Базовый снимок сохранён в `runtime/refactor-baseline/bundle.html`.
- **Lazy-loading `UpdateChecker`**: компонент опрашивает updater через 30 с после старта, поэтому оформлен как `React.lazy()`. Сами плагины `@tauri-apps/plugin-updater` и `-process` вынесены в `update-install.ts`, импортируются динамически при клике “Install”.
- **Extracted `analysisCache`**: `useAnalysisPipeline.ts` содержал module-level кэш. Вынесли в отдельный `analysisCache.ts` (53 LOC), чтобы не-hook-потребители (`DashboardLayoutClient`, `experiment-data-store`) не тянули в main-бандл весь analysis-pipeline.
- **`React.memo(DashboardContent)`** + стабилизация `onSaveClick`/`onInstrumentChange` через `useCallback` — parent переоткрывает `SaveDialog` / переключает `isLoading` без ре-рендеринга всего chart/tab-дерева.
- **Migration runner hardening**: skip-already-applied, per-migration транзакции, downgrade-детект с warning, тесты на инварианты реестра миграций.

Результат: `main.js` 280.71 KB → **272.74 KB** (gzip 89.29 → 86.58).

### W4 — документация

- `docs/ipc-surface.md` — высокоуровневая карта 80+ Tauri-команд с риск-классами и license-gate.
- `docs/ARCHITECTURE.md` обновлён до `0.2.0-beta.21`: отражает новую структуру `startup/`, декомпозированные `commands/*/`, hardened migration runner.
- Этот ADR — исторический артефакт с причинами и trade-off'ами.

## 4. Последствия

### Положительные

- Файлы ≤ 500 Rust LOC / ≤ 400 TS LOC по всей “интерфейсной” поверхности проекта — соблюдается WP-4.1 hygiene.
- PR за октябрь-апрель ретроспективно стали бы в 3–5× меньше по diff.
- Появилась **safety-net для миграций** — инвариантные тесты ловят расхождение `CURRENT_SCHEMA_VERSION` и реестра **на этапе `cargo test`**, а не в production.
- Bundle-size окно открыто: уже сейчас −8 KB raw; `rollup-plugin-visualizer` видит следующих кандидатов (`vendor-radix` 115 KB, `vendor-charts` 52 KB) для tree-shaking в будущих раундах.
- Культура `useShallow` везде — верифицирована аудитом в W3.2.

### Отрицательные

- **Больше файлов** — навигация через IDE open-by-name чуть сложнее. Компенсируется barrel-файлами и обновлённым ARCHITECTURE.md.
- Glob re-export для Tauri-макросов (`commands/analysis/mod.rs: pub use commands::*;`) — неявная зависимость: если переименовать `__cmd__*` helper, компилятор найдёт ошибку, но не все IDE подсвечивают такие символы. Зафиксировано в комментарии `mod.rs`.
- Некоторые тесты потребовали `#[allow(unused_imports)]` для backwards-совместимых re-export'ов (`clearAnalysisCache` в `useAnalysisPipeline`).

### Нейтральные

- Публичный Tauri IPC API **не изменился** — фронт не требует правок (инвариант §1.2 REFACTORING_DEEP_PLAN).
- Legacy URL aliases для settings-tabs (`?tab=*`) сохранены через `resolveTabFromUrl` — закладок пользователей не ломаем.
- `CURRENT_SCHEMA_VERSION` осталась ручной константой (невозможно вычислить на compile-time из `&[&dyn Migration]`), но есть тест на совпадение с `latest_registered_version()`.

## 5. Мониторинг и откат

- **Регрессия**: полный прогон `tsc`, `vitest` (1190 tests / 6 skipped), `cargo test --lib` (261 tests), `npm run build`, `npm audit`, `cargo audit` после каждой фазы.
- **Откат**: каждая фаза — отдельные атомарные коммиты на ветке `refactor/w2-decomposition`. Любой шаг легко ревертится через `git revert` без затрагивания последующих.
- **Baseline**: `runtime/refactor-baseline/` содержит bundle snapshot и metrics.json до-рефактора — есть чем сравнивать.
