import { useEffect, useState } from 'react';
import type { ExperimentsFilterMetadataResponse } from '@/types/tauri';
import { getExperimentFilterMetadata } from '@/lib/experiments/client';
import { logger } from '@/lib/logger';

/**
 * Module-level promise cache for library-wide filter metadata.
 *
 * The Rust backend caches the response for 30 seconds, but we still want
 * a React-side shared subscription so that:
 *   - `ExperimentFilters` (filter panel) and `ExperimentList` (empty
 *     state + range hints) share exactly one in-flight fetch on mount.
 *   - The cache is invalidated explicitly (via `resetMetadataCache`)
 *     when an operation mutates the library — no polling, no stampede.
 *
 * The value is intentionally global within the JS module scope.  This is
 * safe because the filter metadata represents DB state that all parts
 * of the UI interpret identically — there's no per-component variant.
 */
let cachedPromise: Promise<ExperimentsFilterMetadataResponse> | null = null;

function loadMetadataCached(): Promise<ExperimentsFilterMetadataResponse> {
    if (!cachedPromise) {
        cachedPromise = getExperimentFilterMetadata().catch((err) => {
            // Clear the cache on failure so subsequent calls can retry.
            // A persisted rejected promise would keep serving the same
            // error to every consumer for the lifetime of the tab.
            cachedPromise = null;
            throw err;
        });
    }
    return cachedPromise;
}

/**
 * Drop the cached metadata so the next `useExperimentFilterMetadata()`
 * subscriber triggers a fresh fetch.  Call this after any mutation that
 * could change distinct column values or touch-point stats — e.g. saving
 * or deleting an experiment — so the UI reflects the new state.
 */
export function resetExperimentFilterMetadataCache(): void {
    cachedPromise = null;
}

interface MetadataHookResult {
    /** Loaded metadata, `null` until the first fetch resolves. */
    metadata: ExperimentsFilterMetadataResponse | null;
    /** Human-readable error message; `null` on success or while loading. */
    error: string | null;
}

/**
 * Subscribe to library-wide filter metadata.
 *
 * Every caller pulls from the same module-level promise, so `N` components
 * mounting simultaneously still trigger only one round-trip.  While the
 * fetch is in flight both `metadata` and `error` are `null`; consumers
 * should render a fallback (e.g. skeleton / disabled control) in that
 * interval.
 *
 * Errors are surfaced via `error` rather than thrown so hosts don't have
 * to install React error boundaries just for a sidebar panel.
 */
export function useExperimentFilterMetadata(): MetadataHookResult {
    const [metadata, setMetadata] = useState<ExperimentsFilterMetadataResponse | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        loadMetadataCached()
            .then((data) => {
                if (!cancelled) {
                    setMetadata(data);
                    setError(null);
                }
            })
            .catch((e) => {
                logger.warn('Failed to load experiment filter metadata', e);
                if (!cancelled) {
                    setError('Не удалось загрузить параметры фильтрации');
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    return { metadata, error };
}
