/**
 * Tests for src/lib/store/zoom-sync-store.ts
 * Cross-chart zoom synchronisation via syncKey.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useZoomSyncStore } from '@/lib/store/zoom-sync-store';

describe('useZoomSyncStore', () => {
    beforeEach(() => {
        useZoomSyncStore.setState({ ranges: {} });
    });

    it('starts with no ranges', () => {
        expect(useZoomSyncStore.getState().ranges).toEqual({});
    });

    it('setRange stores a range for the given key', () => {
        useZoomSyncStore.getState().setRange('dashboard', { min: 0, max: 100 });
        const range = useZoomSyncStore.getState().ranges['dashboard'];
        expect(range).toEqual({ min: 0, max: 100 });
    });

    it('setRange with null clears the range', () => {
        useZoomSyncStore.getState().setRange('dashboard', { min: 0, max: 100 });
        useZoomSyncStore.getState().setRange('dashboard', null);
        expect(useZoomSyncStore.getState().ranges['dashboard']).toBeNull();
    });

    it('different syncKeys are independent', () => {
        useZoomSyncStore.getState().setRange('chart-a', { min: 0, max: 50 });
        useZoomSyncStore.getState().setRange('chart-b', { min: 10, max: 80 });
        expect(useZoomSyncStore.getState().ranges['chart-a']).toEqual({ min: 0, max: 50 });
        expect(useZoomSyncStore.getState().ranges['chart-b']).toEqual({ min: 10, max: 80 });
    });

    it('setRange returns early (no update) when range is identical', () => {
        useZoomSyncStore.getState().setRange('dashboard', { min: 5, max: 50 });
        const before = useZoomSyncStore.getState().ranges;

        // Same min/max — should early exit, same object reference
        useZoomSyncStore.getState().setRange('dashboard', { min: 5, max: 50 });
        // After early-exit, ranges object should be the same reference
        expect(useZoomSyncStore.getState().ranges).toBe(before);
    });

    it('setRange updates when only min changes', () => {
        useZoomSyncStore.getState().setRange('dashboard', { min: 0, max: 100 });
        useZoomSyncStore.getState().setRange('dashboard', { min: 10, max: 100 });
        expect(useZoomSyncStore.getState().ranges['dashboard']?.min).toBe(10);
    });

    it('setRange updates when only max changes', () => {
        useZoomSyncStore.getState().setRange('dashboard', { min: 0, max: 100 });
        useZoomSyncStore.getState().setRange('dashboard', { min: 0, max: 80 });
        expect(useZoomSyncStore.getState().ranges['dashboard']?.max).toBe(80);
    });

    it('unknown key returns undefined (not an error)', () => {
        expect(useZoomSyncStore.getState().ranges['nonexistent']).toBeUndefined();
    });

    it('overwriting a range with new values updates correctly', () => {
        useZoomSyncStore.getState().setRange('chart', { min: 0, max: 100 });
        useZoomSyncStore.getState().setRange('chart', { min: 20, max: 200 });
        expect(useZoomSyncStore.getState().ranges['chart']).toEqual({ min: 20, max: 200 });
    });

    it('can store ranges for many keys simultaneously', () => {
        for (let i = 0; i < 10; i++) {
            useZoomSyncStore.getState().setRange(`key-${i}`, { min: i, max: i + 10 });
        }
        expect(Object.keys(useZoomSyncStore.getState().ranges)).toHaveLength(10);
    });

    it('null equals null — no update when both are null', () => {
        useZoomSyncStore.getState().setRange('x', null);
        const before = useZoomSyncStore.getState().ranges;
        useZoomSyncStore.getState().setRange('x', null);
        expect(useZoomSyncStore.getState().ranges).toBe(before);
    });
});
