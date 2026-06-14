// @vitest-environment jsdom
/**
 * Tests for src/lib/store/analysis-settings-store.ts
 * Zustand store with persist middleware for expert rheology settings.
 *
 * Runs under jsdom because the persist roundtrip suite needs a real
 * `localStorage` implementation (Zustand's persist middleware is a no-op
 * under plain Node, which would silently make every "survives restart"
 * assertion green).
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
    externalAiEnabled: false,
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

        it('has externalAiEnabled=false by default', () => {
            expect(useAnalysisSettingsStore.getState().expertSettings.externalAiEnabled).toBe(false);
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

        it('does not enable forceAiParsing without external AI opt-in', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({ forceAiParsing: true });
            expect(useAnalysisSettingsStore.getState().expertSettings.forceAiParsing).toBe(false);
        });

        it('enables forceAiParsing after external AI opt-in', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({
                externalAiEnabled: true,
                forceAiParsing: true,
            });
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

    // ── persist roundtrip ────────────────────────────────────────────────
    //
    // The maintainer reported that the expert-mode "Настройки расчёта"
    // panel (points-to-average + viscosity shear rates) does not survive
    // an app restart. The store is wired through Zustand's `persist`
    // middleware (storage key: rheolab-analysis-settings), so these tests
    // pin the contract that:
    //   1. setExpertSettings writes the post-sanitisation state to
    //      localStorage immediately (no debounce, no async race).
    //   2. The persisted JSON has the expected `{ state, version }` shape
    //      so the merge() callback can find it on rehydrate.
    //   3. persist.rehydrate() round-trips the persisted values back into
    //      the live store, including user-added shear rates outside the
    //      [40,100,170] default trio (regression for the η@220 bug from
    //      alpha.6 — same root cause class).
    //   4. Stale / corrupt data falls back to defaults via
    //      sanitizeExpertSettings instead of crashing the store.

    describe('persist roundtrip (survives app restart)', () => {
        const STORAGE_KEY = 'rheolab-analysis-settings';

        it('writes setExpertSettings updates to localStorage synchronously', () => {
            useAnalysisSettingsStore.getState().setExpertSettings({
                pointsToAverage: 7,
                viscosityShearRates: [40, 100, 170, 220],
            });

            const raw = localStorage.getItem(STORAGE_KEY);
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!) as { state: { expertSettings: typeof DEFAULT_EXPERT } };
            expect(parsed.state.expertSettings.pointsToAverage).toBe(7);
            expect(parsed.state.expertSettings.viscosityShearRates).toEqual([40, 100, 170, 220]);
        });

        it('rehydrates user-customised settings (incl. extra shear rates) from localStorage', async () => {
            // Write directly to localStorage to simulate the persisted blob
            // an earlier app session would have left behind. Going through
            // setExpertSettings/setState here would route through the
            // `persist` middleware, which means any subsequent in-memory
            // wipe also overwrites the storage entry — defeating the
            // round-trip we're trying to verify.
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                state: {
                    expertSettings: {
                        ...DEFAULT_EXPERT,
                        pointsToAverage: 15,
                        viscosityShearRates: [40, 100, 170, 220, 500],
                        stepSplitting: false,
                        splitStartDuration: 12,
                    },
                },
                version: 0,
            }));

            await useAnalysisSettingsStore.persist.rehydrate();

            const s = useAnalysisSettingsStore.getState().expertSettings;
            expect(s.pointsToAverage).toBe(15);
            expect(s.viscosityShearRates).toEqual([40, 100, 170, 220, 500]);
            expect(s.stepSplitting).toBe(false);
            expect(s.splitStartDuration).toBe(12);
        });

        it('falls back to defaults when persisted blob is corrupt JSON', async () => {
            localStorage.setItem(STORAGE_KEY, '{not valid json');
            await useAnalysisSettingsStore.persist.rehydrate();

            const s = useAnalysisSettingsStore.getState().expertSettings;
            // Corrupt blob → Zustand drops it, store falls back to the
            // DEFAULT_SETTINGS that the initial state used.
            expect(s.pointsToAverage).toBe(0);
            expect(s.viscosityShearRates).toEqual([40, 100, 170]);
        });

        it('sanitises legacy persisted state with missing fields', async () => {
            // Mimic an old install that persisted only points/rates and
            // never knew about stepSplitting / aiModel: the merge()
            // callback must hand the partial state to sanitizeExpertSettings,
            // which back-fills every default that was never stored.
            const legacy = {
                state: {
                    expertSettings: {
                        pointsToAverage: 3,
                        viscosityShearRates: [40, 100, 170, 220],
                    },
                },
                version: 0,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
            await useAnalysisSettingsStore.persist.rehydrate();

            const s = useAnalysisSettingsStore.getState().expertSettings;
            expect(s.pointsToAverage).toBe(3);
            expect(s.viscosityShearRates).toEqual([40, 100, 170, 220]);
            expect(s.stepSplitting).toBe(true);
            expect(s.aiModel).toBe(DEFAULT_EXPERT.aiModel);
            expect(s.externalAiEnabled).toBe(false);
            expect(s.forceAiParsing).toBe(false);
            expect(s.timeShiftEnabled).toBe(false);
        });
    });
});
