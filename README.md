# RheoLab Enterprise

RheoLab Enterprise — офлайн-ориентированная настольная платформа для анализа реологических данных и генерации отчётов.

Репозиторий включает не только клиентское приложение:

- React/Vite frontend в `src/`
- Tauri v2 shell и desktop backend в `src-tauri/`
- общий Rust core crate в `src/rust/rheolab-core/`
- PHP-сервер лицензирования и обновлений в `license-server/`
- Astro-сайт и пользовательскую документацию в `website/`

Единственный источник правды по версии — файл `/version.json` (поля `version` и
`channel`); актуальное число версии смотрите в нём. Четыре зависимых файла
(`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` и
`src/lib/version.ts`) синхронизируются командой `npm run version:sync` и
проверяются `npm run version:validate`. Редактировать эти четыре файла вручную
не нужно.

## Стек

| Зона | Технология |
|---|---|
| Desktop UI | React 19, Vite 6, TypeScript, Tailwind CSS v4 |
| Desktop shell | Tauri v2 |
| Native backend | Rust |
| Общий native core | `src/rust/rheolab-core` |
| Хранение данных | SQLite через `rusqlite` |
| Отчёты | Typst PDF + `rust_xlsxwriter` |
| Лицензирование / обновления | Rust desktop client + PHP `license-server` |
| Website | Astro |

## Карта репозитория

```text
RheoLab/
├── src/                     React-приложение внутри desktop WebView
├── src-tauri/               Tauri app, Rust-команды, SQLite-интеграция
├── src/rust/rheolab-core/   Общий Rust crate для парсинга, анализа и отчётов
├── tests/                   Vitest + Playwright suites
├── docs/                    Живая документация и исторические материалы
├── license-server/          PHP admin panel, activation API, update routing
├── website/                 Публичный сайт, загрузки, пользовательские docs
├── scripts/                 Dev, audit, release, deploy и test helper-скрипты
├── tools/                   Отдельные Rust-утилиты для fixture/seed workflows
├── runtime/                 Сгенерированные audit, QA и release-артефакты
└── Regents/                 Исходные материалы по реагентам и extraction-скрипты
```

## Быстрый старт

### Требования

- Node.js 20+
- Rust stable
- Visual Studio Build Tools с C++ workload на Windows
- PHP 8.1+, если вы работаете с `license-server/`

Проверка окружения:

```powershell
npm run doctor:windows
```

```bash
npm run doctor:linux
```

### Локальная разработка

```bash
npm install
npm run tauri:dev
```

Полезные вспомогательные команды:

```powershell
.\scripts\dev\run-autonomous-windows.ps1
```

```bash
npm --prefix website install
```

## Основные проверки

Используйте реальные команды раннеров, а не старые цифры из документации:

```bash
npm run audit:enterprise:quick
npm test
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run test:e2e:smoke
npm --prefix website run build
```

Если меняете release/update-контур:

```bash
npm run release:prepare -- --channel beta --dry-run --allow-unsigned --skip-qa
```

Если меняете `license-server/`, запускайте PHP-проверки в окружении с установленным PHP:

```bash
node scripts/audit/php-lint-license-server.js
phpunit --configuration license-server/phpunit.xml
```

## Модель релиза и обновлений

- Канонический scripted release path — `npm run release:prepare`.
- `scripts/release/build.ps1` остаётся отдельным интерактивным Windows-потоком с version bump перед сборкой.
- Tauri-клиент настроен на updater endpoint:

```text
https://license.vizbuka.ru/releases/v1/update/{{target}}-{{arch}}/update
```

- Сервер публикует channel manifests вроде `stable.json` и `beta.json` в `releases/v1/update/windows-x86_64/`.
- Desktop-клиент отправляет `X-Update-Channel` и, для beta-доступа, `X-Update-Token`.

Детальный operational flow описан в [docs/RELEASE_AND_DEPLOY.md](docs/RELEASE_AND_DEPLOY.md).

## Документация

Начинать стоит отсюда:

- [docs/README.md](docs/README.md) — карта документации
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — актуальная архитектура и границы доверия
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — процесс работы для разработчиков
- [docs/RELEASE_AND_DEPLOY.md](docs/RELEASE_AND_DEPLOY.md) — релизный и updater-контур
- [docs/testing/TEST_METHODOLOGY.md](docs/testing/TEST_METHODOLOGY.md) — методология тестов и аудита
- [docs/SERVER_ACCESS.md](docs/SERVER_ACCESS.md) — модель доступа к deploy-серверу

Подсистемные документы:

- [license-server/docs/README.md](license-server/docs/README.md)
- [scripts/README.md](scripts/README.md)
- [website/README.md](website/README.md)
- [website/SPECIFICATION.md](website/SPECIFICATION.md)

## Секреты и доступы

Репозиторий не должен использоваться как хранилище живых паролей, учётных данных БД или ключей подписи.

- Desktop/release secrets: `scripts/dev/.env.keys`
- Deploy access: `scripts/deploy/.env.server`
- Updater signing key: `src-tauri/keys/updater.key`
- Конфигурация `license-server`: environment variables или локальный `license-server/config.php`

См. [CREDENTIALS.md](CREDENTIALS.md) и [docs/SERVER_ACCESS.md](docs/SERVER_ACCESS.md).
