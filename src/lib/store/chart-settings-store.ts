/**
 * Chart Settings Store
 * Global settings for chart visualization (Zustand with persist)
 * Each curve has individual color, width and style settings
 *
 * Types and defaults live in separate modules; re-exported here for
 * backward-compatible imports from '@/lib/store/chart-settings-store'.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { logger } from '@/lib/logger';

// Re-export types and defaults for backward compatibility
export type {
    LineWidth,
    LineStyle,
    LineAxis,
    DownsampleMode,
    ComparisonAxisMode,
    LineSettings,
    ChartLineSettings,
    ChartPrecision,
    ChartSettings,
} from './chart-settings-types';
export {
    DEFAULT_LINE_SETTINGS,
    DEFAULT_REPORT_LINE_SETTINGS,
    DEFAULT_CHART_SETTINGS,
    DEFAULT_REPORT_SETTINGS,
} from './chart-settings-defaults';

import type {
    LineWidth,
    LineStyle,
    LineSettings,
    ChartLineSettings,
    ChartPrecision,
    ChartSettings,
} from './chart-settings-types';
import {
    DEFAULT_LINE_SETTINGS,
    DEFAULT_REPORT_LINE_SETTINGS,
    DEFAULT_CHART_SETTINGS,
    DEFAULT_REPORT_SETTINGS,
} from './chart-settings-defaults';

// === Line Key Type ===
export type LineKey = keyof ChartLineSettings;

// === Store State Interface ===
interface ChartSettingsState {
    settings: ChartSettings;
    reportSettings: ChartSettings;
    
    // Display settings methods
    setSettings: (settings: Partial<ChartSettings>) => void;
    setLineSettings: (lineKey: LineKey, lineSettings: Partial<LineSettings>) => void;
    setPrecision: (precision: Partial<ChartPrecision>) => void;
    resetToDefaults: () => void;
    
    // Report settings methods
    setReportSettings: (settings: Partial<ChartSettings>) => void;
    setReportLineSettings: (lineKey: LineKey, lineSettings: Partial<LineSettings>) => void;
    setReportPrecision: (precision: Partial<ChartPrecision>) => void;
    resetReportToDefaults: () => void;
    copyDisplayToReport: () => void;
    
    // Export/Import
    exportSettings: () => string;
    importSettings: (json: string) => boolean;
}

// === Debounced localStorage adapter ===
// Chart settings are read on every zoom/pan event; without debouncing, every
// state update would synchronously serialize and write ~5 KB to localStorage.
// 500 ms debounce coalesces rapid successive writes into a single flush.
function makeDebouncedStorage(delayMs = 500) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return {
        getItem: (name: string) => localStorage.getItem(name),
        setItem: (name: string, value: string) => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => localStorage.setItem(name, value), delayMs);
        },
        removeItem: (name: string) => localStorage.removeItem(name),
    };
}

/** JSON storage with a 500 ms write debounce — prevents flooding localStorage on every zoom event. */
const debouncedJsonStorage = createJSONStorage(() => makeDebouncedStorage(500));

