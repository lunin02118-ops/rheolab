# Chart Rendering Budget Phase 1

Date: 2026-06-15
Work item: W5-02 `perf/chart-rendering-budget-phase-1`
Branch: `perf/chart-rendering-budget-phase-1`

## Scope

Added phase-1 rendering guardrails for the comparison chart brush hot path.

Files changed:

- `src/components/charts/chart-brush.tsx`
- `tests/components/chart-brush.test.tsx`
- `tests/performance/chart-rendering-budget.test.tsx`
- `docs/audits/progress/chart-rendering-budget-phase-1.md`

Implemented:

- Brush `pointermove` preview callbacks are coalesced through
  `requestAnimationFrame`, while `pointerup` flushes the latest pending range
  before committing.
- Brush canvas drawing uses a density cap for very large datasets instead of
  materializing one overview polyline point per source sample.
- Added a render-budget regression test proving prepared comparison uPlot data,
  series, axes, and touch-point arrays stay referentially stable when inputs do
  not change.
- Updated brush tests to pin the new throttled-preview contract and large
  dataset guardrail.

## Non-Scope

- No chart data processing algorithm changes.
- No comparison binary series windowing changes.
- No report export request or payload shape changes.
- No report renderer, Tauri IPC, Rust, dependency, version, migration, package,
  CI, or Tauri config changes.
- No license, demo, trial, activation, signed payload, or `license-server/**`
  changes.

## Behavior Changes

Brush preview updates during drag are now frame-coalesced. The final committed
range is still flushed synchronously on pointerup before `onCommit`.

## Validation

| Command | Result | Notes |
|---|---|---|
| `npm run version:validate` | PASS | SSoT version `0.2.3-alpha.19`; all four dependents agree with `/version.json`. |
| `git diff --check` | PASS | No whitespace errors. |
| Hidden/bidi Unicode scan | PASS | Checked all changed source, test, and docs files. |
| `npm run typecheck` | PASS | TypeScript compile check passed. |
| `npm run audit:large-ipc` | PASS | Scanned 93 Rust files; no large-IPC contract violations. |
| `npm run test -- tests/performance/chart-rendering-budget.test.tsx tests/components/chart-brush.test.tsx tests/components/comparison-chart-viewport-policy.test.ts tests/components/comparison-visible-series-metrics.test.ts tests/components/comparison-chart-scales.test.ts tests/performance/store-selector-audit.test.tsx` | PASS | `6 passed`, `56 passed`; existing jsdom canvas/pointer-capture warnings observed in brush tests. |
| `npm run test:release-gate` | PASS | `1 passed`; 7 exports, 4 fixtures, heap growth `+5.93 MB / 20 MB`. |
| `npx playwright test --workers=1 tests/e2e/reports/reports-export.spec.ts` | PASS | `8 passed`; confirms report export path remains green. |
| `npx playwright test --config playwright.tauri.config.ts --workers=1 tests/e2e/comparison-brush-battle.tauri.spec.ts` | PASS | `1 passed`; rebuilt debug Tauri binary and captured brush battle perf artifact. |

## Risks

- Brush dragging remains interactive but preview callback frequency is now
  bounded by animation frames. Existing E2E brush-battle coverage should be kept
  as the deeper interactive proof when running the full desktop perf lane.

## Rollback

Revert this PR. It only changes brush rendering guardrails, tests, and this
progress note.
