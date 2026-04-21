# Report UX Overhaul — TZ v5 + Progress Tracker

**Task ID**: VLA-14 (Report UX Overhaul) + VLA-12 (per-series units) + VLA-13 (report units regression guard)
**Started**: 2026-04-27
**Target release**: `0.2.0-beta.11`

---

## 1. Цель

Упростить и унифицировать UX работы с отчётами: **один источник истины** для визуала графика + **быстрая генерация стандартизованного отчёта** прямо с главной страницы после парсинга.

---

## 2. Архитектурные решения (зафиксированы)

1. **Один источник истины для визуала чарта** — удалить `reportSettings` из `chart-settings-store`. Дашборд, превью отчёта, PDF/Excel чарт используют один и тот же `settings` (цвета, стили, оси, единицы, точность, сетка).
2. **Страница `/reports` удаляется полностью** — роут, навигация, страница.
3. **Новая вкладка «Отчёт» на главной** — рядом с `График / Таблица / Рецептура / Анализ воды / Калибровка`.
4. **Содержимое вкладки «Отчёт» — минималистичное**: 2 чекбокса секций + 2 чекбокса формата + 1 кнопка. Нет превью, нет дропдаунов.
5. **Настройки → Отчёты удаляется целиком** — параметры переезжают в **Общие** (язык отчёта, компания/лого, default showCalibration, default showRawData).
6. **Per-series unit selectors** — только в `Настройки → Графики → Настройки линий → колонка «Ед.изм.»`.
7. **Карточка «Единицы вязкости» в Общие удаляется** (заменяется per-series в Графики).
8. **Store `display-settings-store.ts` удаляется полностью**.
9. **Advanced-статистика (PV/YP)** — автоматом по режиму `useUIMode().isExpert`, без отдельного чекбокса.
10. **Точки касания, Target time, viscosityThreshold** — исключены (переедут в будущую функциональность вкладки `Сравнение`).
11. **Видимость линий чарта (T / γ̇ / P / Tᵇ / RPM)** — только через `Настройки → Графики → Настройки линий → Вкл`, не дублируется на вкладке Отчёт.

---

## 3. UI вкладки «Отчёт» (окончательно)

```
┌─ Секции отчёта ─────────────────────────────┐
│ ☐ Сырые данные                              │
│ ☐ Калибровка                                │
└─────────────────────────────────────────────┘

┌─ Формат ────────────────────────────────────┐
│ ☑ PDF    ☑ Excel                            │
│                                             │
│            [ ⬇ Скачать отчёт ]             │
└─────────────────────────────────────────────┘
```

**Логика кнопки**: если `formatPdf` — генерит PDF и вызывает save-dialog; если `formatExcel` — то же для Excel; если оба — последовательно оба файла.

**Источники остальных настроек** (не управляются с вкладки):
- `language` → `Настройки → Общие → Язык отчёта`
- `showAdvancedStats` → `useUIMode().isExpert`
- Видимость линий T/γ̇/P/Tᵇ/RPM → `settings.lines[*].visible` (Графики)
- Единицы всех параметров → `settings.lines[*].unit` (Графики)
- Цвета/стили/оси/толщина линий → `settings.lines[*]` (Графики)
- Company name/logo → `useBrandingStore` (карточка в Общие)
- `showTouchPoints`, `viscosityThreshold`, `showTargetTime`, `targetTime` → **захардкожены `false`/`0`** на фронте (пока не переедут в Сравнение)

---

## 4. Новая структура Настроек

**Было**: `Общие / Данные / Графики / Отчёты / Система` (5 вкладок)
**Стало**: `Общие / Данные / Графики / Система` (4 вкладки)

### `Настройки → Общие` (с новыми карточками)

```
📝 Язык и локаль
└─ Язык UI: [РУС]

📊 Отчёты по умолчанию                       ← НОВАЯ карточка
├─ Язык отчёта: [РУС ▼]
├─ ☐ Включать калибровку по умолчанию
└─ ☐ Включать сырые данные по умолчанию

🏢 Организация                                ← НОВАЯ карточка
├─ Название компании: [________________]
└─ Логотип: [ Загрузить ]
```

