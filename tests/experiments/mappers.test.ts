/**
 * Tests for src/lib/experiments/mappers.ts
 * DB record → ParseResult conversion and recipe mapping.
 */
import { describe, it, expect } from 'vitest';
import {
    isMetadataOnlyParseResult,
    mapExperimentDetailMetaToParseResult,
    mapExperimentToParseResult,
    mapReagentsToRecipe
} from '@/lib/experiments/mappers';

// ── Helpers ────────────────────────────────────────────────────────────────

 
function makeExpRecord(overrides: Record<string, any> = {}): Record<string, any> {
    return {
        id: 'exp-1',
        name: 'Test Exp',
        originalFilename: 'test.xlsx',
        instrumentType: 'Chandler 5550',
        testDate: '2025-01-15T10:00:00.000Z',
        geometry: 'R1B5',
        geometrySource: 'context',
        rawPoints: [
            { time_sec: 0, viscosity_cp: 50, temperature_c: 25, rpm: 0, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 0 },
            { time_sec: 60, viscosity_cp: 100, temperature_c: 26, rpm: 60, shear_rate_s1: 50, shear_stress_pa: 5, pressure_bar: 1 },
        ],
        calibration: null,
        testId: 'T001',
        fieldName: 'Eagleford',
        operatorName: 'Alice',
        wellNumber: 'W-42',
        waterSource: 'Freshwater',
        viscosityMin: 50,
        pressureMax: 10,
        metrics: { maxViscosity: 100, maxTemp: 90 },
        ...overrides,
    };
}

// ── mapExperimentToParseResult ─────────────────────────────────────────────

describe('mapExperimentToParseResult', () => {
    it('returns success=true', () => {
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.success).toBe(true);
    });

    it('maps rawPoints to data array', () => {
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.data).toHaveLength(2);
    });

    it('maps viscosity_cp correctly', () => {
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.data[1].viscosity_cp).toBe(100);
    });

    it('maps shear_rate_s1 field', () => {
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.data[1].shear_rate_s1).toBe(50);
    });

    it('maps metadata.filename from originalFilename', () => {
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.metadata.filename).toBe('test.xlsx');
    });

    it('maps metadata.instrumentType', () => {
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.metadata.instrumentType).toBe('Chandler 5550');
    });

    it('maps metadata.geometry', () => {
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.metadata.geometry).toBe('R1B5');
    });

    it('maps filenameMetadata.fieldName', () => {
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.metadata.filenameMetadata?.fieldName).toBe('Eagleford');
    });

    it('maps filenameMetadata.operatorName', () => {
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.metadata.filenameMetadata?.operatorName).toBe('Alice');
    });

    it('maps summary.pointCount', () => {
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.summary?.pointCount).toBe(2);
    });

    it('handles empty rawPoints array', () => {
        const result = mapExperimentToParseResult(makeExpRecord({ rawPoints: [] }));
        expect(result.data).toHaveLength(0);
        expect(result.summary?.pointCount).toBe(0);
    });

    it('handles missing geometry (returns undefined)', () => {
        const result = mapExperimentToParseResult(makeExpRecord({ geometry: null }));
        expect(result.metadata.geometry).toBeUndefined();
    });

    it('maps timeRange when timeRangeMin/Max present', () => {
        const result = mapExperimentToParseResult(makeExpRecord({ timeRangeMin: 0, timeRangeMax: 3600 }));
        expect(result.summary?.timeRange?.durationMinutes).toBe(60);
    });

    it('maps bath_temperature_c when present in rawPoints', () => {
        const result = mapExperimentToParseResult(makeExpRecord({
            rawPoints: [
                { time_sec: 0, viscosity_cp: 50, temperature_c: 25, rpm: 0, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 0, bath_temperature_c: 110.5 },
                { time_sec: 60, viscosity_cp: 100, temperature_c: 26, rpm: 60, shear_rate_s1: 50, shear_stress_pa: 5, pressure_bar: 1, bath_temperature_c: 111.2 },
            ],
        }));
        expect(result.data[0].bath_temperature_c).toBe(110.5);
        expect(result.data[1].bath_temperature_c).toBe(111.2);
    });

    it('sets bath_temperature_c to undefined when absent from rawPoints', () => {
        // rawPoints without bath_temperature_c — e.g. experiment recorded without heater
        const result = mapExperimentToParseResult(makeExpRecord());
        expect(result.data[0].bath_temperature_c).toBeUndefined();
        expect(result.data[1].bath_temperature_c).toBeUndefined();
    });

    it('sets bath_temperature_c to undefined when null in rawPoints (columnar null bitmap)', () => {
        // Columnar decoder emits null JSON value for null-bitmap positions
        const result = mapExperimentToParseResult(makeExpRecord({
            rawPoints: [
                { time_sec: 0, viscosity_cp: 50, temperature_c: 25, rpm: 0, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 0, bath_temperature_c: null },
            ],
        }));
        expect(result.data[0].bath_temperature_c).toBeUndefined();
    });
});

