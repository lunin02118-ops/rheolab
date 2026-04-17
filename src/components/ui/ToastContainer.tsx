/**
 * ToastContainer.tsx
 * Global toast renderer — mount once at the app root (DashboardLayoutClient).
 * Reads from useToastStore; each Toast is animated and auto-dismissed.
 */

import { type ReactNode } from 'react';
import { useToastStore } from '@/lib/store/toast-store';

const TYPE_STYLES: Record<string, string> = {
    success: 'bg-emerald-500/90 border-emerald-400 text-foreground',
    error:   'bg-red-500/90 border-red-400 text-foreground',
    warning: 'bg-amber-500/90 border-amber-400 text-foreground',
    info:    'bg-blue-500/90 border-blue-400 text-foreground',
};

const TYPE_ICONS: Record<string, ReactNode> = {
    success: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
    ),
    error: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
    ),
    warning: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
    ),
    info: (
        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12A9 9 0 113 12a9 9 0 0118 0z" />
        </svg>
    ),
};

export function ToastContainer() {
    const toasts = useToastStore((state) => state.toasts);
    const remove = useToastStore((state) => state.remove);

    if (toasts.length === 0) return null;

    return (
        <div
            className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
            aria-live="polite"
        >
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border 
                        animate-slide-in pointer-events-auto
                        ${TYPE_STYLES[toast.type] ?? TYPE_STYLES.info}`}
                >
                    {TYPE_ICONS[toast.type]}
                    <span className="font-medium text-sm flex-1">{toast.message}</span>
                    <button
                        onClick={() => remove(toast.id)}
                        className="ml-2 opacity-70 hover:opacity-100 transition-opacity shrink-0"
                        aria-label="Закрыть"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            ))}
        </div>
    );
}
