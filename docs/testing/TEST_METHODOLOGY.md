# Методология тестирования — RheoLab Enterprise

> Обновлено по фактическому состоянию репозитория 2026-04-17

Этот документ описывает актуальные точки входа в тестирование и аудит. Он намеренно не хардкодит “вечные” количества тестов или Tauri-команд, потому что они быстро устаревают. Источником правды всегда остаётся вывод раннеров и артефакты под `runtime/audit/`.

## 1. Основные уровни проверки

| Слой | Команда | Что проверяет |
|---|---|---|
| TypeScript / frontend | `npm test` | Vitest для компонентов, хуков, stores, release-утилит |
| Native backend | `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` | Rust unit/integration coverage для Tauri backend |
| Desktop smoke | `npm run test:e2e:smoke` | Критические Playwright/Tauri пользовательские сценарии |
| Repo-wide audit | `npm run audit:enterprise:quick` | env readiness, tsc, eslint, npm test, cargo check, website build, release dry-run |
| Release dry-run | `npm run release:prepare -- --channel beta --dry-run --allow-unsigned --skip-qa` | updater/release policy without full publish |
| Website | `npm --prefix website run build` | Astro production build |
| PHP server | `node scripts/audit/php-lint-license-server.js` / `phpunit --configuration license-server/phpunit.xml` | `license-server/` syntax and behavior |

## 2. Базовый рабочий набор

Для большинства desktop-изменений достаточно:

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

Если вы меняли parser, release/update, backup/restore или критический UI flow, дополнительно запускайте:

```bash
npm run test:desktop-core
npm run test:e2e:smoke
npm run audit:enterprise:quick
```

## 3. Environment-specific проверки

### Website

```bash
npm --prefix website ci
npm --prefix website run build
```

### License server

Нужен PHP runtime. Без него `audit:enterprise:quick` даст ожидаемый blocker по `php -v` и PHP lint.

```bash
node scripts/audit/php-lint-license-server.js
phpunit --configuration license-server/phpunit.xml
```

## 4. Release/update coverage

Для релизного контура важны как минимум:

- `tests/release/integrity-key-guard.test.ts`
- `tests/release/release-policy.test.ts`
- `tests/release/rollback-utils.test.ts`
- `tests/release/tauri-updater-config.test.ts`
- `tests/release/update-manifest-format.test.ts`
- `tests/store/update-store.test.ts`

Сами артефакты updater-а и серверный endpoint проверяются через:

```bash
node scripts/test/check-update-endpoint.mjs --version <version> --channel <stable|beta>
```

## 5. Снимок проверенного состояния на 2026-04-17

Ниже не “методология вообще”, а зафиксированная audit-сводка, которую полезно знать, чтобы не читать старые docs как будто всё зелёное.

### Пройдено

- `npx tsc --noEmit`
- `npx eslint .`
- `npm test`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm --prefix website run build`
- `npm run release:prepare -- --channel beta --dry-run --allow-unsigned --skip-qa`

### Blockers из `npm run audit:enterprise:quick`

- broken git worktree pointer: `git rev-parse --is-inside-work-tree` падает
- PHP runtime отсутствует в текущем shell / CI-контуре
- `license-server` PHP lint не может быть выполнен без PHP
- `npm audit --audit-level=high` сообщает high-vulns, в том числе по `xlsx`

### Дополнительно обнаружено вручную

После исправления path validation полный Rust suite сейчас зелёный:

```text
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

Проходит полностью, включая ранее проблемный сценарий `validate_file_path_blocks_ssh_dir`.

## 6. Чего больше не делать

Считайте устаревшими:

- старые цифры вида “76 Rust tests” или “479 Vitest tests”
- команды наподобие `cargo test db:: crud:: -- --test-threads=1`
- ссылки на удалённые / архивные Playwright config-файлы
- описания миграций через старый `user_version`-контур

## 7. Практический совет

Если вам нужен текущий статус, сначала запускайте:

```bash
npm run audit:enterprise:quick
```

А уже потом углубляйтесь в конкретные suites. Этот audit сейчас лучший единый вход в состояние репозитория.