**Удаляется** из Общие:
- Старая карточка «Единицы вязкости» (заменяется per-series в Графики)

### `Настройки → Графики` (обновление таблицы линий)

```
Настройки линий
┌────┬─────────┬──────┬────────┬─────┬────┬────────┐
│ Вкл│Параметр │ Цвет │Толщина │Стиль│ Ось│Ед.изм. │ ← НОВАЯ колонка
├────┼─────────┼──────┼────────┼─────┼────┼────────┤
│ ⬤ │Вязкость │ [■] │ [2]    │ ━━ │ L  │[Pa·s ▼]│
│ ⬤ │Темп. T  │ [■] │ [2]    │ ━━ │ R  │[°C  ▼] │
│ ⬤ │Темп. Tᵇ │ [■] │ [2]    │ ┅┅ │ R  │[°C  ▼] │
│ ⬤ │γ̇       │ [■] │ [2]    │ ━━ │ L  │[1/s  ▼]│
│ ⚪ │Давл. P  │ [■] │ [2]    │ ━━ │ R  │[bar ▼] │
│ ⚪ │RPM      │ [■] │ [2]    │ ━━ │ L  │[RPM ▼] │
└────┴─────────┴──────┴────────┴─────┴────┴────────┘
```

---

## 5. Per-series юниты

| Параметр | Варианты (включая Imperial) |
|---|---|
| Вязкость (η) | `mPa·s` · `Pa·s` · `cP` |
| Температура (T) | `°C` · `°F` · `K` |
| Темп. бани (Tᵇ) | `°C` · `°F` · `K` |
| Скорость сдвига (γ̇) | `1/s` |
| Давление (P) | `bar` · `psi` · `MPa` · `kPa` |
| Обороты (RPM) | `RPM` |

**Поведение**: при выборе `cP` для вязкости бэкенд передаёт значения в `cP` + автоматически переключает K'/Ks/Kp на `lbf·s^n/100ft²`, PV на `cP`, YP на `lbf/100ft²` (семейство Imperial).

---

## 6. Удаляемые поля (cleanup)

### TypeScript

- `chart-settings-store.reportSettings` и все связанные методы (`setReportSettings`, `setReportLineSettings`, `setReportPrecision`, `resetReportToDefaults`, `copyDisplayToReport`)
- `DEFAULT_REPORT_LINE_SETTINGS`, `DEFAULT_REPORT_SETTINGS` (или оставить только для migration backward compat)
- `display-settings-store.ts` целиком + все импорты (`useDisplaySettingsStore`, `getViscosityUnit`, `convertViscosity`, `getViscosityDecimals`, `toRustUnitSystem`, `UnitSystem`)
- Поля `showTouchPoints`, `viscosityThreshold`, `showTargetTime`, `targetTime` из `ReportSettings` (шлются жёстко `false`/`0`)
- `useReportExport` — упростить интерфейс
- `ReportsPanel` целиком (после удаления /reports)

### Rust

- (опционально) `settings.unit_system` поле — заменяется per-line `line_settings.{param}.unit`. Можно оставить до первой major-версии для backward-compat.

### Routes / Components

- `src/app/dashboard/reports/page.tsx` → удалить
- `src/components/reports/*` → удалить (`ReportsPanel.tsx`, `hooks/useReportExport.ts` переместить в `components/analysis/report-tab/`)
- `src/components/settings/ReportSettingsManager.tsx` → удалить

### Navigation

- Убрать `Отчёты` из top-bar

---

## 7. Фазы реализации и Progress

> Легенда: `[ ]` — не начато, `[~]` — в работе, `[x]` — завершено, `[!]` — заблокировано/проблема

### Фаза A — Удаление `reportSettings` из стора (refactor) ✅