// === Store Implementation ===
export const useChartSettingsStore = create<ChartSettingsState>()(
    persist(
        (set, get) => ({
            settings: { ...DEFAULT_CHART_SETTINGS },
            reportSettings: { ...DEFAULT_REPORT_SETTINGS },

            // === Display Settings Methods ===
            setSettings: (newSettings) =>
                set((state) => ({
                    settings: { ...state.settings, ...newSettings },
                })),

            setLineSettings: (lineKey, lineSettings) =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        lines: {
                            ...state.settings.lines,
                            [lineKey]: { ...state.settings.lines[lineKey], ...lineSettings },
                        },
                    },
                })),

            setPrecision: (precision) =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        precision: { ...state.settings.precision, ...precision },
                    },
                })),

            resetToDefaults: () =>
                set({ settings: structuredClone(DEFAULT_CHART_SETTINGS) }),

            // === Report Settings Methods ===
            setReportSettings: (newSettings) =>
                set((state) => ({
                    reportSettings: { ...state.reportSettings, ...newSettings },
                })),

            setReportLineSettings: (lineKey, lineSettings) =>
                set((state) => ({
                    reportSettings: {
                        ...state.reportSettings,
                        lines: {
                            ...state.reportSettings.lines,
                            [lineKey]: { ...state.reportSettings.lines[lineKey], ...lineSettings },
                        },
                    },
                })),

            setReportPrecision: (precision) =>
                set((state) => ({
                    reportSettings: {
                        ...state.reportSettings,
                        precision: { ...state.reportSettings.precision, ...precision },
                    },
                })),

            resetReportToDefaults: () =>
                set({ reportSettings: structuredClone(DEFAULT_REPORT_SETTINGS) }),

            copyDisplayToReport: () =>
                set((state) => ({
                    reportSettings: { 
                        ...structuredClone(state.settings),
                        animationsEnabled: false,
                        tooltipEnabled: false,
                    },
                })),

            // === Export/Import ===
            exportSettings: () => {
                const { settings, reportSettings } = get();
                return JSON.stringify({ display: settings, report: reportSettings }, null, 2);
            },

            importSettings: (json: string) => {
                try {
                    const parsed = JSON.parse(json);
                    
                    if (parsed.display && parsed.report) {
                        set({
                            settings: {
                                ...DEFAULT_CHART_SETTINGS,
                                ...parsed.display,
                                lines: { ...DEFAULT_LINE_SETTINGS, ...parsed.display.lines },
                                precision: { ...DEFAULT_CHART_SETTINGS.precision, ...parsed.display.precision },
                            },
                            reportSettings: {
                                ...DEFAULT_REPORT_SETTINGS,
                                ...parsed.report,
                                lines: { ...DEFAULT_REPORT_LINE_SETTINGS, ...parsed.report.lines },
                                precision: { ...DEFAULT_REPORT_SETTINGS.precision, ...parsed.report.precision },
                            },
                        });
                    } else if (parsed.lines && parsed.precision) {
                        // Old format - apply to display settings only
                        set({
                            settings: {
                                ...DEFAULT_CHART_SETTINGS,
                                ...parsed,
                                lines: { ...DEFAULT_LINE_SETTINGS, ...parsed.lines },
                                precision: { ...DEFAULT_CHART_SETTINGS.precision, ...parsed.precision },
                            },
                        });
                    } else {
                        console.error('Invalid chart settings format');
                        return false;
                    }
                    
                    return true;
                } catch (e) {
                    console.error('Failed to import chart settings:', e);
                    return false;
                }
            },
        }),
        {
            name: 'rheolab-chart-settings',
            storage: debouncedJsonStorage,
            version: 7, // Increment when structure changes
            // merge is called on every hydration — guarantees all default keys
            // (e.g. bathTemperature) are present even in old persisted states.
            merge: (persisted, current) => {
                const p = (persisted ?? {}) as Record<string, unknown>;
                const pSettings = (p.settings ?? {}) as Record<string, unknown>;
                const pReport  = (p.reportSettings ?? {}) as Record<string, unknown>;
                return {
                    ...current,
                    ...p,
                    settings: {
                        ...current.settings,
                        ...pSettings,
                        lines: {
                            ...DEFAULT_LINE_SETTINGS,
                            ...((pSettings.lines ?? {}) as object),
                        },
                    },
                    reportSettings: {
                        ...current.reportSettings,
                        ...pReport,
                        // Always enforce report-only fields regardless of persisted value
                        tooltipEnabled: false,
                        animationsEnabled: false,
                        lines: {
                            ...DEFAULT_REPORT_LINE_SETTINGS,
                            ...((pReport.lines ?? {}) as object),
                        },
                    },
                };
            },
            migrate: (persistedState: unknown, version: number) => {
                const state = persistedState as Record<string, unknown>;

                // Migration to v7: set reportSettings.lines.shearRate.axis to 'right'
                // (default was 'left', but Rust PDF renderer always puts shear rate on right
                // in individual mode — preview and PDF must match)
                if (version < 7) {
                    const r = state?.reportSettings as Record<string, unknown> | undefined;
                    const rLines = r?.lines as Record<string, unknown> | undefined;
                    const rShearRate = rLines?.shearRate as Record<string, unknown> | undefined;
                    if (rShearRate && rShearRate.axis === 'left') {
                        rShearRate.axis = 'right';
                    }
                }

                // Migration to v6: add bathTemperature to existing line settings
                if (version < 6) {
                    const s = state?.settings as Record<string, unknown> | undefined;
                    const r = state?.reportSettings as Record<string, unknown> | undefined;
                    const sLines = s?.lines as Record<string, unknown> | undefined;
                    const rLines = r?.lines as Record<string, unknown> | undefined;
                    if (sLines && !('bathTemperature' in sLines)) {
                        sLines.bathTemperature = { ...DEFAULT_LINE_SETTINGS.bathTemperature };
                    }
                    if (rLines && !('bathTemperature' in rLines)) {
                        rLines.bathTemperature = { ...DEFAULT_REPORT_LINE_SETTINGS.bathTemperature };
                    }
                }

                // Migration to v5: reset comparisonAxisMode to 'individual' (new default) if still at v4 default
                if (version < 5) {
                    const s = state?.settings as Record<string, unknown> | undefined;
                    const r = state?.reportSettings as Record<string, unknown> | undefined;
                    // Only reset if not explicitly customised (v4 set 'shared' as migration default)
                    if (s && s.comparisonAxisMode === 'shared') s.comparisonAxisMode = 'individual';
                    if (r && r.comparisonAxisMode === 'shared') r.comparisonAxisMode = 'individual';
                }

                // Migration to v4: add comparisonAxisMode to existing settings
                if (version < 4) {
                    const s = state?.settings as Record<string, unknown> | undefined;
                    const r = state?.reportSettings as Record<string, unknown> | undefined;
                    if (s && !('comparisonAxisMode' in s)) {
                        s.comparisonAxisMode = 'shared';
                    }
                    if (r && !('comparisonAxisMode' in r)) {
                        r.comparisonAxisMode = 'shared';
                    }
                }

                // Migration to v3: add downsampleMode to existing settings
                if (version < 3) {
                    const s = state?.settings as Record<string, unknown> | undefined;
                    const r = state?.reportSettings as Record<string, unknown> | undefined;
                    if (s && !('downsampleMode' in s)) {
                        s.downsampleMode = 'smart';
                    }
                    if (r && !('downsampleMode' in r)) {
                        r.downsampleMode = 'off';
                    }
                }

                // Migration from v1 (old format with colors/visibility) to v2 (lines)
                if (version < 2) {
                    logger.debug('[ChartSettings] Migrating from v1 to v2...');
                    
                    // Check if old format exists
                    const oldSettings = state?.settings as Record<string, unknown> | undefined;
                    
                    // If old format has 'colors' instead of 'lines', migrate
                    if (oldSettings && 'colors' in oldSettings && !('lines' in oldSettings)) {
                        const oldColors = oldSettings.colors as Record<string, string> | undefined;
                        const oldVisibility = oldSettings.visibility as Record<string, boolean> | undefined;
                        
                        // Create new lines structure from old format
                        const newLines: ChartLineSettings = {
                            viscosity: {
                                color: oldColors?.viscosity || DEFAULT_LINE_SETTINGS.viscosity.color,
                                width: (oldSettings.lineWidth as LineWidth) || 2,
                                style: (oldSettings.lineStyle as LineStyle) || 'solid',
                                visible: true,
                                axis: 'left',
                            },
                            temperature: {
                                color: oldColors?.temperature || DEFAULT_LINE_SETTINGS.temperature.color,
                                width: (oldSettings.lineWidth as LineWidth) || 2,
                                style: (oldSettings.lineStyle as LineStyle) || 'solid',
                                visible: oldVisibility?.temperature ?? true,
                                axis: 'right',
                            },
                            shearRate: {
                                color: oldColors?.shearRate || DEFAULT_LINE_SETTINGS.shearRate.color,
                                width: (oldSettings.lineWidth as LineWidth) || 2,
                                style: (oldSettings.lineStyle as LineStyle) || 'solid',
                                visible: oldVisibility?.shearRate ?? true,
                                axis: 'left',
                            },
                            pressure: {
                                color: oldColors?.pressure || DEFAULT_LINE_SETTINGS.pressure.color,
                                width: (oldSettings.lineWidth as LineWidth) || 2,
                                style: (oldSettings.lineStyle as LineStyle) || 'solid',
                                visible: oldVisibility?.pressure ?? false,
                                axis: 'right',
                            },
                            rpm: {
                                color: oldColors?.rpm || DEFAULT_LINE_SETTINGS.rpm.color,
                                width: (oldSettings.lineWidth as LineWidth) || 2,
                                style: (oldSettings.lineStyle as LineStyle) || 'solid',
                                visible: oldVisibility?.rpm ?? false,
                                axis: 'left',
                            },
                            // bathTemperature was not in v1 — use the default settings
                            bathTemperature: { ...DEFAULT_LINE_SETTINGS.bathTemperature },
                        };
                        
                        return {
                            settings: {
                                ...DEFAULT_CHART_SETTINGS,
                                lines: newLines,
                                precision: oldSettings.precision || DEFAULT_CHART_SETTINGS.precision,
                                showGridLines: oldSettings.showGridLines ?? true,
                                gridOpacity: oldSettings.gridOpacity ?? 0.5,
                                animationsEnabled: oldSettings.animationsEnabled ?? true,
                                tooltipEnabled: oldSettings.tooltipEnabled ?? true,
                            },
                            reportSettings: DEFAULT_REPORT_SETTINGS,
                        };
                    }
                    
                    // If completely broken, return defaults
                    if (!oldSettings?.lines) {
                        return {
                            settings: DEFAULT_CHART_SETTINGS,
                            reportSettings: DEFAULT_REPORT_SETTINGS,
                        };
                    }
                }
                
                return state;
            },
        }
    )
);

// === Helper: Get stroke dasharray for line style ===
export function getStrokeDasharray(style: LineStyle): string | undefined {
    switch (style) {
        case 'dashed':
            return '5 5';
        case 'dotted':
            return '2 2';
        default:
            return undefined;
    }
}

// === Helper: Format value with precision ===
export function formatWithPrecision(value: number | undefined, precision: number): string {
    if (value === undefined || value === null) return '—';
    if (value === 0) return (0).toFixed(precision);
    return value.toFixed(precision);
}
