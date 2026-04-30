# Глубокий аудит RheoLab Enterprise — 2026-04-30

**Версия на момент аудита:** `0.2.2-alpha.7` (channel: `alpha`)
**HEAD:** `dfaf82c chore(release): stamp alpha 0.2.2-alpha.7 artifact`
**Воркспейс:** `D:\Development\Rheolab` — clean, sync с `origin/main`.
**Аудитор:** Cascade (deep-audit pass).

---

## 1. TL;DR

**Общий вердикт:** репозиторий в **здоровом состоянии**. Все основные боевые гейты проходят
(Vitest, Cargo, npm/cargo audit, version SSoT). Найдены **4 регрессии и 6 средних/низких
проблем**, ни одна из которых не блокирует релиз `alpha.7`, но часть из них относится к
high-risk зонам (Tauri capabilities, react-hooks correctness, размер `commands/reports.rs`).

| Метрика | Результат |
|---|---|
| `npm run version:validate` | PASS — все 4 dependents синхронизированы |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities (78 prod / 662 dev) |
| `cargo audit` | PASS — 0 vulnerabilities |
| `npm run test` (Vitest) | PASS — 1412 / 6 skipped / 0 failed (~16 c) |
| `cargo test` (workspace) | PASS — 501 + 25 (ai_parsing) + 12 (db_integrity) + 10 (ipc_contracts) = **548 pass / 0 fail / 3 ignored** |
| `npx tsc --noEmit` | **FAIL — 5 ошибок в 2 тест-файлах** |
| `npm run lint` | **FAIL — 10 ошибок react-hooks/no-console в 5 source-файлах** |
| `npx madge --circular` | PASS — нет циклических зависимостей |
| Worktree | Clean |
| TODO/FIXME/HACK в `src/` + `src-tauri/src/` | Практически отсутствуют (только тест-фикстуры) |

**Главное расхождение:** «Локальная валидация авторитативна» (per AGENTS.md) — а локально
ESLint и TypeScript падают. Релизный гейт `prerelease:prepare` запускает только
`version:validate`, поэтому drift `tsc/lint` мог проникнуть незамеченным. См. P1-2.

---

## 2. Сводная таблица проверок

| Проверка | Команда | Результат | Время |
|---|---|---|---|
| Версия SSoT | `node scripts/version/validate.js` | ✓ `0.2.2-alpha.7` во всех 4 dependents | <1 c |
| npm prod audit | `npm audit --omit=dev` | ✓ 0/0/0/0 (info/low/moderate/high/critical) | ~3 c |
| Cargo audit | `cargo audit` (`src-tauri/`) | ✓ no vulnerabilities | ~6 c |
| Vitest (unit + DOM) | `npm run test` | ✓ 1412 pass / 6 skip / 0 fail | ~16 c |
| Cargo test (workspace) | `cargo test --manifest-path src-tauri/Cargo.toml` | ✓ 548 pass / 0 fail / 3 ignored | ~33 c |
| TypeScript strict | `npx tsc --noEmit` | ✗ **5 errors** в `tests/components/zoom-plugin.test.ts`, `tests/e2e/saved-report-by-id-smoke.tauri.spec.ts` | ~12 c |
| ESLint | `npm run lint` | ✗ **10 errors** в 5 source-файлах | ~8 c |
| Циклы импорта (madge) | `npx madge --circular --extensions ts,tsx src` | ✓ 255 файлов / 0 циклов | ~3 c |
| Dead code (knip) | `npx knip --reporter compact` | (информативно) ~70 unused exports + 2 duplicate exports | ~10 c |
| Worktree | `git status --short` | ✓ clean | — |

---

## 3. Архитектура (краткий снимок)

### 3.1 Размер кодовой базы

