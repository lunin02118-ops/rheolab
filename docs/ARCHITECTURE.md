# Архитектура — RheoLab Enterprise

> Проверено по репозиторию: 2026-04-28  
> Версия приложения на момент проверки: `0.2.1-beta.1`

## 1. Обзор системы

RheoLab Enterprise — офлайн-ориентированная настольная система для анализа реологических данных. Это не “один бинарник”: в репозитории живут клиентское приложение, отдельный сервер лицензирования и обновлений, публичный сайт и несколько вспомогательных контуров.

```text
┌────────────────────────────┐
│ React / Vite SPA          │  src/
└─────────────┬──────────────┘
              │ Tauri IPC
┌─────────────▼──────────────┐
│ Tauri v2 desktop shell     │  src-tauri/
│ Rust commands + SQLite     │
└─────────────┬──────────────┘
              │ Rust crate dependency
┌─────────────▼──────────────┐
│ rheolab-core               │  src/rust/rheolab-core/
│ parsing / analysis / docs  │
└────────────────────────────┘

Связанные, но отдельные сервисы:
- `license-server/` — PHP activation + admin + update manifests
- `website/` — Astro-сайт, загрузки и пользовательская документация
```

## 2. Топология репозитория

| Путь | Назначение |
|---|---|
| `src/` | React-приложение внутри desktop WebView |
| `src-tauri/` | Tauri app builder, native commands, SQLite и updater integration |
| `src/rust/rheolab-core/` | Общий Rust crate для парсинга, анализа и генерации отчётов |
| `tests/` | Vitest и Playwright coverage для frontend, release и E2E flows |
| `license-server/` | PHP admin panel, activation/validation APIs, update routing, PHPUnit tests |
| `website/` | Astro-сайт, публичные docs и download flow |
| `scripts/` | Dev, audit, release, deploy, benchmark и utility scripts |
| `tools/` | Отдельные Rust-утилиты, например fixture/seed helpers |
| `runtime/` | Сгенерированные audit, QA и release-артефакты |
| `Regents/` | Исходные данные по реагентам и extraction helpers |

## 3. Настольный runtime-контур

### Frontend

- Entry routes лежат в `src/routes.tsx`.
- Page-модули находятся в `src/app/dashboard/*`.
- Переиспользуемый UI живёт в `src/components/*`.
- Shared state реализован через Zustand stores в `src/lib/store/*`.
- Публичный `src/lib/tauri/index.ts` — это compatibility barrel; реальные bindings разбиты по доменам в `src/lib/tauri/`.

### Native shell

- Tauri стартует из `src-tauri/src/main.rs`.
- `src-tauri/src/lib.rs` — тонкий оркестратор: строит `tauri::Builder`, подключает плагины, делегирует детали в `startup/`.
- `src-tauri/src/startup/` содержит раздельные ответственности (W2 декомпозиция):
  - `logging.rs` — файл-лог с ротацией до первого tracing-subscriber'а.
  - `setup.rs` — тело `.setup()` closure: pool, миграции, background-воркеры.
  - `commands_registry.rs` — макрос `register_tauri_commands!()`, экспандящийся в `tauri::generate_handler![]`.
- Desktop-приложение использует плагины для `fs`, `dialog`, `process`, `http`, `opener`, `log` и `updater`.
- Настройки браузера/WebView задаются в `src-tauri/tauri.conf.json`.

### Поверхность native-команд

Набор native-команд организован по доменам, а не в одном гигантском модуле:

- `commands/experiments`
- `commands/reagents`
- `commands/operators`
- `commands/laboratories`
- `commands/analysis`
- `commands/reports`
- `commands/backup`
- `commands/licensing`
- `commands/parsing`
- `commands/data_flows`
- `commands/api_keys`
- `commands/fixtures`
- `commands/logger`

Не фиксируйте количество команд в документации. Авторитетный список — это макрос `register_tauri_commands!()` в `src-tauri/src/startup/commands_registry.rs`. Высокоуровневая навигация по командам с риск-классами и license-gate — в [`docs/ipc-surface.md`](./ipc-surface.md).

