/**
 * @file zoom-sync-store.ts
 * @description §4.5 – Zustand store for cross-chart zoom synchronisation.
 *
 * Charts that share the same `syncKey` will zoom/reset together.
 * The zoom plugin (`zoom.ts`) reads and writes this store via the `syncKey`
 * option, allowing any number of charts to stay in lock-step.
 *
 * ### Usage
 * 1. Give both charts the same `syncKey` in `zoomPlugin({ syncKey: 'dashboard' })`.
 * 2. That's it — the store is managed internally by the plugin.
 *
 * You can also read zoom state from React components:
 * ```tsx
 * const range = useZoomSyncStore(s => s.ranges['dashboard']);
 * ```
 */
import { create } from 'zustand';

export interface ZoomRange {
    min: number;
    max: number;
}

interface ZoomSyncState {
    /** Map of syncKey → current x-axis zoom range.  Absent key = not zoomed. */
    ranges: Record<string, ZoomRange | null>;

    /** Called by the zoom plugin when a chart zooms in. */
    setRange: (syncKey: string, range: ZoomRange | null) => void;
}

export const useZoomSyncStore = create<ZoomSyncState>()((set, get) => ({
    ranges: {},
    setRange: (syncKey, range) => {
        // §4.5 — Early-exit when value hasn't changed.
        // Without this, every zoom mousemove creates a new `ranges` object and
        // fires all Zustand subscribers even when min/max are numerically identical.
        const prev = get().ranges[syncKey] ?? null;
        if (prev === range) return;
        if (prev && range && prev.min === range.min && prev.max === range.max) return;
        set((state) => ({
            ranges: { ...state.ranges, [syncKey]: range },
        }));
    },
}));
