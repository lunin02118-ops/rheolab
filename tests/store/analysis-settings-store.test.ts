/**
 * Tests for src/lib/store/analysis-settings-store.ts
 * Zustand store with persist middleware for expert rheology settings.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';

const DEFAULT_EXPERT = {
    pointsToAverage: 0,
    viscosityShearRates: [40, 100, 170],
    stepSplitting: true,
    splitStartDuration: 30,
    splitEndDuration: 30,
    minDurationForSplit: 90,
    aiModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    forceAiParsing: false,
    timeShiftEnabled: false,
};

describe('useAnalysisSettingsStore', () => {
    beforeEach(() => {
        useAnalysisSettingsStore.getState().resetToDefaults();
    });

    // ── Default state ────────────────────────────────────────────────────

    describe('default state', () => {
        it('has pointsToAverage=0 by default', () => {
            expect(useAnalysisSettingsStore.getState().expertSettings.pointsToAverage).toBe(0);
        });

        it('has default viscosityShearRates [40, 100, 170]', () => {
            expect(useAnalysisSettingsStore.getState().expertSettings.viscosityShearRates).toEqual([40, 100, 170]);
        });

        it('has stepSplitting=true by default', () => {
            expect(useAnalysisSettingsStore.getState().expertSettings.stepSplitting).toBe(true);
        });

        it('has forceAiParsing=false by default', () => {
            expect(useAnalysisSettingsStore.getState().expertSettings.forceAiParsing).toBe(false);
        });

        it('has timeShiftEnabled=false by default', () => {
            expect(useAnalysisSettingsStore.getState().expertSettings.timeShiftEnabled).toBe(false);
        });

        it('has splitStartDuration=30 by default', () => {
            expect(useAnalysisSettingsStore.getState().expertSettings.splitStartDuration).toBe(30);
        });

        it('has minDurationForSplit=90 by default', () => {
            expect(useAnalysisSettingsStore.getState().expertSettings.minDurationForSplit).toBe(90);
        });
    });

    // ── setExpertSettings ────────────────────────────────────────────────

    describe('setExpertSettings', () => {
        it('updates single field without touching others', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ pointsToAverage: 5 });
            const s = useAnalysisSettingsStore.getState().expertSettings;
            expect(s.pointsToAverage).toBe(5);
        });

        it('toggles stepSplitting to false', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ stepSplitting: false });
            expect(useAnalysisSettingsStore.getState().expertSettings.stepSplitting).toBe(false);
        });

        it('sets viscosityShearRates to custom array', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ viscosityShearRates: [6, 100, 300] });
            expect(useAnalysisSettingsStore.getState().expertSettings.viscosityShearRates).toEqual([6, 100, 300]);
        });

        it('falls back to default shear rates for empty array', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ viscosityShearRates: [] });
            // empty array → default rates
            expect(useAnalysisSettingsStore.getState().expertSettings.viscosityShearRates).toEqual([40, 100, 170]);
        });

        it('filters out NaN values from viscosityShearRates', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ viscosityShearRates: [40, NaN, 170] });
            const rates = useAnalysisSettingsStore.getState().expertSettings.viscosityShearRates;
            expect(rates).not.toContain(NaN);
        });

        it('clamps negative pointsToAverage to 0', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ pointsToAverage: -5 });
            expect(useAnalysisSettingsStore.getState().expertSettings.pointsToAverage).toBe(0);
        });

        it('clamps negative splitStartDuration to 0', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ splitStartDuration: -10 });
            expect(useAnalysisSettingsStore.getState().expertSettings.splitStartDuration).toBe(0);
        });

        it('enables forceAiParsing', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ forceAiParsing: true });
            expect(useAnalysisSettingsStore.getState().expertSettings.forceAiParsing).toBe(true);
        });

        it('trims and sets aiModel', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ aiModel: '  my-model  ' });
            expect(useAnalysisSettingsStore.getState().expertSettings.aiModel).toBe('my-model');
        });

        it('falls back to default aiModel for empty string', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ aiModel: '   ' });
            expect(useAnalysisSettingsStore.getState().expertSettings.aiModel).toBe(DEFAULT_EXPERT.aiModel);
        });
    });

    // ── resetToDefaults ──────────────────────────────────────────────────

    describe('resetToDefaults', () => {
        it('restores all fields to defaults after changes', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({
                pointsToAverage: 10,
                stepSplitting: false,
            });
            useAnalysisSettingsStore.getState().resetToDefaults();
            const s = useAnalysisSettingsStore.getState().expertSettings;
            expect(s.pointsToAverage).toBe(0);
            expect(s.stepSplitting).toBe(true);
        });

        it('restores viscosityShearRates to [40, 100, 170]', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ viscosityShearRates: [6, 100] });
            useAnalysisSettingsStore.getState().resetToDefaults();
            expect(useAnalysisSettingsStore.getState().expertSettings.viscosityShearRates).toEqual([40, 100, 170]);
        });
    });
});
