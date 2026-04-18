import { create } from 'zustand';
import type { LogEntry, LogLevel } from '@/lib/logger';
import { subscribeToLogs } from '@/lib/logger';

interface LogStoreState {
    logs: LogEntry[];
    isOpen: boolean;
    filterLevel: LogLevel | 'ALL';
    filterModule: string | null;

    // Actions
    addLog: (entry: LogEntry) => void;
    clearLogs: () => void;
    toggleOpen: () => void;
    setFilterLevel: (level: LogLevel | 'ALL') => void;
    setFilterModule: (module: string | null) => void;
}

export const useLogStore = create<LogStoreState>((set) => ({
    logs: [],
    isOpen: false,
    filterLevel: 'ALL',
    filterModule: null,

    addLog: (entry) => set((state) => {
        // Strip heavy args to prevent retaining references to large objects
        // (experiment data, parse results, etc.) via the log buffer.
        // Keep only primitive/short string representations.
        const safeEntry: LogEntry = {
            ...entry,
            args: entry.args
                ? entry.args.map(a => {
                    if (a === null || a === undefined) return a;
                    if (typeof a === 'string') return a.length > 200 ? a.slice(0, 200) + '…' : a;
                    if (typeof a === 'number' || typeof a === 'boolean') return a;
                    try {
                        const s = String(a);
                        return s.length > 200 ? s.slice(0, 200) + '…' : s;
                    } catch { return '[unserializable]'; }
                })
                : undefined,
        };
        // Keep last 500 logs (reduced from 1000) to limit retained memory
        const newLogs = [...state.logs, safeEntry];
        while (newLogs.length > 500) {
            newLogs.shift();
        }
        return { logs: newLogs };
    }),

    clearLogs: () => set({ logs: [] }),
    toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
    setFilterLevel: (level) => set({ filterLevel: level }),
    setFilterModule: (module) => set({ filterModule: module }),
}));

// Initialize subscription
// This should be called once at app startup
let isInitialized = false;

export function initializeLogStore() {
    if (isInitialized) return;
    isInitialized = true;

    subscribeToLogs((entry) => {
        useLogStore.getState().addLog(entry);
    });
}
