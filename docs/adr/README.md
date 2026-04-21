# Architecture Decision Records (ADRs)

Реестр архитектурных решений RealLab Enterprise V2.

| ADR | Название | Статус | Дата |
|-----|----------|--------|------|
| [ADR-0001](ADR-0001-tauri-v2-desktop-framework.md) | Tauri v2 как фреймворк десктопного приложения | ✅ Реализовано | до 2026-02-01 |
| [ADR-0002](ADR-0002-sqlite-rusqlite-embedded-db.md) | SQLite + rusqlite как встроенная БД | ✅ Реализовано | до 2026-02-01 |
| [ADR-0003](ADR-0003-eliminate-wasm-webview-desktop-native-analysis.md) | Eliminate WASM Analysis in WebView2 — Move to Native Rust | ✅ Реализовано | 2026-02-22 |
| [ADR-0004](ADR-0004-no-sheetjs-ce.md) | Отказ от SheetJS Community Edition | ✅ Реализовано | 2026-04-17 |
| [ADR-0005](ADR-0005-licensing-architecture.md) | Архитектура лицензирования — двухуровневая криптографическая защита | ✅ Реализовано | до 2026-02-01 |
| [ADR-0006](ADR-0006-sync-engine-contract.md) | Delta-sync engine — офлайн обмен данными | ✅ Реализовано | 2026-03-15 |
| [ADR-0007](ADR-0007-parser-pipeline.md) | Parser pipeline — мультиформатный парсинг | ✅ Реализовано | до 2026-02-01 |
| [ADR-0008](ADR-0008-logging-and-telemetry.md) | Logging and telemetry — единый фасад логирования | ✅ Реализовано | 2026-04-17 |
| [ADR-0009](ADR-0009-refactor-modularization-2026-04.md) | Поэтапная модуляризация кода (W1–W3, bundle -8 KB, migration hardening) | ✅ Реализовано | 2026-04-19 |

---

## Соглашения

- Статусы: `В работе` → `Принято` → `✅ Реализовано` / `❌ Отклонено` / `Заменено ADR-XXXX`
- ADR создаётся для решений, влияющих на архитектуру, производительность или безопасность всей системы
- Ретроспективные ADR (задним числом) разрешены; указывать дату принятия и дату документирования
