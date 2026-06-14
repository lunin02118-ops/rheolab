/**
 * Analysis Settings Store
 * Global settings for rheology calculations (Zustand)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toFiniteNumber } from '@/lib/utils/numbers';
import { DEFAULT_VISCOSITY_SHEAR_RATES } from '@/lib/analysis/constants';

export interface ExpertSettings {
    pointsToAverage: number;      // 0 = All, N > 0 = Last N points
    viscosityShearRates: number[];

    // Step splitting options
    stepSplitting: boolean;
    splitStartDuration: number;
    splitEndDuration: number;
    minDurationForSplit: number;

    // AI Configuration
    aiModel: string;
    externalAiEnabled: boolean;
    forceAiParsing: boolean;

    // Display Configuration
    timeShiftEnabled: boolean;
}

interface AnalysisSettingsState {
    expertSettings: ExpertSettings;
    setExpertSettings: (settings: Partial<ExpertSettings>) => void;
    resetToDefaults: () => void;
}

const DEFAULT_SETTINGS: ExpertSettings = {
    pointsToAverage: 0,           // All points
    viscosityShearRates: [40, 100, 170],
    stepSplitting: true,          // Enable by default
    splitStartDuration: 30,       // 30 sec start
    splitEndDuration: 30,         // 30 sec end
    minDurationForSplit: 90,      // Only split steps >90s

    // AI Configuration
    aiModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    externalAiEnabled: false,
    forceAiParsing: false,

    // Display Configuration
    timeShiftEnabled: false,
};

function normalizeViscosityShearRates(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return [...DEFAULT_VISCOSITY_SHEAR_RATES];
    }

    // Allow zero values during editing — only filter out NaN/Infinity/negative
    const normalized = value
        .map((rate) => toFiniteNumber(rate, NaN))
        .filter((rate) => Number.isFinite(rate) && rate >= 0);

    return normalized.length > 0 ? normalized : [...DEFAULT_VISCOSITY_SHEAR_RATES];
}

function sanitizeExpertSettings(value: unknown): ExpertSettings {
    const raw = (value ?? {}) as Partial<ExpertSettings>;
    const externalAiEnabled = typeof raw.externalAiEnabled === 'boolean'
        ? raw.externalAiEnabled
        : DEFAULT_SETTINGS.externalAiEnabled;

    return {
        pointsToAverage: Math.max(0, Math.round(toFiniteNumber(raw.pointsToAverage, DEFAULT_SETTINGS.pointsToAverage))),
        viscosityShearRates: normalizeViscosityShearRates(raw.viscosityShearRates),
        stepSplitting: typeof raw.stepSplitting === 'boolean' ? raw.stepSplitting : DEFAULT_SETTINGS.stepSplitting,
        splitStartDuration: Math.max(0, toFiniteNumber(raw.splitStartDuration, DEFAULT_SETTINGS.splitStartDuration)),
        splitEndDuration: Math.max(0, toFiniteNumber(raw.splitEndDuration, DEFAULT_SETTINGS.splitEndDuration)),
        minDurationForSplit: Math.max(0, toFiniteNumber(raw.minDurationForSplit, DEFAULT_SETTINGS.minDurationForSplit)),
        aiModel: typeof raw.aiModel === 'string' && raw.aiModel.trim().length > 0
            ? raw.aiModel.trim()
            : DEFAULT_SETTINGS.aiModel,
        externalAiEnabled,
        forceAiParsing: externalAiEnabled && typeof raw.forceAiParsing === 'boolean'
            ? raw.forceAiParsing
            : DEFAULT_SETTINGS.forceAiParsing,
        timeShiftEnabled: typeof raw.timeShiftEnabled === 'boolean'
            ? raw.timeShiftEnabled
            : DEFAULT_SETTINGS.timeShiftEnabled,
    };
}

export const useAnalysisSettingsStore = create<AnalysisSettingsState>()(
    persist(
        (set) => ({
            expertSettings: sanitizeExpertSettings(DEFAULT_SETTINGS),

            setExpertSettings: (newSettings) =>
                set((state) => ({
                    expertSettings: sanitizeExpertSettings({ ...state.expertSettings, ...newSettings }),
                })),

            resetToDefaults: () =>
                set({ expertSettings: sanitizeExpertSettings(DEFAULT_SETTINGS) }),
        }),
        {
            name: 'rheolab-analysis-settings',
            merge: (persistedState, currentState) => {
                const persistedRoot = (persistedState ?? {}) as { state?: Partial<AnalysisSettingsState> } & Partial<AnalysisSettingsState>;
                const persisted = persistedRoot.state ?? persistedRoot;
                return {
                    ...currentState,
                    ...persisted,
                    expertSettings: sanitizeExpertSettings(persisted.expertSettings),
                };
            },
        }
    )
);
