# Warm Navigation Closeout

**Date:** 2026-04-30.
**Branch:** `codex/warm-navigation-closeout-docs`.
**Base:** `codex/warm-navigation-cache-invalidation` at `c2f710a`.
**Authoritative gate:** local top-of-stack validation plus generated Tauri
sidecars. GitHub Actions are informational only for this repository.

## Verdict

Warm navigation is closed for beta readiness after PR #36 plus this closeout
document.

The implemented lifecycle keeps the user-visible Comparison session warm without
keeping DB-backed raw or full columnar arrays in renderer state after route
leave:

- selected experiment ids, metadata chips, display settings, active tab, and
  viewport remain logical session state;
- recently visible binary series windows remain recoverable warm cache bounded
  by TTL, entry count, and byte budget;
- DB-backed raw points and chart columnar payloads are stripped from the
  comparison store on route leave;
- returning within the warm window does not refetch existing selected lines;
- adding another saved experiment loads only that new line;
- save/delete/import/restore/sync mutation boundaries invalidate stale frontend
  warm windows.

This is not a claim that Total RSS is fixed. WebView2, GPU, and runtime
allocation behavior remain soft metrics. The product claim is bounded
renderer-owned state plus warm recoverable views.

## Stack Summary

| PR | Branch | Slice | Status |
| --- | --- | --- | --- |
| #29 | `codex/warm-navigation-session-state` | Normalize Comparison logical session state | complete |
| #30 | `codex/warm-navigation-series-cache` | Shared frontend series window cache | complete |
| #31 | `codex/warm-navigation-comparison-binary-lines` | Per-line binary Comparison loading | complete |
| #32 | `codex/warm-navigation-viewport-session` | Persist active tab and viewport | complete |
| #33 | `codex/warm-navigation-comparison-window-refetch` | Refetch persisted viewport as window data | complete |
| #34 | `codex/warm-navigation-rust-series-cache` | Rust decoded series cache | complete |
| #35 | `codex/warm-navigation-e2e-smoke` | Tauri warm-navigation smoke | complete |
| #36 | `codex/warm-navigation-cache-invalidation` | Frontend warm cache invalidation | complete |
| #37 | `codex/warm-navigation-closeout-docs` | Closeout, release claims, local gate | this doc |

The originally planned WN-6 centralized view lifecycle manager is deferred. The
current route-level behavior already has the needed beta contract: logical
session state survives route leave, heavy renderer-owned buffers are released,
and warm caches are bounded. A central lifecycle manager can still be useful
later if cleanup policy becomes scattered again.

## User Contract

Target workflow:

1. Open Comparison with 5 saved experiments.
2. Zoom or brush to a chart viewport.
3. Leave Comparison for about 30 seconds.
4. Open another saved experiment on Dashboard and save it.
5. Return to Comparison.
6. Add the 6th experiment.

Expected behavior:

- the existing 5 chips/settings/viewport are still present;
- old 5 lines are visible quickly from warm cache;
- route return does not refetch those old 5 experiment ids;
- adding the 6th issues one series request for the new experiment id;
- old lines remain visible while the new line loads;
- DB-backed raw and columnar payloads are not persisted in the comparison store.

## Smoke Evidence

Local smoke command:

```powershell
npm run perf:warm-nav:tauri
```

GitHub Actions are not the gate for this evidence. The relevant source of truth
is the local command output plus the JSON sidecar under `outputs/e2e/perf/`.

| Metric | PR #35 first smoke | PR #36 after invalidation | Read |
| --- | ---: | ---: | --- |
| Initial 5-line comparison ready | 4,927 ms | 4,980 ms | setup cost, not route-return |
| Route away duration | 32,956 ms | 32,899 ms | matches 30 second scenario |
| Return to old 5 lines | 473 ms | 455 ms | warm return preserved |
| Series requests on return | 0 | 0 | no old-line refetch |
| Add 6th line ready | 936 ms | 903 ms | within current 1 second soft target |
| Series requests after add | 1 window | 1 window | only new line loads |
| Refetched existing lines after add | 0 | 0 | no reload storm |
| After route leave raw/columnar in store | 0 / 0 | 0 / 0 | heavy DB-backed state stripped |

Fresh sidecars:

- `outputs/e2e/perf/warm-navigation-comparison-1777564178729-tauri.json`
- `outputs/e2e/perf/warm-navigation-comparison-1777566938221-tauri.json`

The current warm-return budget should be documented as `<= 500 ms` for beta.
The earlier `<= 300 ms` number remains aspirational until several scale runs
show it is stable.