Ряд доменов декомпозирован на подмодули (W2):

- `commands/analysis/` → `dto.rs` + `cycle_detection.rs` + `cycle_processing.rs` + `commands.rs`; `mod.rs` делает glob re-export для macro-generated Tauri helpers `__cmd__*`.
- `commands/experiments/` → `read.rs` + `write.rs` + `delete.rs` + общий `mod.rs`.
- `commands/licensing/` → `hardware.rs` + `signature.rs` + `online.rs` + `guards.rs` + `state.rs`.

## 4. Модель данных и миграции

SQLite — локальный system of record для desktop-клиента.

### Ключевые моменты

- Connection pooling живёт в `src-tauri/src/db/pool.rs`.
- Runner миграций — `src-tauri/src/db/migration.rs`; реестр версий — `src-tauri/src/db/migrations/` (`mod.rs` + `v0001_initial.rs` + `trait.rs`).
- Версионирование схемы опирается на:
  - `CURRENT_SCHEMA_VERSION` в `migration.rs` (должна совпадать с `latest_registered_version()` — тесты это проверяют)
  - `schema_meta` (singleton row, id = 1) — хранит текущую версию и `app_version` предыдущего запуска
  - `MigrationResult` — сериализованный отчёт, эмитируется фронтенду событием `startup_completed`
- Основная схема выражена через консолидированный блок `V1_DDL` с `CREATE TABLE IF NOT EXISTS`.
- Runner (W3.4 hardening):
  - Читает `schema_meta.schema_version` **до** применения миграций и пропускает те, что уже применены.
  - Каждую миграцию оборачивает в собственную транзакцию — частичное применение невозможно.
  - Логирует warning при downgrade (`stored_version > CURRENT_SCHEMA_VERSION`), но не падает — UI может предложить восстановление.

### Текущий migration contract

- Additive-изменения, которые безопасно выражаются через `IF NOT EXISTS`, могут добавляться прямо в `V1_DDL`.
- Destructive или transformational schema changes должны поднимать `CURRENT_SCHEMA_VERSION` и добавлять явную upgrade-логику.
- Сейчас схема включает 22 application tables, включая `schema_meta`, плюс FTS-структуры, создаваемые SQLite.

### Важные доменные таблицы

- `Experiment`, `ExperimentData`, `Calibration`, `ExperimentReagent`
- `ReagentCatalog`, `WaterSourceCatalog`, `Laboratory`, `Operator`
- `APIKey`, `SystemState`, `Settings`, `User`
- `ImportBatch`, `ExperimentPayload`, `ParserArtifact`, `ReportArtifact`
- `SyncOutbox`, `SyncInbox`, `MergeEvent`, `ConflictRecord`

## 5. Сеть и границы доверия

Desktop-клиент умеет работать офлайн, но не является полностью network-free.

### Исходящие сетевые пути

- License validation и activation обращаются к `license.vizbuka.ru` через `src-tauri/src/commands/licensing/online.rs`.
- Опциональный AI-assisted parsing / mapping может обращаться к `api.groq.com`, если настроены API keys.
- Updater проверяет release endpoint, заданный в `src-tauri/tauri.conf.json`.

### Локальные границы доверия

- Состояние, чувствительное к лицензии и целостности, хранится в SQLite, в первую очередь в `SystemState`.
- API keys управляются через `src-tauri/src/commands/api_keys/` и шифруются перед сохранением.
- Licensing crypto содержит legacy compatibility code paths, поэтому актуальная документация не должна описывать систему как “целиком CBC-only”.

### Webview Content Security Policy

CSP задан в `src-tauri/tauri.conf.json` (`app.security.csp`) и является основным барьером против XSS в webview-контуре:

```
default-src 'self' blob:
script-src  'self'
style-src   'self' 'unsafe-inline'
img-src     'self' data: blob:
font-src    'self' data:
connect-src 'self' https://license.vizbuka.ru https://api.groq.com
```

**Обоснование исключений** (аудит SEC-004):

