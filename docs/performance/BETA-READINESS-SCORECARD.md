# Beta Readiness Scorecard

**Date:** 2026-04-30.
**Scope:** beta-readiness follow-up after the memory-hardening track.
**Authoritative gate:** local top-of-stack validation and Tauri smoke/perf
runners. GitHub Actions are informational only for this repository.

## Verdict

GO for sequential review/merge of the beta-readiness stack after the usual
local top-of-stack gate on the final branch.

This scorecard does **not** change the memory-hardening conclusion. The correct
release claim remains:

- renderer-owned scientific payload/state is bounded on the default saved
  detail/report/comparison paths;
- heavy data stays in Rust/SQLite unless a user action explicitly requires it;
- JS heap remains low and stable in the measured workflows;
- Total RSS remains a soft metric because WebView2, GPU, and runtime allocation
  behavior are not fully app-controlled.

## Stack Order

Merge or rebase linearly:

| Order | PR | Branch | Purpose | Status |
| ---: | --- | --- | --- | --- |
| 1 | #23 | `codex/beta-readiness-ui-latency` | Tune library filter debounce by filter kind | open, mergeable |
| 2 | #24 | `codex/beta-readiness-comparison-rss` | Summarize N=5 comparison memory phase readout | open, mergeable |
| 3 | #25 | `codex/beta-readiness-n10-policy` | Document N=10 beta policy and sentinel smoke | open, mergeable |
| 4 | #26 | `codex/beta-readiness-scorecard` | This aggregate beta readiness scorecard | current |

Do not merge these out of order unless the stack is rebased first.

## What Changed Since The Final Memory Scorecard

### Library UI Latency

PR #23 makes filter debounce depend on the kind of change:

| Change type | Debounce |
| --- | ---: |
| initial load | 200 ms |
| text search | 175 ms |
| range/date | 125 ms |
| quick filters/reset | 50 ms |

Fresh local DB-scale sidecars:

| Scenario | Debounce | IPC | Peak JS heap |
| --- | ---: | ---: | ---: |
| small search | 178.2 ms | 6.5 ms | 8.54 MB |
| small fluid dropdown | 58.9 ms | 7.4 ms | 8.54 MB |
| small date range | 134.1 ms | 8.0 ms | 8.54 MB |
| small reset | 59.6 ms | 7.4 ms | 8.54 MB |
| large search | 178.1 ms | 17.6 ms | 8.66 MB |
| large fluid dropdown | 58.2 ms | 8.8 ms | 8.66 MB |
| large date range | 131.2 ms | 10.6 ms | 8.66 MB |
| large reset | 56.5 ms | 14.2 ms | 8.66 MB |

Read: SQL/IPC is still small. The UX win is lower non-text debounce; remaining
latency is render/settle and runner padding, not DB work.

### Comparison Renderer RSS

PR #24 summarizes three N=5 diagnostic memory runs:

| Phase | Total p50 | Renderer p50 | GPU p50 |
| --- | ---: | ---: | ---: |
| after_chart_visible | 644.33 MB | 143.27 MB | 261.14 MB |
| after_pdf | 736.34 MB | 207.28 MB | 259.71 MB |
| after_xlsx | 726.19 MB | 209.05 MB | 248.00 MB |
| after_export_gc_hint | 626.07 MB | 192.82 MB | 164.18 MB |
| after_route_leave | 631.44 MB | 192.14 MB | 166.32 MB |

Read:

- `after_xlsx - after_export_gc_hint` reclaims about 100.12 MB Total RSS,
  including 16.23 MB renderer RSS and 83.82 MB GPU RSS.
- `after_export_gc_hint - after_route_leave` is near-flat for renderer RSS.
- There is no new evidence of app-level comparison state retained after
  navigation, but comparison renderer RSS remains a watch item.

### N=10 Comparison Policy

PR #25 resolves the previous ambiguity:

- beta native runtime cap is 8 comparison experiments;
- N=10 UI smoke is not a beta gate while that cap remains 8;
- `COMPARISON_SMOKE_N=10 npm run perf:comparison:tauri` is a sentinel smoke
  that should pass with a `skipped: "license-cap"` row.

Observed sentinel sidecar:

```json
{
  "license_cap": 8,
  "measurements": [
    {
      "n": 10,
      "skipped": "license-cap",
      "skipReason": "runtime license caps maxComparisonExperiments at 8"
    }
  ]
}
```

## Local Validation

The local gate is authoritative. GitHub Actions status must not be used as the
release/readiness blocker unless the release owner explicitly asks for it.

Already run on the beta-readiness stack:

```powershell
npm run build:ci
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run version:validate
npm run audit:large-ipc
git diff --check
```

Observed results:

- `npm run build:ci`: passed.
- `npm test`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 450 passed, 2 ignored.
- `npm run version:validate`: passed.
- `npm run audit:large-ipc`: zero violations.
- `git diff --check`: passed.

Perf/smoke runs captured across the stack:

```powershell
npm run perf:db:small
npm run perf:db:large
COMPARISON_SMOKE_MEMORY_STEPS=1 COMPARISON_SMOKE_N=5 npm run perf:comparison:tauri
COMPARISON_SMOKE_N=10 npm run perf:comparison:tauri
```

For a final beta candidate, repeat the full local gate on the merged/rebased
top-of-stack commit and include the release smoke matrix from
`docs/release/RELEASE_GATE.md`.

## Go / No-Go

| Area | Decision | Reason |
| --- | --- | --- |
| Memory ownership | GO | Saved chart/analysis/table/report and comparison paths are by-id/binary/page-bounded. |
| Large IPC | GO | `audit:large-ipc` remains zero violations and zero suppressions. |
| Library filter latency | GO with watch | Non-text debounce is reduced; remaining cost is UI render/settle. |
| Comparison memory | GO with watch | Export cleanup reclaim is measured; post-route renderer RSS is near-flat. |
| N=10 UI smoke | GO | Not applicable under beta cap 8; sentinel skip is validated. |
| Total RSS claim | NO-GO as hard win | Keep Total RSS soft because WebView2/GPU/runtime still dominate variance. |
| GitHub Actions gate | NO-GO | Actions are not authoritative for this repo. |

## Beta Watch Items

- Comparison setup latency is still above the aspirational `L-CMP-3`/`L-CMP-5`
  UI-ready budgets.
- Comparison renderer RSS remains the main memory watch item.
- Library filter work should now target render/settle behavior, not SQL.
- License activation/deactivation, updater alpha smoke, and backup
  restore/import smoke still need final beta-candidate manual confirmation.
- Runtime queue polish before `spawn_blocking` remains a P2 stability item, not
  a beta blocker.

## Release Notes Claim

Use this wording:

```text
RheoLab beta hardens saved-experiment and comparison workflows so the renderer
keeps ids, metadata, pages, and bounded chart windows instead of full raw
scientific arrays. Heavy report, analysis, table, and comparison data now stays
in Rust/SQLite by default. JS heap remains low in the measured workflows; Total
RSS is tracked as a soft metric because WebView2/GPU/runtime allocation remains
outside full app control.
```

Avoid this wording:

```text
Memory usage is fixed.
Total RSS is guaranteed lower.
N=10 comparison UI is release-gated.
GitHub Actions are the merge gate.
```
