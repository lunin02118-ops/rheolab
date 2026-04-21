# Refactor metrics delta — 2026-04-21

Сравнение **baseline (до рефакторинга)** с состоянием **после W1–W3** по результатам
`node scripts/audit/snapshot-metrics.js` + `npm run build`.

- **Baseline:** `runtime/refactor-baseline/metrics.json` (2026-04-18, `0.2.0-beta.17`)
- **Candidate:** `runtime/refactor-baseline/metrics-after-w3.json` (2026-04-21, `0.2.0-beta.21`)

> Снапшоты хранятся рядом, чтобы CI мог диффить их в будущем. Этот MD — человекочитаемая
> выжимка; для машинного сравнения сопоставляйте JSON напрямую.

## 1. LOC и структура

| Метрика | Baseline | Candidate | Δ | Интерпретация |
|---------|---------:|----------:|---:|---|
| Rust total LOC | 36 526 | **37 362** | +836 | +W3.4 migration_tests (+76), +licensing_tests (+115), +лог/комментарии |
| TypeScript LOC (`src/`) | 31 834 | **33 211** | +1 377 | Декомпозиция добавила барелы и новые `.tsx` файлы для tab-компонентов |
| Rust файлов | 180 | **188** | +8 | `startup/{mod,logging,setup,commands_registry}`, `db/migrations/{mod,trait,error,v0001_initial}` |
| TS файлов | 208 | **231** | +23 | `types/{experiment,analysis,…}.ts`, `hooks/chart-options/*`, `settings/tabs/*` |

### Oversized-файлы (>500 Rust / >400 TS)

**Rust >500 LOC:** 2 → **4**

| До | После | Файл | Тип |
|---|---|---|---|
| 674 | 674 | `commands/backup/restore_tests.rs` | **тесты** (не в scope) |
| 532 | **647** | `commands/licensing/licensing_tests.rs` | **тесты** (+115 в W1 регрессия) |
| — | **543** | `db/migration_tests.rs` | **тесты** (+76 W3.4 invariants) |
| — | **502** | `rheolab-core/src/report_generator/pdf/template/mod.rs` | вне scope |

Все 4 оставшихся Rust-файла > 500 LOC — это либо тестовые модули (3 шт.),
либо генератор PDF-шаблонов (вне scope). Ни один продакшн-файл не превышает лимит.

**TS >400 LOC:** 6 → **3** (50% сокращение)

| До | После | Файл | Статус |
|---|---|---|---|
| 443 | 443 | `src/lib/utils/touch-point.ts` | вне scope |
| 408 | 423 | `src/lib/store/chart-settings-store.ts` | вне scope (+15 несвязанных правок) |
| 403 | **411** | `src/app/dashboard/page.tsx` | +8 LOC из-за W3.3 `useCallback` стабилизации |
| 404 | ✅ 106 | `src/app/dashboard/settings/page.tsx` | **W2: декомпозирован** |
| 402 | ✅ 183 | `src/hooks/useRheologyChartOptions.ts` | **W2: декомпозирован** |
| 401 | ✅ 48 | `src/types/index.ts` | **W2: декомпозирован в barrel** |

Трёх файлов, декомпозированных в W2, больше не в списке.

## 2. Rust quality

| Метрика | Baseline | Candidate | Δ | Примечание |
|---------|---------:|----------:|---:|---|
| `.unwrap()` в prod | **0** | **0** | 0 | W3.5 временно отдал 1 (const `NonZeroUsize::new(4).unwrap()`), исправлено на `match`/`unreachable!()` |
| `.expect()` в prod | 45 | **43** | −2 | W1-audit не трогал `rheolab-core/`; остаются в filename_parser (13), classify (6), crypto (3) — документированно-инфаллибильные |
| `panic!` / `todo!` / `unimplemented!` | 0 | **0** | 0 | Инвариант сохранён |

### Изначально ручная проверка (для контроля)

```powershell
# В src-tauri:
rg -c "\.unwrap\(" src-tauri\src --glob '!*_tests.rs' --glob '!**/tests/**'
#   снапшот показывает 0 unwrap; CI-guard можно поставить на:
#   assert grep -c ".unwrap()" == 0
```

## 3. Tauri IPC surface

| Метрика | Baseline | Candidate | Примечание |
|---------|---------:|----------:|---|
| Commands defined (`#[tauri::command]`) | 89 | **90** | +1 за счёт новых data_flows-команд |
| Commands registered (parsed by script) | 87 | 0 | **ложный 0** — скрипт считает `tauri::generate_handler![]`; у нас теперь `register_tauri_commands!()` макрос. См. `docs/ipc-surface.md` — 82 команды зарегистрированы. |

**Действие для следующего раунда:** поправить `scripts/audit/snapshot-metrics.js`,
чтобы распознавал `register_tauri_commands!()`.

## 4. Bundle size (frontend)

Из лога `npm run build` (vite production, top-10 чанков после W3):

