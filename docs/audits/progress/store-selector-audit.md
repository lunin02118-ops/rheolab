# Store Selector Audit

Date: 2026-06-15
Work item: W5-01 `perf/store-selector-audit`
Branch: `perf/store-selector-audit`

## Scope

Reduced unnecessary Zustand subscriptions and re-renders in report/chart-heavy
frontend surfaces.

Files changed:

- `src/components/comparison/comparison-chart-uplot.tsx`
- `src/components/comparison/useComparisonChartData.ts`
- `src/components/dashboard/raw-data-table.tsx`
- `src/components/dashboard/raw-data-table-by-id.tsx`
- `tests/performance/store-selector-audit.test.tsx`
- `docs/audits/progress/store-selector-audit.md`

Implemented:

- `ComparisonChartUPlot` now reads only `comparisonAxisMode`,
  `downsampleMode`, and `timeFormat` from `useChartSettingsStore` through one
  shallow selector instead of subscribing to the full `settings` object.
- `useComparisonChartData` now reads only `lines`, `downsampleMode`, and
  `timeFormat`, so precision-only/unit-preset-only changes do not recompute the
  comparison chart data pipeline.
- Raw data tables now subscribe only to `settings.precision` instead of the full
  chart settings object.
- Added W5-01 regression guards for unrelated chart-settings mutations.

## Non-Scope

- No chart rendering algorithm changes.
- No report export request or payload shape changes.
- No report renderer, Tauri IPC, Rust, dependency, version, migration, package,
  CI, or Tauri config changes.
- No license, demo, trial, activation, signed payload, or `license-server/**`
  changes.

## Behavior Changes

None intended. Frontend render subscription granularity only.

## Validation

| Command | Result | Notes |
|---|---|---|
| `npm run version:validate` | PASS | SSoT version lockstep is intact. |
| `git diff --check` | PASS | No whitespace errors. |
| Hidden/bidi Unicode scan | PASS | No hidden/bidirectional Unicode characters in changed files. |
| `npm run test -- tests/performance/store-selector-audit.test.tsx tests/performance/report-tab-perf.test.tsx tests/performance/dashboard-tabs-perf.test.tsx tests/components/raw-data-table-by-id.test.tsx tests/components/comparison-visible-series-metrics.test.ts tests/components/comparison-chart-scales.test.ts` | PASS | `38 passed`; existing jsdom `scrollTo`/`act` warnings observed in dashboard perf test. |
| `npm run typecheck` | PASS | TypeScript compile check passed. |
| `npm run audit:large-ipc` | PASS | No large-IPC contract violations. |
| `npm run test:release-gate` | PASS | `1 passed`; 7 exports; heap growth `+5.96 MB` against `20 MB` budget. |
| `npx playwright test --workers=1 tests/e2e/reports/reports-export.spec.ts` | PASS | `8 passed`. |

## Risks

- Selector granularity is intentionally conservative. Report export hooks still
  receive full `ChartSettings` so this PR does not alter report semantics.

## Rollback

Revert this PR. It only changes frontend selector usage, perf tests, and this
progress note.
