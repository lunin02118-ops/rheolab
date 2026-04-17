# Developer Guide: Database Architecture & Management

Техническая документация по фактической модели хранения данных в RheoLab Enterprise.

> Проверено по коду репозитория: 2026-04-17  
> Актуально для desktop-версии: `0.2.0-beta.5`

---

## 1. Текущий стек

| Компонент | Технология |
|-----------|------------|
| База данных | SQLite |
| Rust-драйвер | `rusqlite 0.32` (`features = ["bundled"]`) |
| Connection pool | `r2d2` + `r2d2_sqlite 0.25` |
| Полнотекстовый поиск | SQLite FTS5 |
| Columnar storage | `src-tauri/src/db/columnar.rs` |
| Единый источник истины по схеме | `src-tauri/src/db/migration.rs` |

В проекте нет `Prisma`, `schema.prisma`, PostgreSQL или отдельного ORM-слоя миграций.

---

## 2. Файлы и пути

Приложение работает от `app_data_dir`, который Tauri определяет по `identifier = "com.rheolab.enterprise"`.

Типовая раскладка:

- основная БД: `<app_data_dir>/rheolab.db`
- каталог бэкапов: `<app_data_dir>/backups/`
- pending restore: `<app_data_dir>/pending_restore.db`
- restore log: `<app_data_dir>/restore.log`

Для E2E- и harness-сценариев путь к БД может быть переопределён переменной:

```text
RHEOLAB_E2E_DB_PATH
```

---

## 3. Bootstrap flow

Инициализация desktop-приложения строится так:

1. `state/app_state.rs` создаёт `app_data_dir` и `backups/`.
2. `db/pool.rs` поднимает пул соединений.
3. `db/migration.rs` выполняет `run_migrations()`.
4. Выполняется миграция legacy API-ключей.
5. Инициализируется локальный licensing engine.

То есть миграции запускаются на каждом старте и являются частью нормального bootstrap flow.

---

## 4. Pool configuration

Актуальные параметры пула и SQLite PRAGMA задаются в `src-tauri/src/db/pool.rs`:

- `journal_mode = WAL`
- `foreign_keys = ON`
- `busy_timeout = 5000`
- `synchronous = NORMAL`
- `cache_size = -2000`
- `temp_store = MEMORY`
- `mmap_size = 67108864`
- `max_size = 4`
- `min_idle = 1`

Это single-user desktop-конфигурация. Старые документы с `max_size = 8` и другими mmap/cache значениями больше не актуальны.

---

## 5. Миграции и версия схемы

### Что реально используется сейчас

- `CURRENT_SCHEMA_VERSION = 1`
- singleton-таблица `schema_meta`
- структура `MigrationResult`
- консолидированный DDL-блок `V1_DDL`

`schema_meta` хранит:

- `schema_version`
- `app_version`
- `migrated_at`

### Практический контракт

- `run_migrations()` безопасно вызывать на каждом старте.
- Additive-изменения допускаются через `CREATE ... IF NOT EXISTS` внутри `V1_DDL`.
- Destructive / transformational changes требуют:
  - повышения `CURRENT_SCHEMA_VERSION`
  - явной upgrade-логики в Rust
  - обновления тестов миграции

Документация, ссылающаяся на `SCHEMA_VERSION`, `PRAGMA user_version` или старую линейку `migrate_v2/v3/...`, считается устаревшей.

---

## 6. Текущий инвентарь схемы

SQLite-схема desktop-приложения включает 22 таблицы и 1 FTS5 virtual table.

### Таблицы

- `schema_meta`
- `User`
- `Settings`
- `APIKey`
- `SystemState`
- `ReagentCatalog`
- `Laboratory`
- `Operator`
- `WaterSourceCatalog`
- `Experiment`
- `ExperimentData`
- `Calibration`
- `ExperimentReagent`
- `ImportBatch`
- `ExperimentPayload`
- `ParserArtifact`
- `ReportArtifact`
- `SearchProjectionLog`
- `SyncOutbox`
- `SyncInbox`
- `MergeEvent`
- `ConflictRecord`

### FTS

- `fts_experiment`

FTS-таблица и связанные с ней служебные триггеры создаются из того же migration-файла и не должны документироваться как отдельные доменные сущности.

---

## 7. Доменные зоны данных

### Operational core

- `Experiment`
- `ExperimentData`
- `Calibration`
- `ExperimentReagent`

### Reference data

- `ReagentCatalog`
- `WaterSourceCatalog`
- `Laboratory`
- `Operator`

### App/runtime state

- `User`
- `Settings`
- `APIKey`
- `SystemState`

### Audit / import / reporting

- `ImportBatch`
- `ExperimentPayload`
- `ParserArtifact`
- `ReportArtifact`
- `SearchProjectionLog`

### Future / sync plumbing

- `SyncOutbox`
- `SyncInbox`
- `MergeEvent`
- `ConflictRecord`

---

## 8. Важные практические замечания

### `Experiment` и `ExperimentData`

- `Experiment` остаётся центральной карточкой теста.
- `Experiment.rawPoints` сохраняется как legacy/read-compat поле.
- Предпочтительное плотное хранение точек находится в `ExperimentData.dataBlob`.

### `APIKey`

API-ключи хранятся в SQLite, но защищаются на уровне приложения. Документация не должна утверждать, что это «plain text in DB».

### `SystemState`

В `SystemState` лежит чувствительное runtime-состояние desktop-клиента, включая licensing-related значения. Любые изменения в этой таблице нужно рассматривать как изменение trust boundary, а не как простую справочную запись.

---

## 9. Как правильно менять схему

### Additive change

Если добавляется новая таблица, индекс или безопасный `IF NOT EXISTS`-элемент:

1. Обновить `V1_DDL`.
2. При необходимости обновить код чтения/записи.
3. Обновить тесты в `migration.rs`.

### Destructive / shape change

Если меняется структура существующей таблицы:

1. Повысить `CURRENT_SCHEMA_VERSION`.
2. Добавить явную migration-логику.
3. Обновить/дописать тесты upgrade-path.
4. Проверить bootstrap на существующих БД.

Минимальный verification loop:

```bash
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
npm run audit:enterprise:quick
```

---

## 10. Где смотреть правду в коде

При расхождении документации и реализации сначала сверять:

- `src-tauri/src/db/migration.rs`
- `src-tauri/src/db/pool.rs`
- `src-tauri/src/state/app_state.rs`
- `src-tauri/src/commands/backup/restore.rs`
- `src-tauri/Cargo.toml`

Этот файл должен обновляться после каждого изменения migration-контракта или bootstrap-потока БД.
