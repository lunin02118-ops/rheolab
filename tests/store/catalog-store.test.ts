/**
 * Tests for src/lib/store/catalog-store.ts
 * Shared catalog for reagents & water sources with deduplication.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (vi.mock must be at module top level) ─────────────────────────────

const mockListReagents = vi.fn();
const mockListWaterSources = vi.fn();

vi.mock('@/lib/reagents/client', () => ({
    listReagents: (...args: unknown[]) => mockListReagents(...args),
}));

vi.mock('@/lib/water-sources/client', () => ({
    listWaterSources: (...args: unknown[]) => mockListWaterSources(...args),
}));

import { useCatalogStore } from '@/lib/store/catalog-store';

describe('useCatalogStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset module-level fetch flags and store state
        useCatalogStore.getState().invalidateReagents();
        useCatalogStore.getState().invalidateWaterSources();
        useCatalogStore.setState({
            reagents: [],
            reagentsLoading: false,
            reagentsError: null,
            waterSources: [],
            waterSourcesLoading: false,
            waterSourcesError: null,
        });
    });

    // ── Reagents ─────────────────────────────────────────────────────────

    it('starts with empty reagents', () => {
        expect(useCatalogStore.getState().reagents).toHaveLength(0);
    });

    it('fetchReagents loads reagents from client', async () => {
        mockListReagents.mockResolvedValue([{ id: 1, name: 'KCl', type: 'salt' }]);
        await useCatalogStore.getState().fetchReagents();
        expect(useCatalogStore.getState().reagents).toHaveLength(1);
        expect(useCatalogStore.getState().reagents[0].name).toBe('KCl');
    });

    it('fetchReagents sets reagentsLoading=false after success', async () => {
        mockListReagents.mockResolvedValue([]);
        await useCatalogStore.getState().fetchReagents();
        expect(useCatalogStore.getState().reagentsLoading).toBe(false);
    });

    it('fetchReagents does not call client twice (deduplication)', async () => {
        mockListReagents.mockResolvedValue([]);
        await useCatalogStore.getState().fetchReagents();
        await useCatalogStore.getState().fetchReagents();
        expect(mockListReagents).toHaveBeenCalledTimes(1);
    });

    it('fetchReagents re-fetches after invalidateReagents()', async () => {
        mockListReagents.mockResolvedValue([]);
        await useCatalogStore.getState().fetchReagents();
        useCatalogStore.getState().invalidateReagents();
        await useCatalogStore.getState().fetchReagents();
        expect(mockListReagents).toHaveBeenCalledTimes(2);
    });

    it('fetchReagents stores error on failure', async () => {
        mockListReagents.mockRejectedValue(new Error('network error'));
        await useCatalogStore.getState().fetchReagents();
        expect(useCatalogStore.getState().reagentsError).toContain('network error');
    });

    it('fetchReagents sets loading=false after error', async () => {
        mockListReagents.mockRejectedValue(new Error('fail'));
        await useCatalogStore.getState().fetchReagents();
        expect(useCatalogStore.getState().reagentsLoading).toBe(false);
    });

    // ── Water sources ─────────────────────────────────────────────────────

    it('starts with empty waterSources', () => {
        expect(useCatalogStore.getState().waterSources).toHaveLength(0);
    });

    it('fetchWaterSources loads sources from client', async () => {
        mockListWaterSources.mockResolvedValue(['Freshwater', 'Brine', 'Seawater']);
        await useCatalogStore.getState().fetchWaterSources();
        expect(useCatalogStore.getState().waterSources).toEqual(['Freshwater', 'Brine', 'Seawater']);
    });

    it('fetchWaterSources deduplicates concurrent calls', async () => {
        mockListWaterSources.mockResolvedValue([]);
        await useCatalogStore.getState().fetchWaterSources();
        await useCatalogStore.getState().fetchWaterSources();
        expect(mockListWaterSources).toHaveBeenCalledTimes(1);
    });

    it('fetchWaterSources re-fetches after invalidation', async () => {
        mockListWaterSources.mockResolvedValue([]);
        await useCatalogStore.getState().fetchWaterSources();
        useCatalogStore.getState().invalidateWaterSources();
        await useCatalogStore.getState().fetchWaterSources();
        expect(mockListWaterSources).toHaveBeenCalledTimes(2);
    });

    it('fetchWaterSources stores error string on failure', async () => {
        mockListWaterSources.mockRejectedValue(new Error('timeout'));
        await useCatalogStore.getState().fetchWaterSources();
        expect(useCatalogStore.getState().waterSourcesError).toContain('timeout');
    });
});
