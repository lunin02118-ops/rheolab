/**
 * PerfMon — thin wrapper around the W3C Performance API.
 *
 * Marks and measures are stored in the browser's PerformanceTimeline.
 * Overhead is negligible (~100 ns per call), safe in production.
 *
 * Playwright tests read results via:
 *   page.evaluate(() => window.__perfMon.list())
 */

export interface PerfMeasure {
    name: string;
    duration: number;
    startTime: number;
}

function tryMark(name: string): void {
    try { performance.mark(name); } catch (_e) { /* SSR / node context */ }
}

export const PerfMon = {
    /** Place a named timestamp on the timeline. */
    mark(name: string): void {
        tryMark(name);
    },

    /** Measure elapsed time between startMark and endMark. */
    measure(label: string, startMark: string, endMark: string): void {
        try {
            performance.measure(label, startMark, endMark);
        } catch (_e) {
            // marks not placed (e.g. path skipped) — ignore
        }
    },

    /**
     * Convenience: mark `name:end`, auto-measure against `name:start`,
     * then return the measured duration in ms (or NaN if marks missing).
     */
    end(name: string): number {
        tryMark(`${name}:end`);
        try {
            performance.measure(name, `${name}:start`, `${name}:end`);
            const entries = performance.getEntriesByName(name, 'measure');
            return entries.length > 0 ? entries[entries.length - 1].duration : NaN;
        } catch (_e) {
            return NaN;
        }
    },

    /** Return all measures as plain objects (safe for structuredClone / JSON). */
    list(): PerfMeasure[] {
        try {
            return performance.getEntriesByType('measure').map(e => ({
                name: e.name,
                duration: Math.round(e.duration * 100) / 100,
                startTime: Math.round(e.startTime * 100) / 100,
            }));
        } catch (_e) {
            return [];
        }
    },

    /** Return a single measure by name (latest occurrence), or null. */
    get(name: string): PerfMeasure | null {
        try {
            const entries = performance.getEntriesByName(name, 'measure');
            if (!entries.length) return null;
            const e = entries[entries.length - 1];
            return { name: e.name, duration: Math.round(e.duration * 100) / 100, startTime: Math.round(e.startTime * 100) / 100 };
        } catch (_e) {
            return null;
        }
    },

    /** Clear all marks and measures — call at the start of each benchmark scenario. */
    reset(): void {
        try {
            performance.clearMarks();
            performance.clearMeasures();
        } catch (_e) { /* ignore */ }
    },
};

// Expose globally so Playwright's page.evaluate() can reach it without imports.
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__perfMon = PerfMon;
}
