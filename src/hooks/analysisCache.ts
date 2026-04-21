/**
 * Module-level analysis cache.
 *
 * Extracted from `useAnalysisPipeline.ts` so that callers that only need
 * to *clear* the cache (e.g. `DashboardLayoutClient`, `experiment-data-store`)
 * do not have to import the full analysis pipeline — which would pull in
 * `@/lib/analysis/client` and the Tauri IPC bridge into the main bundle.
 *
 * This file intentionally imports only types (erased at build time),
 * keeping its runtime footprint at ~0 bytes while still letting consumers
 * reset the cache without loading the pipeline module graph.
 */
import type { GraceCycleResult, RheoCycle, RheoStep } from '@/lib/analysis/types';

export interface AnalysisCacheEntry {
    key: string;
    cycles: RheoCycle[];
    cycleResults: Map<number, GraceCycleResult>;
    allSteps: RheoStep[];
}

let cache: AnalysisCacheEntry | null = null;

/** Read the current cache entry, or null when empty. */
export function getAnalysisCache(): AnalysisCacheEntry | null {
    return cache;
}

/** Write a new cache entry (or null to evict). */
export function setAnalysisCache(entry: AnalysisCacheEntry | null): void {
    cache = entry;
}

/**
 * Clear the module-level analysis cache.
 *
 * Must be called when:
 *  - The user closes/resets the current experiment
 *  - The experiment-data-store is reset
 *
 * Without this, the last experiment's analysis results (~5-15 MB of cycles,
 * steps, and per-cycle GraceCycleResult maps) stay retained at module scope
 * indefinitely — even after navigating away from the Dashboard.
 */
export function clearAnalysisCache(): void {
    cache = null;
}

/** @internal – reset module-level cache between tests */
export function __resetAnalysisCache(): void {
    cache = null;
}
