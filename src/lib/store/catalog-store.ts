/**
 * Shared catalog store for reagents & water sources.
 *
 * Consolidates 4+ independent `listReagents()` and 2+ independent
 * `listWaterSources()` IPC calls into a single Zustand store so that all
 * consumers share the same data and only one IPC round-trip is needed per
 * category until explicitly invalidated.
 */

import { create } from 'zustand';
import { listReagents } from '@/lib/reagents/client';
import { listWaterSources } from '@/lib/water-sources/client';
import type { ReagentRecord } from '@/types/tauri';

interface CatalogState {
    // ── Reagents ──────────────────────────────────────────────────────────
    reagents: ReagentRecord[];
    reagentsLoading: boolean;
    reagentsError: string | null;
    /** Fetches unless already loaded. Call `invalidateReagents()` first to force. */
    fetchReagents: () => Promise<void>;
    /** Mark stale — next `fetchReagents()` will re-fetch. */
    invalidateReagents: () => void;

    // ── Water sources ────────────────────────────────────────────────────
    waterSources: string[];
    waterSourcesLoading: boolean;
    waterSourcesError: string | null;
    fetchWaterSources: () => Promise<void>;
    invalidateWaterSources: () => void;
}

let reagentsFetched = false;
let waterSourcesFetched = false;

export const useCatalogStore = create<CatalogState>((set, get) => ({
    // ── Reagents ──────────────────────────────────────────────────────────
    reagents: [],
    reagentsLoading: false,
    reagentsError: null,

    fetchReagents: async () => {
        if (reagentsFetched && !get().reagentsError) return;
        if (get().reagentsLoading) return; // dedupe concurrent calls
        set({ reagentsLoading: true, reagentsError: null });
        try {
            const data = await listReagents();
            reagentsFetched = true;
            set({ reagents: data, reagentsLoading: false });
        } catch (e) {
            set({ reagentsError: String(e), reagentsLoading: false });
        }
    },

    invalidateReagents: () => {
        reagentsFetched = false;
    },

    // ── Water sources ────────────────────────────────────────────────────
    waterSources: [],
    waterSourcesLoading: false,
    waterSourcesError: null,

    fetchWaterSources: async () => {
        if (waterSourcesFetched && !get().waterSourcesError) return;
        if (get().waterSourcesLoading) return;
        set({ waterSourcesLoading: true, waterSourcesError: null });
        try {
            const data = await listWaterSources();
            waterSourcesFetched = true;
            set({ waterSources: data, waterSourcesLoading: false });
        } catch (e) {
            set({ waterSourcesError: String(e), waterSourcesLoading: false });
        }
    },

    invalidateWaterSources: () => {
        waterSourcesFetched = false;
    },
}));
