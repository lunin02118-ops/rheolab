# ADR-0006: Delta-sync engine — офлайн обмен данными между лабораториями

**Статус:** ✅ Реализовано  
**Дата принятия:** 2026-03-15  
**Дата документирования:** 2026-04-18 (ретроспективная запись)  
**Авторы:** Platform Team  
**Затронутые компоненты:** `src-tauri/src/commands/sync_engine.rs`, `src-tauri/src/commands/data_flows/sync.rs`, `src-tauri/src/commands/data_flows/conflicts.rs`

---

## 1. Контекст

Лаборатории работают офлайн и обмениваются данными через USB/SFTP:

```
Lab A → USB/sftp → Lab B → Central Lab
```

Нужен механизм экспорта/импорта дельт с отслеживанием конфликтов — без постоянного сетевого соединения.

## 2. Рассмотренные альтернативы

| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| **Delta-файлы (JSON)** | Простота, работает офлайн, человеко-читаемый формат | Нет real-time sync, ручной перенос файлов |
| CouchDB/PouchDB replication | Автоматическая синхронизация | Требует сеть, дополнительная СУБД |
| Git-based sync | Встроенный merge | Неприемлемая сложность для пользователей-лаборантов |

## 3. Решение

File-based delta-sync через `sync_engine.rs`:

**Формат дельта-файла** (`sync/delta_<ts>.json`):
```json
{
  "_deltaVersion": "1",
  "_sinceTimestamp": "<RFC-3339>",
  "_exportedAt": "<RFC-3339>",
  "experiments": [ <StoredExperiment>, … ]
}
```

**Flow:**
1. `sync_export_delta(since_timestamp)` — экспорт экспериментов, изменённых после указанной метки.
2. Физический перенос файла (USB).
3. `sync_import_delta(path)` — импорт на принимающей стороне.
4. Per-experiment conflict detection: если `updatedAt` локального эксперимента позже `sinceTimestamp` — конфликт.
5. Конфликты записываются в `ConflictRecord` (`status: "open"` → `"resolved"`).

**Инфраструктура:** таблицы `SyncOutbox`, `SyncInbox`, `ConflictRecord`, `MergeEvent` в SQLite.

## 4. Последствия

- **Положительные:** полностью офлайн, прозрачный формат, поэкспериментный конфликт-трекинг
- **Отрицательные:** ручной перенос файлов, нет auto-merge на уровне полей (только целый эксперимент)
- **Нейтральные:** масштабируется до цепочки Lab A→B→Central через повторное экспортирование
