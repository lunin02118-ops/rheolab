# IPC surface — RheoLab Enterprise

> Проверено против `src-tauri/src/startup/commands_registry.rs` на коммите `0.2.1-beta.1`.
> Авторитетный список всегда — сам макрос `register_tauri_commands!()`; этот документ — агрегированная навигация для разработки и аудита.

## Как читать

| Колонка | Значение |
|---------|----------|
| **Command** | Имя, видимое фронтенду через `invoke(...)` и `@tauri-apps/api/core`. |
| **Назначение** | Одной строкой: что делает и какая таблица/ресурс затрагивается. |
| **Risk** | `LOW` — чтение/локальный кэш; `MED` — запись пользовательских данных; `HIGH` — запись критичных таблиц, FS, лицензии, sync. |
| **Error type** | `AppError` (см. `src-tauri/src/error.rs`) или `String` для legacy команд — текст ошибки уже локализован. |
| **License gate** | Что проверяется перед выполнением: `—` (без проверки), `trial` (демо-режим пропускает), `paid` (только активированные лицензии), `feature:<name>`. |

Все команды регистрируются в **одном месте**: `src-tauri/src/startup/commands_registry.rs`. Добавление новой команды:
1. Реализовать `#[tauri::command]` в соответствующем `src-tauri/src/commands/<domain>/` модуле.
2. Экспортировать её через `pub use` в `mod.rs` домена.
3. Добавить строку в `register_tauri_commands!` в соответствующую секцию и этот файл.

---

## 1. `backup` — резервные копии БД

Пишут и читают файлы SQLite-бэкапов в `%APPDATA%/RheoLab Enterprise/backups/`.

| Command | Назначение | Risk | License gate |
|---|---|---|---|
| `backup_list` | Вернуть список существующих бэкапов (имя, размер, mtime). | LOW | — |
| `backup_create` | Создать бэкап текущей БД (горячая копия через `VACUUM INTO`). | HIGH | paid |
| `backup_restore` | Заменить активную БД бэкапом; требует перезапуска. | HIGH | paid |
| `backup_delete` | Удалить файл бэкапа по имени. | HIGH | paid |
| `backup_open_folder` | Открыть папку бэкапов в системном проводнике. | LOW | — |
| `backup_import_db` | Импортировать стороннюю БД из файла (валидация схемы). | HIGH | paid |
| `backup_export_db` | Экспортировать активную БД в указанный путь. | HIGH | paid |

---

## 2. `api_keys` — API-ключи AI-парсеров

Хранятся зашифрованными (AES-GCM, ключ — machine fingerprint) в таблице `APIKey`.

| Command | Назначение | Risk |
|---|---|---|
| `api_keys_list` | Список ключей (provider + обрезанный preview, без plaintext). | MED |
| `api_keys_create` | Добавить новый ключ, шифрует на лету. | HIGH |
| `api_keys_set_active` | Переключить активный ключ для провайдера. | MED |
| `api_keys_delete` | Удалить ключ по id. | HIGH |
| `api_keys_active` | Отдать расшифрованный активный ключ для указанного провайдера. | HIGH |
| `api_keys_check_active` | Проверить, что есть активный ключ (булево). | LOW |
| `api_keys_validate` | Сходить во внешний API провайдера — валиден ли ключ. | MED |

---

## 3. `experiments` — эксперименты и их экспорт

Ядро пользовательских данных. Таблицы: `Experiment`, `ExperimentData`, `ExperimentReagent`, `Calibration`, `ImportBatch`.

| Command | Назначение | Risk | License gate |
|---|---|---|---|
| `experiments_list` | Список карточек (пагинация + сортировка + фильтры). | LOW | — |
| `experiments_count` | Общее число экспериментов (для квоты и демо-лимита). | LOW | — |
| `experiments_get` | Получить один эксперимент со всеми данными для Dashboard. | LOW | — |
| `experiments_get_batch` | Bulk-загрузка для сравнения (comparison mode). | LOW | — |
| `experiments_check_existence` | Проверить наличие по hash/имени (pre-save conflict detection). | LOW | — |
| `experiments_save` | Создать или обновить эксперимент + children. | HIGH | paid (demo разрешает N опытов) |
| `experiments_delete` | Каскадно удалить эксперимент и его children. | HIGH | paid |
| `experiments_last_context` | Восстановить последний открытый эксперимент (sticky). | LOW | — |
| `experiments_water_sources` | Справочник источников воды для выпадающего списка. | LOW | — |
| `experiments_filter_metadata` | Уникальные значения для фильтров библиотеки. | LOW | — |
| `experiments_export_laboratories` | Экспорт группы экспериментов по лабораториям. | MED | paid |
| `experiments_export_to_file` | Дамп в JSON/CSV/Excel (batch export). | MED | paid |
| `experiments_import` | Импорт экспериментов из файла (дедупликация по hash). | HIGH | paid |

---

