# ADR-0007: Parser pipeline — мультиформатный парсинг реометрических данных

**Статус:** ✅ Реализовано  
**Дата принятия:** до 2026-02-01 (предшествует репозиторию)  
**Дата документирования:** 2026-04-18 (ретроспективная запись)  
**Авторы:** Platform Team  
**Затронутые компоненты:** `src/rust/rheolab-core/src/parser/`, `src-tauri/src/commands/parsing/`

---

## 1. Контекст

Лаборатории используют реометры разных производителей (Grace M5600, Chandler, Ofite 1100, BSL, Brookfield и др.). Каждый прибор генерирует файлы в собственном формате (Excel, CSV, DAT). Нужен единый pipeline: файл → структурированные данные → SQLite.

## 2. Рассмотренные альтернативы

| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| **Rust native (rheolab-core)** | Максимальная скорость, единая кодовая база | Сложность поддержки новых форматов |
| WASM parsers в WebView | Быстрый PoC, веб-совместимость | Overhead сериализации, ограниченный I/O |
| Python backend | Богатая экосистема (pandas, openpyxl) | Дополнительный runtime, сериализация |

## 3. Решение

Модульный parser pipeline в `rheolab-core`:

```
File → rheo_parser (csv/workbook) → header_detector → instrument_detector
  → row_mapper → geometry_verifier → physics_engine → validator → RheoStep[]
```

**Ключевые модули:**

| Модуль | Ответственность |
|--------|-----------------|
| `rheo_parser/` | Низкоуровневый парсинг: `csv_parser.rs`, `workbook.rs` (calamine) |
| `header_detector` | Определение структуры заголовков |
| `instrument_detector` | Автоопределение прибора по сигнатурам данных |
| `row_mapper/` | Маппинг сырых строк в `RheoPoint`, включая `detection.rs` |
| `geometry_verifier` | Проверка геометрии измерительной ячейки |
| `physics_engine` | Пересчёт физических величин (вязкость, напряжение сдвига) |
| `validator` | Валидация итоговых данных |
| `filename_parser` | Извлечение метаданных из имени файла |
| `date_detector` | Извлечение дат из различных форматов |
| `ai_mapper` | AI-assisted column mapping (опциональный, через API-ключ) |
| `calibration/` | Парсинг калибровочных данных |

**Tauri integration:** `src-tauri/src/commands/parsing/mod.rs` — `parsing_parse_file`, `parsing_parse_file_with_ai_mapper`, `parsing_release_cache`.

## 4. Последствия

- **Положительные:** нативная скорость (~ms на файл), автоопределение прибора, AI-fallback для неизвестных форматов
- **Отрицательные:** добавление нового формата требует Rust-разработки
- **Нейтральные:** парсинг калибровок использует тот же pipeline (`calibration/`)
