// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    loadFilterMetadataCached,
    resetExperimentFilterMetadataCache,
} from '@/lib/experiments/filter-metadata-cache';
import type { ExperimentsFilterMetadataResponse } from '@/types/tauri';

const emptyMetadata: ExperimentsFilterMetadataResponse = {
    instrumentTypes: [],
    fluidTypes: [],
    geometries: [],
    reagentNames: [],
    laboratoryNames: [],
    fieldNames: [],
    waterSources: [],
    testCategories: [],
    testTypes: [],
    touchPointStats: {
        totalExperiments: 0,
        withCrossingCount: 0,
        withTargetCount: 0,
        crossingTimeMinMinutes: null,
        crossingTimeMaxMinutes: null,
        crossingViscosityMinCp: null,
        crossingViscosityMaxCp: null,
        viscosityAtTargetMinCp: null,
        viscosityAtTargetMaxCp: null,
    } as ExperimentsFilterMetadataResponse['touchPointStats'],
};

describe('filter-metadata-cache', () => {
    // The cache is module-global; reset between tests so the order does
    // not matter and so a leaking cache cannot mask a regression.
    afterEach(() => {
        resetExperimentFilterMetadataCache();
    });

    it('shares one in-flight promise between concurrent callers', async () => {
        const loader = vi.fn().mockResolvedValue(emptyMetadata);

        const a = loadFilterMetadataCached(loader);
        const b = loadFilterMetadataCached(loader);
        const c = loadFilterMetadataCached(loader);

        // Same promise instance — no fan-out fetches.
        expect(a).toBe(b);
        expect(b).toBe(c);
        await Promise.all([a, b, c]);
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('keeps serving the resolved value to subsequent callers', async () => {
        const loader = vi.fn().mockResolvedValue(emptyMetadata);
        await loadFilterMetadataCached(loader);

        // Second call AFTER resolution: still cached, no extra fetch.
        const second = await loadFilterMetadataCached(loader);
        expect(second).toBe(emptyMetadata);
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it('refetches after resetExperimentFilterMetadataCache', async () => {
        const loader = vi.fn().mockResolvedValue(emptyMetadata);
        await loadFilterMetadataCached(loader);
        expect(loader).toHaveBeenCalledTimes(1);

        resetExperimentFilterMetadataCache();
        await loadFilterMetadataCached(loader);
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('clears the cache on rejection so the next caller retries', async () => {
        const error = new Error('IPC down');
        const loader = vi
            .fn<() => Promise<ExperimentsFilterMetadataResponse>>()
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce(emptyMetadata);

        await expect(loadFilterMetadataCached(loader)).rejects.toBe(error);
        // The rejected promise must NOT linger in the cache; the second
        // caller should trigger a fresh fetch and succeed.
        const second = await loadFilterMetadataCached(loader);
        expect(second).toBe(emptyMetadata);
        expect(loader).toHaveBeenCalledTimes(2);
    });
});
