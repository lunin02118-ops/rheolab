/**
 * Tests for src/lib/analysis/report-types/comparison-report-converter.ts
 *
 * Verifies that the camelCase → snake_case wire-format conversion matches
 * what the Rust `ComparisonReportInput` deserialiser expects — i.e. the
 * same shape consumed by the `reports_generate_comparison_*` Tauri IPC.
 */
import { describe, it, expect } from 'vitest';
import type {
    ComparisonReportInput,
    ComparisonChartConfig,
} from '@/lib/analysis/report-types/comparison-report-inputs';
import type {
    PdfReportInput,
    ReportChartLineSettings,
} from '@/lib/analysis/report-types/report-inputs';
import { convertComparisonReportInputToWasm } from '@/lib/analysis/report-types/comparison-report-converter';

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeLineSettings(withBath = false): ReportChartLineSettings {
    const base: ReportChartLineSettings = {
        viscosity: { color: '#3b82f6', width: 2, style: 'solid' },
        temperature: { color: '#ef4444', width: 2, style: 'dashed' },
        shearRate: { color: '#a855f7', width: 2, style: 'dotted' },
        pressure: { color: '#06b6d4', width: 2, style: 'solid' },
        rpm: { color: '#10b981', width: 2, style: 'solid' },
    };
    if (withBath) {
        base.bathTemperature = { color: '#f97316', width: 1, style: 'dashed' };
    }
    return base;
}

function makeChartConfig(overrides: Partial<ComparisonChartConfig> = {}): ComparisonChartConfig {
    return {
        metrics: {
            primary: 'viscosity_cp',
            leftSecondary: 'none',
            secondary: 'temperature_c',
            tertiary: 'none',
        },
        axisMode: 'shared',
        brushRange: [0, 30],
        touchPoint: {
            enabled: true,
            viscosityThreshold: 200,
            showTargetTime: false,
            targetTime: 10,
        },
        lineSettings: makeLineSettings(),
        experimentColors: ['#1E90FF', '#FF0000'],
        ...overrides,
    };
}

