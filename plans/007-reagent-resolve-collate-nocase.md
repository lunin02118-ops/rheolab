# План 007: Убрать последний LOWER(name)-скан в resolve_by_id_or_name (остаток находки F1)

> **Инструкция исполнителю**: выполняй план строго по шагам. После каждого шага
> запускай команду верификации и сверяй результат, прежде чем идти дальше.
> При любом условии из «Условия STOP» — остановись и доложи. По завершении
> обнови строку статуса этого плана в `plans/README.md`.
>
> **Проверка дрейфа (выполнить первой)**:
> `git grep -n "LOWER(name)" -- src-tauri/src/db/repositories/reagents.rs`
> Ожидаемо: ровно одно совпадение (строка ~228, внутри `resolve_by_id_or_name`).
> Если совпадений ноль — фикс уже сделан, пометить план REJECTED в индексе.
> Если больше одного — файл дрейфанул, STOP.

## Статус

- **Приоритет**: P3
- **Трудозатраты**: S (одна строка SQL + один регрессионный тест)
- **Риск**: LOW
- **Зависит от**: нет
- **Категория**: perf (микро) + консистентность паттерна
- **Составлен на**: коммит `969fa1f`, 2026-06-12

## Почему это важно

DB-аудит 2026-04-27 (`docs/audit/2026-04-27-database-deep-dive.md`, finding
F1) показал: предикат `LOWER(name) = LOWER(?)` не может использовать индекс
`idx_reagent_name_nocase ON ReagentCatalog(name COLLATE NOCASE)` — выражение
не совпадает с ключом индекса, SQLite делает full scan. F1 был починен в
`is_duplicate_name` (с регрессионными тестами в `reagents_tests.rs`) и в
ORDER BY-варианте (миграция v0005), но один вызов пропустили: fallback по
имени в `resolve_by_id_or_name` (путь импорта реагентов). Практический
эффект микроскопический (таблица <500 строк), но это последнее место в
репозитории, противоречащее собственному задокументированному паттерну —
и приглашение скопировать антипаттерн в будущий код. Фикс — одна строка,
точно повторяющая уже принятое решение тремя экранами выше.

## Текущее состояние

- `src-tauri/src/db/repositories/reagents.rs:192-233` — функция
  `resolve_by_id_or_name`; fallback-запрос (строки ~226-232):

  ```rust
  // Fallback: match by name
  conn.query_row(
      &format!("{} WHERE LOWER(name) = LOWER(?1)", SQL),
      params![name],
      map_row,
  )
  ```

  где `SQL` = `SELECT id, manufacturer, country, description,
  activeSubstance, form, extraFields FROM ReagentCatalog` (строка ~198).

- Канонический паттерн — в ТОМ ЖЕ файле, `is_duplicate_name`
  (строки ~163-180), с поясняющим комментарием:

  ```rust
  // Note: `name = ? COLLATE NOCASE` lets SQLite use the existing
  // `idx_reagent_name_nocase ON ReagentCatalog(name COLLATE NOCASE)` index.
  // Wrapping the column in `LOWER()` would defeat the index — see
  // docs/audit/2026-04-27-database-deep-dive.md (finding F1).
  ...
  "SELECT COUNT(*) FROM ReagentCatalog WHERE name = ?1 COLLATE NOCASE",
  ```

- Индекс существует с v0001: `src-tauri/src/db/migrations/v0001_initial.rs:270`
  — `CREATE INDEX IF NOT EXISTS idx_reagent_name_nocase ON
  ReagentCatalog(name COLLATE NOCASE);`

- Тесты-образцы: `src-tauri/src/db/repositories/reagents_tests.rs` —
  in-memory БД через `run_migrations`, хелперы `open_db()` /
  `insert_reagent()`; EXPLAIN-паттерн — `explain()` хелпер в
  `src-tauri/src/db/migrations/v0005_reagent_and_testtype_indexes.rs`
  (tests-модуль).

- Семантика NOCASE vs LOWER: SQLite `NOCASE` фолдит только ASCII A-Z;
  `LOWER()` без ICU — тоже только ASCII. Поведение для кириллических имён
  реагентов НЕ меняется (оба варианта case-sensitive для не-ASCII), что
  совпадает с уже принятым в `is_duplicate_name` решением.

## Команды, которые понадобятся