## 4. `reagents` — каталог реагентов

Таблица `ReagentCatalog`. Seeds через `INSERT OR IGNORE` при каждом старте — пользовательские реагенты сохраняются.

| Command | Назначение | Risk |
|---|---|---|
| `reagents_list` | Список активных реагентов (с категорией и единицами). | LOW |
| `reagents_create` | Создать кастомный реагент. | MED |
| `reagents_update` | Изменить имя / категорию / default dose. | MED |
| `reagents_delete` | Hard-delete реагент из `ReagentCatalog`; отказывает с ошибкой если реагент привязан к экспериментам. | MED |
| `reagents_export` | Экспорт каталога в JSON. | LOW |
| `reagents_import` | Импорт каталога из JSON (merge по имени). | MED |
| `reagents_seed` | Пересеять defaults (admin / диагностика). | MED |

---

## 5. `operators` / `laboratories` — персонал и площадки

| Command | Назначение | Risk |
|---|---|---|
| `operators_list` / `laboratories_list` | Справочники для выбора в Save-диалоге. | LOW |
| `operators_create` / `laboratories_create` | Создание новой записи. | MED |
| `operators_update` / `laboratories_update` | Изменение полей. | MED |
| `operators_delete` / `laboratories_delete` | Удаление (FK на `Experiment.userId`/`laboratoryId` с `SET NULL`). | MED |

---

## 6. `fixtures` — демо-данные для Dashboard

Читают подготовленные файлы из `runtime/fixtures/`. Не пишут ни в БД, ни в FS.

| Command | Назначение | Risk |
|---|---|---|
| `test_fixtures_list` | Список доступных демо-файлов. | LOW |
| `test_fixtures_read` | Прочитать сырые байты фикстуры. | LOW |
| `test_fixtures_parse` | Распарсить фикстуру через pipeline (результат ≈ upload flow). | LOW |

---

## 7. `parsing` — нативный парсинг файлов

Обёртка над `rheolab-core::parser`. Парсит Chandler/Anton-Paar/Excel/CSV/AI-mapped сигнатуры.

| Command | Назначение | Risk |
|---|---|---|
| `parsing_parse_file` | Распарсить путь к файлу → `ParseResult` (метаданные, серии, ошибки). | LOW |
| `parsing_release_cache` | Очистить module-level кэш парсеров (диагностика). | LOW |

---

## 8. `reports` — PDF/Excel генерация

Нативные генераторы в `rheolab-core::reports`. License-gated и возвращают `Vec<u8>` бинарных данных — фронтенд сохраняет через `dialog.save`.

| Command | Назначение | Risk | License gate |
|---|---|---|---|
| `reports_generate_pdf` | Построить PDF-отчёт (до 6 локалей графиков, опционально калибровка). | LOW | feature:reportPdf |
| `reports_generate_excel` | Построить многолистовый XLSX. | LOW | feature:reportExcel |
| `reports_generate_comparison_pdf` | Comparison-отчёт PDF по группе экспериментов (ADR-0010). Нативный pipeline в `rheolab-core::report_generator::comparison`. | LOW | feature:reportPdf |
| `reports_generate_comparison_excel` | Comparison-отчёт XLSX (Сводная таблица + per-experiment листы). | LOW | feature:reportExcel |

---

## 9. `analysis` — аналитический пайплайн

Декомпозированный модуль (W2): `commands/analysis/{dto,cycle_detection,cycle_processing,commands}.rs`. DTO валидируются перед вычислениями.

| Command | Назначение | Risk |
|---|---|---|
| `analysis_analyze_full` | Полный прогон: detect cycles → process → Grace fit per cycle. | LOW |
| `analysis_detect_steps` | Только поиск steps / cycles (для Expert mode). | LOW |
| `analysis_regroup_by_pattern` | Перегруппировать точки по заданной shear-rate pattern. | LOW |

---

## 10. `logger` — фронт-эндовый JSON лог

Пишут в файл `%APPDATA%/RheoLab Enterprise/logs/app.log` с ротацией (см. `startup/logging.rs`).

| Command | Назначение | Risk |
|---|---|---|
| `log_info` | Записать info-событие (module, message, optional fields). | LOW |
| `log_error` | Записать error-событие с серилизованным stack. | LOW |

---

## 11. `licensing` — V2 лицензионный движок

Самая чувствительная поверхность: активация/деактивация, подпись `machine_id`, connection с `license.vizbuka.ru`.
См. `commands/licensing/mod.rs`. Crypto живёт в `commands/licensing/signature.rs`.

### 11.1 Legacy / диагностика

