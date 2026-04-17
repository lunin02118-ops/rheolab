/* eslint-disable no-console -- This IS the structured console logging layer */
/**
 * Structured Logger for RheoLab
 * Replaces console.log with level-based logging
 * 
 * Features:
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - Automatic prefix with module name
 * - Production mode suppresses DEBUG logs
 * - Emoji indicators for quick visual scanning
 */

import { isProduction } from '@/lib/env';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LoggerConfig {
    level: LogLevel;
    enabled: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const LOG_EMOJI: Record<LogLevel, string> = {
    DEBUG: '🔍',
    INFO: '📋',
    WARN: '⚠️',
    ERROR: '❌'
};

// Default config - can be overridden
let config: LoggerConfig = {
    level: isProduction ? 'INFO' : 'DEBUG',
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
function formatMessage(module: string, message: string, level: LogLevel): string {
    const emoji = LOG_EMOJI[level];
    return `${emoji} [${module}] ${message}`;
}

/**
 * Create a namespaced logger for a specific module
 */
export function createLogger(module: string) {
    return {
        debug: (message: string, ...args: unknown[]) => {
            if (shouldLog('DEBUG')) {
                console.log(formatMessage(module, message, 'DEBUG'), ...args);
                emitLog('DEBUG', module, message, args);
            }
        },

        info: (message: string, ...args: unknown[]) => {
            if (shouldLog('INFO')) {
                console.log(formatMessage(module, message, 'INFO'), ...args);
                emitLog('INFO', module, message, args);
            }
        },

        warn: (message: string, ...args: unknown[]) => {
            if (shouldLog('WARN')) {
                console.warn(formatMessage(module, message, 'WARN'), ...args);
                emitLog('WARN', module, message, args);
            }
        },

        error: (message: string, ...args: unknown[]) => {
            if (shouldLog('ERROR')) {
                console.error(formatMessage(module, message, 'ERROR'), ...args);
                emitLog('ERROR', module, message, args);
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

// Pre-configured loggers for common modules
export const logger = {
    parser: createLogger('RheoParser'),
    physics: createLogger('PhysicsEngine'),
    instrument: createLogger('InstrumentDetector'),
    geometry: createLogger('GeometryVerifier'),
    header: createLogger('HeaderDetector'),
    sheet: createLogger('SheetScanner'),
    ai: createLogger('AI Client'),
    aiMapper: createLogger('AIColumnMapper'),
    sst: createLogger('SST Detector'),
    pattern: createLogger('PatternDetector'),
    cycle: createLogger('CycleProcessor'),
    api: createLogger('API'),
    // Additional loggers for server-side modules
    secureStorage: createLogger('SecureStorage'),
    machineId: createLogger('MachineID'),
    licensing: createLogger('Licensing'),
    testFixtures: createLogger('TestFixtures'),
    reagents: createLogger('Reagents'),
    apiKeys: createLogger('APIKeys'),
    database: createLogger('Database'),
    auth: createLogger('Auth'),
    admin: createLogger('Admin'),
    experiments: createLogger('Experiments'),
    diagnostics: createLogger('Diagnostics'),
    waterSources: createLogger('WaterSources'),
    importExport: createLogger('ImportExport'),
    app: createLogger('App')
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
