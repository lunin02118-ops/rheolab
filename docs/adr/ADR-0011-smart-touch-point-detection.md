# ADR-0011 — Детектирование точки касания (Smart Touch-Point)

- **Status**: Implemented (PR1 — Phases 1–4)
- **Date**: 2026-04-22
- **Target version**: 0.2.0-beta.25
- **Related**: ADR-0007 (parser pipeline), ADR-0010 (comparison report)

### История статуса

| Дата       | Статус      | Комментарий |
|------------|-------------|-------------|
| 2026-04-22 | Proposed    | План исправления 11 багов из аудита touch-points (BUG #1–#11). |
| 2026-04-22 | Implemented | TS (`src/lib/utils/touch-point.ts`) и Rust (`src/rust/rheolab-core/src/report_generator/touch_point/`) — 1:1 parity. Unit: Rust 12/12, Vitest touch-point suite 55/55. Full gate: Rust 213/213, Vitest 1272/1278 (6 skipped). |

---

## 1. Контекст

Smart touch-point — это два маркера, которые накладываются на график зависимости вязкости от времени:

1. **Threshold-точка** — момент падения вязкости ниже пользовательского порога (например, 50 cP). Используется как индикатор гель-брейка.
2. **Target-time точка** — значение вязкости в заданный момент времени (например, 10 мин) для сравнения жидкостей по одной временной метке.

Алгоритм детектирования реализован дважды — в TypeScript (для интерактивного графика) и в Rust (для PDF/Excel отчётов). Отклонение выдаваемых маркеров между двумя реализациями ⇒ отчёт не совпадает с графиком.

В апреле 2026 года внутренний аудит выявил **11 багов** разной степени критичности. Этот ADR фиксирует, как мы их закрываем и какие инварианты теперь поддерживаются.

---

## 2. Проблемные места аудита

| № | Баг | Симптом | Корневая причина |
|---|-----|---------|------------------|
| 1 | Unit mismatch Y-scale | Маркер threshold рисовался в cP, пока ось Y была в Pa·s / mPa·s | Плагин подставлял `viscosityThreshold` как есть, без учёта display-unit |
| 2 | Desync маркер ↔ кривая | После downsampling’а маркер «висел» между вершинами | Не было snap-to-series после рендера |
| 3 | Info-panel unit mismatch | Хинт в info-панели показывал cP даже при выбранных Pa·s | `useRheologyVisibility` игнорировал displayUnit |
| 4 | Target-time на shear-rate jump | При смене plateau вязкость интерполировалась через вертикальный разрыв | Линейная интерполяция без проверки шаг-в-шаг shear-rate |
| 5 | Threshold-line в отчётах | В PDF линия threshold рисовалась в сыром cP, независимо от выбранной единицы | Генератор брал `viscosityThreshold` без конверсии |
| 6 | `MIN_CONSECUTIVE_BELOW = 3` точки | При плотной выборке (1 с) triggered на 3 секунды шума; при разреженной (60 с) — на 3 минуты | Hardcoded point-based порог |
| 7 | Peak detection без decline ratio | На шумном плато ramp-up принимался за пик | Сравнение `avg[i] < avg[i-1]` без допуска |
| 8 | Асимметричный dominant cluster | Cluster рос только «вверх» (`centre·(1+tolerance)`) → промах между плато | Greedy walk без учёта симметричного окна |
| 9 | `SLOPE_LOOKBACK_POINTS = 10` | На разреженной выборке 10 точек = 10 минут — slope-guard становился слишком широким | Hardcoded point-based lookback |
| 10 | NaN / ∞ poison | Одиночный NaN во входе → недетерминированный sort, зависание median | Нет сантайза инпутов |
| 11 | TS/Rust parity | Отчёт и график разошлись после правок в TS | Нет parity-тестов на реальной fixture |

---

## 3. Решение

### 3.1 Архитектурные инварианты

1. **Единственный источник правды** — `src/lib/utils/touch-point.ts` (TS) и `src/rust/rheolab-core/src/report_generator/touch_point/` (Rust). Любое изменение алгоритма обязано быть применено в обеих реализациях одним коммитом.
2. **Алгоритм работает в cP** (внутренняя единица). Вся конверсия в display-unit происходит в слое отображения (плагин `touchPoints`, info-panel, PDF-рендер).
3. **Все константы, зависящие от плотности выборки, выражаются в секундах**. Конвертация в точки — через `medianSamplingInterval`, с нижней границей в виде легаси point-based константы.
4. **Инпут санитайзится на входе** — NaN / ±Infinity / отрицательный shear_rate фильтруются в одном месте (`sanitizeTouchPointInputs` / `sanitize_touch_point_inputs`), чтобы downstream логика никогда не встречала ни одного non-finite числа.
5. **Маркер сидит ровно на кривой**. TS-плагин после расчёта вызывает `snapToSeries()` — если ближайшая вершина в пределах `samplingInterval × 1.5`, маркер стягивается к ней; иначе — интерполяция между двумя соседями.

### 3.2 Ключевые изменения кода

| Область | TS | Rust |
|---------|----|------|
| Snap-to-series | `src/lib/utils/series-snap.ts` (новый) + применён в `useRheologyData.ts` | `— `n/a (в Rust маркер не снапится, он поступает в typst сразу с координатой алгоритма)` |
| Shear-rate-jump guard | `calculateSmartTouchPoints` step 4 + `isShearRateJump` | `algorithm.rs` Step 4 + `is_shear_rate_jump` |
| Симметричный dominant cluster | `findDominantShearRate` через `lower_bound / upper_bound` | `helpers.rs` `find_dominant_shear_rate` с теми же bound-функциями |
| Time-based `MIN_CONSECUTIVE_BELOW_SECONDS` / `SLOPE_LOOKBACK_SECONDS` | Step 3 в `calculateSmartTouchPoints` | `algorithm.rs`, то же вычисление |
| `MIN_DECLINE_RATIO = 0.01` | `findViscosityPeak` | `helpers.rs` `find_viscosity_peak` |
| NaN sanitation | `sanitizeTouchPointInputs` | `sanitize_touch_point_inputs` |
| Parity-тест на fixture | `tests/utils/touch-point-fixture.test.ts` | `src/rust/rheolab-core/tests/touch_point_fixture_parity.rs` |

### 3.3 Публичные контракты

- `TouchPointResult.anomaly` расширен до `'shear-rate-jump'` (TS) / `TouchPointAnomaly::ShearRateJump` (Rust). Поле optional, обратно совместимо.
- Плагин `touchPoints` теперь принимает `displayUnit?: ViscosityUnit`. При отсутствии используется `'cP'`, старое поведение.
- Helper-функции `findNearestTimeIndex`, `medianSamplingInterval`, `snapToSeries` в `src/lib/utils/series-snap.ts` — переиспользуемы и покрыты 16 unit-тестами.

---

## 4. Тестовая стратегия

1. **Unit-параметризация алгоритма**: `tests/utils/touch-point.test.ts` — 37 базовых + 4 новых (shear-rate-jump, NaN sanitation). Rust-зеркало `tests.rs` — те же 12 сценариев через `#[test]`.
2. **Snap-helpers**: `tests/utils/series-snap.ts` — 16 тестов (`findNearestTimeIndex`, `medianSamplingInterval`, `snapToSeries`).
3. **Real fixture parity**: оба стека читают один и тот же JSON (`tests/fixtures/t-20.02.26-1-561-110C.json`) и проверяют идентичный контракт — threshold в 180–220 мин.
4. **Release-gate**: `npm run release-gate` включает `cargo test` по всему `rheolab-core` и `vitest run` всей suite. Оба должны быть зелёными перед релизом.

---

## 5. Последствия

- Алгоритм touch-points ведёт себя одинаково на любой частоте дискретизации (1 с ↔ 60 с) и на любом состоянии входа (включая NaN).
- PDF/Excel отчёт и график на вкладках Analysis / Comparison больше не могут разойтись по координате маркера — это защищено fixture parity-тестом.
- Будущие оптимизации (мемоизация smoothing, параллельное сканирование) не изменят результат: они обязаны пройти фиксированный JSON-снапшот.

---

## 6. Открытые вопросы / следующие шаги

- Memoization сглаживания (`median smoothing`) в TS пока не реализована — трудозатраты > выигрыша (Step 3 выполняется <1 мс на 670 точках). Возврат к теме после PR2, если профилирование на больших датасетах (>50 000 точек) покажет узкое место.
- В PR2 добавится **фильтр по touch-point-интервалу** в сайдбаре списка экспериментов. Алгоритм, исправленный здесь, станет источником данных для серверного SQL fast-path.
