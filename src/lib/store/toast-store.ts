/**
 * toast-store.ts
 * Zustand micro-store for application-wide toast notifications.
 * Replaces per-component useState + useEffect timer patterns.
 */

import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
    id: string;
    message: string;
    type: ToastType;
    /** Duration in ms before auto-dismiss. Defaults to 4000. */
    duration: number;
}

interface ToastStoreState {
    toasts: Toast[];
    add: (message: string, type: ToastType, duration?: number) => void;
    remove: (id: string) => void;
    clear: () => void;
}

let _counter = 0;
const _timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStoreState>((set) => ({
    toasts: [],

    add: (message, type, duration = 4000) => {
        const id = `toast-${++_counter}`;
        set((state) => ({ toasts: [...state.toasts, { id, message, type, duration }] }));
        // Auto-dismiss after `duration` ms
        const timer = setTimeout(() => {
            _timers.delete(id);
            set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
        }, duration);
        _timers.set(id, timer);
    },

    remove: (id) => {
        const timer = _timers.get(id);
        if (timer) { clearTimeout(timer); _timers.delete(id); }
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    },

    clear: () => {
        _timers.forEach((timer) => clearTimeout(timer));
        _timers.clear();
        set({ toasts: [] });
    },
}));
