/* eslint-disable no-console -- This IS the console logging layer */
/**
 * Client-side Logger Helper
 *
 * Logs to the browser console at the appropriate level.
 * Error-level messages are also forwarded to the Tauri plugin-log so they
 * appear in the on-disk app.log file and survive app restarts.
 */

import { isDevelopment } from '@/lib/env';

/** Forward an error message to the Tauri on-disk log (best-effort). */
async function forwardErrorToTauri(text: string): Promise<void> {
    try {
        const { error: tauriError } = await import('@tauri-apps/plugin-log');
        await tauriError(text);
    } catch (_e) {
        // Not running inside Tauri (e.g. unit tests) — ignore
    }
}

export const logger = {
    info: (message: string, ...args: unknown[]) => {
        const text = formatMessage(message, args);
        console.log(text);
    },

    error: (message: string, ...args: unknown[]) => {
        const text = formatMessage(message, args);
        console.error(text);
        void forwardErrorToTauri(text);
    },

    warn: (message: string, ...args: unknown[]) => {
        const text = formatMessage(message, args);
        console.warn(text);
    },

    debug: (message: string, ...args: unknown[]) => {
        // Debug logs only in development
        if (isDevelopment) {
            console.debug(formatMessage(message, args));
        }
    }
};

function formatMessage(message: string, args: unknown[]): string {
    if (args.length === 0) return message;
    try {
        return message + ' ' + args.map(a =>
            a instanceof Error ? (a.stack || a.message) :
                typeof a === 'object' ? JSON.stringify(a) :
                    String(a)
        ).join(' ');
    } catch (_e) {
        return message + ' [Circular/Unserializable]';
    }
}
