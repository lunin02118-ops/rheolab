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

## Смежные документы

- `docs/performance/PERF_TESTING.md`
- `docs/testing/TEST_METHODOLOGY.md`
- `docs/RELEASE_AND_DEPLOY.md`
