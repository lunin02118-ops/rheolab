/**
 * Unit tests for comparison-store:
 * - _hasHydrated flag behaviour (regression guard for the
 *   "blank comparison page on navigation" bug)
 * - addExperiment / removeExperiment / clear
 * - displaySettings persistence helpers
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ─── Mock heavy dependencies before importing the store ──────────────────────

// Tauri IPC is unavailable in node — mock the experiments client
vi.mock('@/lib/experiments/client', () => ({
    getExperimentById: vi.fn().mockResolvedValue({ success: false }),
    getExperimentsByIds: vi.fn().mockResolvedValue({ success: true, experiments: [] }),
    listExperiments: vi.fn().mockResolvedValue({ experiments: [] }),
    checkExperimentsExist: vi.fn().mockResolvedValue({ existingIds: [] }),
}));

// License store — return defaults so getMaxExperiments() is deterministic
vi.mock('@/lib/store/license-store', () => ({
    useLicenseStore: {
        getState: () => ({
            result: {
                license: { features: { maxComparisonExperiments: 4 } },
            },
        }),
    },
}));

// columnar utils — return a minimal ColumnarData so toColumnarExperiment doesn't throw
vi.mock('@/lib/utils/columnar', () => ({
    tauriRawRecordsToColumnar: vi.fn().mockReturnValue({
        time_sec: new Float32Array(),
        viscosity_cp: new Float32Array(),
        temperature_c: new Float32Array(),
        speed_rpm: new Float32Array(),
        shear_rate_s1: new Float32Array(),
        shear_stress_pa: new Float32Array(),
        pressure_bar: new Float32Array(),
        bath_temperature_c: new Float32Array(),
    }),
}));

// ─── Import store after mocks ─────────────────────────────────────────────────
import { useComparisonStore } from '@/lib/store/comparison-store';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeExp(id = 'exp-1', name = 'Test Exp') {
    return {
        id,
        name,
        testDate: new Date().toISOString(),
        originalFilename: 'test.txt',
        instrumentType: 'Grace',
        waterSource: 'tap',
        fluidType: 'fluid',
        testGroup: '',
        metrics: {},
        rawPoints: [],
        userId: 'u1',
        laboratoryId: 'lab1',
        waterSourceId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    } as any;  
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ComparisonStore — _hasHydrated flag', () => {
    beforeEach(() => {
        // Reset to initial state before each test
        useComparisonStore.setState({
            experiments: [],
            _hasHydrated: false,
        });
    });

    test('_hasHydrated starts as false', () => {
        expect(useComparisonStore.getState()._hasHydrated).toBe(false);
    });

    test('_setHasHydrated(true) sets the flag', () => {
        useComparisonStore.getState()._setHasHydrated(true);
        expect(useComparisonStore.getState()._hasHydrated).toBe(true);
    });

    test('_setHasHydrated(false) clears the flag', () => {
        useComparisonStore.getState()._setHasHydrated(true);
        useComparisonStore.getState()._setHasHydrated(false);
        expect(useComparisonStore.getState()._hasHydrated).toBe(false);
    });

    test('rehydrateIfNeeded returns early with empty list (no crash)', async () => {
        // Regression: before the hydration fix, this would be called before
        // _hasHydrated was true and would silently no-op (experiments=[]).
        // Test verifies the store does not throw when list is empty.
        await expect(
            useComparisonStore.getState().rehydrateIfNeeded()
        ).resolves.toBeUndefined();
        expect(useComparisonStore.getState().experiments).toHaveLength(0);
    });
});

describe('ComparisonStore — add / remove / clear', () => {
    beforeEach(() => {
        useComparisonStore.setState({ experiments: [], _hasHydrated: true });
    });

    test('addExperiment adds to list', () => {
        const added = useComparisonStore.getState().addExperiment(makeExp('e1'));
        expect(added).toBe(true);
        expect(useComparisonStore.getState().experiments).toHaveLength(1);
    });

    test('addExperiment rejects duplicate ids', () => {
        useComparisonStore.getState().addExperiment(makeExp('e1'));
        const added = useComparisonStore.getState().addExperiment(makeExp('e1'));
        expect(added).toBe(false);
        expect(useComparisonStore.getState().experiments).toHaveLength(1);
    });

    test('addExperiment enforces max limit (4 from mock license)', () => {
        for (let i = 0; i < 4; i++) {
            expect(useComparisonStore.getState().addExperiment(makeExp(`e${i}`))).toBe(true);
        }
        const fifth = useComparisonStore.getState().addExperiment(makeExp('e5'));
        expect(fifth).toBe(false);
        expect(useComparisonStore.getState().experiments).toHaveLength(4);
    });

    test('removeExperiment removes correct experiment', () => {
        useComparisonStore.getState().addExperiment(makeExp('e1', 'Alpha'));
        useComparisonStore.getState().addExperiment(makeExp('e2', 'Beta'));
        useComparisonStore.getState().removeExperiment('e1');
        const ids = useComparisonStore.getState().experiments.map(e => e.id);
        expect(ids).toEqual(['e2']);
    });

    test('clear removes all experiments', () => {
        useComparisonStore.getState().addExperiment(makeExp('e1'));
        useComparisonStore.getState().addExperiment(makeExp('e2'));
        useComparisonStore.getState().clear();
        expect(useComparisonStore.getState().experiments).toHaveLength(0);
    });

    test('isInComparison returns true for added experiment', () => {
        useComparisonStore.getState().addExperiment(makeExp('e1'));
        expect(useComparisonStore.getState().isInComparison('e1')).toBe(true);
        expect(useComparisonStore.getState().isInComparison('missing')).toBe(false);
    });
});

describe('ComparisonStore — displaySettings', () => {
    beforeEach(() => {
        useComparisonStore.setState({
            displaySettings: {
                primaryMetric: 'viscosity_cp',
                leftSecondaryMetric: 'none',
                secondaryMetric: 'temperature_c',
                tertiaryMetric: 'none',
                showLegend: true,
                showControls: true,
                showTouchPoints: false,
                viscosityThreshold: 200,
                showTargetTime: true,
                targetTime: 10,
            },
        });
    });

    test('updateDisplaySettings patches individual fields', () => {
        useComparisonStore.getState().updateDisplaySettings({ showLegend: false, viscosityThreshold: 100 });
        const s = useComparisonStore.getState().displaySettings;
        expect(s.showLegend).toBe(false);
        expect(s.viscosityThreshold).toBe(100);
        // Other fields untouched
        expect(s.primaryMetric).toBe('viscosity_cp');
    });

    test('updateDisplaySettings does not reset unmentioned fields', () => {
        useComparisonStore.getState().updateDisplaySettings({ targetTime: 30 });
        expect(useComparisonStore.getState().displaySettings.showTouchPoints).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ComparisonStore — releaseHeavyData', () => {
    function makeDBExp(id: string) {
        return {
            ...makeExp(id),
            rawPoints: [{ time_sec: 0, viscosity_cp: 100, temperature_c: 50, speed_rpm: 1, shear_rate_s1: 1, shear_stress_pa: 1, pressure_bar: 1 }],
            columnarData: { timeSec: [0], viscosityCp: [100], temperatureC: [50], shearRate: [1], shearStress: [1], pressureBar: [1], speedRpm: [1] },
        };
    }

    function makeFileExp(id: string) {
        const exp = makeDBExp(`file-${id}`);
        return { ...exp, id: `file-${id}` };
    }

    beforeEach(() => {
        useComparisonStore.setState({ experiments: [], _hasHydrated: true });
    });

    test('releaseHeavyData clears rawPoints and columnarData from DB experiments', () => {
        useComparisonStore.setState({ experiments: [makeDBExp('db-1') as never], _hasHydrated: true });
        useComparisonStore.getState().releaseHeavyData();
        const exp = useComparisonStore.getState().experiments[0];
        expect(exp.rawPoints).toEqual([]);
        expect((exp as never as { columnarData: unknown }).columnarData).toBeUndefined();
    });

    test('releaseHeavyData keeps file-sourced experiments intact', () => {
        const fileExp = makeFileExp('1');
        useComparisonStore.setState({ experiments: [fileExp as never], _hasHydrated: true });
        useComparisonStore.getState().releaseHeavyData();
        const exp = useComparisonStore.getState().experiments[0];
        // File experiments should be untouched
        expect((exp.rawPoints as unknown[]).length).toBeGreaterThan(0);
    });

    test('releaseHeavyData preserves other non-heavy fields', () => {
        useComparisonStore.setState({ experiments: [makeDBExp('db-2') as never], _hasHydrated: true });
        useComparisonStore.getState().releaseHeavyData();
        const exp = useComparisonStore.getState().experiments[0];
        expect(exp.id).toBe('db-2');
        expect(exp.name).toBe('Test Exp');
    });

    test('releaseHeavyData processes mixed list (file + DB)', () => {
        const mixed = [makeDBExp('db-1'), makeFileExp('2')] as never[];
        useComparisonStore.setState({ experiments: mixed, _hasHydrated: true });
        useComparisonStore.getState().releaseHeavyData();
        const exps = useComparisonStore.getState().experiments;
        // DB experiment: rawPoints cleared
        expect(exps[0].rawPoints).toEqual([]);
        // File experiment: rawPoints kept
        expect((exps[1].rawPoints as unknown[]).length).toBeGreaterThan(0);
    });
});
