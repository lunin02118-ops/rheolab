# RC Hardening Roadmap

**Status:** active planning track.
**Date:** 2026-04-29.
**Position:** after Sprints 1-6 and after the legacy comparison IPC removal
lane.

## Goal

Stop adding feature sprints and move into release-candidate hardening.

The central technical goal is:

```text
saved experiment detail open
  metadata by ID
  chart = binary overview/window
  analysis = by-ID cached analysis
  raw table = paged rows
  reports = native by-IDs
```

This makes the hot paths by-ID/read-model/binary-first instead of
full-rawPoints-first.

## Priority order

| Priority | Work | Why |
| --- | --- | --- |
| P0 | Merge/remove legacy comparison payload IPC | Makes `audit:large-ipc` zero suppression |
| P0 | MEM-0 baseline | Prevents memory conclusions from single runs |
| P1 | Detail metadata by ID | Removes full raw point dependency from chart-first open |
| P1 | By-ID analysis + cache | Removes renderer raw point dependency from analysis |
| P1 | Raw table page by ID | Bounds table memory by page size |
| P1 | Typed binary chart pipeline | Keeps binary IPC memory savings in the renderer |
| P1 | Chart viewport windows | Keeps zoom/pan bounded by `maxPoints` |
| P2 | Instrument chart/detail/long tasks/RSS | Turns architectural wins into measured budgets |
| P2 | Scheduler retention and CPU/RSS sampler | Prevents runtime metadata growth and nullable resource metrics |
| P2 | Projection catalog drift fixes | Keeps denormalized library projection honest |

## Phase 0 - alpha gate after legacy IPC removal

Local release gate:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run build:ci
npm test
npm run version:validate
npm run audit:large-ipc
git diff --check
```

Manual smoke:

1. DB-loaded experiment detail opens.
2. Chart renders through binary overview.
3. `localStorage['RHEOLAB_SERIES_LEGACY_AOS']='1'` enables chart fallback.
4. `experiments_series_meta` works.
5. `experiments_series_window` returns a bounded binary payload.
6. Report/table/save tabs still work.
7. Comparison PDF/XLSX by-IDs still work.
8. Projection/facet status/rebuild works.
9. Analysis cache stats/prune works.

## Phase 1 - memory hardening

The detailed plan lives in `MEMORY-HARDENING-PLAN.md`.

Recommended PR sequence:

| PR | Base | Title |
| --- | --- | --- |
| MEM-0 | legacy IPC removal branch | `docs(perf): add memory hardening track plan` |
| MEM-1 | MEM-0 | `feat(experiments): add detail metadata by id` |
| MEM-2 | MEM-1 | `feat(analysis): analyze experiment by id with cache` |
| MEM-3 | MEM-2 | `feat(raw-table): page raw data by id` |
| MEM-4 | MEM-3 | `refactor(chart): preserve typed binary series pipeline` |
| MEM-5 | MEM-4 | `feat(chart): fetch viewport series windows` |
| MEM-6 | MEM-5 | `chore(runtime): bound retained jobs and buffers` |
| MEM-7 | MEM-6 | `perf(rc): add memory hardening scorecard` |

Stacked PRs are acceptable while PR #7 is open. Merge order should remain
linear so validation artifacts stay understandable.

## Phase 2 - instrumentation hardening

Add or finish runners for:

- dashboard detail open;
- chart first paint;
- chart pan/zoom;
- IPC payload bytes;
- JS heap delta;
- long-task count and longest long task;
- Rust process RSS/CPU inside scheduler job metrics.

Metrics start soft and only become hard after repeated green alpha/beta runs.

## Phase 3 - projection and runtime cleanup

Projection drift follow-ups:

- mark or rebuild affected projections on laboratory mutations;
- mark or rebuild affected reagent summaries/facets on reagent catalog changes;
- handle operator/user display-name drift if displayed in the library;
- include projection readiness/dirty state in support diagnostics.

Runtime follow-ups:

- job registry retention;
- queued jobs should not occupy blocking threads while waiting on a gate;
- immediate cancellation progress event;
- loader-safe CPU/RSS sampler.

## Release policy

GitHub Actions are not the source of truth for this track. Local validation is
the release gate.

Alpha promote requires:

- local gate green;
- `audit:large-ipc` reports zero violations and zero suppressions;
- memory baseline is repeated or explicitly labelled as spot-check;
- fallback flags exist for risky dashboard transitions.

Beta candidate requires:

- one alpha window without by-ID/binary-series regressions;
- no full rawPoints default for saved chart-first detail open, or an explicit
  signed-off deferral;
- chart/detail metrics captured;
- no known data-loss bugs;
- updater smoke clean.

Stable requires:

- beta window clean;
- DB migration restore/downgrade smoke clean;
- release notes complete;
- updater manifest/signature verified.

## Bottom line

The next release work is not Sprint 7. It is RC hardening:

```text
remove temporary payload debt
measure repeated memory baseline
move saved detail open off rawPoints
make chart/table/analysis bounded by ID, viewport, and page
validate the result with repeated local p50/p95
```