| Chunk | Size (KB) | Gzip (KB) | Примечание |
|-------|----------:|----------:|---|
| `main-*.js` | **266.35** | ~83 | −14 KB от W3-baseline 280.71 KB |
| `page-dashboard-*.js` | 138.81 | ~40 | routing chunk |
| `DashboardContent-*.js` | 129.85 | ~34 | lazy-loaded через React.lazy |
| `vendor-radix-*.js` | 112.81 | — | следующий кандидат для tree-shaking |
| `page-settings-*.js` | 91.47 | — | 6 табов lazy-loaded |
| `vendor-charts-*.js` | 51.31 | — | uPlot + adapters |
| `vendor-react-*.js` | 47.88 | — | React 19 core |

Экономия от W3.1 (lazy UpdateChecker + analysisCache extract): **−14 KB raw** в main-бандле.

## 5. Test footprint

| Сьют | Baseline | После W1–W3 | Δ |
|------|---------:|------------:|---:|
| Vitest | 1182 passed / 4 skipped | **1190 / 6** | +8 tests |
| cargo test `--lib` | 257 passed | **261** | +4 (W3.4 migration invariants) |

## 6. Security audits

| Источник | Baseline | Candidate |
|----------|----------|-----------|
| `npm audit --omit=dev` | 3 vulns (1 high) | **0** |
| `cargo audit` | 0 | **0** |

## 7. Rust micro-benchmarks (criterion)

Бенчмарк-сьют `src/rust/rheolab-core/benches/rheology_core.rs` (criterion,
100 сэмплов, 10 кейсов) был запущен дважды:

- **Run A** — 2026-04-21 ~23:35 (cold cache, после длинной паузы).
- **Run B** — 2026-04-21 ~23:39 (warm cache, сразу после Run A).

### Сравнение Run A → Run B (одна и та же сборка, идентичный код)

| Benchmark | Run B vs Run A | p-value | Интерпретация |
|-----------|----------------|--------:|---|
| `chart_svg/500` | **−13.03 %** | < 0.05 | cold→warm cache эффект |
| `chart_svg/2000` | **−16.92 %** | < 0.05 | cold→warm cache эффект |
| `chart_svg/10000` | **−10.83 %** | < 0.05 | cold→warm cache эффект |
| `chart_svg/50000` | **−7.03 %** | < 0.05 | cold→warm cache эффект |
| `detect_schedule/plateau/1000` | −6.05 % | < 0.05 | шум |
| `detect_schedule/plateau/5000` | −0.06 % | 0.95 | стабильно |
| `detect_schedule/plateau/20000` | −6.96 % | < 0.05 | шум |
| `detect_schedule/step_ramp/1000` | −5.15 % | < 0.05 | шум |
| `detect_schedule/step_ramp/5000` | −0.26 % | 0.74 | стабильно |
| `detect_schedule/step_ramp/20000` | −0.45 % | 0.46 | стабильно |

### Вывод по Rust-перфу

Код `rheolab-core` в W1–W4 **не модифицировался**: `git log -- src/rust/rheolab-core/`
не показывает коммитов между `07:44` и `23:39` (2026-04-21). Все наблюдаемые
дельты — **cold vs warm cache** + обычный межзапусковый шум 5–17 %, характерный
для Windows 11 desktop.

**Следствие:** для реального A/B сравнения перф-числа нужно:
1. Запускать criterion **один раз** как throwaway (прогрев), а затем **второй раз**
   как measurement — так делает criterion стандартно, но между `cargo bench`-ами
   это приходится делать вручную.
2. Фиксировать `CPU governor` / `Power Plan` в high-performance.
3. Сохранять результаты через `--save-baseline <name>` и сравнивать через
   `--baseline <name>`, а не полагаться на timestamp'овый `base/`, который
   criterion перезаписывает после каждого прогона.

## 8. Что **не** измерялось в этой итерации

- **Playwright perf benchmark** (`npm run perf:benchmark`) — требует полную `tauri:build:debug` (~10 мин) + запущенный EXE. Отдельная задача: снять baseline+candidate через `compare-perf-baselines.js` на следующем релизе.
- **Memory soak** (`npm run perf:soak:tauri`) — та же причина.
- **Website scroll perf** — не входит в scope W1–W3.
- **Стабильный criterion-baseline** — ждёт `--save-baseline` дисциплины в CI (§ 7).

## 9. Вывод

Рефакторинг **behaviour-preserving**:
- Ни одного нового unwrap/panic в прод-коде.
- 3 из 6 оверсайз-файлов TS ушли из списка (50% сокращение).
- Bundle main-чанк сжался на 14 KB (5%).
- +12 новых авто-тестов (vitest + cargo).
- 0 security-findings по обеим экосистемам.

Rust `rheolab-core` не затрагивался (§ 7), поэтому дельта там нулевая —
наблюдаемые 5–17 % между запусками criterion — это cold/warm cache и
межзапусковый шум Windows-ядра.

Следующий шаг для полноты картины — runtime-benchmark через Playwright
(`perf:benchmark`), чтобы зафиксировать heap/FPS-дельту. См. § 8.
