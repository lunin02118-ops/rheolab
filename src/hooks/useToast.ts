/**
 * useToast.ts
 * Convenience hook for showing toast notifications.
 *
 * Usage:
 *   const { showToast } = useToast();
 *   showToast('Saved!', 'success');
 *   showToast('Failed to save', 'error', 6000);
 */

import { useToastStore } from '@/lib/store/toast-store';
import type { ToastType } from '@/lib/store/toast-store';

export interface UseToastResult {
    /** Show a toast. Duration defaults to 4000 ms for success/info, 5000 ms for error/warning. */
    showToast: (message: string, type?: ToastType, duration?: number) => void;
}

export function useToast(): UseToastResult {
    const add = useToastStore((s) => s.add);

    const showToast = (
        message: string,
        type: ToastType = 'success',
        duration?: number,
    ) => {
        const defaultDuration = type === 'error' || type === 'warning' ? 5000 : 4000;
        add(message, type, duration ?? defaultDuration);
    };

    return { showToast };
}