## Cache Ownership

### Frontend Warm Series Cache

`seriesWindowCache` owns recent decoded chart windows in the renderer. It is
recoverable, bounded state:

- TTL: 5 minutes.
- Max bytes: 96 MB.
- Max entries: 64.
- Eviction: TTL, LRU, byte budget, explicit mutation invalidation.

This cache must never become the source of truth. SQLite/Rust remain the source
of truth for saved experiments.

### Rust Decoded Series Cache

The Rust cache avoids repeatedly decoding the same `ExperimentData.dataBlob` for
overview/window requests. It is keyed by experiment id plus data hash, and is
bounded by TTL, entries, and bytes.

The frontend cache currently does not include data hash in every Comparison key,
so PR #36 intentionally invalidates frontend warm windows on mutation
boundaries.

## Mutation Invalidation Policy

| Mutation | Frontend warm cache action | Reason |
| --- | --- | --- |
| successful `experiments_save` with experiment id | `deleteByExperiment(id)` | one known experiment changed |
| failed `experiments_save` | keep cache | no mutation happened |
| successful `experiments_delete(id)` | `deleteByExperiment(id)` | one known experiment removed |
| experiment data import | `clear()` | affected ids may be broad or unknown |
| backup restore | `clear()` | database contents/projections may change broadly |
| sync import delta | `clear()` | remote mutation set may be broad |
| sync conflict resolution | `clear()` | resolved record ownership may change |
| DB import UI path | `clear()` | replaces or mutates broad DB state |

Future polish: centralize broad invalidation behind a helper such as
`invalidateAllRecoverableExperimentCaches(reason)` so new import/restore callers
cannot bypass the policy.

## Release Claim

Use this wording:

```text
Comparison route-return lifecycle now keeps selected ids, metadata, settings,
active tab, and viewport warm without retaining DB-backed raw or full columnar
arrays in renderer state after route leave. Returning within the warm window
avoids refetching existing lines, and adding a new saved experiment loads only
that line. Experiment save/delete/import/restore/sync boundaries invalidate
recoverable warm series caches.
```

Avoid this wording:

```text
Comparison memory is fixed.
Total RSS is guaranteed lower.
The 5x100k scenario has already been scale-proven.
GitHub Actions are the merge gate.
```

## Known Limitations

- The WN smoke uses the saved fixture pool. It proves the lifecycle contract, not
  the 5 experiments x 100k points stress case.
- File-based unsaved comparison experiments remain a special case because they
  cannot be recovered from SQLite by id before save. They may keep enough
  in-memory data to remain usable until saved.
- Rust decoded cache stats are not yet exposed in support diagnostics.
- Frontend support export does not yet include `seriesWindowCache.stats()` or
  comparison session warm-cache status.
- Total RSS remains a soft watch metric.

## Remaining Optional Work

These are not blockers for closing warm navigation:

1. Expose support diagnostics:
   - frontend `seriesWindowCache.stats()`;
   - Rust decoded series cache stats/clear;
   - comparison session state summary;
   - manual "clear warm caches" action that keeps logical ids/settings.
2. Add a large saved-experiment seed path and run the 5x100k stress variant.
3. Revisit the centralized view lifecycle manager if route cleanup policy starts
   spreading across unrelated components.

## Local Merge Gate

Before merging the top of the warm-navigation stack, run locally:

```powershell
npm run build:ci
npm test -- --run tests/tauri/series-cache-invalidation.test.ts
npm test -- --run tests/tauri/series-cache-invalidation.test.ts tests/hooks/useComparisonSeriesWindows.test.tsx tests/series/series-window-cache.test.ts
npm test
npm run perf:warm-nav:tauri
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run version:validate
npm run audit:large-ipc
git diff --check
```

Do not block this merge on GitHub Actions status unless the release owner
explicitly changes the repository policy.

## Definition Of Done

| Requirement | Status |
| --- | --- |
| Comparison selected ids/settings survive route leave | done |
| Active tab and viewport survive route leave | done |
| Returning within warm TTL avoids old-line refetch | done |
| Adding a 6th saved experiment loads only the 6th line | done |
| Old lines remain visible while the new line loads | done |
| DB-backed raw/columnar renderer state stripped on route leave | done |
| Frontend warm cache bounded by TTL/entries/bytes | done |
| Rust decoded cache bounded by TTL/entries/bytes | done |
| Mutation boundaries invalidate frontend warm windows | done |
| Large IPC audit remains zero violations | gate |
| 5x100k stress validation | follow-up |
