/**
 * Tests for src/lib/reports/comparison-builders.ts
 *
 * Pure helper — ensures the UI-level build context is assembled into a
 * `ComparisonReportInput` payload without accidental aliasing or dropped
 * fields.  The Rust side of the contract is covered by the converter test
 * and the Rust integration tests under `src-tauri/`.
 */
import { describe, it, expect } from 'vitest';
import {
    buildComparisonReportInput,
    type ComparisonReportBuildContext,
    type ComparisonReportEntrySource,
} from '@/lib/reports/comparison-builders';
import type {
    ComparisonChartConfig,
    ComparisonSectionToggles,
} from '@/lib/analysis/report-types/comparison-report-inputs';
import type {
    PdfReportInput,
    ReportChartLineSettings,
} from '@/lib/analysis/report-types/report-inputs';

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeLineSettings(): ReportChartLineSettings {
    return {
        viscosity: { color: '#3b82f6', width: 2, style: 'solid' },
        temperature: { color: '#ef4444', width: 2, style: 'solid' },
        shearRate: { color: '#a855f7', width: 2, style: 'solid' },
        pressure: { color: '#06b6d4', width: 2, style: 'solid' },
        rpm: { color: '#10b981', width: 2, style: 'solid' },
    };
}

function makeChartConfig(): ComparisonChartConfig {
    return {
        metrics: {
            primary: 'viscosity_cp',
            leftSecondary: 'none',
            secondary: 'none',
            tertiary: 'none',
        },
        axisMode: 'shared',
        touchPoint: {
            enabled: false,
            viscosityThreshold: 0,
            showTargetTime: false,
            targetTime: 0,
        },
        lineSettings: makeLineSettings(),
        experimentColors: ['#1E90FF', '#FF0000'],
    };
}

function makeReportInput(filename: string): PdfReportInput {
    return {
        metadata: { filename },
        rawData: [],
        cycleResults: [],
        recipe: [],
        settings: {
            language: 'en',
            unitSystem: 'SI',
            showTouchPoints: false,
            showCalibration: false,
            showTemperature: true,
            showShearRate: true,
            showPressure: false,
        },
    };
}

function makeToggles(): ComparisonSectionToggles {
    return {
        showCalibration: false,
        showRawData: false,
        showRecipe: true,
        showWaterAnalysis: false,
        showRheology: true,
    };
}

function makeEntry(id: string, displayName: string): ComparisonReportEntrySource {
    return {
        id,
        displayName,
        reportInput: makeReportInput(`${id}.dat`),
        sectionToggles: makeToggles(),
    };
}

function makeContext(overrides: Partial<ComparisonReportBuildContext> = {}): ComparisonReportBuildContext {
    return {
        language: 'en',
        unitSystem: 'SI',
        generatedAt: '2026-04-22T12:00:00Z',
        comparisonChart: makeChartConfig(),
        entries: [makeEntry('exp-1', 'First'), makeEntry('exp-2', 'Second')],
        ...overrides,
    };
}

// ── Happy path ───────────────────────────────────────────────────────────

describe('buildComparisonReportInput', () => {
    it('copies all top-level context fields onto the payload', () => {
        const ctx = makeContext();
        const input = buildComparisonReportInput(ctx);
        expect(input.language).toBe('en');
        expect(input.unitSystem).toBe('SI');
        expect(input.generatedAt).toBe('2026-04-22T12:00:00Z');
        // comparisonChart is forwarded by reference — the converter handles
        // the snake_case translation so no builder-side clone is required.
        expect(input.comparisonChart).toBe(ctx.comparisonChart);
    });

    it('forwards optional company fields when provided', () => {
        const input = buildComparisonReportInput(
            makeContext({ companyName: 'RheoLab', companyLogoBase64: 'AAA=' }),
        );
        expect(input.companyName).toBe('RheoLab');
        expect(input.companyLogoBase64).toBe('AAA=');
    });

    it('preserves entry order and identifiers', () => {
        const input = buildComparisonReportInput(makeContext());
        expect(input.experiments.map(e => e.id)).toEqual(['exp-1', 'exp-2']);
        expect(input.experiments.map(e => e.displayName)).toEqual(['First', 'Second']);
    });

    it('forwards reportInput objects as-is (no deep copy)', () => {
        const ctx = makeContext();
        const input = buildComparisonReportInput(ctx);
        // Builder does not need to clone reportInput; the converter runs
        // through it field-by-field when producing the wire payload.
        expect(input.experiments[0].reportInput).toBe(ctx.entries[0].reportInput);
    });

    it('defensively copies sectionToggles so mutations in the source do not leak', () => {
        const ctx = makeContext();
        const input = buildComparisonReportInput(ctx);
        ctx.entries[0].sectionToggles.showRecipe = false;
        expect(input.experiments[0].sectionToggles.showRecipe).toBe(true);
    });

    it('uses an ISO-8601 timestamp when generatedAt is omitted', () => {
        const input = buildComparisonReportInput(
            makeContext({ generatedAt: undefined }),
        );
        // ISO-8601 with Z suffix or offset — let Date accept it without NaN.
        expect(Number.isNaN(Date.parse(input.generatedAt))).toBe(false);
    });
});

// ── Error cases ──────────────────────────────────────────────────────────

describe('buildComparisonReportInput — validation', () => {
    it('throws when entries is empty', () => {
        expect(() => buildComparisonReportInput(makeContext({ entries: [] }))).toThrow(
            /at least one experiment/,
        );
    });
});