- [x] A1. Удалить `reportSettings` из `ChartSettingsState` интерфейса
- [x] A2. Удалить методы `setReportSettings`, `setReportLineSettings`, `setReportPrecision`, `resetReportToDefaults`, `copyDisplayToReport`
- [x] A3. Удалить `DEFAULT_REPORT_SETTINGS`, `DEFAULT_REPORT_LINE_SETTINGS` экспорты
- [x] A4. Обновить все места где читается `reportSettings`:
  - `src/lib/reports/report-builders.ts` → `chartSettings`
  - `src/components/reports/hooks/useReportExport.ts` → `chartSettings`
  - `src/components/reports/ReportsPanel.tsx` → `useChartSettingsStore(s => s.settings)`
  - `src/hooks/useRheologyVisibility.ts` → single `chartSettings`
- [x] A5. Store migration v7 → v8: `delete state.reportSettings`
- [x] A6. `exportSettings`/`importSettings` упрощены (одно поле, backward-compat с v7 format)
- [x] A7. Удалить `ReportSettingsManager.tsx`
- [x] A8. `ChartSettingsManager.tsx` — пометка «применяются ко всем графикам, включая PDF/Excel»
- [x] A9. `npm run test` — 94/94 tests pass

### Фаза B — Удаление страницы `/reports`

- [ ] B1. Удалить `src/app/dashboard/reports/page.tsx` (или редирект на `/dashboard`)
- [ ] B2. Убрать ссылку «Отчёты» из top-bar (`src/components/TopBar.tsx` или аналогичный)
- [ ] B3. Проверить что нет broken links с других страниц

### Фаза C — Удаление Настройки → Отчёты, перенос в Общие

- [x] C1. Удалить вкладку «Отчёты» из `src/app/dashboard/settings/page.tsx` (done in A6)
- [ ] C2. Добавить карточку «Отчёты по умолчанию» в Общие (язык, showCalibration, showRawData)
- [x] C3. Переместить карточку «Организация» (BrandingManager) в Общие (done in A6)
- [ ] C4. Создать `useReportDefaultsStore` (или расширить `useBrandingStore`) для новых глобальных настроек
- [ ] C5. Удалить карточку «Единицы вязкости» из Общие
- [ ] C6. Обновить все импорты и использования удалённых настроек

### Фаза D — Новая вкладка «Отчёт» на главной

- [ ] D1. Найти главную страницу анализа (где таб-бар График/Таблица/…)
- [ ] D2. Создать `src/components/analysis/ReportTab.tsx` с минимальным UI (2+2 чекбокса + кнопка)
- [ ] D3. Добавить таб в таб-бар после «Калибровка»
- [ ] D4. Состояние чекбоксов — локальный `useState`, дефолты из `useReportDefaultsStore`
- [ ] D5. Логика «Скачать»: вызов `generatePdfReportBlob()` и/или `generateExcelReportBlob()` с `saveBlob()`
- [ ] D6. Disable состояние кнопки: оба формата не выбраны → disabled
- [ ] D7. Loading/error indicators во время генерации

### Фаза E — Per-series unit selectors в Графики

- [ ] E1. Расширить `LineSettings` типом `unit: LineUnit` + per-family union types (уже сделано)
- [ ] E2. `DEFAULT_LINE_SETTINGS` — указать дефолтный unit для каждого параметра
- [ ] E3. Store migration v8 → v9: добавить дефолтный unit к каждой персистированной линии
- [ ] E4. `LineConfigRow` — добавить колонку с `<select>` для юнита
- [ ] E5. `LINE_CONFIGS` — расширить с `unitOptions` полем (доступные варианты per parameter)
- [ ] E6. Шапка таблицы в `ChartSettingsManager.tsx` — добавить «Ед.изм.»
- [ ] E7. Single-option параметры (γ̇, RPM) — dropdown disabled

### Фаза F — Применение units на дашборде

- [ ] F1. Создать `src/lib/units/converters.ts` с функциями (зеркало Rust):
  - `convertViscosity(v_mpas, unit)`
  - `convertTemperature(t_c, unit)`
  - `convertPressure(p_bar, unit)`
  - `convertConsistencyIndex(k_pasn, viscosityUnit)` — unit-семейство
  - `convertPV(pv_pas, viscosityUnit)`
  - `convertYP(yp_pa, viscosityUnit)`
  - `getKUnit(viscosityUnit)` etc.
  - `getDecimals(unit)` per parameter
