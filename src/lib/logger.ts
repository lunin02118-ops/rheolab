/* eslint-disable no-console -- This IS the structured console logging layer */
/**
 * Unified Logger for RheoLab
 *
 * Single logging facade for the whole application.
 *
 * Features:
 * - Log levels (TRACE, DEBUG, INFO, WARN, ERROR)
 * - Module-scoped loggers via `createLogger(module)`
 * - Default `logger` object for general-purpose logging
 * - Production mode suppresses TRACE/DEBUG
 * - Emoji indicators for quick visual scanning
 * - ERROR-level messages forwarded to Tauri plugin-log (on-disk persistence)
 * - Log subscription system for UI display (LogViewer)
 */

import { isProduction } from '@/lib/env';

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LoggerConfig {
    level: LogLevel;
    enabled: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
    TRACE: 0,
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4
};

const LOG_EMOJI: Record<LogLevel, string> = {
    TRACE: '🔬',
    DEBUG: '🔍',
    INFO: '📋',
    WARN: '⚠️',
    ERROR: '❌'
};

// Default config — TRACE/DEBUG in dev, INFO+ in production
let config: LoggerConfig = {
    level: isProduction ? 'INFO' : 'TRACE',
    enabled: true
};

/**
 * Configure the logger
 */
export function configureLogger(newConfig: Partial<LoggerConfig>): void {
    config = { ...config, ...newConfig };
}

/**
 * Get current log level
 */
export function getLogLevel(): LogLevel {
    return config.level;
}

/**
 * Check if a log level should be printed
 */
function shouldLog(level: LogLevel): boolean {
    if (!config.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[config.level];
}

/**
 * Format log message with module prefix
 */
function formatModuleMessage(module: string, message: string, level: LogLevel): string {
    const emoji = LOG_EMOJI[level];
    return `${emoji} [${module}] ${message}`;
}

/**
 * Fold extra args into a single string (for Tauri forwarding / flat output).
 */
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

/** Forward an error message to the Tauri on-disk log (best-effort). */
async function forwardErrorToTauri(text: string): Promise<void> {
    try {
        const { error: tauriError } = await import('@tauri-apps/plugin-log');
        await tauriError(text);
    } catch (_e) {
        // Not running inside Tauri (e.g. unit tests) — ignore
    }
}

/**
 * Create a namespaced logger for a specific module
 */
export function createLogger(module: string) {
    return {
        trace: (message: string, ...args: unknown[]) => {
            if (shouldLog('TRACE')) {
                console.debug(formatModuleMessage(module, message, 'TRACE'), ...args);
                emitLog('TRACE', module, message, args);
            }
        },

        debug: (message: string, ...args: unknown[]) => {
            if (shouldLog('DEBUG')) {
                console.log(formatModuleMessage(module, message, 'DEBUG'), ...args);
                emitLog('DEBUG', module, message, args);
            }
        },

        info: (message: string, ...args: unknown[]) => {
            if (shouldLog('INFO')) {
                console.log(formatModuleMessage(module, message, 'INFO'), ...args);
                emitLog('INFO', module, message, args);
            }
        },

        warn: (message: string, ...args: unknown[]) => {
            if (shouldLog('WARN')) {
                console.warn(formatModuleMessage(module, message, 'WARN'), ...args);
                emitLog('WARN', module, message, args);
            }
        },

        error: (message: string, ...args: unknown[]) => {
            if (shouldLog('ERROR')) {
                const text = formatModuleMessage(module, message, 'ERROR');
                console.error(text, ...args);
                emitLog('ERROR', module, message, args);
                void forwardErrorToTauri(formatMessage(text, args));
            }
        },

        /**
         * Log with custom emoji (for special cases like physics, success, etc.)
         */
        custom: (emoji: string, message: string, ...args: unknown[]) => {
            if (shouldLog('INFO')) {
                console.log(`${emoji} [${module}] ${message}`, ...args);
                emitLog('INFO', module, `${emoji} ${message}`, args);
            }
        }
    };
}

// ---------------------------------------------------------------------------
// Default facade — use when module context is not needed.
//
// Replaces the former `client-logger.ts` and `debug-logger.ts`.
// ERROR-level calls are forwarded to the Tauri on-disk log.
// ---------------------------------------------------------------------------

export const logger = {
    trace: (message: string, ...args: unknown[]) => {
        if (shouldLog('TRACE')) {
            console.debug(formatMessage(message, args));
            emitLog('TRACE', 'App', message, args);
        }
    },

    debug: (message: string, ...args: unknown[]) => {
        if (shouldLog('DEBUG')) {
            console.debug(formatMessage(message, args));
            emitLog('DEBUG', 'App', message, args);
        }
    },

    info: (message: string, ...args: unknown[]) => {
        if (shouldLog('INFO')) {
            console.log(formatMessage(message, args));
            emitLog('INFO', 'App', message, args);
        }
    },

    warn: (message: string, ...args: unknown[]) => {
        if (shouldLog('WARN')) {
            console.warn(formatMessage(message, args));
            emitLog('WARN', 'App', message, args);
        }
    },

    error: (message: string, ...args: unknown[]) => {
        if (shouldLog('ERROR')) {
            const text = formatMessage(message, args);
            console.error(text);
            emitLog('ERROR', 'App', message, args);
            void forwardErrorToTauri(text);
        }
    },
};

// --- Log Subscription System ---

export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    module: string;
    message: string;
    args?: unknown[];
}

type LogListener = (entry: LogEntry) => void;
const listeners: Set<LogListener> = new Set();

export function subscribeToLogs(listener: LogListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function emitLog(level: LogLevel, module: string, message: string, args: unknown[]) {
    const entry: LogEntry = {
        timestamp: Date.now(),
        level,
        module,
        message,
        args: args.length > 0 ? args : undefined
    };
    listeners.forEach(listener => listener(entry));
}
