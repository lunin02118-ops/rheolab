# docs/audit/

Результаты аудитов кодовой базы.

## Запуск audit-контура

- Быстрый прогон: `npm run audit:enterprise:quick`
- Только preflight (для PR): `npm run audit:enterprise -- --preflight-only`
- Полный прогон: `npm run audit:enterprise`

Артефакты каждого запуска сохраняются в `runtime/audit/<run-id>/`.
Обязательные артефакты:

- `dynamic-checks-summary.tsv`
- `audit-findings.json`
- `environment-readiness-matrix.md`
- `release-gate-decision.md`

Декларативный контракт проверок и environment-matrix: `scripts/audit/enterprise-audit-manifest.json`.

## Текущее состояние

Markdown-аудиты из этого каталога были удалены во время cleanup 2026-03-13, чтобы не держать в репозитории устаревшие отчёты, которые расходились с кодом.

Актуальный источник audit-данных теперь такой:

- runtime-артефакты в `runtime/audit/<run-id>/`
- audit-скрипты в `scripts/audit/`
- итоговые решения по изменениям в `docs/plans/REFACTORING_PLAN_2026-03-13.md`
- исторические сводки в `CHANGELOG.md`

## Отчёты рефакторинга 2026-Q2

- [`REFACTORING_AUDIT_2026-04-18.md`](./REFACTORING_AUDIT_2026-04-18.md) — независимый аудит качества исполнения `docs/REFACTORING_DEEP_PLAN.md`. Выявил расхождения между заявленными WP-statuses и кодом.
- [`REFACTORING_AUDIT_2026-04-19-FOLLOWUP.md`](./REFACTORING_AUDIT_2026-04-19-FOLLOWUP.md) — follow-up с устранением всех §5.1–5.2 замечаний + декомпозицией крупных Rust-файлов + финальной верификацией.
- [`command-validation.md`](./command-validation.md) — инвентаризация всех 89 Tauri-команд по доменам валидации (WP-1.5 DoD).
- [`W1-security-review.md`](./W1-security-review.md) — архивный security review.

Baseline-snapshot метрик: `runtime/refactor-baseline/metrics.json` (воспроизводится через `node scripts/audit/snapshot-metrics.js`).

## Смежные документы

- `docs/performance/PERF_TESTING.md`
- `docs/testing/TEST_METHODOLOGY.md`
- `docs/RELEASE_AND_DEPLOY.md`