| Назначение | Команда | Ожидаемо при успехе |
|---|---|---|
| Тесты реагентов | `cargo test --manifest-path src-tauri/Cargo.toml reagent` | все зелёные |
| Полные Rust-тесты | `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` | exit 0, ≥546 passed |
| Линт Rust (если настроен) | `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | exit 0 (если clippy не входит в гейт репо — пропустить) |

## Объём

**В объёме**:
- `src-tauri/src/db/repositories/reagents.rs` (одна строка SQL + при желании
  короткий комментарий-ссылка на F1 по образцу is_duplicate_name)
- `src-tauri/src/db/repositories/reagents_tests.rs` (два новых теста)
- `plans/README.md` (статус)

**Вне объёма** (НЕ трогать):
- Миграции (`src-tauri/src/db/migrations/**`) — индекс уже существует,
  новые НЕ нужны.
- `src-tauri/src/commands/reagents/commands.rs:276`
  (`ORDER BY LOWER(category), LOWER(name)`) — НЕ трогать: этот ORDER BY
  обслуживается индексом v0005 `idx_reagent_category_name_nocase` только в
  паре с переписанным ORDER BY... если запрос всё ещё содержит LOWER() —
  это отдельный вопрос вне объёма; не расширяй фикс на него без отдельного
  решения (см. Условия STOP).
- `src-tauri/src/commands/experiments/sync.rs:69` — комментарий про LOWER
  в дедупе экспериментов, другой контур.

## Git-процесс

- Ветка: `advisor/007-reagent-nocase` от текущей.
- Один коммит: `fix(db): use COLLATE NOCASE in resolve_by_id_or_name name fallback`.
- Не пушить и не открывать MR без указания оператора.

## Шаги

### Шаг 1: Заменить предикат

В `resolve_by_id_or_name` (reagents.rs, fallback-ветка):

```rust
// было
&format!("{} WHERE LOWER(name) = LOWER(?1)", SQL),
// стало
&format!("{} WHERE name = ?1 COLLATE NOCASE", SQL),
```

**Verify**: `git grep -n "LOWER(name)" -- src-tauri/src/db/repositories/reagents.rs` → пусто.

### Шаг 2: Регрессионные тесты

В `reagents_tests.rs` добавить (импортировав `resolve_by_id_or_name` в
use-список):

1. `resolve_by_name_matches_case_insensitive` — вставить реагент
   `"PolyAcryl"`, проверить, что `resolve_by_id_or_name(&conn, None,
   "polyacryl")` и `"POLYACRYL"` возвращают `Some`, а `"OtherReagent"` —
   `None`. (Фиксирует контракт: фикс не меняет видимое поведение.)
2. `resolve_by_name_uses_nocase_index` — по образцу `explain()` из
   v0005-тестов: `EXPLAIN QUERY PLAN SELECT id ... FROM ReagentCatalog
   WHERE name = 'x' COLLATE NOCASE` должен содержать
   `idx_reagent_name_nocase` и НЕ содержать `SCAN ReagentCatalog`.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml reagent` →
все зелёные, включая 2 новых.

### Шаг 3: Полная регрессия

`cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1`

**Verify**: exit 0, счётчик ≥ 548 (546 базовых + 2 новых).

## Тест-план

Два теста из шага 2: поведенческий (case-insensitive контракт сохранён)
и плановый (EXPLAIN подтверждает использование индекса). Образцы:
`reagents_tests.rs::is_duplicate_name_matches_case_insensitive` (структура,
хелперы) и `v0005_reagent_and_testtype_indexes.rs::tests::explain`
(EXPLAIN-проверка).

## Критерии готовности

- [ ] `git grep -rn "LOWER(name) = LOWER" src-tauri/src/` → пусто
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml reagent` → зелёные, +2 теста
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1` → exit 0
- [ ] Изменены только `reagents.rs`, `reagents_tests.rs` (`git status`)
- [ ] Строка статуса в `plans/README.md` обновлена

## Условия STOP

- Поведенческий тест шага 2.1 падает ДО фикса при прогоне на старом коде
  (значит, текущее поведение не case-insensitive и фикс меняет семантику —
  разбор человеком).
- EXPLAIN-тест показывает, что план НЕ использует `idx_reagent_name_nocase`
  даже после фикса (неожиданное решение оптимизатора — доложить с выводом
  плана).
- Возникает желание «заодно» переписать `commands/reagents/commands.rs:276`
  или дедуп в `sync.rs` — вне объёма, доложить отдельной находкой.

## Заметки на сопровождение

- После этого фикса `git grep "LOWER(name)" src-tauri/src` должен оставаться
  пустым (кроме комментариев) — дешёвый ревью-чек на возврат антипаттерна.
- Если когда-нибудь понадобится Unicode-каноничный кейс-фолдинг для
  кириллических имён реагентов — это отдельная фича (ICU-коллация или
  нормализация на запись), НЕ возврат LOWER().
