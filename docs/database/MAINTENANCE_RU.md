# Обслуживание базы данных

Практические инструкции по обслуживанию локальной SQLite-базы desktop-приложения RheoLab Enterprise.

> Проверено по коду репозитория: 2026-04-17  
> Актуально для схемы с `schema_meta` и `CURRENT_SCHEMA_VERSION = 1`

---

## 1. Где лежат файлы

База живёт внутри Tauri `app_data_dir`. На Windows типичный путь выглядит так:

```text
%APPDATA%\com.rheolab.enterprise\
```

Основные файлы:

| Файл | Назначение |
|------|------------|
| `rheolab.db` | Основная база данных |
| `rheolab.db-wal` | WAL-лог SQLite |
| `rheolab.db-shm` | Shared memory для WAL |
| `backups\*.db` | Локальные бэкапы |
| `pending_restore.db` | Файл отложенного восстановления |
| `restore.log` | Лог операций restore |

Если документация или скрипт ссылается на `dev.db`, это устаревшая информация.

---

## 2. Что использовать для бэкапов

### Предпочтительный путь

Использовать встроенные desktop-команды:

- `backup_create`
- `backup_list`
- `backup_restore`
- `backup_import_db`

`backup_restore` не подменяет БД на лету. Команда копирует выбранный файл в `pending_restore.db`, а swap выполняется на следующем старте приложения до открытия connection pool.

### Ручной бэкап

Если приложение недоступно, сначала полностью закройте его, затем:

```powershell
sqlite3 "$env:APPDATA\com.rheolab.enterprise\rheolab.db" "VACUUM INTO 'backup_manual.db'"
```

или скопируйте комплект файлов:

```powershell
Copy-Item "$env:APPDATA\com.rheolab.enterprise\rheolab.db*" "D:\backup\"
```

Нельзя копировать только `rheolab.db`, пока приложение работает в WAL-режиме.

---

## 3. Быстрая проверка целостности

```powershell
sqlite3 "$env:APPDATA\com.rheolab.enterprise\rheolab.db" "PRAGMA integrity_check;"
sqlite3 "$env:APPDATA\com.rheolab.enterprise\rheolab.db" "PRAGMA quick_check;"
```

Ожидаемый результат `integrity_check`: `ok`.

Если есть сомнения по FTS, индексам или миграциям, дополнительно запускайте backend-тесты:

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

---

## 4. Если база повреждена

При ошибках вида `database disk image is malformed`:

1. Скопируйте текущий `rheolab.db` в отдельный quarantine-файл.
2. Закройте приложение.
3. Попробуйте `.recover` через SQLite CLI.
4. После восстановления удалите устаревшие `-wal` и `-shm`, если они остались от старого состояния.

Пример:

```powershell
Copy-Item "$env:APPDATA\com.rheolab.enterprise\rheolab.db" ".\rheolab_corrupt_backup.db"
sqlite3 ".\rheolab_corrupt_backup.db" ".recover" | sqlite3 ".\rheolab_recovered.db"
Move-Item ".\rheolab_recovered.db" "$env:APPDATA\com.rheolab.enterprise\rheolab.db"
Remove-Item "$env:APPDATA\com.rheolab.enterprise\rheolab.db-wal" -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\com.rheolab.enterprise\rheolab.db-shm" -ErrorAction SilentlyContinue
```

---

## 5. Эксплуатационные операции

### WAL checkpoint

```powershell
sqlite3 "$env:APPDATA\com.rheolab.enterprise\rheolab.db" "PRAGMA wal_checkpoint(TRUNCATE);"
```

### VACUUM

```powershell
sqlite3 "$env:APPDATA\com.rheolab.enterprise\rheolab.db" "VACUUM;"
```

Выполнять только при закрытом приложении.

### Оценка размера файла

```powershell
sqlite3 "$env:APPDATA\com.rheolab.enterprise\rheolab.db" "SELECT page_count * page_size / 1024 / 1024 AS size_mb FROM pragma_page_count(), pragma_page_size();"
```

---

## 6. Как сейчас обновляется схема

Старая инструкция про `SCHEMA_VERSION`, `user_version` и каскад `migrate_v2/v3/...` больше не актуальна.

Фактическая модель:

- версия хранится в `schema_meta`
- текущая константа: `CURRENT_SCHEMA_VERSION`
- основной baseline описан в `V1_DDL`
- миграции запускаются через `run_migrations()`

Если добавляется новая таблица/индекс:

1. Обновить `V1_DDL`.
2. Обновить код, который читает/пишет данные.
3. Обновить тесты миграций.

Если меняется существующая структура:

1. Повысить `CURRENT_SCHEMA_VERSION`.
2. Добавить явную upgrade-логику.
3. Проверить path обновления существующей БД.

См. также [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).

---

## 7. Что не относится к этой базе

`license-server/database.sql`, `activation_log`, `demo_users` и другие MySQL-таблицы сервера лицензирования не относятся к локальной SQLite-базе desktop-клиента. Это отдельный operational контур.
