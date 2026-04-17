# Методика тестирования системы лицензирования

> Актуализировано по коду и тестам 2026-04-17

Система лицензирования больше не является “frontend-only” механизмом. Основная логика живёт в Rust backend (`src-tauri/src/commands/licensing/`), а TypeScript-слой лишь вызывает Tauri-команды и отображает состояние.

## 1. Карта покрытия

| Слой | Где живёт | Чем проверяется |
|---|---|---|
| Desktop license engine | `src-tauri/src/commands/licensing/` | `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` |
| Frontend stores / UX | `src/lib/store/license-store.ts`, `src/components/licensing/*` | `npm test -- tests/store/license-store.test.ts tests/store/update-store.test.ts` |
| License server | `license-server/` | `phpunit --configuration license-server/phpunit.xml` |
| Update-channel integration | `src/components/shared/UpdateChecker.tsx`, `license-server/api/update-channel.php`, `license-server/releases.htaccess` | release tests + manual verification |

## 2. Автоматические проверки

### Rust backend

Канонический запуск:

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

Ключевые области покрытия:

- `crypto.rs` — integrity/signature helpers
- `engine/engine_tests.rs` — `LicenseEngine`
- `hardware.rs` — machine id
- `demo.rs` — demo/offline budget
- `features.rs` — entitlement mapping
- `online.rs` — server-response handling
- `security.rs` — tamper/time-related checks

### Frontend / stores

```bash
npm test -- tests/store/license-store.test.ts tests/store/update-store.test.ts
```

Полезно дополнительно запускать весь `npm test`, если менялись баннеры, onboarding или update UX.

### PHP server

```bash
node scripts/audit/php-lint-license-server.js
phpunit --configuration license-server/phpunit.xml
```

Обратите внимание: эти проверки требуют реального PHP runtime. Если `php` отсутствует, repo-wide audit закономерно покажет blocker.

## 3. Что именно нужно проверять вручную

### Активация

1. Запустить приложение.
2. Ввести валидный лицензионный ключ.
3. Убедиться, что `licensing_check` и `licensing_get_status` возвращают согласованное состояние.
4. Проверить, что лицензия сохраняется между рестартами.

### Отзыв лицензии

1. Отозвать ключ в `license-server/admin/`.
2. Перезапустить приложение с доступом к сети.
3. Убедиться, что лицензия не восстанавливается автоматически как active.

### Сброс привязки

Текущий admin UI уже умеет reset binding; это больше не “ручной DB-edit only” сценарий.

Проверьте:

1. Ключ привязан к старому `machine_id`.
2. В панели администратора выполняется reset.
3. Повторная активация на новом устройстве проходит без выпуска второго ключа, если это допустимо по бизнес-правилам.

### Beta channel

Проверяйте связку:

- `UpdateChecker.tsx`
- `get_update_channel`
- `license-server/api/update-channel.php`
- `license-server/releases.htaccess`

На сегодня в репозитории есть расхождение между token-aware PHP router и активным Apache rewrite, поэтому ручная проверка beta-канала обязательна после любых изменений в updater routing.

### Offline / tamper scenarios

Проверяйте:

- grace/offline budget
- поведение после повторного запуска без сети
- реакцию на ручной rollback системного времени

## 4. Диагностика

В DevTools / Tauri IPC:

```javascript
const { invoke } = window.__TAURI__;
await invoke('licensing_get_status');
await invoke('licensing_check');
```

Серверная сторона:

- admin panel
- Apache/PHP logs
- PHPUnit suite

## 5. Что уже устарело

Считайте устаревшими следующие представления:

- лицензирование хранится в localStorage
- у менеджера есть только типы `Standard` и `Professional`
- перенос лицензии всегда требует выпуска нового ключа
- frontend-удалённые тесты `tests/licensing/*` остаются главным источником правды

Источником правды сейчас являются Rust engine, текущие Zustand store tests и PHP server behavior.
