import type { ExperimentsFilterMetadataResponse } from '@/types/tauri';

/**
 * Module-level promise cache for the library-wide filter metadata.
 *
 * The Rust backend caches the response for 30 seconds, but we still want
 * a React-side shared subscription so that:
 *   - `ExperimentFilters` (filter panel) and `ExperimentList` (empty-state
 *     hints) share exactly one in-flight fetch on mount.
 *   - The cache is invalidated explicitly via
 *     `resetExperimentFilterMetadataCache` after any mutation — no polling,
 *     no stampede.
 *
 * The state is intentionally global within the JS module scope.  This is
 * safe because the filter metadata represents DB state that every component
 * interprets identically — there's no per-component variant.
 *
 * The cache lives here (in `lib/experiments`) rather than inside the React
 * hook so that non-React callers — e.g. the `saveExperiment` /
 * `deleteExperiment` mutation helpers in `lib/experiments/client.ts` —
 * can invalidate it after a successful write without pulling React into
 * their dependency graph.  Keeping the hook → client edge one-way preserves
 * the zero-cycle module graph (verified by madge).
 */

let cachedPromise: Promise<ExperimentsFilterMetadataResponse> | null = null;

/**
 * Pull from the shared filter-metadata cache.  If the cache is empty the
 * supplied `loader` is invoked exactly once and the resulting in-flight
 * promise is shared with every concurrent caller.
 *
 * On rejection the cache is cleared so the next subscriber retries; a
 * persisted rejected promise would otherwise keep handing the same error
 * to every consumer for the lifetime of the tab.
 */
export function loadFilterMetadataCached(
    loader: () => Promise<ExperimentsFilterMetadataResponse>,
): Promise<ExperimentsFilterMetadataResponse> {
    if (!cachedPromise) {
        cachedPromise = loader().catch((err) => {
            cachedPromise = null;
            throw err;
        });
    }
    return cachedPromise;
}

/**
 * Drop the cached metadata so the next subscriber triggers a fresh fetch.
 *
 * Must be called after any mutation that could change distinct column
 * values or touch-point stats — saving, deleting or importing an
 * experiment.  This is the frontend mirror of the backend's
 * `invalidate_filter_metadata_cache` (see Phase 4 DB deep-dive, finding
 * F3): the Rust write paths already invalidate their server-side cache;
 * without this call the frontend would keep handing out the pre-mutation
 * promise for the rest of the tab's lifetime.
 */
export function resetExperimentFilterMetadataCache(): void {
    cachedPromise = null;
}