| Command | Назначение | Risk |
|---|---|---|
| `licensing_machine_id` | Собрать и вернуть hex-fingerprint текущей машины. | LOW |
| `licensing_debug_fingerprint` | Детальный дамп компонентов fingerprint’а (CPU/Motherboard/BIOS/MAC) для диагностики проблем активации. | LOW |
| `licensing_was_ever_licensed` | `true`, если БД когда-либо была активирована (флаг в `SystemState`). | LOW |
| `licensing_checkpoint_db` | Снапшот БД — используется before-deactivate hook. | HIGH |
| `licensing_reset_experiments` | Удалить все эксперименты текущего пользователя (LOCAL_USER_ID) + их reagent-линки. Шлюз `require_write_license`. | HIGH |
| `licensing_reset_all_experiments` | Полный reset experimentа + артефактов. | HIGH |

### 11.2 V2 engine

| Command | Назначение | Risk |
|---|---|---|
| `licensing_check` | Форс-проверка лицензии (online если возможно, иначе grace period). | HIGH |
| `licensing_get_status` | Текущий статус (live/trial/expired + features + counters). | LOW |
| `licensing_activate_full` | Активировать по ключу: обмен с сервером, подпись, сохранение. | HIGH |
| `licensing_deactivate` | Снять активацию, отправить серверу, очистить локальное состояние. | HIGH |
| `licensing_can_save` | Разрешён ли save experiment прямо сейчас (учитывает квоты trial). | LOW |
| `licensing_register_experiment` | Зарегистрировать факт сохранения (decrements trial counter). | MED |
| `get_update_channel` | Какой канал обновлений доступен при текущей лицензии. | LOW |
| `is_e2e_mode` | `true` когда приложение запущено в Playwright E2E. | LOW |

---

## 12. `data_flows` — sync outbox/inbox, импорт-батчи, артефакты

Таблицы: `ImportBatch`, `ExperimentPayload`, `ParserArtifact`, `ReportArtifact`, `SyncOutbox`, `SyncInbox`, `ConflictRecord`, `SearchProjection`.

| Command | Назначение | Risk |
|---|---|---|
| `import_batches_list` / `_get` | История импортов для аудита и повторного проигрывания. | LOW |
| `experiment_payloads_list` | Raw payloads, привязанные к экспериментам. | LOW |
| `parser_artifacts_list` / `_get` | Сохранённые сырые выходы парсера (диагностика). | LOW |
| `report_artifacts_list` / `_save` / `_delete` | Кэшированные PDF/Excel для быстрой повторной выдачи. | MED |
| `search_projections_list` | Денормализованные строки для поиска по библиотеке. | LOW |
| `sync_status` | Агрегированный статус outbox/inbox (счётчики + last_sync). | LOW |
| `sync_outbox_list` / `_mark_synced` / `_retry` | Управление очередью исходящих событий. | MED |
| `sync_inbox_receive` / `_list` | Приём входящих событий, дедупликация. | MED |
| `conflicts_list` / `_resolve` | CRDT-конфликты и их разрешение. | MED |

---

## 13. `sync_engine` — file-based delta sync

Низкоуровневая поверхность сериализации delta-пакетов (SQLite → ZIP → SQLite). Используется для обмена без сети.

| Command | Назначение | Risk |
|---|---|---|
| `sync_export_delta` | Собрать изменения с `since_timestamp` → пакет байт. | HIGH |
| `sync_import_delta` | Применить delta-пакет, merge с inbox, зафиксировать конфликты. | HIGH |
| `sync_resolve_conflict` | Принять/отклонить конкретный конфликт. | HIGH |
| `sync_list_conflicts` | Текущие нерешённые конфликты. | LOW |

---

## Error conventions

- **Новые команды** возвращают `Result<T, AppError>` (`src-tauri/src/error.rs`).
  Фронт получает union-объект `{ kind: "NotFound" | "Validation" | "Io" | "Database" | … , message: string }`.
- **Legacy команды** возвращают `Result<T, String>` — текст уже локализован для UI (ru/en).
- Паники в прод-коде запрещены; `.unwrap()`/`.expect()` допустимы только в тестах и в документированных infallible точках (фикстуры, `LazyLock::get`).

## License gating

Проверка `paid` выполняется через единую обёртку `require_license!(ctx, feature)`
(`src-tauri/src/commands/licensing/guards.rs`). Демо-режим (`trial`) автоматически
пропускает большинство write-команд, пока не превышен лимит экспериментов,
настроенный в `LicenseResult.features.trialMaxExperiments`.

## Добавление новой команды — чеклист

1. `#[tauri::command]` с `Result<T, AppError>` (никогда `panic`).
2. DTO входа/выхода — структуры с `#[derive(Deserialize)]` / `#[derive(Serialize)]`,
   `#[serde(rename_all = "camelCase")]`.
3. Валидация входа **в первой же строке** (см. паттерн в `commands/analysis/dto.rs`).
4. License gate, если команда пишет пользовательские данные.
5. `pub use` в `mod.rs` домена.
6. Строчка в `register_tauri_commands!` + строка сюда в правильную секцию.
7. Unit-тест в соответствующем `tests/` или `#[cfg(test)]` модуле.
