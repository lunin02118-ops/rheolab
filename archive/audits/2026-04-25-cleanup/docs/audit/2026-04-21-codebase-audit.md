# RheoLab Enterprise V2 — глубокий аудит кодовой базы

**Дата:** 21 апреля 2026
**Версия:** 0.2.0-beta.18 (alpha-канал)
**Scope:** фронтенд (React 19 + TS + Vite) · десктоп-шелл (Tauri 2 + Rust) · тесты · скрипты сборки/деплоя
**Цель:** комплексная оценка здоровья проекта + метрики производительности + приоритизированный план улучшений.

---

## 1. Executive summary

| Область | Оценка | Ключевой вывод |
|---------|:------:|----------------|
| Архитектура | 🟢 **B+** | Чёткое разделение слоёв, хорошая атомизация Zustand-сторов (12 шт.) |
| Типобезопасность TS | 🟢 **A** | 0 `@ts-ignore` / `@ts-nocheck`, всего 30 `any` на 44 329 LOC |
| Надёжность Rust | 🟡 **B−** | **81 `.unwrap()` в продакшен-коде** — локальные хот-споты: `db/columnar.rs`, `backup/export.rs` |
| Bundle (JS) | 🟢 **A−** | 1 078 КБ суммарно, главный чанк 272 КБ — хороший сплит (63 чанка) |
| Перф-паттерны | 🟢 **B+** | 43 `React.memo`, 14 `useShallow` — применяются там, где надо |
| Тесты | 🟢 **A−** | 80 unit-файлов · **1 190 тестов проходят, 6 skipped** · 26 e2e |
| Tauri IPC surface | 🟡 **B** | 94 команды в 27 файлах — близко к верхней границе управляемости |
| Безопасность deps | 🟡 **B** | Runtime: **0 vulns**. Dev: 3 advisories (vite, flatted, brace-expansion) |
| Лицензирование/crypto | 🟢 **A−** | Изолированный модуль, собственные тесты (577 LOC) |
| Документация | 🟡 **C+** | `AGENTS.md` есть, но нет ADR/архитектурного обзора |

**Вердикт:** проект в хорошем состоянии. Структура зрелая, инструменты качества работают. Главные долги — **unwrap/expect в прод-Rust** и небольшой пакет уязвимостей в dev-deps.

---

## 2. Метрики размера

### 2.1 Строки кода по слоям

| Слой | Файлов | LOC |
|------|-------:|----:|
| `src/` (фронтенд) | 302 | **44 329** |
| `src-tauri/src/` (Rust) | 100 | **18 743** |
| `tests/` | 130 | 24 172 |
| `scripts/` | 81 | 10 584 |
| **Итого код+тесты** | **613** | **97 828** |

### 2.2 Фронтенд — по папкам

| Папка | Файлов | LOC | Комментарий |
|-------|-------:|----:|-------------|
| `src/app/` | 13 | 2 000 | Router + dashboard pages |
| `src/components/` | 90 | **14 889** | Крупнейший слой — есть запас к декомпозиции |
| `src/lib/` | 89 | 10 347 | Чистые домены: stores, parsing, analysis, reports |
| `src/hooks/` | 10 | 1 638 | Среднее ~164 LOC — в норме |
| `src/contexts/` | 2 | 108 | Минимально, правильно |

### 2.3 Топ-10 самых больших TS/TSX файлов

| LOC | Файл | Рекомендация |
|----:|------|--------------|
| 430 | `src/hooks/useRheologyChartOptions.ts` | Разнести uPlot-опции по суб-модулям (axes/tooltip/series) |
| 406 | `src/app/dashboard/settings/page.tsx` | После рефакторинга вкладок остаётся inline-JSX — выделить TabContent-компоненты |
| 396 | `src/lib/utils/touch-point.ts` | Утилиты низкоуровневые, оставить как есть |
| 390 | `src/lib/store/chart-settings-store.ts` | OK; persist/merge-слой уже вынесен логически |
| 372 | `src/app/dashboard/page.tsx` | Главная страница — кандидат на разбиение |
| 371 | `src/components/library/reagents-manager.tsx` | Слишком «толстый» компонент |
| 371 | `src/components/library/experiment-card.tsx` | OK с учётом memoization |
| 370 | `src/lib/analysis/report-types/wasm-models.ts` | Data-heavy model файл, норма |
| 366 | `src/types/index.ts` | Стоит разбить по доменам |
| 364 | `src/components/dashboard/save-experiment-dialog.tsx` | Кандидат на декомпозицию |

### 2.4 Топ-5 Rust-файлов

