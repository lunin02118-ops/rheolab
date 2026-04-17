# Архитектура — RheoLab Enterprise

> Проверено по репозиторию: 2026-04-17  
> Версия приложения на момент проверки: `0.2.0-beta.5`

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
- Сборка приложения, plugin setup и `invoke_handler![]` находятся в `src-tauri/src/lib.rs`.
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

Не фиксируйте количество команд в документации. Авторитетный список — это `invoke_handler![]` в `src-tauri/src/lib.rs`.

## 4. Модель данных и миграции

SQLite — локальный system of record для desktop-клиента.

### Ключевые моменты

- Connection pooling живёт в `src-tauri/src/db/pool.rs`.
- Schema setup и orchestration миграций живут в `src-tauri/src/db/migration.rs`.
- Версионирование схемы реально используется и сейчас опирается на:
  - `CURRENT_SCHEMA_VERSION`
  - `schema_meta`
  - `MigrationResult`
- Основная схема выражена через консолидированный блок `V1_DDL` с `CREATE TABLE IF NOT EXISTS`.

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
- `src-tauri/src/lib.rs`
- `src-tauri/src/db/migration.rs`
- `scripts/release/prepare-production.js`
- `scripts/deploy/publish-update.js`
- `src/components/shared/UpdateChecker.tsx`
- `license-server/releases.htaccess`
- `license-server/api/update-channel.php`
