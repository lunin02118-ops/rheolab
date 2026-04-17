# RheoLab V2 — Refactoring + Test Coverage Plan
**Date:** 2026-03-13  
**Branch:** `refactor/phase-1-security-blockers` → `refactor/phase-2-audit-fixes`

## TL;DR

Полный рефакторинг в 4 фазах с TDD: каждый фикс сопровождается тестом.  
Начинаем с safety net (snapshot текущего поведения), затем SEC → Rust cleanup → Performance → Frontend.  
Перед каждым изменением — тест, который подтверждает, что функционал не сломан.

**Важная коррекция от реального анализа кода:** большинство проблем из первоначального аудита оказались ложными — SQL Injection нет, rheolab-core уже изолирован, CSP настроен, лицензионный движок уже имеет 47 тестов. Реальные проблемы другие и менее глобальные.

---

## Phase 0 — Safety Net ✅ PARTIAL

Цель: зафиксировать текущее поведение тестами ДО того как что-то меняем.

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| 0.1 | Smoke-тесты на все 94 команды (mock_runtime) | `src-tauri/tests/commands_smoke.rs` | ⏳ |
| 0.2 | Тесты миграции: 21 таблица, FK, уникальные индексы | `src-tauri/tests/db_integrity.rs` | ✅ 12 тестов |
| 0.3 | IPC contract roundtrip для 10 критичных команд | `src-tauri/tests/ipc_contracts.rs` | ✅ 10 тестов |

---

## Phase 1 — Security Fixes ✅ DONE

Подход: тест падает → фикс → тест зелёный.

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| 1.1 | `shell.open` → `false`, удалить `shell:allow-open` capability | `tauri.conf.json`, `capabilities/default.json` | ✅ |
| 1.2 | IPC input validation (`validator` crate) на `data_flows/`, `backup/`, `reagents/` | `Cargo.toml` + команды | ⏳ |
| 1.3 | Аудит `console.log` с чувствительными данными | `eslint.config.mjs` + `src/**` | ✅ Чисто |
| 1.4 | `.unwrap()` в production Rust коде → `.expect()` / `?` | `licensing/engine/mod.rs`, `parsing/mod.rs` | ✅ 2 места |
| 1.5 | `handleOpenFolder` без try/catch | `BackupManager.tsx` | ✅ |

**Коммит:** `40f4511` — phase 0+1 safety net tests + security fixes

---

## Phase 2 — Test Coverage Expansion ⏳

Зависит от Phase 1.

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| 2.1 | CRUD тесты: experiments, export, backup, reagents | `src-tauri/tests/experiments_commands.rs` и др. | ⏳ |
| 2.2 | License gate тест для каждой привилегированной команды | `licensing_tests.rs` — добавить | ⏳ |
| 2.3 | Vitest на `useSaveDialogInit.ts`, `useAnalysisPipeline.ts` | `tests/hooks/` | ⏳ |
| 2.4 | E2E: загрузить → посчитать → экспортировать (`.xlsx` фикстура) | `tests/e2e/full-export.spec.ts` | ⏳ |

---

## Phase 3 — Performance Fixes ⏳ PARTIAL

Зависит от Phase 2.

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| 3.1 | N+1 запросы в `data_flows/artifacts.rs` → batch JOIN | `artifacts.rs`, `db/repositories/` | ⏳ |
| 3.2 | FK индексы в миграции (через `migrate_v2`, не V1_DDL) | `migration.rs` | ⏳ |
| 3.3 | Транзакции в batch write командах | `sync.rs` | ✅ 3 функции |

**Коммит:** `d366e94` — phase 2: wrap batch writes in explicit transactions

---

## Phase 4 — Frontend Cleanup ⏳

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| 4.1 | `invoke()` без `.catch()` — добавить error handling | `src/**/*.ts`, `src/**/*.tsx` | ✅ В основных компонентах чисто |
| 4.2 | Заменить `invoke<any>` на `invoke<ResponseType>` из `generated.d.ts` | `src/lib/tauri/**` | ⏳ |

---

## Verification после каждой фазы

```bash
cargo test                         # все Rust тесты зелёные
npm test                           # все Vitest тесты зелёные
cargo clippy -- -D warnings        # 0 предупреждений
npm run lint                       # 0 ESLint ошибок
# После Phase 4:
npm run test:e2e:smoke             # smoke E2E тесты на Tauri
```

---

## Decisions

- **Не трогаем:** лицензионный движок (47 тестов), `rheolab-core` (150+ тестов), схему БД (30+ тестов)
- **TDD:** тест падает → фикс → тест зелёный — для SEC и Rust fixes
- **Атомарные коммиты:** один коммит = один конкретный fix + его тест
- **validator crate:** добавляет ~400 KB к бинарю — альтернатива ручная валидация. Решение принять перед 1.2.
- **migrate_v2:** новые FK индексы через отдельную migrate функцию, не правка V1_DDL (существующие БД получат индексы через update)
- **E2E (2.4):** требует запущенного Tauri — если CI без GUI, пропустить до настройки xvfb

---

## Текущее состояние веток

```
master
└── refactor/phase-1-security-blockers  ← HEAD (d366e94)
    ├── 438d568  fix: Copilot PR review (10 comments)
    ├── 40f4511  refactor: phase 0+1 — safety net + security fixes
    └── d366e94  refactor: phase 2 — batch writes in transactions
```

**Следующая ветка:** `refactor/phase-2-audit-fixes` от `refactor/phase-1-security-blockers`

