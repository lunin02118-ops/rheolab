# Library Filter Allocation Cleanup

Date: 2026-06-15
Work item: W5-03 `perf/library-filter-allocation-cleanup`
Branch: `perf/library-filter-allocation-cleanup`

## Scope

Removed the current P2 allocation hotspot reported by the frontend IPC audit
for:

- `src/components/library/experiment-filters.tsx`

Files changed:

- `src/components/library/experiment-filters.tsx`
- `docs/performance/FRONTEND-IPC-DEEP-AUDIT-2026-06-15.md`
- `docs/performance/FRONTEND-IPC-DEEP-AUDIT-LATEST.md`
- `docs/performance/BASELINES.md`
- `docs/performance/memory-performance-report-2026-06-15.md`
- `docs/audits/progress/library-filter-allocation-cleanup.md`

Implemented:

- Removed the `metadataOptions` wrapper object and reused stable empty metadata
  arrays while metadata is loading.
- Combined touch-point hint derivation into one memoized block.
- Removed the `useMemo` block for the cheap threshold label.
- Avoided per-render temporary arrays for active-filter badges and the global
  "has active filters" check.
- Avoided copying category test type arrays when deriving the test-type option
  list.
- Regenerated the frontend IPC audit evidence after the cleanup.

## Non-Scope

- No backend filtering semantics changes.
- No touch-point threshold semantics changes.
- No report export request or payload shape changes.
- No Rust, Tauri, dependency, version, migration, package, CI, or Tauri config
  changes.
- No license, demo, trial, activation, signed payload, or `license-server/**`
  changes.

## Behavior Changes

None intended. The UI contract is unchanged: threshold OFF still clears
downstream touch-point subfilters, threshold activation still auto-enables
`hasCrossing` only from the OFF state, and manual threshold-to-threshold edits
preserve existing subfilters.

## Validation

| Command | Result | Notes |
|---|---|---|
| `npm run version:validate` | PASS | SSoT version `0.2.3-alpha.19`; all four dependents agree with `/version.json`. |
| `git diff --check` | PASS | No whitespace errors. |
| Hidden/bidi Unicode scan | PASS | Checked changed source and docs files. |
| `npm run typecheck` | PASS | TypeScript compile check passed. |
| `npm run audit:large-ipc` | PASS | Scanned 93 Rust files; no large-IPC contract violations. |
| `npm run test -- tests/components/experiment-filters-touch-point.test.tsx tests/lib/touch-point-hints.test.ts tests/lib/library/filter-debounce.test.ts tests/components/empty-states.test.tsx` | PASS | `4 passed`, `54 passed`; covers library filter persistence, touch-point UI semantics, and debounce policy. |
| `npm run audit:frontend-ipc -- --windows-runner --run-id=w5-03-full --command-timeout-ms=900000` | PASS | Full Windows audit, blocking mode; `allocationHotspots: 0`, static findings empty, gate `PASS`. |
| `npm run test:release-gate` | PASS | `1 passed`; 7 exports, 4 fixtures, heap growth `+5.97 MB / 20 MB`. |

## Risks

- The cleanup intentionally reduces hook count in a stateful filter sidebar.
  Existing touch-point tests cover the risky threshold and active-filter
  behavior.

## Rollback

Revert this PR. It only changes the library filter allocation cleanup and
performance/audit evidence.