- `script-src 'self'` — жёсткий, без `'unsafe-inline'` / `'unsafe-eval'`. Это закрывает главный XSS-вектор (eval впрыснутого скрипта).
- `style-src` включает `'unsafe-inline'` + `dangerousDisableAssetCspModification: ["style-src"]` под Tauri CSP rewrite — это **вынужденно**, потому что:
  - 86+ React-компонентов (в `src/components/library/experiment-table.tsx`, `src/components/charts/*`, `src/components/calibration/*` и др.) используют inline `style={{...}}` для динамических width/height/transform/color, вычисляемых из runtime data (chart bounds, per-experiment colour assignments, drag-resize tooltip positioning).
  - React inline-styles выводятся как `style="..."` атрибуты, которые CSP предявляет style-src; без `'unsafe-inline'` они были бы блокированы.
  - Альтернативы: nonce-based style-src (Tauri/Wry не даёт простого хука для per-request nonce), CSS-in-JS без inline-style, или миграция на CSS-переменные — любой вариант требует крупного refactor’а всех 86 точек.
  - Риск `style-src 'unsafe-inline'` в desktop-режиме **низкий**: webview загружает только bundled-контент (`'self'` resolves в tauri:// scheme); внешние origins жёстко ограничены `connect-src` и не способны инъектировать HTML.
- `connect-src` жёстко ограничен двумя origin’ами (license + Groq) — было бы `*` очевидным футганом.

**Что было бы надо для изъятия `'unsafe-inline'`** (если когда-либо решим ужесточить):

1. Миграция всех inline `style={{...}}` на CSS-классы + CSS-переменные (динамика через `style.setProperty('--var', value)`).
2. Написать codemod `tsx-style-to-cssvar` на `ts-morph` для автоматического переписывания.
3. Проверить ни одни из 86 точек не производит вредные для layout regression’ы (Playwright visual snapshots).

## 6. Архитектура релиза и updater-а

### Build paths

Сейчас есть два build-потока:

1. `npm run release:prepare`
   - канонический scripted release/pre-release path
   - валидирует updater config и release policy
   - поддерживает `--dry-run`, `--channel`, `--allow-unsigned`, `--skip-qa`

2. `scripts/release/build.ps1`
   - интерактивный Windows-oriented path
   - делает version bump перед запуском сборки

### Текущее подключение updater-а

Tauri-приложение настроено на endpoint:

```text
https://license.vizbuka.ru/releases/v1/update/{{target}}-{{arch}}/update
```

Текущий server-side flow:

- `publish-update.js` пишет `stable.json` и/или `beta.json` manifests в `releases/v1/update/windows-x86_64/`.
- `UpdateChecker.tsx` отправляет `X-Update-Channel` и опциональный `X-Update-Token`.
- Apache rewrites в `license-server/releases.htaccess` сейчас выбирают между `stable.json` и `beta.json`.
- `license-server/api/update-channel.php` содержит более строгую token-aware routing logic, но этот PHP endpoint сейчас не является активным Apache path.

Это расхождение — реальный операционный риск, и его нужно явно учитывать в релизной работе.

## 7. Модель тестирования и аудита

Репозиторий использует многоуровневую верификацию:

- `npm test` for frontend/unit integration coverage
- `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` for native/backend coverage
- `npm run test:e2e:smoke` for critical Playwright/Tauri flows
- `npm run audit:enterprise:quick` for a repo-wide quality/release/security pass
- `npm --prefix website run build` for website readiness
- PHP-specific checks for `license-server/`

Не полагайтесь на зафиксированные числа из старых документов. Проверяйте runner output и generated audit artifacts в `runtime/audit/`.

## 8. Файлы-источники правды

Если docs и код расходятся, сначала сверяйтесь с этими файлами:

- `package.json`
- `src/lib/version.ts`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/lib.rs` + `src-tauri/src/startup/`
- `src-tauri/src/startup/commands_registry.rs` — источник истины для IPC surface
- `src-tauri/src/db/migration.rs` + `src-tauri/src/db/migrations/`
- `scripts/release/prepare-production.js`
- `scripts/deploy/publish-update.js`
- `src/components/shared/UpdateChecker.tsx`
- `license-server/releases.htaccess`
- `license-server/api/update-channel.php`