| LOC | Файл | Комментарий |
|----:|------|-------------|
| 600 | `commands/backup/restore_tests.rs` | Тест, норма |
| 577 | `commands/licensing/licensing_tests.rs` | Тест, норма |
| 465 | `commands/reagents/seed_data.rs` | Seed-массив — допустимо |
| **444** | `commands/analysis.rs` | **Прод-файл — кандидат на разбиение** |
| **439** | `src/lib.rs` | **Регистрация команд + setup** — уже близко к лимиту |

---

## 3. Типобезопасность и качество кода

### 3.1 TypeScript

| Метрика | Значение | Интерпретация |
|---------|:--------:|---------------|
| `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error` | **0** | 🟢 Идеально |
| `any` (слово) | 30 в 22 файлах | 🟢 Ниже 0.1 % LOC |
| `TODO` / `FIXME` / `HACK` | 3 в 2 файлах (`LicenseActivationDialog`, `DevModeSection`) | 🟢 |
| `console.*` прямые вызовы | 39 в 13 файлах | 🟡 Большинство — в `logger.ts` (ожидаемо) и в `license-store`, `encryption`, `main.tsx` (допустимо) |
| `npx tsc --noEmit` | Exit 0 | 🟢 Чистая компиляция |

### 3.2 Rust — обработка ошибок в продакшен-коде

| Метрика | Значение | Хот-споты |
|---------|:--------:|-----------|
| `.unwrap()` в non-test коде | **81** 🟡 | `db/columnar.rs` (21) · `backup/export.rs` (15) · `lib.rs` (10) · `parsing/mod.rs` (6) · `licensing/demo.rs` (5) |
| `.expect(...)` | 17 | В основном сопровождаются сообщениями |

**🔴 Риск:** `db/columnar.rs` содержит наибольшее количество `unwrap()` в сериализации. В случае повреждённых данных — паника потока. Нужно заменить на `?` + `thiserror`.

### 3.3 Линтинг и формат

- ESLint 9 + `eslint-plugin-react-hooks` — настроен.
- Prettier/Rustfmt config — обнаружен в `.vscode` и `rustfmt.toml` (по умолчанию).

---

## 4. Архитектура

### 4.1 Zustand-сторы (12 шт.)

| Стор | Назначение | Persist |
|------|-----------|:-:|
| `analysis-settings-store` | Параметры анализа (shear rates, AI) | ✅ |
| `branding-store` | Брендинг лаборатории | ✅ |
| `catalog-store` | Справочник оборудования | ❌ |
| `chart-settings-store` | Графики + единицы + точность | ✅ (с deep-merge) |
| `comparison-store` | Сравнение экспериментов | ❌ |
| `display-settings-store` | UI-режим (beginner/expert) | ✅ |
| `experiment-data-store` | Текущий эксперимент | ❌ |
| `license-store` | Статус лицензии | ❌ |
| `log-store` | In-memory логи | ❌ |
| `toast-store` | Уведомления | ❌ |
| `update-store` | Updater | ❌ |
| `zoom-sync-store` | Синхронизация зума на графиках | ❌ |

**Вывод:** чистое разделение, нет "god-store". Все persistent-сторы — с осознанным набором полей.

### 4.2 Lazy-splitting

- **22 `React.lazy()` точки** в 6 файлах — основные: `settings/page.tsx` (11), `routes.tsx` (6), `DashboardLayoutClient.tsx` (2).
- Это даёт **63 JS-чанка** в build (см. §5.1) — корректная стратегия.

### 4.3 Tauri IPC surface

- **94 команды** в 27 файлах.
- Крупнейшие наборы: licensing (13), api_keys (8), reagents (7), data_flows (12), experiments (9).
- Среднее: ~3.5 команды на файл — **управляемо, но близко к порогу**, при котором стоит вводить фасады (single-entry `invoke`-hooks).

---

## 5. Производительность

### 5.1 Bundle size (production)

| Категория | Метрика |
|-----------|---------|
| JS чанков | **63 файла, 1 077.8 КБ total** |
| CSS | 2 файла, 140.0 КБ |
| Крупнейший JS-чанк | `main-DQ3w7C9L.js` — **271.8 КБ** |
| Vendor-chunks | `radix 110.8` · `charts (uplot) 51.0` · `react 47.6` · `date 19.5` |

**Топ-10 чанков:**

| КБ | Файл |
|---:|------|
| 271.8 | `main-*.js` |
| 138.4 | `main-*.css` |
| 129.6 | `page-*.js` (dashboard?) |
| 126.5 | `DashboardContent-*.js` |
| 110.8 | `vendor-radix-*.js` |
| 90.3 | `page-*.js` |
| 51.0 | `vendor-charts-*.js` (uPlot) |
| 47.6 | `vendor-react-*.js` |
| 40.7 | `page-*.js` |
| 26.6 | `page-*.js` |

