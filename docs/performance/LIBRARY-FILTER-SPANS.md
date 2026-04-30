# Library Filter Span Decomposition

This note documents the RC hardening measurement added to the DB-scale
library runner. It is measurement-only: it does not change filter semantics,
query behavior, budgets, or user-facing UI.

## Goal

The Sprint 5 projection work made the DB read path cheap, but DB-scale UI
filter/search timings can still look slow at the wall-clock level. The
remaining question is where the time goes:

- input/filter state change
- debounce wait
- IPC/backend query
- React commit/render
- post-render settle/wait time

The DB-scale sidecar now includes a `libraryFilterSpans` object so audit can
separate those phases instead of treating `L-FILTER` as one opaque number.

## Output

`npm run perf:db:small` and `npm run perf:db:large` write:

```text
outputs/e2e/perf/db-scale-<runId>.json
```

The report contains the existing `steps` object plus:

```json
{
  "libraryFilterSpans": {
    "search_by_name": {
      "label": "FTS5 search: \"Chandler\"",
      "total_ms": 342.7,
      "input_to_filter_change_ms": 12.1,
      "filter_change_to_debounce_fire_ms": 201.4,
      "debounce_fire_to_ipc_start_ms": 0.2,
      "ipc_ms": 18.6,
      "ipc_to_render_commit_ms": 21.9,
      "render_commit_to_settled_ms": 88.5,
      "request_id": 4,
      "filter_keys": ["search"],
      "result_count": 12,
      "total_count": 588,
      "event_count": 6,
      "events": []
    }
  }
}
```

Measured actions:

- `search_by_name`
- `filter_fluid_type`
- `filter_date_range`
- `filter_reset`

For before/after tracking, run:

```bash
npm run perf:db:regression
npm run perf:db:regression -- --write-md
```

The regression tracker auto-discovers baseline sidecars without
`libraryFilterSpans` and current sidecars with `libraryFilterSpans`, then writes
`docs/performance/LIBRARY-FILTER-REGRESSION-TRACKING.md` when `--write-md` is
used.

## Field Guide

- `total_ms`: browser-side action start to settled list.
- `input_to_filter_change_ms`: Playwright action start to React filter state
  change signal.
- `filter_change_to_debounce_fire_ms`: UI debounce wait plus scheduling
  overhead.
- `debounce_fire_to_ipc_start_ms`: gap between debounce callback and IPC call.
- `ipc_ms`: backend IPC duration as observed by the frontend list fetch.
- `ipc_to_render_commit_ms`: time from IPC completion to React commit signal.
- `render_commit_to_settled_ms`: runner settle/wait time after render commit.

The raw `events` array is preserved for audit. If an action becomes a no-op
because a control is absent or already reset, phase fields may be `null`; that
should be treated as "not observed" rather than zero.

## Interpretation

Expected Sprint 5/Sprint 6 pattern:

- low `ipc_ms` means the projection/facet DB path is not the bottleneck;
- high `filter_change_to_debounce_fire_ms` is mostly intentional debounce;
- high `ipc_to_render_commit_ms` points to React render/state work;
- high `render_commit_to_settled_ms` points to runner settling, animations,
  virtualization, or post-render waits.

This report should be used to decide the next targeted optimization. It should
not be used to tighten hard UI budgets until several comparable small/large
runs are collected.