- [ ] F2. `cycle-results-table.tsx` — читать unit из `settings.lines.viscosity.unit`, динамические заголовки η/K'/Ks/Kp/PV/YP
- [ ] F3. `CycleRow.tsx` — конвертация значений η, K', Ks, Kp, PV, YP
- [ ] F4. `CycleStepsDetail.tsx` — dynamic header + conversion для viscosity column
- [ ] F5. `cycle-editor-dialog.tsx` — применить те же helpers
- [ ] F6. Чарт (`ExperimentChart` или аналогичный) — axis title + tick formatter используют per-series unit
- [ ] F7. Tooltips чарта — значения конвертируются и показываются в выбранных юнитах

### Фаза G — Удаление `display-settings-store.ts`

- [ ] G1. Заменить все импорты `useDisplaySettingsStore` на чтение из `useChartSettingsStore`
- [ ] G2. Заменить все импорты хелперов (`convertViscosity` etc.) на новые из `src/lib/units/converters.ts`
- [ ] G3. Удалить сам файл `display-settings-store.ts`
- [ ] G4. Удалить persist key `rheolab-display-settings` (либо через migration очистки)
- [ ] G5. `npm run test` + `npm run build` — проверить сборку

### Фаза H — Rust backend: per-line units

- [ ] H1. Расширить Rust `LineSettings` struct полем `unit: String`
- [ ] H2. Передавать unit через `convertReportInputToWasm` во фронтовом конверторе
- [ ] H3. Rust `formatters.rs` — `get_viscosity_unit` etc. принимают `unit: &str` напрямую
- [ ] H4. PDF `stats.rs` — заголовки и конверсия через `input.settings.line_settings.viscosity.unit` вместо `settings.unit_system`
- [ ] H5. Excel `stats.rs` — аналогично
- [ ] H6. `raw_data.rs`, `touch_points.rs`, `chart_page.rs` — обновить
- [ ] H7. Добавить Rust integration test: `tests/reports_per_line_unit_integration.rs`
- [ ] H8. (опц.) Убрать поле `unit_system` после backward-compat периода
- [ ] H9. `cargo test --manifest-path src-tauri/Cargo.toml` — green

### Фаза I — Тесты

- [ ] I1. Store migration test (v7 → v8 → v9)
- [ ] I2. Unit conversion helpers tests (TypeScript)
- [ ] I3. E2E Playwright: `tests/e2e/unit-selection.spec.ts`:
  - Выбрать Pa·s в Графики
  - Открыть эксперимент, проверить что dashboard η показывает конвертированные значения + заголовок (Pa·s)
  - Кликнуть «Скачать отчёт» (PDF) → распарсить результат → проверить наличие (Pa·s) в тексте
  - То же для Excel
- [ ] I4. E2E: удаление /reports — при попытке перейти — редирект или 404

### Фаза J — Release

- [ ] J1. Bump `package.json` и `src-tauri/Cargo.toml` → `0.2.0-beta.11`
- [ ] J2. `scripts/release/build.ps1` — должен работать с новым smoke-тестом
- [ ] J3. CHANGELOG обновить
- [ ] J4. Публикация в alpha channel
- [ ] J5. Smoke-test на установленной версии (ручной)
- [ ] J6. Promote в stable после подтверждения

---

## 8. Риски и открытые вопросы

- **Миграция persisted state**: пользователи с кастомными `reportSettings.lines` потеряют настройки. Стратегия — скопировать их разово в `settings.lines` при migration v8 если `settings.lines` == дефолты (иначе дропнуть).
- **Обратная совместимость Rust IPC**: добавление `unit` в `LineSettings` — non-breaking если в Rust это `serde` с default. Удаление `unit_system` — breaking; оставить до следующей major-версии.
- **Режим Expert**: переключение Basic ↔ Expert НЕ должно стирать выбранные секции отчёта. Локальный state на вкладке Отчёт не зависит от режима.

---

## 9. Работа в сессиях

Этот файл обновляется после каждой завершённой суб-задачи. При смене сессии — читать актуальный статус отсюда.

Последнее обновление: `2026-04-27 09:21 UTC+05:00` — Фаза A завершена. Все 9 суб-задач выполнены, 94/94 тестов проходят.