- **Rust:** 184 файла `.rs` в `src-tauri/` (без `target/`).
- **TypeScript:** 254 файла `.ts/.tsx` в `src/`.
- **Тесты:** 145 файлов спецификаций (Vitest + Playwright) в `tests/`, 3 интеграционных файла Rust в `src-tauri/tests/`.
- **ADR:** 13 принятых решений (`@d:\Development\Rheolab\docs\adr\`), последнее — ADR-0013-no-large-ipc-rule.

### 3.2 Tauri IPC поверхность

- 113 `#[tauri::command]` на 91 файл в `@d:\Development\Rheolab\src-tauri\src\commands\`.
- **63 явных license-gate** (38× `require_write_license`, 25× `can_write_via_engine`).
  Это правильно: оставшиеся ~50 команд — read-only (`*_list`, `*_get`, `*_count`, лицензионные
  чеки, статусы, версии).
- Per-feature (`LicenseFeatures`) gating используется в `@d:\Development\Rheolab\src-tauri\src\commands\reports.rs`
  (REP-001) — намеренно: помимо write-gate проверяется конкретный флаг возможностей.

### 3.3 Высокорисковые зоны (per AGENTS.md)

- **Лицензирование:** `@d:\Development\Rheolab\src-tauri\src\commands\licensing\` — 19 элементов,
  явное разделение на `crypto.rs`, `engine/`, `hardware/`, `online.rs`, `demo.rs`. Тесты
  `licensing_tests.rs` — 27 KB, `engine_tests.rs` — 23 KB. **Покрытие выглядит здоровым**:
  `crypto_tests`, `hardware_tests`, `engine_tests`, integration `licensing_tests` — все green.
- **DB-миграции:** `@d:\Development\Rheolab\src-tauri\src\db\` — 33 элемента;
  `migration_tests.rs` (25 KB) + `db_integrity.rs` integration-тест (все 12 тестов pass:
  FK pragma on, idempotent migrations, schema_meta version, default reagent seeds, FK
  cascade/prevent-orphan, unique constraints).
- **Экспорт / отчёты:** `@d:\Development\Rheolab\src-tauri\src\commands\reports.rs` —
  144 KB / 3891 строк / 6 IPC-команд. **Самый большой одиночный модуль в репозитории.**
  Все 6 команд гейтятся через `can_write_via_engine` + `LicenseFeatures`. См. P3-1 (рефакторинг).
- **Tauri IPC boundary:** capabilities в `@d:\Development\Rheolab\src-tauri\capabilities\default.json`
  имеют **регрессию** (см. P1-1).

---

## 4. Findings

### P1 — Регрессия Tauri FS scope: `$HOME/**` снова разрешён

**Файл:** `@d:\Development\Rheolab\src-tauri\capabilities\default.json:31`

```json
@d:\Development\Rheolab\src-tauri\capabilities\default.json:22-33
    {
      "identifier": "fs:scope",
      "allow": [
        "$APPDATA/com.rheolab.enterprise/**",
        "$LOCALAPPDATA/com.rheolab.enterprise/**",
        "$DOWNLOADS/**",
        "$TEMP/**",
        "$DESKTOP/**",
        "$DOCUMENT/**",
        "$HOME/**"
      ]
    },
```

**Контекст:** в предыдущем аудите `@d:\Development\Rheolab\docs\audit\2026-04-27-codebase-audit.md:62-68` была
устранена эта же проблема («P1 — removed `$HOME/**` from … capabilities/default.json»). На
текущем `HEAD` `$HOME/**` снова в allowlist. Это **регрессия безопасности**: компрометация
рендерера даёт fs-плагину доступ к произвольным путям внутри пользовательского home.

**Воздействие:** при компрометации WebView (CSP уже жёсткий, см. § 5.1) фронтенд может через
`@tauri-apps/plugin-fs` читать/писать файлы вне приложения, обходя Rust-уровневую валидацию
путей (`utils::validation::user_path_*`).

**План:**
1. Удалить `$HOME/**` из `fs:scope`. (Минимальный коммит, 1 строка.)
2. Добавить regression-тест на capabilities (например, JSON-snapshot в Vitest или Rust),
   который падает при появлении `$HOME/**` в allowlist.
3. Долгосрочно: смигрировать оставшиеся frontend FS-вызовы в Rust commands (см. рекомендацию
   2026-04-27) и сузить scope до `$APPDATA/$LOCALAPPDATA/com.rheolab.enterprise/**` плюс
   user-selected paths через dialog-broker.

---

### P1 — Локальный ESLint падает (10 ошибок), gate не ловит

**Файлы:**
- `@d:\Development\Rheolab\src\app\dashboard\comparison\page.tsx:159` — `react-hooks/immutability` (изменение `warningTimerRef.current` после использования в effect deps).
- `@d:\Development\Rheolab\src\app\dashboard\page.tsx:305` — `react-hooks/set-state-in-effect`.
- `@d:\Development\Rheolab\src\components\comparison\useComparisonSeriesWindows.ts:130,153,179` — `exhaustive-deps` + `set-state-in-effect` (×2).
- `@d:\Development\Rheolab\src\components\dashboard\DashboardContent.tsx:124,128` — `exhaustive-deps` (отсутствует `binarySeries` в deps).
- `@d:\Development\Rheolab\src\hooks\useExperimentSeriesOverview.ts:117,176` — `set-state-in-effect` (×2).
- `@d:\Development\Rheolab\tests\series\series-window-cache.test.ts:34` — `prefer-const`.

**Контекст:** все 9 «функциональных» ошибок — в коде свежей фичи warm-navigation (commits
`d3956ae`, `a465072`, `ff38467`, `c2f710a`). Правила в
`@d:\Development\Rheolab\eslint.config.mjs:54-62` — `react-hooks/recommended` + `exhaustive-deps:error`
+ `react-hooks/set-state-in-effect` (новое правило в `eslint-plugin-react-hooks` 7.x).

**Воздействие:** не runtime-баги, но индикатор реальных React 19 anti-patterns:
каскадные re-render'ы, потенциальные stale-closure баги в кэшировании binary series.
**Локальная валидация авторитативна** (per AGENTS.md) — это означает, что текущий
`HEAD` формально не проходит локальный гейт качества кода.

**План:**
1. Починить 10 ошибок: вынести setTimeout-логику из effect-bodies в effects, добавить
   недостающие deps, обернуть `setLineStates` в начальное состояние / в onChange-callback'и
   а не в effect, заменить `let now` на `const`.
2. Добавить `npm run lint` и `npx tsc --noEmit` в `prerelease:prepare`
   (`@d:\Development\Rheolab\package.json:64`) рядом с `version:validate`. Это
   defense-in-depth: validate ловит drift версии, lint/tsc — drift качества кода.
3. Регрессионный тест: добавить хук в `scripts/audit/run-enterprise-deep-audit.js`,
   который падает на любом `lint` или `tsc` non-zero exit.

---

### P1 — TypeScript strict падает (5 ошибок) в тестах

**Файлы:**
- `@d:\Development\Rheolab\tests\components\zoom-plugin.test.ts:35,37,65` — uPlot mock
  передаёт неправильную сигнатуру `init?(self, opts, data)` и неполный `BBox` в `select`.
- `@d:\Development\Rheolab\tests\e2e\saved-report-by-id-smoke.tauri.spec.ts:197` — `Buffer<ArrayBufferLike>`
  vs `Buffer` (несовместимость `@types/node` 25.x и `exceljs`).

**Воздействие:** тесты сейчас выполняются (Vitest всё прошёл), но компилятор-гейт ломается.
Это означает что `tsc --noEmit` не запускается автоматически в release-prep.

**План:**
1. В `zoom-plugin.test.ts` — обновить mock сигнатуры `init` и расширить `select` до
   полного `BBox` (`top`, `height`).
2. В `saved-report-by-id-smoke.tauri.spec.ts:197` — привести `bytes` к `Buffer` через
   `Buffer.from(bytes)`.
3. См. P1-2: добавить `tsc --noEmit` в release-prep.

---

### P2 — `progress.txt` устарел: оба пункта уже решены

**Файл:** `@d:\Development\Rheolab\progress.txt`

Оба пункта в файле — outstanding follow-ups, но фактически уже исправлены:

1. **Section 1 (`test_stub_force_ai_uses_structured_mapping_for_fixture`).** В
   `progress.txt:77-176` помечен как regression. На текущем HEAD тест **PASS**:

   ```
   test test_stub_force_ai_uses_structured_mapping_for_fixture ... ok
   ```
   (см. вывод `cargo test --test ai_parsing`).

2. **Section 2 (channel-header rewrites bypass HMAC).** В `progress.txt:30-75` помечен
   как pre-existing SEC-TODO. На текущем HEAD `@d:\Development\Rheolab\license-server\releases.htaccess:14`
   явно ссылается на фикс: «Fixed 2026-04-19; was tracked in docs/LICENSING_CHANNELS.md as
   a hardening TODO». Все запросы теперь проходят через `api/update-channel.php`, который
   валидирует `X-Update-Token` HMAC.

**Воздействие:** дрейф документации — будущий разработчик/агент будет считать обе проблемы
открытыми. Может привести к избыточной работе и неправильной приоритизации.

**План:** удалить (или явно закрыть с датой и hash коммита) обе секции в `progress.txt`.
Оставить только активный пункт «Comparison Report Generation — ADR-0010».

---

### P2 — `commands/reports.rs` слишком большой (3891 строк / 144 KB)

**Файл:** `@d:\Development\Rheolab\src-tauri\src\commands\reports.rs`

Самый большой одиночный файл в репо. Содержит 6 IPC-команд (`reports_generate_pdf`,
`reports_generate_excel`, их `_by_id`, и пару `_comparison_*_by_ids`), но также — куча
дополнительной логики (payload-validation, license-feature checks, кэш-ключи, метаданные).

**Воздействие:** review-friction, риск merge-конфликтов, размывание ownership на
high-risk зоне (export). Прямого риска для безопасности нет — все 6 команд корректно
гейтятся (см. § 3.3).

**План (минимально-инвазивный, чтобы не ломать паблик-API):**
1. Извлечь `pub mod payload_validation;` (Zod-аналог для входов).
2. Извлечь `pub mod cache_keys;` (логика построения `AnalysisCacheKey`).
3. Извлечь `pub mod license_gates;` (per-feature checks из REP-001).
4. Оставить в `reports.rs` только тонкие IPC-обёртки.

Цель: каждый IPC-handler — ≤ 50 строк, общий размер `reports.rs` < 600 строк.

---

### P2 — Knip: ~70 неиспользуемых экспортированных типов и 2 дубликат-экспорта

**Сводка:**
- ~52 unused exported types в `src/lib/tauri/bridge*.ts` (response/request DTOs, частично
  оставленные для специфика-генерации `src/types/generated.d.ts`).
- 2 duplicate exports — `LicenseActivationDialog` и `TrialBanner` экспортируют и `default`,
  и именованный (`@d:\Development\Rheolab\src\components\licensing\LicenseActivationDialog.tsx`,
  `@d:\Development\Rheolab\src\components\licensing\TrialBanner.tsx`).
- Несколько unused-функций (`alignSeriesFromColumnar`, `downsampleLTTB`, `temperatureDecimals`).

**Воздействие:** низкое; шум в IDE и потенциально лишний bundle (для функций — depends on
tree-shaking). Большая часть DTOs нужна для специфика-биндингов и Zod-валидации, knip их
ошибочно помечает как dead.

**План:**
1. Закрыть 2 duplicate exports — оставить только default или только named, поправить импорты.
2. Просмотреть unused exported functions (а не types) — реально удалить тех, что не
   используются ни в `src/`, ни в тестах.
3. Не трогать DTOs из `bridge*.ts` без явной причины — они часть IPC-контракта.

---

### P2 — Несколько IPC-мутаторов без явного license-gate

**Файлы:**
- `@d:\Development\Rheolab\src-tauri\src\commands\api_keys\mod.rs` — `api_keys_create`, `api_keys_set_active`, `api_keys_delete`.
- `@d:\Development\Rheolab\src-tauri\src\commands\jobs.rs` — `analysis_cache_prune`, `experiments_projection_rebuild`, `jobs_cancel`.

**Контекст:** автоматический скан выявил 13 «подозрительных» мутирующих команд без
gate. Из них:
- 8 — false-positives (read-only `*_list/_get`, `licensing_can_save`, `get_update_channel`,
  `backup_open_folder`).
- 5 — реальные кандидаты:
  - **API keys** (3 команды): хранят локальные пользовательские настройки (Groq), сейчас
    доступны без лицензии. Это может быть намеренно (демо-режим должен работать со своим
    ключом), но стоит явно задокументировать.
  - **Maintenance ops** (`analysis_cache_prune`, `experiments_projection_rebuild`): админские
    операции, в Demo они выполняться не должны.

**Воздействие:** низкий; в худшем случае — пользователь без лицензии может вызвать
сравнительно безопасные maintenance-операции. Прямого data loss нет.

**План:**
1. Принять решение: гейтить ли API-keys-команды (рекомендация — нет, они user-local настройки,
   не RheoLab-данные).
2. Для `analysis_cache_prune` и `experiments_projection_rebuild` — добавить
   `require_write_license` или сильнее (например, `require_admin_license` если такой helper
   будет введён).
3. Расширить regression-тест из P1-AUDIT-2026-04-27 (follow-up «add a regression test or
   audit script that enumerates `register_tauri_commands!` mutators and asserts license-gate
   coverage») — он указан в `@d:\Development\Rheolab\docs\audit\2026-04-27-codebase-audit.md:36`,
   но ещё не реализован.

---

### P3 — Документация: разрозненные follow-ups в `progress.txt`, `docs/audit/` и ADR

**Наблюдение:** активные пункты раскиданы по нескольким источникам:
- `@d:\Development\Rheolab\progress.txt` (1 активный + 2 stale).
- `@d:\Development\Rheolab\docs\audit\` (4 файла, разные форматы).
- ADR-0010 — phases [ ] не обновлены.

**Воздействие:** среднее — затрудняет агентам и людям понять, что в работе.

**План:** объединить в `docs/audit/README.md` indexed-таблицу всех открытых
follow-ups с состоянием (open/in-progress/closed) и ссылкой на коммит закрытия.

---

### P3 — TypeScript strict-сурсы покрыты, но `tests/` исключены частично

**Файл:** `@d:\Development\Rheolab\tsconfig.json`

`include` покрывает `**/*.ts/.tsx/.mts`, `exclude` — `node_modules`, `dist`, `scripts`,
`website`, `src-tauri`, `tests/e2e/_archived`. То есть `tests/` (включая Playwright e2e)
**проверяется** компилятором — это и привело к 5 ошибкам в P1-3.

**Наблюдение:** хорошо, что тесты в `strict`. Но 5 ошибок «накопились» — это значит,
что никто не запускал `tsc --noEmit` локально перед merge. См. рекомендацию в P1-2.

---

### P3 — `eslint.config.mjs` игнорирует `scripts/`, `e2e/`, `docs/`

**Файл:** `@d:\Development\Rheolab\eslint.config.mjs:6-27`

Игнорируется большой объём `.ts/.mjs`-файлов:
- `scripts/**` — 100+ build/release/perf/audit-скриптов (значительная боевая часть проекта).
- `e2e/**` (отдельно от `tests/e2e/**`!) — устаревшая директория?
- `tests/e2e/_archived/**` — норм, архив.

**Воздействие:** низкое; но `scripts/` — это активно поддерживаемый код, баги в нём
(особенно в `release/` и `audit/`) дают ложные сигналы релизного гейта.

**План:** включить `scripts/` в eslint-флоу с минимальным ruleset
(prefer-const, no-unused-vars, no-explicit-any:warn).

---

## 5. Зоны без замечаний (положительные находки)

### 5.1 Безопасность: CSP, capabilities, обновления

- **CSP** в `@d:\Development\Rheolab\src-tauri\tauri.conf.json:32` — жёсткий: `default-src 'self' blob:;
  script-src 'self'; style-src 'self' 'unsafe-inline'`. `connect-src` ограничен
  `https://license.vizbuka.ru` + `https://api.groq.com`. ✓
- **HTTP allowlist** для capabilities — те же 2 хоста (`@d:\Development\Rheolab\src-tauri\capabilities\default.json:38-42`). ✓
- **Updater** использует Tauri-нативный signature flow с pubkey в conf
  (`@d:\Development\Rheolab\src-tauri\tauri.conf.json:70`). Endpoints проходят через
  `license.vizbuka.ru/releases/v1/update/{target}/update`, server-side HMAC-валидация
  (`@d:\Development\Rheolab\license-server\releases.htaccess:14-21`). ✓
- **Panic-on-startup** для dev-keys в release-сборке — `assert_production_keys` в
  `licensing/types.rs` (per `@d:\Development\Rheolab\docs\LICENSING_CHANNELS.md:106-109`). ✓
- **Channel→license mapping** по HMAC-токену с 5-минутным окном
  (`@d:\Development\Rheolab\docs\LICENSING_CHANNELS.md:99-101`). ✓
- **Gitleaks gate** активен, history scan, fingerprint-based ignore
  (`@d:\Development\Rheolab\docs\audit\GITLEAKS-TRIAGE-2026-04-26.md`). ✓

### 5.2 Версионирование (SSoT)

`@d:\Development\Rheolab\version.json` — **рабочее single source of truth**.
`scripts/version/sync.js` + `validate.js` корректно проводят значение в 4 dependents.
Pre-hooks встроены в `tauri:build` и `release:prepare` (defense-in-depth).
**Гейт работает:** на момент аудита `validate` обнаружил консистентное состояние во
всех 4 файлах несмотря на 2 версии-bump'а (alpha.5 → alpha.6 → alpha.7) во время аудита.

### 5.3 Тестовое покрытие

| Слой | Файлов | Тестов | Время | Состояние |
|---|---|---|---|---|
| Vitest (DOM/unit/integration) | 100 | 1412 / 6 skip | ~16 c | ✓ |
| Cargo unittest (workspace) | — | 454 / 2 ignored | ~32 c | ✓ |
| Cargo integration (`ai_parsing`) | 1 | 25 | ~0.7 c | ✓ |
| Cargo integration (`db_integrity`) | 1 | 12 | ~0.3 c | ✓ |
| Cargo integration (`ipc_contracts`) | 1 | 10 | ~0.2 c | ✓ |
| Playwright (web/tauri/perf) | ~30+ | — | varies | не запускалось в этом аудите (heavy) |

**Найденные хорошие практики:**
- `tests/lib/experiments/filter-metadata-cache.test.ts` — explicit cache-invariant tests.
- `tests/components/save-experiment-dialog.test.tsx` — параметризованные тесты
  (`testCategory × testType` × `fluidType` × `productionDate-as-Date|ISO`).
- `db_integrity.rs` — проверки FK pragma, idempotency, schema_meta version,
  unique-constraints, cascade/prevent-orphan FK.
- `ipc_contracts.rs` — round-trip и дубликат-семантика для `experiments_save/find/delete`.
- Параметрические regression-тесты с реальными фикстурами (`combat_composite::*`,
  `combat_thresholds::*`).

### 5.4 Архитектура

- **Нет циклических зависимостей** (madge: 0/255).
- **Strict TypeScript** включён глобально (`tsconfig.json`).
- **`@typescript-eslint/no-explicit-any: error`** в source-коде, явные исключения для
  тестов и e2e-mock'ов.
- **`@typescript-eslint/no-floating-promises: error`** — крайне ценно для async-тяжёлого
  кода с IPC.
- **`no-restricted-imports`** для `src/lib/tauri/*` — заставляет использовать `safeInvoke`
  вместо raw `invoke` (`@d:\Development\Rheolab\eslint.config.mjs:67-78`). ✓
- **Per-package opt-level overrides** в `Cargo.toml` для compute-bound крейтов (typst,
  rheolab-core, plotters) — измеренный и задокументированный trade-off
  (`@d:\Development\Rheolab\src-tauri\Cargo.toml:85-100`). ✓
- **Profile.dev оптимизации** Typst → opt-level=2: «Typst PDF compilation 5+ min → 20-40×
  faster in debug» — задокументированный трейд (`@d:\Development\Rheolab\src-tauri\Cargo.toml:135-140`). ✓
- **WebView memory caps** через `additionalBrowserArgs`
  (`@d:\Development\Rheolab\src-tauri\tauri.conf.json:28`): `--js-flags=--max-old-space-size=512`,
  `--force-gpu-mem-available-mb=256`, `--disable-back-forward-cache`. Соответствует
  Enterprise/Embedded use-case. ✓

### 5.5 Зависимости

- React 19.2.5, Tauri 2.10, Vite 8 — актуальные версии.
- Один Tauri-стек, одна цепочка криптокрейтов (sha2/hmac/hkdf/aes-gcm/rsa) — без
  дублирующих/конфликтующих версий.
- `rusqlite = "0.32"` — **последняя стабильная версия**, не отстаёт.
- **`reqwest = { default-features = false, features = ["rustls-tls", ...] }`** —
  устраняет зависимость от системного OpenSSL. ✓
- **`panic = "abort"`** в `[profile.release]` — лучшая практика для bin-крейтов
  (исключает unwind machinery). ✓

### 5.6 Документация

- 13 ADR с понятным форматом и шаблоном (`_template.md`).
- `LANGUAGE_POLICY.md` — однозначный язык для каждой части (код-EN, UI-RU, ADR-RU,
  README-EN, CHANGELOG-RU). ✓
- `LICENSING_CHANNELS.md` — полное описание three-tier (alpha→beta→stable) +
  HMAC-rotation.
- `ARCHITECTURE.md` (15 KB), `RELEASE_AND_DEPLOY.md` (12 KB), `ipc-surface.md` (17 KB) —
  hot-doc'и присутствуют.
- Performance — целая директория `docs/performance/` с 56 артефактами (BUDGETS.md,
  BASELINES.md, AlphaBaseline-0.2.2-alpha.2 — версионированные baselines).

### 5.7 Performance harness

`@d:\Development\Rheolab\package.json:26-56` — обширный набор perf-сценариев:
- Memory soak (`perf:soak:tauri`), workflow benchmark, comparison (real/memory variants),
  chart series, warm-navigation, DB-scale (small/large), library-budgets.
- Microbench для PDF и analysis pipeline (Rust criterion-style examples).
- Compare-скрипты (`compare-perf-baselines.js`, `compare-db-scale.js`,
  `db-sweep-compare.mjs`).

Это сильная инфраструктура — **нет рекомендаций к расширению**, только к интеграции
в gating (см. § 7).

---

## 6. Сравнение с предыдущим аудитом (2026-04-27)

| Категория | 2026-04-27 | 2026-04-30 | Δ |
|---|---|---|---|
| Worktree | dirty (много changes) | **clean** | ✓ улучшено |
| Tauri commands w/o license-gate | большой список | сужено до 5 реальных кандидатов | ✓ улучшено |
| `sync_import_delta` валидация | ungated, no size cap | gated + 50 MB / 10K cap | ✓ закрыто |
| Backup integrity check | absent | `PRAGMA integrity_check` + table check | ✓ закрыто |
| FS scope `$HOME/**` | удалён | **снова добавлен** | ✗ **регрессия P1** |
| `commands/reports.rs` size | не упоминалось | 3891 строк / 144 KB | новый P2 |
| ESLint state | упоминался как PASS | **10 errors** | ✗ **регрессия P1** |
| TSC state | упоминался как PASS | **5 errors** | ✗ **регрессия P1** |
| `progress.txt` outstanding | 2 active | 2 stale + 1 active | ✗ дрейф P2 |
| Verified commands | tsc/lint/test/cargo/audit | те же, но lint/tsc больше не green | — |

---

## 7. План действий (приоритизация)

### Sprint 0 — немедленно (1–2 коммита, < 1 час каждый)

1. **[P1] Удалить `$HOME/**`** из `@d:\Development\Rheolab\src-tauri\capabilities\default.json:31`.
   Добавить snapshot-тест Rust или JSON-snapshot в Vitest.
2. **[P1] Починить 5 TS-ошибок** в `tests/components/zoom-plugin.test.ts` и
   `tests/e2e/saved-report-by-id-smoke.tauri.spec.ts`. Пуш отдельным `fix(tests):`.
3. **[P1] Усилить prerelease-gate** в `@d:\Development\Rheolab\package.json:64`:
   ```json
   "prerelease:prepare": "node scripts/version/validate.js && npm run lint && npx tsc --noEmit"
   ```
4. **[P2] Очистить `progress.txt`**: удалить или закрыть section 1 (test PASS) и
   section 2 (htaccess fix 2026-04-19).

### Sprint 1 — текущая итерация (несколько дней)

5. **[P1] Починить 10 ESLint-ошибок** в warm-navigation коде. Возможно ввести `useTimer`
   custom-hook для setTimeout-логики и `useCachedSeries` обёртку.
6. **[P2] Реализовать regression-тест** на license-gate coverage всех IPC-мутаторов
   (follow-up из 2026-04-27).
7. **[P2] Решить судьбу 5 «реальных» ungated mutators**: `api_keys_*` (вероятно — оставить
   как есть, явно задокументировать), `analysis_cache_prune`, `experiments_projection_rebuild`,
   `jobs_cancel` (возможно — гейтить).
8. **[P2] Закрыть 2 duplicate exports** в `LicenseActivationDialog.tsx` и `TrialBanner.tsx`.

### Sprint 2 — backlog

9. **[P2] Рефакторинг `commands/reports.rs`** на 3-4 подмодуля (см. § P2).
10. **[P3] Включить `scripts/`** в ESLint с минимальным ruleset.
11. **[P3] Объединить follow-ups** в `docs/audit/README.md` как indexed-таблицу.
12. **[P3] Сузить FS scope** до `$APPDATA/$LOCALAPPDATA/...` и dialog-broker (долгосрочный
    рефакторинг, требует миграции frontend FS-вызовов в Rust commands).

---

## 8. Команды для воспроизведения

```powershell
# SSoT
node scripts/version/validate.js

# Security
npm audit --omit=dev
cd src-tauri; cargo audit; cd ..

# Code quality
npx tsc --noEmit
npm run lint
npx madge --circular --extensions ts,tsx src
npx knip --reporter compact

# Tests
npm run test
cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast
```

Все команды — read-only, безопасны для автозапуска.

---

## Приложение A — версии

| Компонент | Версия |
|---|---|
| RheoLab Enterprise | `0.2.2-alpha.7` (channel: `alpha`) |
| Tauri | `2.10` (api), `2.10.1` (cli) |
| React | `19.2.5` |
| TypeScript | `^6.0.3` |
| Vite | `^8.0.10` |
| Vitest | `^4.1.5` |
| ESLint | `^10.2.1` |
| rusqlite | `0.32` (bundled) |
| reqwest | `0.12` (rustls-tls) |
| Rust crates audit | clean |
| npm prod audit | 0 vuln |

---

_Аудитор: Cascade — глубокий audit pass от 2026-04-30. Отчёт построен поверх
`docs/audit/2026-04-27-codebase-audit.md` и фиксирует delta._