🟢 **Хорошо:** разбивка по маршрутам работает, vendor-чанки изолированы.
🟡 **Улучшаемо:** `main` 272 КБ содержит, вероятно, код, который можно дожать (проверить через `rollup-plugin-visualizer` в dev-deps).

### 5.2 Дистрибутив

| Артефакт | Размер |
|----------|-------:|
| Release EXE | **27.9 МБ** |
| MSI-инсталлятор (x64) | **9.7 МБ** |

🟢 Нормально для Tauri (для сравнения: Electron эквивалент 100+ МБ).

### 5.3 Перф-паттерны (React)

| Паттерн | Использований | Комментарий |
|---------|:-------------:|-------------|
| `React.memo` / `memo()` | **43 в 24 файлах** | Применяется в «горячих» компонентах: `CalibrationChartsUplot`, `experiment-filters`, `raw-data-table`, `CycleRow`, `reagents-manager` |
| `useShallow(...)` | 14 в 12 файлах | Все мульти-селекты из Zustand — через shallow |
| `useMemo` / `useCallback` / `useEffect` | 176 в 51 файле | Средне, без перекоса |
| Прямые подписки на стор без shallow | Обнаружены в некоторых мелких компонентах (см. §10) | Точечная правка при необходимости |

### 5.4 Риски перерисовки

- `useChartSettingsStore(...)` без `useShallow` встречается в нескольких мелких местах (напр., `cycle-results-table.tsx`, `raw-data-table.tsx`) — перерисовка на любой правке стора. Некритично, пока компоненты лёгкие, но стоит унифицировать.

---

## 6. Тесты

| Уровень | Файлов | Статус |
|---------|:-----:|:------:|
| Vitest (unit + integration) | **80** | **1 190 passed / 6 skipped** — 100 % зелёный прогон |
| Playwright E2E (активные) | 26 | стабильны в CI |
| E2E архив | — | `_archived/` — не считается |
| Release-уровневые тесты | 1 (`update-manifest-format`) | 6 skipped — намеренно (условные сценарии) |

**Skipped (10 мест):**
- 6 × `update-manifest-format` (условные сценарии)
- 2 × e2e `geometry-save-load` (архив)
- 1 × `full-workflow.spec.ts`
- 1 × `reports/real-native-export.tauri.spec.ts` (требует Tauri runtime)

🟢 Нет признаков «заглушенных» упавших тестов. Пропуски семантически обоснованы.

---

## 7. База данных

- **Один файл миграции**: `db/migrations/v0001_initial.rs` (438 LOC) + тесты `migration_tests.rs`.
- Используются: `db/pool.rs`, `db/columnar.rs`, `db/repositories/experiments/{read,write,delete}.rs` + `reagents.rs`.

🟡 С ростом фич потребуется вторая миграция → уже стоит подумать о стратегии версионирования и откатов.

---

## 8. Безопасность

### 8.1 npm audit

| Scope | Результат |
|-------|-----------|
| `--omit=dev` (runtime) | 🟢 **0 уязвимостей** |
| Полный аудит | 🟡 3 уязвимости в dev-deps: |
| | — **vite ≤ 6.4.1** (high) — path traversal в dev-сервере, WS file-read |
| | — **flatted ≤ 3.4.1** (high) — unbounded recursion DoS (через транзитив у eslint) |
| | — **brace-expansion** (moderate) — zero-step hang (через eslint/glob) |

Все — через `npm audit fix` безопасно патчатся (dev-only).

### 8.2 Tauri / IPC

- CSP настроен в `tauri.conf.json` (требует ревью на предмет `'unsafe-inline'`).
- 94 команды — IPC-surface нужно задокументировать (см. §11).

### 8.3 Licensing

- Отдельный модуль `commands/licensing/` — изолирован, имеет свою подсистему тестов (`licensing_tests.rs` 577 LOC + `crypto_tests.rs`).
- Ed25519-подписи + machine fingerprinting — выглядит корректно.

---

## 9. Зависимости

### 9.1 Runtime (30)

Стек стабилен и современный:
- **React 19.2.1**, **Zustand 5.0.9**, **uPlot 1.6.32**, **Zod 4.1.13**
- **Tauri API 2.9.1** + плагины: `dialog`, `fs`, `http`, `log`, `os`, `process`, `shell`, `updater`
- **Radix UI** (8 примитивов), **Tailwind + animate**, **date-fns 4**, **lucide-react**, **@tanstack/react-virtual**

