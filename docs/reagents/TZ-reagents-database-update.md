# ТЗ: Обновление базы данных реагентов

> **Статус:** 🟡 ЧЕРНОВИК — спецификация не завершена (2026-02-25)  
> **Цель:** Описать требования к расширению `ReagentCatalog` и структуры данных `ExperimentReagent`.

---

## Контекст

Текущая структура реагентов в SQLite:

```sql
-- Глобальный справочник
CREATE TABLE ReagentCatalog (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    category        TEXT NOT NULL,
    manufacturer    TEXT,
    country         TEXT,
    description     TEXT,
    activeSubstance TEXT,
    form            TEXT,           -- "Liquid", "Powder", "Solid"
    createdAt       TEXT NOT NULL,
    updatedAt       TEXT NOT NULL
);

-- Привязка реагента к эксперименту
CREATE TABLE ExperimentReagent (
    id             TEXT PRIMARY KEY,
    experimentId   TEXT NOT NULL,
    reagentId      TEXT,
    reagentName    TEXT,            -- денормализовано для исторической целостности
    category       TEXT,            -- денормализовано
    concentration  REAL NOT NULL,
    unit           TEXT NOT NULL,   -- "kg/m3", "gpt", "L/m3", "%"
    batchNumber    TEXT,
    productionDate TEXT
);
```

## Планируемые изменения

> TODO: Заполнить спецификацию

Предполагаемые области улучшений:
- [ ] Расширение каталога: поставщики, сертификаты, SDS-документы
- [ ] Версионирование состава реагентов (изменение формулы со временем)
- [ ] Регионализация: разные названия одного реагента в разных регионах
- [ ] Нормы concentrations по типам флюидов и температурным диапазонам

## Связанные файлы

- Код: `src-tauri/src/commands/reagents.rs`
- Тесты: `tests/reagents/`
- Миграция: при изменении схемы — добавить V10+ в `src-tauri/src/db/migration.rs`
