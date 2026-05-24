/**
 * Tests for src/lib/reports/comparison-experiment-adapter.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/analysis/client', () => ({
    analyzeData: vi.fn().mockResolvedValue({ cycles: [], results: new Map(), allSteps: [] }),
}));
import type { Experiment, ColumnarData } from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import {
    experimentToReportBuildContext,
    clearComparisonAnalysisCache,
    getComparisonAnalysisCacheSize,
    type ComparisonExperimentContextOverrides,
} from '@/lib/reports/comparison-experiment-adapter';
import { analyzeData } from '@/lib/analysis/client';

const analyzeDataMock = vi.mocked(analyzeData);

// PERF-002: the analysis cache is module-scoped and persists across
// `experimentToReportBuildContext` calls.  Existing tests assume a fresh
// state per test (e.g. they verify `analyzeData` was called); reset the
// cache between every test so cache-state never bleeds across cases.
beforeEach(() => {
    clearComparisonAnalysisCache();
});

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

    it('uses legacy instrumentRheology only for the instrument source', async () => {
        const exp = makeExperiment({
            columnarData: undefined as unknown as ColumnarData,
            instrumentRheology: [{
                cycleNo: 1,
                nPrime: 0.42,
                kPrimePaSn: 0.33,
            }],
        } as unknown as Partial<Experiment>);

        const instrumentCtx = await experimentToReportBuildContext(exp, {
            ...makeOverrides(),
            rheologySourceOverride: 'instrument',
        });
        expect(instrumentCtx.rheologySource).toBe('instrument');
        expect(instrumentCtx.cycleResultsMapped[0]).toMatchObject({
            cycleNo: 1,
            nPrime: 0.42,
            kPrime: 0.33,
        });

        const programCtx = await experimentToReportBuildContext(exp, {
            ...makeOverrides(),
            rheologySourceOverride: 'program',
        });
        expect(programCtx.rheologySource).toBe('program');
        expect(programCtx.cycleResultsMapped).toEqual([]);
    });

    it('does not reuse unsourced persisted rheology rows across sources', async () => {
        const exp = makeExperiment({
            columnarData: undefined as unknown as ColumnarData,
            rheologySource: 'instrument',
            rheologyParameters: [{
                cycleNo: 1,
                nPrime: 0.42,
                kPrimePaSn: 0.33,
            }],
        } as unknown as Partial<Experiment>);

        await expect(
            experimentToReportBuildContext(exp, makeOverrides()),
        ).rejects.toThrow('таблица реологических расчётов не найдена');
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
        expect(ctx.rheologySource).toBe('program');
    });

    it('falls back to experiment id when name is missing', async () => {
        const exp = makeExperiment({ name: '' });
        const ctx = await experimentToReportBuildContext(exp, makeOverrides());
        // Empty string → default 'report'
        expect(ctx.metadata.filename).toBe('report');
    });

    // ── Regression: forward viscosityShearRates to analyzeData ──────────
    //
    // Bug filed by the maintainer in alpha.6 manual testing: the
    // comparison-report's per-experiment "Rheological Statistics" sheet
    // rendered η@220 as a column header but the values for every cycle
    // came out as "-". Cause was that the adapter passed a hard-coded
    // [40, 100, 170] to `analyzeData()` regardless of what the user
    // had configured in expert mode, so the Rust pipeline never
    // populated viscosities[220]. The column header was driven by
    // `reportViscosityRates` and showed up correctly, but the value
    // lookup found nothing and the fallback to `visc_at_<rate>` only
    // covers the legacy 40/100/170 trio.
    //
    // These tests pin the contract so the bug cannot silently regress.

    it('forwards user-supplied reportViscosityRates to analyzeData (expert-mode bug fix)', async () => {
        analyzeDataMock.mockClear();
        const overrides = { ...makeOverrides(), isExpert: true, reportViscosityRates: [40, 100, 170, 220] };

        await experimentToReportBuildContext(makeExperiment(), overrides);

        expect(analyzeDataMock).toHaveBeenCalledTimes(1);
        const [, , settings] = analyzeDataMock.mock.calls[0];
        expect(settings.viscosityShearRates).toEqual([40, 100, 170, 220]);
    });

    it('strips zero/negative shear rates before passing to analyzeData', async () => {
        analyzeDataMock.mockClear();
        const overrides = { ...makeOverrides(), reportViscosityRates: [40, 0, -5, 100, Number.NaN, 220] };

        await experimentToReportBuildContext(makeExperiment(), overrides);

        const [, , settings] = analyzeDataMock.mock.calls[0];
        // 0, -5, NaN are dropped; the surviving rates keep their original order.
        expect(settings.viscosityShearRates).toEqual([40, 100, 220]);
    });

    it('falls back to DEFAULT_VISCOSITY_SHEAR_RATES when reportViscosityRates is empty', async () => {
        analyzeDataMock.mockClear();
        const overrides = { ...makeOverrides(), reportViscosityRates: [] };

        await experimentToReportBuildContext(makeExperiment(), overrides);

        const [, , settings] = analyzeDataMock.mock.calls[0];
        expect(settings.viscosityShearRates).toEqual([40, 100, 170]);
    });
});

// ── PERF-002: analysis cache tests ───────────────────────────────────────
describe('experimentToReportBuildContext — analysis cache (PERF-002)', () => {
    it('skips analyzeData on second call with identical inputs (cache hit)', async () => {
        analyzeDataMock.mockClear();
        const exp = makeExperiment({ updatedAt: '2026-01-15T12:00:00Z' } as Partial<Experiment>);
        const overrides = makeOverrides();

        await experimentToReportBuildContext(exp, overrides);
        await experimentToReportBuildContext(exp, overrides);

        // First call: cache miss → analyzeData runs.
        // Second call: cache hit → analyzeData is NOT called again.
        expect(analyzeDataMock).toHaveBeenCalledTimes(1);
        expect(getComparisonAnalysisCacheSize()).toBe(1);
    });

    it('re-runs analyzeData when updatedAt changes (cache invalidation)', async () => {
        analyzeDataMock.mockClear();
        const overrides = makeOverrides();

        await experimentToReportBuildContext(
            makeExperiment({ updatedAt: '2026-01-15T12:00:00Z' } as Partial<Experiment>),
            overrides,
        );
        await experimentToReportBuildContext(
            makeExperiment({ updatedAt: '2026-01-16T12:00:00Z' } as Partial<Experiment>),
            overrides,
        );

        expect(analyzeDataMock).toHaveBeenCalledTimes(2);
        expect(getComparisonAnalysisCacheSize()).toBe(2);
    });

    it('re-runs analyzeData when geometry changes (cache invalidation)', async () => {
        analyzeDataMock.mockClear();
        const baseExp = makeExperiment({ updatedAt: '2026-01-15T12:00:00Z' } as Partial<Experiment>);
        const overrides = makeOverrides();

        await experimentToReportBuildContext(
            { ...baseExp, geometry: 'R1B5' } as unknown as Experiment,
            overrides,
        );
        await experimentToReportBuildContext(
            { ...baseExp, geometry: 'R1B1' } as unknown as Experiment,
            overrides,
        );

        expect(analyzeDataMock).toHaveBeenCalledTimes(2);
    });

    it('re-runs analyzeData when shear rates change (cache invalidation)', async () => {
        analyzeDataMock.mockClear();
        const exp = makeExperiment({ updatedAt: '2026-01-15T12:00:00Z' } as Partial<Experiment>);

        await experimentToReportBuildContext(exp, {
            ...makeOverrides(),
            reportViscosityRates: [40, 100, 170],
        });
        await experimentToReportBuildContext(exp, {
            ...makeOverrides(),
            reportViscosityRates: [40, 100, 170, 220],
        });

        expect(analyzeDataMock).toHaveBeenCalledTimes(2);
    });

    it('treats shear-rate ORDER as identical (cache hit on reordering)', async () => {
        // Cache key sorts the rates so [170, 40, 100] and [40, 100, 170]
        // hash to the same key — analysis should not re-run.
        analyzeDataMock.mockClear();
        const exp = makeExperiment({ updatedAt: '2026-01-15T12:00:00Z' } as Partial<Experiment>);

        await experimentToReportBuildContext(exp, {
            ...makeOverrides(),
            reportViscosityRates: [40, 100, 170],
        });
        await experimentToReportBuildContext(exp, {
            ...makeOverrides(),
            reportViscosityRates: [170, 40, 100],
        });

        expect(analyzeDataMock).toHaveBeenCalledTimes(1);
    });

    it('does not cache when columnarData is missing (no analysis ran)', async () => {
        analyzeDataMock.mockClear();
        const exp = makeExperiment({
            columnarData: undefined,
            updatedAt: '2026-01-15T12:00:00Z',
        } as unknown as Partial<Experiment>);

        await experimentToReportBuildContext(exp, makeOverrides());

        expect(analyzeDataMock).not.toHaveBeenCalled();
        expect(getComparisonAnalysisCacheSize()).toBe(0);
    });

    it('clearComparisonAnalysisCache empties the cache so the next call re-analyses', async () => {
        analyzeDataMock.mockClear();
        const exp = makeExperiment({ updatedAt: '2026-01-15T12:00:00Z' } as Partial<Experiment>);

        await experimentToReportBuildContext(exp, makeOverrides());
        expect(getComparisonAnalysisCacheSize()).toBe(1);

        clearComparisonAnalysisCache();
        expect(getComparisonAnalysisCacheSize()).toBe(0);

        await experimentToReportBuildContext(exp, makeOverrides());
        // Two analyzeData calls total: first miss, clear, second miss again.
        expect(analyzeDataMock).toHaveBeenCalledTimes(2);
    });
});