function makePdfReportInput(filename = 'a.dat'): PdfReportInput {
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

function makeInput(overrides: Partial<ComparisonReportInput> = {}): ComparisonReportInput {
    return {
        language: 'en',
        unitSystem: 'SI',
        generatedAt: '2026-04-22T00:00:00Z',
        comparisonChart: makeChartConfig(),
        experiments: [
            {
                id: 'exp-1',
                displayName: 'Chandler SST',
                reportInput: makePdfReportInput('a.dat'),
                sectionToggles: {
                    showCalibration: true,
                    showRawData: false,
                    showRecipe: true,
                    showWaterAnalysis: false,
                    showRheology: true,
                },
            },
            {
                id: 'exp-2',
                displayName: 'Grace Report',
                reportInput: makePdfReportInput('b.dat'),
                sectionToggles: {
                    showCalibration: false,
                    showRawData: true,
                    showRecipe: false,
                    showWaterAnalysis: true,
                    showRheology: true,
                },
            },
        ],
        ...overrides,
    };
}

// ── Top-level payload ────────────────────────────────────────────────────

describe('convertComparisonReportInputToWasm — top level', () => {
    it('renames camelCase fields to snake_case', () => {
        const result = convertComparisonReportInputToWasm(makeInput()) as Record<string, unknown>;

        expect(Object.keys(result).sort()).toEqual([
            'company_logo_base64',
            'company_name',
            'comparison_chart',
            'experiments',
            'generated_at',
            'language',
            'unit_system',
        ]);
        expect(result.language).toBe('en');
        expect(result.unit_system).toBe('SI');
        expect(result.generated_at).toBe('2026-04-22T00:00:00Z');
    });

    it('converts optional company fields to null when omitted', () => {
        const result = convertComparisonReportInputToWasm(makeInput()) as Record<string, unknown>;
        expect(result.company_name).toBeNull();
        expect(result.company_logo_base64).toBeNull();
    });

    it('passes through company fields when present', () => {
        const input = makeInput({ companyName: 'RheoLab', companyLogoBase64: 'AAA=' });
        const result = convertComparisonReportInputToWasm(input) as Record<string, unknown>;
        expect(result.company_name).toBe('RheoLab');
        expect(result.company_logo_base64).toBe('AAA=');
    });
});

// ── comparison_chart subtree ─────────────────────────────────────────────

describe('convertComparisonReportInputToWasm — comparison_chart', () => {
    it('renames metric fields to snake_case', () => {
        const result = convertComparisonReportInputToWasm(makeInput()) as {
            comparison_chart: { metrics: Record<string, unknown> };
        };
        expect(result.comparison_chart.metrics).toEqual({
            primary: 'viscosity_cp',
            left_secondary: 'none',
            secondary: 'temperature_c',
            tertiary: 'none',
        });
    });

    it('serialises brush_range as a two-element array', () => {
        const result = convertComparisonReportInputToWasm(makeInput()) as {
            comparison_chart: { brush_range: unknown };
        };
        expect(result.comparison_chart.brush_range).toEqual([0, 30]);
    });

    it('serialises brush_range as null when absent', () => {
        const input = makeInput({ comparisonChart: makeChartConfig({ brushRange: undefined }) });
        const result = convertComparisonReportInputToWasm(input) as {
            comparison_chart: { brush_range: unknown };
        };
        expect(result.comparison_chart.brush_range).toBeNull();
    });

    it('applies defaults for time_format, downsample_mode, chart_width and chart_height', () => {
        const input = makeInput({
            comparisonChart: makeChartConfig({
                timeFormat: undefined,
                downsampleMode: undefined,
                chartWidth: undefined,
                chartHeight: undefined,
            }),
        });
        const chart = (convertComparisonReportInputToWasm(input) as {
            comparison_chart: Record<string, unknown>;
        }).comparison_chart;

        expect(chart.time_format).toBe('minutes');
        expect(chart.downsample_mode).toBe('smart');
        expect(chart.chart_width).toBe(1400);
        expect(chart.chart_height).toBe(700);
    });

    it('preserves explicit overrides for defaults', () => {
        const input = makeInput({
            comparisonChart: makeChartConfig({
                timeFormat: 'hh:mm:ss',
                downsampleMode: 'off',
                chartWidth: 1920,
                chartHeight: 1080,
            }),
        });
        const chart = (convertComparisonReportInputToWasm(input) as {
            comparison_chart: Record<string, unknown>;
        }).comparison_chart;

        expect(chart.time_format).toBe('hh:mm:ss');
        expect(chart.downsample_mode).toBe('off');
        expect(chart.chart_width).toBe(1920);
        expect(chart.chart_height).toBe(1080);
    });

    it('renames touch-point fields to snake_case', () => {
        const result = convertComparisonReportInputToWasm(makeInput()) as {
            comparison_chart: { touch_point: Record<string, unknown> };
        };
        expect(result.comparison_chart.touch_point).toEqual({
            enabled: true,
            viscosity_threshold: 200,
            show_target_time: false,
            target_time: 10,
        });
    });

    it('copies experiment_colors as a plain array (not a reference)', () => {
        const input = makeInput();
        const result = convertComparisonReportInputToWasm(input) as {
            comparison_chart: { experiment_colors: string[] };
        };
        expect(result.comparison_chart.experiment_colors).toEqual(['#1E90FF', '#FF0000']);
        // Mutation of the original input must not leak into the payload
        input.comparisonChart.experimentColors.push('#FFFFFF');
        expect(result.comparison_chart.experiment_colors).toEqual(['#1E90FF', '#FF0000']);
    });
});

// ── line_settings ────────────────────────────────────────────────────────

describe('convertComparisonReportInputToWasm — line_settings', () => {
    it('converts shearRate to shear_rate but keeps others as-is', () => {
        const input = makeInput();
        const result = convertComparisonReportInputToWasm(input) as {
            comparison_chart: { line_settings: Record<string, unknown> };
        };
        const ls = result.comparison_chart.line_settings;
        expect(Object.keys(ls).sort()).toEqual(['pressure', 'rpm', 'shear_rate', 'temperature', 'viscosity']);
        expect(ls.shear_rate).toEqual({ color: '#a855f7', width: 2, style: 'dotted' });
    });

    it('emits bath_temperature only when present', () => {
        const input = makeInput({
            comparisonChart: makeChartConfig({ lineSettings: makeLineSettings(true) }),
        });
        const result = convertComparisonReportInputToWasm(input) as {
            comparison_chart: { line_settings: Record<string, unknown> };
        };
        expect(result.comparison_chart.line_settings.bath_temperature).toEqual({
            color: '#f97316',
            width: 1,
            style: 'dashed',
        });
    });

    it('omits bath_temperature when not present', () => {
        const result = convertComparisonReportInputToWasm(makeInput()) as {
            comparison_chart: { line_settings: Record<string, unknown> };
        };
        expect('bath_temperature' in result.comparison_chart.line_settings).toBe(false);
    });
});

// ── experiments (nested reportInput delegation) ──────────────────────────

describe('convertComparisonReportInputToWasm — experiments', () => {
    it('maps display_name and id verbatim', () => {
        const result = convertComparisonReportInputToWasm(makeInput()) as {
            experiments: Array<Record<string, unknown>>;
        };
        expect(result.experiments).toHaveLength(2);
        expect(result.experiments[0].id).toBe('exp-1');
        expect(result.experiments[0].display_name).toBe('Chandler SST');
        expect(result.experiments[1].id).toBe('exp-2');
        expect(result.experiments[1].display_name).toBe('Grace Report');
    });

    it('converts section_toggles to snake_case', () => {
        const result = convertComparisonReportInputToWasm(makeInput()) as {
            experiments: Array<{ section_toggles: Record<string, unknown> }>;
        };
        expect(result.experiments[0].section_toggles).toEqual({
            show_calibration: true,
            show_raw_data: false,
            show_recipe: true,
            show_water_analysis: false,
            show_rheology: true,
        });
        expect(result.experiments[1].section_toggles).toEqual({
            show_calibration: false,
            show_raw_data: true,
            show_recipe: false,
            show_water_analysis: true,
            show_rheology: true,
        });
    });

    it('delegates reportInput to the single-exp converter (snake_case output)', () => {
        const result = convertComparisonReportInputToWasm(makeInput()) as {
            experiments: Array<{ report_input: Record<string, unknown> }>;
        };
        const ri = result.experiments[0].report_input;
        // The single-exp converter always produces these snake_case keys;
        // exact value checks live in the existing single-exp tests.
        expect(ri.metadata).toEqual(expect.objectContaining({ filename: 'a.dat' }));
        expect(ri.cycle_results).toEqual([]);
        expect(ri.recipe).toEqual([]);
        expect(ri.settings).toEqual(expect.objectContaining({ language: 'en' }));
    });

    it('preserves experiment ordering', () => {
        const input = makeInput();
        // Reverse manually — result ordering must follow input ordering.
        input.experiments = [input.experiments[1], input.experiments[0]];
        const result = convertComparisonReportInputToWasm(input) as {
            experiments: Array<{ id: string }>;
        };
        expect(result.experiments.map(e => e.id)).toEqual(['exp-2', 'exp-1']);
    });
});

// ── Determinism ──────────────────────────────────────────────────────────

describe('convertComparisonReportInputToWasm — determinism', () => {
    it('produces the same JSON for the same input on repeated calls', () => {
        const input = makeInput();
        const a = JSON.stringify(convertComparisonReportInputToWasm(input));
        const b = JSON.stringify(convertComparisonReportInputToWasm(input));
        expect(a).toBe(b);
    });
});
