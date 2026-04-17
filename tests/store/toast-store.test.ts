/**
 * Tests for src/lib/store/toast-store.ts
 *
 * Covers:
 *   - add()    — toast is created, auto-dismiss fires after duration
 *   - remove() — clears timer + removes toast
 *   - clear()  — flushes all timers and toasts
 *   - Edge cases: duration=0, rapid add/remove, counter increment
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/lib/store/toast-store';

function resetStore() {
    useToastStore.getState().clear();
}

describe('useToastStore', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetStore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── Initial state ─────────────────────────────────────────────────────

    it('starts with no toasts', () => {
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    // ── add() ─────────────────────────────────────────────────────────────

    it('add() creates a toast with the given message and type', () => {
        useToastStore.getState().add('Hello', 'success');
        const { toasts } = useToastStore.getState();
        expect(toasts).toHaveLength(1);
        expect(toasts[0].message).toBe('Hello');
        expect(toasts[0].type).toBe('success');
    });

    it('add() assigns a unique id', () => {
        useToastStore.getState().add('A', 'info');
        useToastStore.getState().add('B', 'info');
        const { toasts } = useToastStore.getState();
        expect(toasts[0].id).not.toBe(toasts[1].id);
    });

    it('add() stores the correct duration', () => {
        useToastStore.getState().add('msg', 'warning', 2000);
        expect(useToastStore.getState().toasts[0].duration).toBe(2000);
    });

    it('add() uses default duration of 4000 when not provided', () => {
        useToastStore.getState().add('msg', 'info');
        expect(useToastStore.getState().toasts[0].duration).toBe(4000);
    });

    it('add() supports all toast types', () => {
        const types = ['success', 'error', 'info', 'warning'] as const;
        for (const type of types) {
            useToastStore.getState().add('msg', type);
        }
        expect(useToastStore.getState().toasts).toHaveLength(4);
    });

    // ── Auto-dismiss ──────────────────────────────────────────────────────

    it('auto-dismisses toast after specified duration', () => {
        useToastStore.getState().add('auto', 'info', 3000);
        expect(useToastStore.getState().toasts).toHaveLength(1);
        vi.advanceTimersByTime(3000);
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('does not dismiss before duration elapses', () => {
        useToastStore.getState().add('auto', 'info', 3000);
        vi.advanceTimersByTime(2999);
        expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('duration=0 dismisses immediately when timer fires', () => {
        useToastStore.getState().add('instant', 'info', 0);
        vi.advanceTimersByTime(0);
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('multiple toasts auto-dismiss independently', () => {
        useToastStore.getState().add('short', 'info', 1000);
        useToastStore.getState().add('long', 'info', 5000);
        vi.advanceTimersByTime(1000);
        expect(useToastStore.getState().toasts).toHaveLength(1);
        expect(useToastStore.getState().toasts[0].message).toBe('long');
        vi.advanceTimersByTime(4000);
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    // ── remove() ─────────────────────────────────────────────────────────

    it('remove() deletes the toast immediately', () => {
        useToastStore.getState().add('remove me', 'success');
        const id = useToastStore.getState().toasts[0].id;
        useToastStore.getState().remove(id);
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('remove() cancels the auto-dismiss timer', () => {
        useToastStore.getState().add('cancel me', 'info', 3000);
        const id = useToastStore.getState().toasts[0].id;
        useToastStore.getState().remove(id);
        // Advancing time should not throw or cause any extra mutations
        vi.advanceTimersByTime(3000);
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('remove() with unknown id is a no-op', () => {
        useToastStore.getState().add('keep', 'info');
        useToastStore.getState().remove('non-existent-id');
        expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('remove() preserves other toasts', () => {
        useToastStore.getState().add('first', 'info', 5000);
        useToastStore.getState().add('second', 'info', 5000);
        const id0 = useToastStore.getState().toasts[0].id;
        useToastStore.getState().remove(id0);
        expect(useToastStore.getState().toasts).toHaveLength(1);
        expect(useToastStore.getState().toasts[0].message).toBe('second');
    });

    // ── clear() ───────────────────────────────────────────────────────────

    it('clear() removes all toasts', () => {
        useToastStore.getState().add('a', 'info');
        useToastStore.getState().add('b', 'error');
        useToastStore.getState().clear();
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('clear() cancels all pending timers', () => {
        useToastStore.getState().add('a', 'info', 2000);
        useToastStore.getState().add('b', 'info', 4000);
        useToastStore.getState().clear();
        // No timers should fire
        vi.advanceTimersByTime(10000);
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    // ── Rapid add/remove cycles ───────────────────────────────────────────

    it('rapid add/remove leaves no stale toasts', () => {
        for (let i = 0; i < 20; i++) {
            useToastStore.getState().add(`msg-${i}`, 'info', 5000);
        }
        const ids = useToastStore.getState().toasts.map((t) => t.id);
        for (const id of ids) {
            useToastStore.getState().remove(id);
        }
        expect(useToastStore.getState().toasts).toHaveLength(0);
        // Advancing time should not throw or create ghost toasts
        vi.advanceTimersByTime(5000);
        expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('counter keeps incrementing across clear()', () => {
        useToastStore.getState().add('a', 'info');
        const id1 = useToastStore.getState().toasts[0].id;
        useToastStore.getState().clear();
        useToastStore.getState().add('b', 'info');
        const id2 = useToastStore.getState().toasts[0].id;
        expect(id1).not.toBe(id2);
    });
});
