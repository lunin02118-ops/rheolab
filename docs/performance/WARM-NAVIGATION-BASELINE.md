# Warm Navigation Baseline

Status: initial baseline before WN runtime changes.

## Current Behavior

The memory-hardening track already moved major saved-detail and report hot paths
to id-based or bounded payloads:

- saved detail chart uses binary overview/window series
- saved detail analysis uses by-id `AnalysisArtifact`
- saved raw table uses page-by-id
- saved Report tab exports by id
- comparison reports export by ids
- large IPC audit has zero violations

The remaining UX/memory tradeoff is Comparison navigation. Today the comparison
store keeps `experiments[]` as both logical selection and chart data adapter.
On route leave, `releaseHeavyData()` strips DB-backed experiments to metadata.
On route return, `rehydrateIfNeeded()` reloads chart data by id.

That is safe for memory, but it is colder than the desired warm-navigation
behavior for short route hops.

## Target Scenario

Use this scenario as the acceptance baseline for later WN runners:

1. Start with 5 saved experiments in Comparison.
2. Each experiment should be large enough to represent real use, ideally about
   100k points.
3. Leave Comparison for about 30 seconds.
4. Open another saved experiment on Dashboard and save it.
5. Return to Comparison.
6. Add the 6th experiment.

Expected final behavior after WN rollout:

- chips and settings are visible immediately
- old 5 lines are visible from warm cache when TTL is valid
- adding the 6th loads only that line
- viewport is preserved
- DB-backed raw arrays are not stored in renderer state
- JS heap stays bounded

## Current Known Gap

`ComparisonPage` releases DB-backed chart payloads on unmount. This is correct
for RC memory hardening, but WN needs a warmer lifecycle policy:

- logical state remains persistent
- chart instances and export bytes are released
- recent series windows remain warm by TTL and byte budget

