# Architecture Decision Records (ADRs)

Реестр архитектурных решений RealLab Enterprise V2.

| ADR | Название | Статус | Дата |
|-----|----------|--------|------|
| [ADR-0001](ADR-0001-tauri-v2-desktop-framework.md) | Tauri v2 как фреймворк десктопного приложения | ✅ Реализовано | до 2026-02-01 |
| [ADR-0002](ADR-0002-sqlite-rusqlite-embedded-db.md) | SQLite + rusqlite как встроенная БД | ✅ Реализовано | до 2026-02-01 |
| [ADR-0003](ADR-0003-eliminate-wasm-webview-desktop-native-analysis.md) | Eliminate WASM Analysis in WebView2 — Move to Native Rust | ✅ Реализовано | 2026-02-22 |

---

## Соглашения

- Статусы: `В работе` → `Принято` → `✅ Реализовано` / `❌ Отклонено` / `Заменено ADR-XXXX`
- ADR создаётся для решений, влияющих на архитектуру, производительность или безопасность всей системы
- Ретроспективные ADR (задним числом) разрешены; указывать дату принятия и дату документирования
