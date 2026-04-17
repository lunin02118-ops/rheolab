# Language Policy — RheoLab Enterprise

> Версия: 2026-04-17

Это руководство определяет, какой язык использовать в каждой части проекта.

---

## 1. Код (Rust + TypeScript)

| Элемент | Язык | Пример |
|---------|------|--------|
| Имена функций, переменных, типов | **English** | `runMigrations`, `experimentId`, `AppState` |
| Комментарии в коде (`//`, `/* */`) | **English** | `// skip if already migrated` |
| Строки ошибок (`Err(...)`, `to_string()`) | **English** | `"experiment not found"` |
| Строки UI (кнопки, заголовки) | **Russian** | `"Сохранить эксперимент"` |
| Seed-данные реагентов (names) | **English + транслит** | `"Гуар гидратированный"`, `"WG-37"` |
| Логи (`tracing::info!`, `console.log`) | **English** | `"Applied migration v1"` |

**Ключевые правила:**
- Весь идентификатор-код — только English (snake_case в Rust, camelCase в TS)
- Ни одного кириллического символа в именах функций, переменных, типов или файлов
- User-facing строки — Russian (целевая аудитория — русскоязычные операторы)

---

## 2. Документация

| Документ | Язык |
|----------|------|
| `docs/database/` — `DEVELOPER_GUIDE.md`, `MAINTENANCE_RU.md` | **Russian** |
| `docs/ARCHITECTURE.md` | **English** (технический, для разработчиков) |
| `docs/CONTRIBUTING.md` | **English** |
| `docs/adr/` — ADR файлы | **Russian** (аудитория — команда) |
| `docs/performance/` — аудит-отчёты | **Russian** |
| `docs/audit/` | **English** для шаблонов и описаний, результаты могут быть смешанными |
| `docs/testing/` | **English** |
| `README.md` | **English** (публичный) |
| `CHANGELOG.md` | **Russian** (команда) |
| `scripts/README.md` | **English** |
| `website/` | **Russian** (маркетинг) |

---

## 3. Git-сообщения коммитов

**English**, формат Conventional Commits:

```
feat(db): add WaterSourceCatalog table
fix(reports): handle empty experiment name in PDF
docs(adr): add ADR-0002 SQLite selection
```

Тело коммита может быть на русском, если адресовано только команде:

```
fix(reagents): replace semicolons with commas in WGXL tuples

Синтаксическая ошибка в трёх кортежах WGXL-8.1/8.2/9.1 приводила
к ошибке компиляции после миграции на V1_DDL.
```

---

## 4. Тесты

| Элемент | Язык |
|---------|------|
| Имена тест-функций | **English** — `test_migration_is_idempotent` |
| Строки `assert_eq!` / `assert!` | **English** — `"row count must be 1"` |
| Описания в `describe()` / `it()` | **English** |
| Комментарии в тестах | English или Russian — по ситуации |

---

## 5. Исключения

- **Данные реагентов** — смешанный язык допустим: технические названия на латинице, описания на русском
- **TDS/SDS описания** — русский (источник данных — российские производители)
- **MAINTENANCE_RU.md** — явно помечен как русскоязычный, является исключением из общего правила для `docs/`
