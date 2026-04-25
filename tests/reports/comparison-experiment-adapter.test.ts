/**
 * Tests for src/lib/reports/comparison-experiment-adapter.ts
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/analysis/client', () => ({
    analyzeData: vi.fn().mockResolvedValue({ cycles: [], results: new Map(), allSteps: [] }),
}));
import type { Experiment, ColumnarData } from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import {
    experimentToReportBuildContext,
    type ComparisonExperimentContextOverrides,
} from '@/lib/reports/comparison-experiment-adapter';

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeColumnarData(n: number = 3): ColumnarData {
    const arr = (v: number) => Array.from({ length: n }, (_, i) => v + i);
    return {
        timeSec: arr(0),
        viscosityCp: arr(100),
        temperatureC: arr(20),
        shearRate: arr(40),
        shearStress: arr(10),
        pressureBar: arr(1),
        speedRpm: arr(50),
    } as unknown as ColumnarData;
}

function makeChartSettings(): ChartSettings {
    // Minimal stub — adapter only forwards the reference downstream.
    return {} as ChartSettings;
}

function makeOverrides(): ComparisonExperimentContextOverrides {
    return {
        language: 'en',
        unitSystem: 'SI',
        companyName: 'Acme',
        companyLogo: null,
        chartSettings: makeChartSettings(),
        showCalibration: true,
        showRawData: true,
        showRecipe: true,
        showWaterAnalysis: true,
        showRheology: true,
        showTouchPoints: false,
        viscosityThreshold: 200,
        showTargetTime: false,
        targetTime: 10,
        reportViscosityRates: [40, 100, 170],
        isExpert: false,
    };
}

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
    return {
        id: 'exp-1',
        name: 'Chandler-123',
        testDate: '2026-01-01',
        fluidType: 'Linear',
        fieldName: 'North',
        operatorName: 'Ivanov',
        wellNumber: 'A-7',
        testId: '1001',
        instrumentType: 'Chandler 5550',
        geometry: 'R1B5',
        waterSource: 'Tap',
        waterParams: {
            ph: 7.2, fe: 0.1, ca: 120, mg: 30, cl: 250, so4: 100, hco3: 180,
        },
        calibration: {
            deviceType: 'Chandler 5550',
            lastCalDate: '2026-01-15',
            rSquared: 0.998,
            slope: 1.02,
            intercept: -0.5,
            hysteresis: 0.3,
            stdev: 2.1,
            status: 'PASS',
        },
        reagents: [
            { reagentId: 'rg-1', reagentName: 'XC Polymer', concentration: 3.5, unit: 'kg/m3', category: 'polymer', reagent: { name: 'XC', category: 'polymer' } },
            { reagentId: null, reagentName: null, concentration: 2.0, unit: '%', category: null, reagent: { name: 'KCl', category: 'salt' } },
        ],
        laboratory: { id: 'lab-1', name: 'Main Lab' },
        columnarData: makeColumnarData(4),
        ...overrides,
    } as unknown as Experiment;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('experimentToReportBuildContext', () => {
    it('maps top-level metadata fields', async () => {
        const ctx = await experimentToReportBuildContext(makeExperiment(), makeOverrides());
        expect(ctx.metadata.filename).toBe('Chandler-123');
        expect(ctx.metadata.instrumentType).toBe('Chandler 5550');
        expect(ctx.metadata.geometry).toBe('R1B5');
        expect(ctx.legacyFields.testId).toBe('1001');
        expect(ctx.legacyFields.operatorName).toBe('Ivanov');
        expect(ctx.legacyFields.laboratoryName).toBe('Main Lab');
        expect(ctx.legacyFields.fieldName).toBe('North');
        expect(ctx.legacyFields.wellNumber).toBe('A-7');
    });

    it('maps columnarData → rawData rows (all n points preserved)', async () => {
        const ctx = await experimentToReportBuildContext(makeExperiment(), makeOverrides());
        expect(ctx.rawDataMapped).toHaveLength(4);
        expect(ctx.rawDataMapped[0].time_sec).toBe(0);
        expect(ctx.rawDataMapped[0].viscosity_cp).toBe(100);
    });

    it('returns empty rawData when columnarData is absent', async () => {
        const exp = makeExperiment({ columnarData: undefined as unknown as ColumnarData });
        const ctx = await experimentToReportBuildContext(exp, makeOverrides());
        expect(ctx.rawDataMapped).toEqual([]);
    });

    it('maps reagents into RecipeComponent[] using the joined reagent descriptor when available', async () => {
        const ctx = await experimentToReportBuildContext(makeExperiment(), makeOverrides());
        expect(ctx.editedRecipe).toHaveLength(2);
        expect(ctx.editedRecipe[0]).toMatchObject({
            abbreviation: 'XC',
            reagentName: 'XC',
            concentration: 3.5,
            unit: 'kg/m3',
            category: 'polymer',
            reagentId: 'rg-1',
        });
        expect(ctx.editedRecipe[1].abbreviation).toBe('KCl');
    });

    it('extracts waterParams with numeric coercion', async () => {
        const ctx = await experimentToReportBuildContext(makeExperiment(), makeOverrides());
        expect(ctx.editedWaterParams).toEqual({
            ph: 7.2, fe: 0.1, ca: 120, mg: 30, cl: 250, so4: 100, hco3: 180,
        });
    });

    it('returns null waterParams when the source object is missing', async () => {
        const exp = makeExperiment({ waterParams: undefined });
        const ctx = await experimentToReportBuildContext(exp, makeOverrides());
        expect(ctx.editedWaterParams).toBeNull();
    });

    it('extracts calibration fields', async () => {
        const ctx = await experimentToReportBuildContext(makeExperiment(), makeOverrides());
        expect(ctx.metadata.calibration).toMatchObject({
            deviceType: 'Chandler 5550',
            lastCalDate: '2026-01-15',
            rSquared: 0.998,
            status: 'PASS',
        });
    });

    it('returns undefined calibration when missing', async () => {
        const exp = makeExperiment({ calibration: null });
        const ctx = await experimentToReportBuildContext(exp, makeOverrides());
        expect(ctx.metadata.calibration).toBeUndefined();
    });

    it('emits cycleResultsMapped and cycles from analysis (empty when mock returns nothing)', async () => {
        const ctx = await experimentToReportBuildContext(makeExperiment(), makeOverrides());
        expect(ctx.cycleResultsMapped).toEqual([]);
        expect(ctx.cycles).toEqual([]);
    });

    it('forwards all override fields verbatim', async () => {
        const overrides = makeOverrides();
        const ctx = await experimentToReportBuildContext(makeExperiment(), overrides);
        expect(ctx.language).toBe('en');
        expect(ctx.unitSystem).toBe('SI');
        expect(ctx.companyName).toBe('Acme');
        expect(ctx.companyLogo).toBeNull();
        expect(ctx.showCalibration).toBe(true);
        expect(ctx.showRawData).toBe(true);
        expect(ctx.showRecipe).toBe(true);
        expect(ctx.showWaterAnalysis).toBe(true);
        expect(ctx.viscosityThreshold).toBe(200);
        expect(ctx.targetTime).toBe(10);
        expect(ctx.reportViscosityRates).toEqual([40, 100, 170]);
        expect(ctx.isExpert).toBe(false);
    });

    it('falls back to experiment id when name is missing', async () => {
        const exp = makeExperiment({ name: '' });
        const ctx = await experimentToReportBuildContext(exp, makeOverrides());
        // Empty string → default 'report'
        expect(ctx.metadata.filename).toBe('report');
    });
});
