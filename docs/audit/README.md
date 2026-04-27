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

Актуальный кодовый аудит на 2026-04-25:

- [`runtime/qa-reports/deep-audit-waves-2026-04-25.md`](../../runtime/qa-reports/deep-audit-waves-2026-04-25.md) — основной отчет по commit `6b0f0991e00cce45c0a65ccbc9de6860c85b4929`.
- [`docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-25.md`](../performance/FRONTEND-IPC-DEEP-AUDIT-2026-04-25.md) — актуальный frontend/IPC performance snapshot.
- [`docs/performance/memory-performance-report-2026-04-25.md`](../performance/memory-performance-report-2026-04-25.md) — актуальный Tauri soak memory snapshot.

Исторические markdown-аудиты и старые runtime/output artefacts убраны в:

- [`archive/audits/2026-04-25-cleanup/`](../../archive/audits/2026-04-25-cleanup/)

Причина cleanup: старые отчеты 2026-02-27..2026-04-24 расходились с текущим `HEAD` и свежими метриками 2026-04-25. Same-day отчет `runtime/qa-reports/audit-2026-04-25/AUDIT-REPORT.md` тоже перенесен в архив, потому что был сделан на commit `94c16713` и содержал более мягкий verdict, перекрытый более поздним deep-audit waves отчетом на `6b0f0991`.

Baseline-snapshot метрик остается в `runtime/refactor-baseline/metrics.json` и воспроизводится через `node scripts/audit/snapshot-metrics.js`.

## Смежные документы

- `docs/performance/PERF_TESTING.md`
- `docs/testing/TEST_METHODOLOGY.md`
- `docs/RELEASE_AND_DEPLOY.md`