### 9.2 Dev (25)

**Vite 6.3.5**, **TypeScript 5**, **Vitest 4.0.16**, **Playwright**, **@react-pdf/renderer**, **ExcelJS**, **JSZip**, **pdf-parse**, **rollup-plugin-visualizer**, **jsdom**, **@testing-library/***, **ESLint 9**.

### 9.3 Cargo

~75 зависимостей (rusqlite, r2d2, tauri*, ed25519-dalek, …). Требуется `cargo audit` в CI (если ещё не подключён).

---

## 10. Хот-споты / технический долг

### 🔴 Высокий приоритет

1. **`db/columnar.rs`** — 21 `.unwrap()` в сериализации. Один повреждённый байт → паника. _Починить за ~1 день._
2. **`backup/export.rs`** — 15 `.unwrap()` при работе с FS. Риск паники при отказе диска.
3. **dev-deps уязвимости** — `npm audit fix` (проверить, что не ломает build).

### 🟡 Средний приоритет

4. **Декомпозиция больших файлов:**
   - `useRheologyChartOptions.ts` (430) → `axes.ts` + `tooltip.ts` + `series.ts`.
   - `commands/analysis.rs` (444) → разнести по сабмодулям.
   - `src/lib.rs` (439) → вынести регистрацию команд в отдельный `commands/register.rs`.
5. **Унификация подписок на `useChartSettingsStore`** — везде через `useShallow` с узкими селекторами.
6. **Вторая DB-миграция** — подготовить инфраструктуру до того, как понадобится.

### 🟢 Низкий приоритет / гигиена

7. **3 `TODO`** в `LicenseActivationDialog` / `DevModeSection` — закрыть или задокументировать.
8. **`src/types/index.ts` (366 LOC)** — разбить по доменам (`experiment.ts`, `analysis.ts`, …).
9. **ADR**: создать `docs/adr/0001-zustand-persist-strategy.md`, `0002-tauri-ipc-conventions.md`.
10. **`rollup-plugin-visualizer`** уже в dev-deps — завести npm-скрипт `npm run build:analyze`.

---

## 11. Рекомендованный roadmap (4 недели)

### Неделя 1 — стабильность
- [ ] Заменить `unwrap()` на `?` + `thiserror` в `columnar.rs`, `backup/export.rs`, `parsing/mod.rs`.
- [ ] `npm audit fix`; добавить `cargo audit` и `npm audit --omit=dev` в CI.
- [ ] Закрыть 3 `TODO`.

### Неделя 2 — архитектура
- [ ] Декомпозиция `useRheologyChartOptions`, `commands/analysis.rs`, `src/lib.rs`.
- [ ] Раскол `src/types/index.ts` по доменам.
- [ ] Миграционная инфраструктура (v0002 placeholder + rollback-стратегия).

### Неделя 3 — перф
- [ ] Запустить `rollup-plugin-visualizer` → отжать 10–15 % из main-chunk.
- [ ] Унифицировать все `useChartSettingsStore` → `useShallow`.
- [ ] Добавить `React.memo` для ещё 3–5 горячих компонентов (кандидаты: `ComparisonLegend`, `CycleRow`, `raw-data-table`).

### Неделя 4 — документация
- [ ] `docs/architecture.md` — обзор слоёв, данных, IPC.
- [ ] `docs/ipc-surface.md` — таблица из 94 команд (имя, параметры, возврат, error modes).
- [ ] Первые 2 ADR.

---

## 12. Приложения

### 12.1 Команды для повторяемости аудита

```powershell
# LOC
Get-ChildItem -Path src -Recurse -File -Include *.ts,*.tsx | Measure-Object -Line
# Крупнейшие файлы
Get-ChildItem -Path src -Recurse -File -Include *.ts,*.tsx | Select @{n='LOC';e={(gc $_.FullName|Measure -Line).Lines}}, FullName | Sort LOC -Desc | Select -First 20
# Качество Rust
rg --type rs --glob '!**/*_tests.rs' --glob '!**/tests/**' '\.unwrap\(\)' src-tauri/src
# Аудит
npm audit --omit=dev
cargo audit --manifest-path src-tauri/Cargo.toml  # (после установки)
# Анализ бандла
npm run build && Get-ChildItem dist/assets | Sort Length -Desc
```

### 12.2 Снимки команд (сохранить рядом)

- `scripts/audit/collect-metrics.ps1` (предложение к созданию) — автоматизирует §2–§5.

---

**Автор отчёта:** Cascade (AI pair programmer)
**Следующий ревью:** через 4 недели (после выполнения roadmap).
