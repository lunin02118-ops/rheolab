# Warm Navigation Plan

Status: rollout closed through WN-7 plus the cache invalidation follow-up.
Closeout: `docs/performance/WARM-NAVIGATION-CLOSEOUT.md`.

## Mission

Make memory disposable by lifecycle without making navigation feel cold. The
renderer should remember user work and forget only heavy buffers that can be
recovered from Rust or SQLite.

## Rollout

1. `WN-0 docs(memory): add lifecycle policy`
   - Document hot/warm/logical/cold state.
   - Record the comparison route-return UX contract.
   - No runtime changes.

2. `WN-1 refactor(comparison): normalize comparison session state`
   - Add `sessionId`, `experimentIds`, `experimentsById`, `viewport`, and
     `activeTab` to the comparison store.
   - Keep the existing `experiments[]` as a compatibility adapter for chart and
     report components.
   - Migrate old persisted `experiments[]` into normalized logical state.

3. `WN-2 feat(series): add shared frontend series window cache`
   - Move hook-local series cache into a bounded module cache.
   - Use TTL, LRU, byte budget, and diagnostics.

4. `WN-3 feat(comparison): load comparison chart lines via binary series`
   - Load each selected saved experiment independently by id.
   - Keep old lines visible while new lines load.
   - Add fallback flag for legacy columnar rehydrate path during soak.

5. `WN-4 feat(comparison): persist viewport and restore warm session`
   - Persist viewport and active tab.
   - Do not reset zoom on normal route return.

6. `WN-5 feat(series): add Rust decoded series cache`
   - Avoid repeated `ExperimentData.dataBlob` decode for repeated overview/window
     requests.
   - Keep cache bounded by TTL and bytes.

7. `WN-6 feat(memory): add view lifecycle manager` (deferred)
   - Centralize route enter/leave release policy.
   - Keep logical state separate from heavy buffers.
   - Deferred because the current route-level policy already satisfies the beta
     lifecycle contract. Revisit if cleanup policy becomes scattered again.

8. `WN-7 perf(comparison): add warm navigation runner`
   - Prove the 5-line, leave 30 seconds, return, add 6th route lifecycle.
   - Keep a 5x100k stress variant as the next data-scale extension once a
     large saved-experiment seed path is available.
   - Write sidecar with cache hits/misses, refetch count, timing, JS heap, and RSS.
   - Local command: `npm run perf:warm-nav:tauri`.
   - GitHub Actions are not authoritative for this track; PR bodies should treat
     local gate output and the generated sidecar as the authoritative evidence.

9. `WN-8 docs(memory): close rollout`
   - Update scorecard and remove or explicitly defer fallback flags.
   - Invalidate frontend warm series windows on experiment mutation:
     save/delete removes the affected id, broad import/restore/sync clears
     recoverable windows.
   - Record release claims, known limitations, and the local authoritative gate.

## Guardrails

- `audit:large-ipc` must stay zero violations.
- DB-backed comparison experiments must not persist raw points or columnar chart
  arrays in localStorage.
- File-based unsaved experiments are a special case: they have no DB id to
  recover from, so they may keep enough data to remain usable until saved.
- License deactivation and manual comparison clear still clear logical state.
