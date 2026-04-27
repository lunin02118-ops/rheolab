import { useEffect, useState } from 'react';
import type { ExperimentsFilterMetadataResponse } from '@/types/tauri';
import { getExperimentFilterMetadata } from '@/lib/experiments/client';
import {
    loadFilterMetadataCached,
    resetExperimentFilterMetadataCache,
} from '@/lib/experiments/filter-metadata-cache';
import { logger } from '@/lib/logger';

// Cache state lives in `lib/experiments/filter-metadata-cache.ts` so that
// non-React callers (saveExperiment / deleteExperiment) can invalidate it
// without importing the React hook.  This keeps the module graph acyclic
// (madge: 0 cycles).  The reset helper is re-exported here for backward
// compatibility — existing tests and components import it from this path.
export { resetExperimentFilterMetadataCache };

function loadMetadataCached(): Promise<ExperimentsFilterMetadataResponse> {
    return loadFilterMetadataCached(getExperimentFilterMetadata);
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
