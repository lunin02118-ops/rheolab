# Участие в разработке RheoLab Enterprise

> Проприетарное ПО. Изменения вносятся только авторизованными участниками команды.

## 1. Требования

Основной toolchain:

- Node.js 20+
- Rust stable
- Visual Studio Build Tools 2022 с C++ workload на Windows

Дополнительные зависимости для отдельных зон:

- PHP 8.1+ для `license-server/`
- Astro dependencies для `website/`

Проверка окружения:

```powershell
npm run doctor:windows
```

```bash
npm run doctor:linux
```

## 2. Локальная настройка

```bash
npm install
npm run tauri:dev
```

Windows helper:

```powershell
.\scripts\dev\run-autonomous-windows.ps1
```

Если вы работаете с сайтом:

```bash
npm --prefix website install
```

Если вы работаете с PHP-сервером, убедитесь, что `php` и `phpunit` доступны локально или в CI.

## 3. Карта проекта

- `src/` — React-приложение
- `src-tauri/` — Tauri app и нативный Rust-код настольного приложения
- `src/rust/rheolab-core/` — общий Rust core crate
- `license-server/` — PHP admin/API/update server
- `website/` — Astro-сайт
- `scripts/` — вспомогательные скрипты
- `tests/` — Vitest и Playwright suites
- `docs/` — живая документация и исторические материалы

Чтобы быстро найти нужный документ, используйте [docs/README.md](README.md).

## 4. Ветки и коммиты

Следуйте формату Conventional Commits:

```text
<type>(<scope>): <summary>
```

Типовые значения: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.

Примеры:

```text
feat(analysis): add batch regroup diagnostics
fix(release): align updater endpoint with channel manifests
docs(architecture): refresh trust-boundary notes
```

## 5. Добавление или изменение Tauri-команды

1. Реализуйте Rust-команду в нужном модуле под `src-tauri/src/commands/`.
2. Зарегистрируйте её в `src-tauri/src/lib.rs`.
3. Добавьте typed frontend binding в правильный domain module под `src/lib/tauri/`.
4. Используйте `src/lib/tauri/index.ts` только для backward-compatible re-exports, не превращайте его в главный implementation surface.
5. Добавьте Rust-тесты в том же модуле или рядом, если нужна integration coverage.

## 6. Изменение SQLite-схемы

Актуальный schema contract находится в `src-tauri/src/db/migration.rs`.

### Additive-изменения

Если изменение безопасно выражается через `IF NOT EXISTS` и не требует преобразования существующих строк:

1. Обновите `V1_DDL`.
2. Сохраните идемпотентность.
3. Добавьте или обновите тесты на fresh install и повторный прогон.
4. Обновите связанную документацию.

### Destructive или transformational changes

Если изменение требует миграции данных, несовместимого изменения формы таблицы или cleanup-логики:

1. Поднимите `CURRENT_SCHEMA_VERSION`.
2. Расширьте migration path и логику `schema_meta`.
3. Добавьте явные upgrade-тесты.
4. Обновите docs по базе и архитектуре в том же change set.

Не следуйте старым инструкциям, где фигурируют `SCHEMA_VERSION` или ad hoc-шаблоны `migrate_vN`, не сверившись сначала с актуальным migration-файлом.

## 7. Обязательная проверка

Выбирайте команды по той зоне, которую вы изменяли.

### Основные desktop-изменения

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

### Parsing-изменения

```bash
npm run test:desktop-core
```

### Критические UI / workflow changes

```bash
npm run test:e2e:smoke
```

### Release / updater / deploy changes

```bash
npm run release:prepare -- --channel beta --dry-run --allow-unsigned --skip-qa
npm run audit:enterprise:quick
```

### Изменения сайта

```bash
npm --prefix website run build
```

### Изменения PHP-сервера

```bash
node scripts/audit/php-lint-license-server.js
phpunit --configuration license-server/phpunit.xml
```

## 8. Какую документацию держать синхронной

Обновляйте docs всякий раз, когда меняются поведение системы, trust boundaries или operational flow.

Наиболее частые точки обновления:

- [../README.md](../README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [RELEASE_AND_DEPLOY.md](RELEASE_AND_DEPLOY.md)
- [testing/TEST_METHODOLOGY.md](testing/TEST_METHODOLOGY.md)
- [testing/LICENSE_TESTING_METHODOLOGY.md](testing/LICENSE_TESTING_METHODOLOGY.md)
- [database/DEVELOPER_GUIDE.md](database/DEVELOPER_GUIDE.md)
- [../license-server/docs/README.md](../license-server/docs/README.md)

## 9. Практический чеклист ревью

- [ ] Документация по feature/module всё ещё описывает текущую реализацию
- [ ] Новые native-команды зарегистрированы и проброшены из правильного domain module
- [ ] Schema changes соответствуют текущему контракту `schema_meta` / `CURRENT_SCHEMA_VERSION`
- [ ] `npm test` проходит
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` проходит, либо известные падения документированы
- [ ] Release-sensitive changes были прогнаны через `release:prepare -- --dry-run`
- [ ] PHP-изменения проверены в окружении с PHP
