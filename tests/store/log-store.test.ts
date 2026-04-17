/**
 * Tests for src/lib/store/log-store.ts
 * Zustand store for in-memory log entries.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useLogStore } from '@/lib/store/log-store';
import type { LogEntry } from '@/lib/logger';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
    return {
        timestamp: Date.now(),
        level: 'INFO',
        module: 'test',
        message: 'hello',
        ...overrides,
    };
}

describe('useLogStore', () => {
    beforeEach(() => {
        useLogStore.setState({ logs: [], isOpen: false, filterLevel: 'ALL', filterModule: null });
    });

    // ── default state ────────────────────────────────────────────────────

    it('starts with empty logs', () => {
        expect(useLogStore.getState().logs).toHaveLength(0);
    });

    it('starts with isOpen=false', () => {
        expect(useLogStore.getState().isOpen).toBe(false);
    });

    it('starts with filterLevel=ALL', () => {
        expect(useLogStore.getState().filterLevel).toBe('ALL');
    });

    it('starts with filterModule=null', () => {
        expect(useLogStore.getState().filterModule).toBeNull();
    });

    // ── addLog ────────────────────────────────────────────────────────────

    it('addLog appends an entry', () => {
        useLogStore.getState().addLog(makeEntry({ message: 'first' }));
        expect(useLogStore.getState().logs).toHaveLength(1);
        expect(useLogStore.getState().logs[0].message).toBe('first');
    });

    it('addLog keeps multiple entries in order', () => {
        useLogStore.getState().addLog(makeEntry({ message: 'A' }));
        useLogStore.getState().addLog(makeEntry({ message: 'B' }));
        const { logs } = useLogStore.getState();
        expect(logs[0].message).toBe('A');
        expect(logs[1].message).toBe('B');
    });

    it('addLog caps logs at 500 entries', () => {
        const state = useLogStore.getState();
        for (let i = 0; i < 501; i++) {
            state.addLog(makeEntry({ message: `msg-${i}` }));
        }
        expect(useLogStore.getState().logs).toHaveLength(500);
    });

    it('addLog drops oldest entry when exceeding 500', () => {
        const state = useLogStore.getState();
        for (let i = 0; i < 501; i++) {
            state.addLog(makeEntry({ message: `msg-${i}` }));
        }
        // msg-0 should have been dropped  
        expect(useLogStore.getState().logs[0].message).toBe('msg-1');
    });

    // ── clearLogs ────────────────────────────────────────────────────────

    it('clearLogs removes all entries', () => {
        useLogStore.getState().addLog(makeEntry());
        useLogStore.getState().addLog(makeEntry());
        useLogStore.getState().clearLogs();
        expect(useLogStore.getState().logs).toHaveLength(0);
    });

    // ── toggleOpen ───────────────────────────────────────────────────────

    it('toggleOpen sets isOpen to true', () => {
        useLogStore.getState().toggleOpen();
        expect(useLogStore.getState().isOpen).toBe(true);
    });

    it('toggleOpen twice returns to false', () => {
        useLogStore.getState().toggleOpen();
        useLogStore.getState().toggleOpen();
        expect(useLogStore.getState().isOpen).toBe(false);
    });

    // ── setFilterLevel ───────────────────────────────────────────────────

    it('setFilterLevel updates filterLevel', () => {
        useLogStore.getState().setFilterLevel('ERROR');
        expect(useLogStore.getState().filterLevel).toBe('ERROR');
    });

    it('setFilterLevel resets to ALL', () => {
        useLogStore.getState().setFilterLevel('WARN');
        useLogStore.getState().setFilterLevel('ALL');
        expect(useLogStore.getState().filterLevel).toBe('ALL');
    });

    // ── setFilterModule ──────────────────────────────────────────────────

    it('setFilterModule sets a module filter', () => {
        useLogStore.getState().setFilterModule('parser');
        expect(useLogStore.getState().filterModule).toBe('parser');
    });

    it('setFilterModule can be cleared with null', () => {
        useLogStore.getState().setFilterModule('parser');
        useLogStore.getState().setFilterModule(null);
        expect(useLogStore.getState().filterModule).toBeNull();
    });
});