// ── mapExperimentDetailMetaToParseResult ──────────────────────────────────

describe('mapExperimentDetailMetaToParseResult', () => {
    it('creates metadata-only ParseResult without raw data', () => {
        const result = mapExperimentDetailMetaToParseResult({
            id: 'exp_1',
            createdAt: '2026-04-30T00:00:00Z',
            updatedAt: '2026-04-30T00:00:00Z',
            name: 'Saved experiment',
            fieldName: 'Field',
            operatorName: 'Operator',
            wellNumber: 'W-1',
            testId: 'T-1',
            originalFilename: 'saved.xlsx',
            testDate: '2026-04-30',
            instrumentType: 'Grace',
            geometry: 'R1B5',
            geometrySource: 'context',
            waterSource: 'Fresh',
            waterParams: { ph: 7 },
            fluidType: 'Linear',
            testGroup: 'Rheology',
            testSubGroup: null,
            metrics: { maxViscosity: 200, maxTemp: 90 },
            calibration: null,
            reagents: [],
            summary: {
                pointCount: 1234,
                timeRangeMin: 0,
                timeRangeMax: 600,
                viscosityMin: 10,
                maxViscosity: 200,
                avgViscosity: 100,
                pressureMax: 2,
            },
            user: null,
            laboratory: { id: 'lab_1', name: 'Lab' },
            parsedBy: 'native',
            parseSource: 'xlsx',
        });

        expect(result.data).toEqual([]);
        expect(result.metadata.experimentId).toBe('exp_1');
        expect(result.summary.pointCount).toBe(1234);
        expect(result.summary.timeRange?.durationMinutes).toBe(10);
        expect(result.metadata.filenameMetadata?.laboratoryName).toBe('Lab');
        expect(isMetadataOnlyParseResult(result)).toBe(true);
    });
});

// ── mapReagentsToRecipe ────────────────────────────────────────────────────

describe('mapReagentsToRecipe', () => {
    it('returns empty array for empty input', () => {
        expect(mapReagentsToRecipe([])).toEqual([]);
    });

    it('maps reagent name to abbreviation', () => {
        const input = [{ reagent: { name: 'KCl', category: 'salt' }, concentration: 2, unit: '%' }];
        const result = mapReagentsToRecipe(input);
        expect(result[0].abbreviation).toBe('KCl');
    });

    it('maps concentration', () => {
        const input = [{ reagent: { name: 'KCl' }, concentration: 3.5, unit: 'ppg' }];
        const result = mapReagentsToRecipe(input);
        expect(result[0].concentration).toBe(3.5);
    });

    it('maps unit field', () => {
        const input = [{ reagent: { name: 'X' }, concentration: 1, unit: 'ppg' }];
        const result = mapReagentsToRecipe(input);
        expect(result[0].unit).toBe('ppg');
    });

    it('maps batchNumber to string', () => {
        const input = [{ reagent: { name: 'X' }, concentration: 1, unit: '', batchNumber: 42 }];
        const result = mapReagentsToRecipe(input);
        expect(result[0].batchNumber).toBe('42');
    });

    it('maps multiple reagents', () => {
        const input = [
            { reagent: { name: 'A' }, concentration: 1, unit: '%' },
            { reagent: { name: 'B' }, concentration: 2, unit: 'ppg' },
        ];
        expect(mapReagentsToRecipe(input)).toHaveLength(2);
    });
});
