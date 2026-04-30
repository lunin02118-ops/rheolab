# Comparison N=10 UI Smoke Policy

**Date:** 2026-04-30.
**Status:** beta policy.
**Owner:** release/performance gate.

## Verdict

N=10 comparison UI smoke is **not applicable** for the beta gate while the
native runtime license cap is 8.

The product runtime currently exposes these comparison caps through
`licensing_check`:

| Tier/status | `maxComparisonExperiments` |
| --- | ---: |
| trial/demo | 3 |
| standard/paid | 8 |
| developer | 8 |
| superuser | 8 |
| expired/invalid | 0 |

The `perf:comparison:tauri` runner intentionally reads the same
`licensing_check` IPC that the app uses. Counts above that cap are recorded in
the sidecar as `skipped: "license-cap"`. Therefore an N=10 skipped row is the
expected beta result, not a failed smoke.

## What Remains Covered

Required beta comparison UI coverage:

```powershell
COMPARISON_SMOKE_N=3 npm run perf:comparison:tauri
COMPARISON_SMOKE_N=5 npm run perf:comparison:tauri
RHEOLAB_E2E_REAL_REPORTS=1 COMPARISON_SMOKE_N=3 npm run perf:comparison:tauri
RHEOLAB_E2E_REAL_REPORTS=1 COMPARISON_SMOKE_N=5 npm run perf:comparison:tauri
COMPARISON_SMOKE_MEMORY_STEPS=1 COMPARISON_SMOKE_N=5 npm run perf:comparison:tauri
```

Optional provenance check for this policy:

```powershell
COMPARISON_SMOKE_N=10 npm run perf:comparison:tauri
```

Expected result: a passing run with a sidecar row where `n` is 10,
`skipped` is `"license-cap"`, and `skipReason` reports the runtime cap of 8.

Existing N=10 native fixture microbench coverage still has value for the report
renderer itself, but it is not a UI setup smoke because it bypasses the
licensing-limited user flow.

Some mock-only browser/e2e helpers still use `maxComparisonExperiments: 10` to
exercise older over-cap or broad UI paths. Those mocks are not the release
policy. Native Tauri smoke/perf runners are authoritative for the beta gate.

## How To Reopen N=10

If product policy changes to allow 10 or more comparison experiments, do it as
an explicit product/runtime change:

1. Update the native license feature presets.
2. Update frontend comments/copy and any mocked license fixtures that should
   mirror the new product cap.
3. Re-enable `L-CMP-10` as a measured UI budget in `BUDGETS.md`.
4. Run and record:

```powershell
COMPARISON_SMOKE_N=10 npm run perf:comparison:tauri
RHEOLAB_E2E_REAL_REPORTS=1 COMPARISON_SMOKE_N=10 npm run perf:comparison:tauri
COMPARISON_SMOKE_MEMORY_STEPS=1 COMPARISON_SMOKE_N=10 npm run perf:comparison:tauri
```

Until then, do not block beta readiness on an N=10 UI smoke.
