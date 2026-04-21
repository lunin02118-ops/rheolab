/**
 * Regression tests for PDF and Excel report generation pipeline.
 *
 * These tests guard against regressions that occurred after the
 * v2/desktop-offline-foundation refactoring:
 *
 * 1. Chart width formula — must account for show_advanced_stats vs column count
 * 2. Settings propagation — every Rust-expected field must survive the
 *    TS builder → converter → JSON pipeline
 * 3. Report builder completeness — buildPdfReportInput / buildExcelReportInput
 *    must include ALL fields that the Rust `ReportInput` struct expects
 * 4. Field naming — snake_case in output, camelCase in TS types
 *
 * Reference commits:
 *   622a0c9 — fix(excel): chart width matches rheological data table exactly
 *   ab306c8 — fix(pdf): shared mode page margins match individual
 *   580d6c7 — feat: show_advanced_stats + bath_temp
 *   509a8e2 — chore: table placement + touch point smart algorithm
 */

import { describe, it, expect } from 'vitest';
import { convertReportInputToWasm } from '@/lib/analysis/report-types/converters';
import {
    buildPdfReportInput,
    buildExcelReportInput,
    type ReportBuildContext,
} from '@/lib/reports/report-builders';
import type { PdfReportInput } from '@/lib/analysis/report-types/types';
import type { ChartSettings, ChartLineSettings } from '@/lib/store/chart-settings-store';

// ──────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────

const FIXTURE_LINE_SETTINGS: ChartLineSettings = {
    viscosity:       { color: '#1e40af', width: 2, style: 'solid',  visible: true,  axis: 'left'  as const, unit: 'mPa·s' },
    temperature:     { color: '#c2410c', width: 2, style: 'solid',  visible: true,  axis: 'right' as const, unit: '°C' },
    shearRate:       { color: '#7e22ce', width: 2, style: 'dashed', visible: false, axis: 'right' as const, unit: '1/s' },
    pressure:        { color: '#15803d', width: 2, style: 'dotted', visible: false, axis: 'right' as const, unit: 'bar' },
    rpm:             { color: '#a16207', width: 2, style: 'dashed', visible: false, axis: 'left'  as const, unit: 'RPM' },
    bathTemperature: { color: '#ea580c', width: 2, style: 'dashed', visible: true,  axis: 'right' as const, unit: '°C' },
};

function makeChartSettings(overrides?: Partial<ChartSettings>): ChartSettings {
    return {
        lines: FIXTURE_LINE_SETTINGS,
        precision: { viscosity: 1, temperature: 1, pressure: 2, time: 2, shearRate: 1, rpm: 0 },
        showGridLines: true,
        gridOpacity: 0.3,
        animationsEnabled: false,
        tooltipEnabled: false,
        downsampleMode: 'off' as const,
        comparisonAxisMode: 'individual' as const,
        ...overrides,
    };
}

function makeReportBuildContext(overrides?: Partial<ReportBuildContext>): ReportBuildContext {
    return {
        rawDataMapped: [
            { time_sec: 0,   viscosity_cp: 1000, temperature_c: 25, shear_rate: 170, shear_stress_pa: 50, shear_stress: 50, speed_rpm: 300, pressure_bar: 30, bath_temperature_c: 24 },
            { time_sec: 60,  viscosity_cp: 950,  temperature_c: 50, shear_rate: 170, shear_stress_pa: 48, shear_stress: 48, speed_rpm: 300, pressure_bar: 30, bath_temperature_c: 49 },
            { time_sec: 120, viscosity_cp: 900,  temperature_c: 75, shear_rate: 170, shear_stress_pa: 45, shear_stress: 45, speed_rpm: 300, pressure_bar: 30, bath_temperature_c: 74 },
        ],
        cycleResultsMapped: [{
            cycleNo: 1, timeMin: 2.0, tempC: 75, pressure_bar: 30,
            nPrime: 0.85, kPrime: 0.25, r2: 0.998,
            viscAt40: 520, viscAt100: 480, viscAt170: 450,
            viscosities: { 40: 520, 100: 480, 170: 450 },
            binghamPv: 15.5, binghamYp: 8.2, binghamR2: 0.995,
        }],
        metadata: {
            filename: 'test_report.xlsx',
            testDate: '2025-01-01',
            instrumentType: 'Grace M5600',
            geometry: 'R1B5',
            calibration: {
                deviceType: 'Grace M5600',
                lastCalDate: '2025-01-01',
                rSquared: 0.999,
                slope: 1.0,
                intercept: 0.0,
                hysteresis: 0.5,
                stdev: 0.01,
                status: 'PASS',
            },
        },
        legacyFields: {
            testId: 'TEST-001',
            operatorName: 'Оператор',
            laboratoryName: 'Лаборатория',
            fieldName: 'Месторождение',
            wellNumber: 'С-123',
        },
        editedRecipe: [
            { reagentName: 'Water', abbreviation: 'H2O', concentration: 950, unit: 'л/м³', category: 'Основа' } as any,
            { reagentName: 'Polymer', abbreviation: 'PAC', concentration: 2.5, unit: 'кг/м³', category: 'Полимер' } as any,
        ],
        editedWaterParams: { ph: 7.2, salinity: 1500, hardness: 120 } as any,
        editedWaterSource: 'Водопроводная',
        cycles: [{ type: 'SST', steps: [{ avgShearRate: 170 }] }] as any,
        companyName: 'RheoLab',
        companyLogo: null,
        chartSettings: makeChartSettings(),
        language: 'ru',
        unitSystem: 'SI',
        showTouchPoints: true,
        viscosityThreshold: 500,
        showTargetTime: true,
        targetTime: 10,
        showCalibration: true,
        showRawData: true,
        reportViscosityRates: [40, 100, 170],
        isExpert: true,
        ...overrides,
    };
}

function makePdfInput(settingsOverrides?: Partial<PdfReportInput['settings']>): PdfReportInput {
    return {
        rawData: [
            { time_sec: 0, viscosity_cp: 1000, temperature_c: 25, shear_rate: 170, pressure_bar: 30, bath_temperature_c: 24 },
            { time_sec: 60, viscosity_cp: 950, temperature_c: 50, shear_rate: 170, pressure_bar: 30, bath_temperature_c: 49 },
        ],
        metadata: { filename: 'test.xlsx', testId: 'T-001', companyName: 'Test' },
        cycleResults: [{
            cycleNo: 1, timeMin: 1.0, tempC: 50, nPrime: 0.85, kPrime: 0.25, r2: 0.998,
            viscosities: { '40': 520, '100': 480, '170': 450 },
            binghamPv: 15.5, binghamYp: 8.2, binghamR2: 0.995,
        }],
        recipe: [{ name: 'Water', unit: 'L/m3', concentration: 950 }],
        settings: {
            language: 'ru',
            unitSystem: 'SI',
            showTemperature: true,
            showShearRate: true,
            showPressure: false,
            showBathTemperature: true,
            showTouchPoints: true,
            showCalibration: true,
            showRawData: true,
            viscosityThreshold: 500,
            showTargetTime: true,
            targetTime: 10,
            viscosityShearRates: [40, 100, 170],
            showAdvancedStats: true,
            shearRateAxis: 'right',
            pressureAxis: 'right',
            axisMode: 'individual',
            lineSettings: {
                viscosity:       { color: '#1e40af', width: 2, style: 'solid' },
                temperature:     { color: '#c2410c', width: 2, style: 'solid' },
                shearRate:       { color: '#7e22ce', width: 2, style: 'dashed' },
                pressure:        { color: '#15803d', width: 2, style: 'dotted' },
                rpm:             { color: '#a16207', width: 2, style: 'dashed' },
                bathTemperature: { color: '#ea580c', width: 2, style: 'dashed' },
            },
            ...settingsOverrides,
        },
    };
}

// ──────────────────────────────────────────────────────────────────
// 1. CONVERTER: all Rust-expected settings fields are present
// ──────────────────────────────────────────────────────────────────

describe('Report Regression: converter output completeness', () => {
    /**
     * Regression: 622a0c9 — Excel chart width depends on show_advanced_stats
     * being correctly passed.  If the converter omits it, Rust defaults to true
     * and the chart width formula will always include Bingham columns.
     */
    it('show_advanced_stats is present in converter output', () => {
        const input = makePdfInput({ showAdvancedStats: true });
        const wasm = convertReportInputToWasm(input) as any;
        expect(wasm.settings).toHaveProperty('show_advanced_stats', true);

        const inputFalse = makePdfInput({ showAdvancedStats: false });
        const wasmFalse = convertReportInputToWasm(inputFalse) as any;
        expect(wasmFalse.settings).toHaveProperty('show_advanced_stats', false);
    });

    it('axis_mode is present and correct', () => {
        const inputInd = makePdfInput({ axisMode: 'individual' });
        expect((convertReportInputToWasm(inputInd) as any).settings.axis_mode).toBe('individual');

        const inputShared = makePdfInput({ axisMode: 'shared' });
        expect((convertReportInputToWasm(inputShared) as any).settings.axis_mode).toBe('shared');
    });

    it('show_bath_temperature is present', () => {
        const input = makePdfInput({ showBathTemperature: true });
        expect((convertReportInputToWasm(input) as any).settings.show_bath_temperature).toBe(true);
    });

    it('shear_rate_axis and pressure_axis are present', () => {
        const input = makePdfInput({ shearRateAxis: 'left', pressureAxis: 'right' });
        const wasm = (convertReportInputToWasm(input) as any).settings;
        expect(wasm.shear_rate_axis).toBe('left');
        expect(wasm.pressure_axis).toBe('right');
    });

    it('viscosity_shear_rates array is passed correctly', () => {
        const input = makePdfInput({ viscosityShearRates: [40, 100, 170, 300] });
        const wasm = (convertReportInputToWasm(input) as any).settings;
        expect(wasm.viscosity_shear_rates).toEqual([40, 100, 170, 300]);
    });

    it('line_settings includes all 6 keys with bath_temperature', () => {
        const input = makePdfInput();
        const wasm = (convertReportInputToWasm(input) as any).settings;
        expect(wasm.line_settings).toBeTruthy();
        expect(wasm.line_settings).toHaveProperty('viscosity');
        expect(wasm.line_settings).toHaveProperty('temperature');
        expect(wasm.line_settings).toHaveProperty('shear_rate');
        expect(wasm.line_settings).toHaveProperty('pressure');
        expect(wasm.line_settings).toHaveProperty('rpm');
        expect(wasm.line_settings).toHaveProperty('bath_temperature');
        // Each entry has color/width/style
        for (const key of ['viscosity', 'temperature', 'shear_rate', 'pressure', 'rpm', 'bath_temperature']) {
            expect(wasm.line_settings[key]).toHaveProperty('color');
            expect(wasm.line_settings[key]).toHaveProperty('width');
            expect(wasm.line_settings[key]).toHaveProperty('style');
        }
    });

    /** Regression: touch point settings must be passed for chart vertical lines */
    it('touch point settings are complete', () => {
        const input = makePdfInput({
            showTouchPoints: true,
            viscosityThreshold: 300,
            showTargetTime: true,
            targetTime: 15,
        });
        const wasm = (convertReportInputToWasm(input) as any).settings;
        expect(wasm.show_touch_points).toBe(true);
        expect(wasm.viscosity_threshold).toBe(300);
        expect(wasm.show_target_time).toBe(true);
        expect(wasm.target_time).toBe(15);
    });

    /**
     * ALL settings fields that Rust ReportSettings expects must be in the
     * converter output.  This test serves as the "contract check" between TS and Rust.
     */
    it('converter output contains ALL Rust ReportSettings fields', () => {
        const input = makePdfInput();
        const wasm = (convertReportInputToWasm(input) as any).settings;

        const requiredFields = [
            'language', 'unit_system',
            'show_temperature', 'show_shear_rate', 'show_pressure', 'show_bath_temperature',
            'show_touch_points', 'viscosity_threshold', 'show_target_time', 'target_time',
            'show_calibration', 'show_raw_data',
            'shear_rate_axis', 'pressure_axis', 'axis_mode',
            'viscosity_shear_rates', 'show_advanced_stats',
            'line_settings',
        ];

        for (const field of requiredFields) {
            expect(wasm, `Missing settings field: ${field}`).toHaveProperty(field);
        }
    });

    it('raw_data includes bath_temperature_c', () => {
        const input = makePdfInput();
        const wasm = (convertReportInputToWasm(input) as any);
        expect(wasm.raw_data[0]).toHaveProperty('bath_temperature_c', 24);
    });

    it('axis_values are computed from raw_data', () => {
        const input = makePdfInput();
        const wasm = (convertReportInputToWasm(input) as any);
        expect(wasm.axis_values).toBeTruthy();
        expect(wasm.axis_values.time_min).toBe(0);
        expect(wasm.axis_values.time_max).toBe(1); // 60sec = 1min
        expect(wasm.axis_values.viscosity_min).toBe(950);
        expect(wasm.axis_values.viscosity_max).toBe(1000);
    });
});

// ──────────────────────────────────────────────────────────────────
// 2. BUILDER: buildPdfReportInput and buildExcelReportInput
// ──────────────────────────────────────────────────────────────────

describe('Report Regression: builder completeness', () => {
    it('buildPdfReportInput includes all settings from context', () => {
        const ctx = makeReportBuildContext();
        const pdf = buildPdfReportInput(ctx);

        // Core settings
        expect(pdf.settings.language).toBe('ru');
        expect(pdf.settings.unitSystem).toBe('SI');
        expect(pdf.settings.showTouchPoints).toBe(true);
        expect(pdf.settings.viscosityThreshold).toBe(500);
        expect(pdf.settings.showTargetTime).toBe(true);
        expect(pdf.settings.targetTime).toBe(10);
        expect(pdf.settings.showCalibration).toBe(true);
        expect(pdf.settings.showRawData).toBe(true);
        expect(pdf.settings.viscosityShearRates).toEqual([40, 100, 170]);

        // Feature flags
        expect(pdf.settings.showAdvancedStats).toBe(true);  // isExpert=true
        expect(pdf.settings.showTemperature).toBe(true);
        expect(pdf.settings.showShearRate).toBe(false); // from default line settings
        expect(pdf.settings.showPressure).toBe(false);
        expect(pdf.settings.showBathTemperature).toBe(true);

        // Axis settings
        expect(pdf.settings.shearRateAxis).toBe('right');
        expect(pdf.settings.pressureAxis).toBe('right');
        expect(pdf.settings.axisMode).toBe('individual');

        // Line settings
        expect(pdf.settings.lineSettings).toBeTruthy();
        expect(pdf.settings.lineSettings!.viscosity.color).toBe('#1e40af');
    });

    it('buildExcelReportInput includes all settings from context', () => {
        const ctx = makeReportBuildContext();
        const excel = buildExcelReportInput(ctx);

        // Same contract as PDF
        expect(excel.settings.showAdvancedStats).toBe(true);
        expect(excel.settings.axisMode).toBe('individual');
        expect(excel.settings.showBathTemperature).toBe(true);
        expect(excel.settings.viscosityShearRates).toEqual([40, 100, 170]);
        expect(excel.settings.lineSettings).toBeTruthy();
    });

    /**
     * Regression: 580d6c7 — show_advanced_stats must be tied to isExpert.
     * When isExpert=false (beginner mode), PV/YP/R²B columns should be omitted.
     */
    it('showAdvancedStats follows isExpert flag', () => {
        const ctxExpert = makeReportBuildContext({ isExpert: true });
        const ctxBeginner = makeReportBuildContext({ isExpert: false });

        expect(buildPdfReportInput(ctxExpert).settings.showAdvancedStats).toBe(true);
        expect(buildPdfReportInput(ctxBeginner).settings.showAdvancedStats).toBe(false);
        expect(buildExcelReportInput(ctxExpert).settings.showAdvancedStats).toBe(true);
        expect(buildExcelReportInput(ctxBeginner).settings.showAdvancedStats).toBe(false);
    });

    it('axisMode comes from chartSettings.comparisonAxisMode', () => {
        const ctxInd = makeReportBuildContext({
            chartSettings: makeChartSettings({ comparisonAxisMode: 'individual' }),
        });
        const ctxShared = makeReportBuildContext({
            chartSettings: makeChartSettings({ comparisonAxisMode: 'shared' }),
        });

        expect(buildPdfReportInput(ctxInd).settings.axisMode).toBe('individual');
        expect(buildPdfReportInput(ctxShared).settings.axisMode).toBe('shared');
        expect(buildExcelReportInput(ctxInd).settings.axisMode).toBe('individual');
        expect(buildExcelReportInput(ctxShared).settings.axisMode).toBe('shared');
    });

    it('visibility flags come from chartSettings.lines.*.visible', () => {
        const lines: ChartLineSettings = {
            ...FIXTURE_LINE_SETTINGS,
            temperature:     { ...FIXTURE_LINE_SETTINGS.temperature, visible: false },
            shearRate:       { ...FIXTURE_LINE_SETTINGS.shearRate, visible: true },
            pressure:        { ...FIXTURE_LINE_SETTINGS.pressure, visible: true },
            bathTemperature: { ...FIXTURE_LINE_SETTINGS.bathTemperature, visible: false },
        };
        const ctx = makeReportBuildContext({
            chartSettings: makeChartSettings({ lines }),
        });

        const pdf = buildPdfReportInput(ctx);
        expect(pdf.settings.showTemperature).toBe(false);
        expect(pdf.settings.showShearRate).toBe(true);
        expect(pdf.settings.showPressure).toBe(true);
        expect(pdf.settings.showBathTemperature).toBe(false);
    });

    it('calibration data is included when showCalibration is true', () => {
        const ctx = makeReportBuildContext({ showCalibration: true });
        const pdf = buildPdfReportInput(ctx);
        expect(pdf.metadata.calibration).toBeTruthy();
        expect(pdf.metadata.calibration!.rSquared).toBe(0.999);
    });

    it('recipe includes batch number for PDF', () => {
        const ctx = makeReportBuildContext({
            editedRecipe: [
                { reagentName: 'PAC-HV', concentration: 5, unit: 'кг/м³', batchNumber: 'LOT-2025' } as any,
            ],
        });
        const pdf = buildPdfReportInput(ctx);
        expect(pdf.recipe[0].batchNumber).toBe('LOT-2025');
    });

    it('water params are included when present', () => {
        const ctx = makeReportBuildContext();
        const pdf = buildPdfReportInput(ctx);
        expect(pdf.waterParams).toBeTruthy();
        expect(pdf.waterParams!.ph).toBe(7.2);
        expect(pdf.waterParams!.source).toBe('Водопроводная');
    });
});

// ──────────────────────────────────────────────────────────────────
// 3. END-TO-END: builder → converter → JSON for Rust
// ──────────────────────────────────────────────────────────────────

describe('Report Regression: end-to-end builder→converter pipeline', () => {
    /**
     * Regression: 622a0c9 — chart width formula.
     * Excel chart width = 110 + (stats_col_count - 1) * 75
     * where stats_col_count = 7 + viscosity_shear_rates.len() + bingham_cols
     * bingham_cols = show_advanced_stats ? 3 : 0
     *
     * This test verifies the converter produces the inputs the Rust formula needs.
     */
    it('Excel chart width inputs are correct for expert mode', () => {
        const ctx = makeReportBuildContext({ isExpert: true, reportViscosityRates: [40, 100, 170] });
        const excel = buildExcelReportInput(ctx);
        const wasm = convertReportInputToWasm(excel) as any;

        // Verify the formula inputs
        const rates = wasm.settings.viscosity_shear_rates;
        const advStats = wasm.settings.show_advanced_stats;
        expect(rates).toEqual([40, 100, 170]);
        expect(advStats).toBe(true);

        // Expected: 7 + 3 + 3 = 13 cols → width = 110 + 12*75 = 1010
        const binghamCols = advStats ? 3 : 0;
        const colCount = 7 + rates.length + binghamCols;
        const expectedWidth = 110 + (colCount - 1) * 75;
        expect(colCount).toBe(13);
        expect(expectedWidth).toBe(1010);
    });

    it('Excel chart width inputs are correct for beginner mode', () => {
        const ctx = makeReportBuildContext({ isExpert: false, reportViscosityRates: [40, 100, 170] });
        const excel = buildExcelReportInput(ctx);
        const wasm = convertReportInputToWasm(excel) as any;

        const rates = wasm.settings.viscosity_shear_rates;
        const advStats = wasm.settings.show_advanced_stats;
        expect(advStats).toBe(false);

        // Expected: 7 + 3 + 0 = 10 cols → width = 110 + 9*75 = 785
        const binghamCols = advStats ? 3 : 0;
        const colCount = 7 + rates.length + binghamCols;
        const expectedWidth = 110 + (colCount - 1) * 75;
        expect(colCount).toBe(10);
        expect(expectedWidth).toBe(785);
    });

    /**
     * Regression: ab306c8 — PDF shared mode margins.
     * The n_settings_left/right counts must be derived from settings visibility flags.
     * This test verifies the converter passes the flags the Rust margin formula uses.
     */
    it('PDF margin formula inputs: settings visibility flags match converter output', () => {
        const lines: ChartLineSettings = {
            ...FIXTURE_LINE_SETTINGS,
            temperature:     { ...FIXTURE_LINE_SETTINGS.temperature, visible: true },
            shearRate:       { ...FIXTURE_LINE_SETTINGS.shearRate, visible: true, axis: 'left' as const },
            pressure:        { ...FIXTURE_LINE_SETTINGS.pressure, visible: true, axis: 'right' as const },
            bathTemperature: { ...FIXTURE_LINE_SETTINGS.bathTemperature, visible: true },
        };
        const ctx = makeReportBuildContext({
            chartSettings: makeChartSettings({ lines }),
        });
        const pdf = buildPdfReportInput(ctx);
        const wasm = convertReportInputToWasm(pdf) as any;
        const s = wasm.settings;

        // Viscosity always left → 1
        // shear_rate visible + left → +1 → n_left = 2
        // temperature visible → +1 (right group)
        // bath_temperature visible → still same right group as temp
        // pressure visible + right → +1 → n_right = 2
        const nLeft = 1 + (s.show_shear_rate && s.shear_rate_axis === 'left' ? 1 : 0)
                         + (s.show_pressure && s.pressure_axis === 'left' ? 1 : 0);
        const nRight = (s.show_temperature || s.show_bath_temperature ? 1 : 0)
                     + (s.show_shear_rate && s.shear_rate_axis === 'right' ? 1 : 0)
                     + (s.show_pressure && s.pressure_axis === 'right' ? 1 : 0);

        expect(nLeft).toBe(2);   // viscosity + shearRate(left)
        expect(nRight).toBe(2);  // temp/bath_temp + pressure(right)
    });

    it('full pipeline produces valid JSON for Rust deserialization', () => {
        const ctx = makeReportBuildContext();
        const pdf = buildPdfReportInput(ctx);
        const wasm = convertReportInputToWasm(pdf);
        const json = JSON.stringify(wasm);

        // Should be valid JSON
        expect(() => JSON.parse(json)).not.toThrow();

        // Should contain all top-level keys expected by Rust ReportInput
        const parsed = JSON.parse(json);
        expect(parsed).toHaveProperty('metadata');
        expect(parsed).toHaveProperty('raw_data');
        expect(parsed).toHaveProperty('cycle_results');
        expect(parsed).toHaveProperty('recipe');
        expect(parsed).toHaveProperty('settings');
        expect(parsed).toHaveProperty('axis_values');
        expect(parsed).toHaveProperty('cycles');
    });

    it('Excel pipeline produces valid JSON for Rust deserialization', () => {
        const ctx = makeReportBuildContext();
        const excel = buildExcelReportInput(ctx);
        const wasm = convertReportInputToWasm(excel);
        const json = JSON.stringify(wasm);

        const parsed = JSON.parse(json);
        expect(parsed).toHaveProperty('metadata');
        expect(parsed).toHaveProperty('raw_data');
        expect(parsed).toHaveProperty('cycle_results');
        expect(parsed).toHaveProperty('recipe');
        expect(parsed).toHaveProperty('settings');
    });

    /** Ensure exact snake_case field names match what Rust expects */
    it('settings field names are snake_case for Rust serde', () => {
        const ctx = makeReportBuildContext();
        const pdf = buildPdfReportInput(ctx);
        const wasm = convertReportInputToWasm(pdf) as any;
        const settings = wasm.settings;

        // Should use snake_case (NOT camelCase)
        expect(settings).toHaveProperty('show_temperature');
        expect(settings).not.toHaveProperty('showTemperature');

        expect(settings).toHaveProperty('unit_system');
        expect(settings).not.toHaveProperty('unitSystem');

        expect(settings).toHaveProperty('show_advanced_stats');
        expect(settings).not.toHaveProperty('showAdvancedStats');

        expect(settings).toHaveProperty('axis_mode');
        expect(settings).not.toHaveProperty('axisMode');

        expect(settings).toHaveProperty('shear_rate_axis');
        expect(settings).not.toHaveProperty('shearRateAxis');

        expect(settings).toHaveProperty('viscosity_shear_rates');
        expect(settings).not.toHaveProperty('viscosityShearRates');

        expect(settings).toHaveProperty('show_bath_temperature');
        expect(settings).not.toHaveProperty('showBathTemperature');
    });

    /** Ensure line settings use snake_case for Rust */
    it('line_settings keys use snake_case', () => {
        const ctx = makeReportBuildContext();
        const pdf = buildPdfReportInput(ctx);
        const wasm = convertReportInputToWasm(pdf) as any;
        const ls = wasm.settings.line_settings;

        expect(ls).toHaveProperty('shear_rate');
        expect(ls).not.toHaveProperty('shearRate');

        expect(ls).toHaveProperty('bath_temperature');
        expect(ls).not.toHaveProperty('bathTemperature');
    });
});

// ──────────────────────────────────────────────────────────────────
// 4. SETTINGS INDEPENDENCE: toggling one setting doesn't affect others
// ──────────────────────────────────────────────────────────────────

describe('Report Regression: settings independence', () => {
    it('changing show_advanced_stats does not affect visibility flags', () => {
        const ctx1 = makeReportBuildContext({ isExpert: true });
        const ctx2 = makeReportBuildContext({ isExpert: false });

        const pdf1 = buildPdfReportInput(ctx1);
        const pdf2 = buildPdfReportInput(ctx2);

        // Visibility flags should be the same regardless of isExpert
        expect(pdf1.settings.showTemperature).toBe(pdf2.settings.showTemperature);
        expect(pdf1.settings.showShearRate).toBe(pdf2.settings.showShearRate);
        expect(pdf1.settings.showPressure).toBe(pdf2.settings.showPressure);
        expect(pdf1.settings.showBathTemperature).toBe(pdf2.settings.showBathTemperature);

        // Only showAdvancedStats should differ
        expect(pdf1.settings.showAdvancedStats).toBe(true);
        expect(pdf2.settings.showAdvancedStats).toBe(false);
    });

    it('changing axis_mode does not affect show_advanced_stats', () => {
        const ctxInd = makeReportBuildContext({
            chartSettings: makeChartSettings({ comparisonAxisMode: 'individual' }),
        });
        const ctxShared = makeReportBuildContext({
            chartSettings: makeChartSettings({ comparisonAxisMode: 'shared' }),
        });

        const pdf1 = buildPdfReportInput(ctxInd);
        const pdf2 = buildPdfReportInput(ctxShared);

        expect(pdf1.settings.showAdvancedStats).toBe(true);
        expect(pdf2.settings.showAdvancedStats).toBe(true);
        expect(pdf1.settings.axisMode).toBe('individual');
        expect(pdf2.settings.axisMode).toBe('shared');
    });

    it('shear_rate_axis does not change when axis_mode changes', () => {
        const ctxLeft = makeReportBuildContext({
            chartSettings: makeChartSettings({
                comparisonAxisMode: 'shared',
                lines: { ...FIXTURE_LINE_SETTINGS, shearRate: { ...FIXTURE_LINE_SETTINGS.shearRate, axis: 'left' as const } },
            }),
        });
        const ctxRight = makeReportBuildContext({
            chartSettings: makeChartSettings({
                comparisonAxisMode: 'shared',
                lines: { ...FIXTURE_LINE_SETTINGS, shearRate: { ...FIXTURE_LINE_SETTINGS.shearRate, axis: 'right' as const } },
            }),
        });

        expect(buildPdfReportInput(ctxLeft).settings.shearRateAxis).toBe('left');
        expect(buildPdfReportInput(ctxRight).settings.shearRateAxis).toBe('right');
    });
});

// ──────────────────────────────────────────────────────────────────
// 5. SPECIFIC REGRESSIONS from commit history
// ──────────────────────────────────────────────────────────────────

describe('Report Regression: specific commit regressions', () => {
    /**
     * Regression: 622a0c9 — chart width must match stats table width.
     * The formula must use show_advanced_stats to conditionally include bingham cols.
     */
    it('[622a0c9] chart width formula: bingham columns conditional on show_advanced_stats', () => {
        // Expert: 7 fixed + 3 visc + 3 bingham = 13 columns
        const ctxExpert = makeReportBuildContext({ isExpert: true, reportViscosityRates: [40, 100, 170] });
        const expertWasm = convertReportInputToWasm(buildExcelReportInput(ctxExpert)) as any;
        const expertCols = 7 + expertWasm.settings.viscosity_shear_rates.length + (expertWasm.settings.show_advanced_stats ? 3 : 0);
        expect(expertCols).toBe(13);

        // Beginner: 7 fixed + 3 visc + 0 bingham = 10 columns
        const ctxBeginner = makeReportBuildContext({ isExpert: false, reportViscosityRates: [40, 100, 170] });
        const beginnerWasm = convertReportInputToWasm(buildExcelReportInput(ctxBeginner)) as any;
        const beginnerCols = 7 + beginnerWasm.settings.viscosity_shear_rates.length + (beginnerWasm.settings.show_advanced_stats ? 3 : 0);
        expect(beginnerCols).toBe(10);
    });

    /**
     * Regression: ab306c8 — shared mode margins identical to individual.
     * Settings-based axis counts must be computed from visibility flags + axis assignments.
     */
    it('[ab306c8] shared margin formula: n_settings_left and n_settings_right', () => {
        // Default: viscosity(left) + temp(right) + shearRate(right,hidden) + pressure(right,hidden) + bath(right)
        const ctx = makeReportBuildContext();
        const wasm = convertReportInputToWasm(buildPdfReportInput(ctx)) as any;
        const s = wasm.settings;

        // n_settings_left = 1 (viscosity always)
        // + 0 (shearRate hidden)
        // + 0 (pressure hidden)
        const nLeft = 1
            + (s.show_shear_rate && s.shear_rate_axis === 'left' ? 1 : 0)
            + (s.show_pressure && s.pressure_axis === 'left' ? 1 : 0);

        // n_settings_right =
        // + 1 (temp or bath visible) — they share the same axis
        // + 0 (shearRate hidden)
        // + 0 (pressure hidden)
        const nRight = (s.show_temperature || s.show_bath_temperature ? 1 : 0)
            + (s.show_shear_rate && s.shear_rate_axis === 'right' ? 1 : 0)
            + (s.show_pressure && s.pressure_axis === 'right' ? 1 : 0);

        expect(nLeft).toBe(1);
        expect(nRight).toBe(1);

        // axis_step = 60pt (AXIS_SPACING_PX)
        // extra = max(nLeft-1, nRight-1) = max(0, 0) = 0
        // margin = 28 + 0*60 = 28pt
        const extra = Math.max(nLeft - 1, nRight - 1, 0);
        const margin = 28 + extra * 60;
        expect(margin).toBe(28);
    });

    /**
     * Regression: 580d6c7 — show_bath_temperature field.
     * bath_temperature must be correctly mapped in raw_data AND settings.
     */
    it('[580d6c7] bath_temperature is present in both raw_data and settings', () => {
        const ctx = makeReportBuildContext();
        const pdf = buildPdfReportInput(ctx);
        const wasm = convertReportInputToWasm(pdf) as any;

        // raw_data
        expect(wasm.raw_data[0].bath_temperature_c).toBe(24);

        // settings
        expect(wasm.settings.show_bath_temperature).toBe(true);

        // line_settings
        expect(wasm.settings.line_settings.bath_temperature).toBeTruthy();
        expect(wasm.settings.line_settings.bath_temperature.color).toBe('#ea580c');
    });

    /**
     * Regression: 509a8e2 — recipe moved below summary in Excel.
     * The recipe section positions are determined by sequential current_row tracking.
     * This test ensures recipe data is present and correctly structured.
     */
    it('[509a8e2] recipe data is correctly structured for sequential row placement', () => {
        const ctx = makeReportBuildContext({
            editedRecipe: [
                { reagentName: 'Water', concentration: 950, unit: 'л/м³', category: 'Основа' } as any,
                { reagentName: 'PAC-HV', concentration: 5, unit: 'кг/м³', category: 'Полимер', batchNumber: 'LOT-001' } as any,
            ],
        });
        const pdf = buildPdfReportInput(ctx);
        const wasm = convertReportInputToWasm(pdf) as any;

        expect(wasm.recipe).toHaveLength(2);
        expect(wasm.recipe[0].name).toBe('Water');
        expect(wasm.recipe[0].concentration).toBe(950);
        expect(wasm.recipe[1].name).toBe('PAC-HV');
        expect(wasm.recipe[1].batch_number).toBe('LOT-001');
    });
});

// ──────────────────────────────────────────────────────────────────
// 6. TYPE CONTRACTS: ensure TS types match Rust expectations
// ──────────────────────────────────────────────────────────────────

describe('Report Regression: type contracts', () => {
    it('cycle_results use snake_case and include all computed fields', () => {
        const ctx = makeReportBuildContext();
        const pdf = buildPdfReportInput(ctx);
        const wasm = convertReportInputToWasm(pdf) as any;
        const c = wasm.cycle_results[0];

        expect(c).toHaveProperty('cycle_no', 1);
        expect(c).toHaveProperty('time_min', 2.0);
        expect(c).toHaveProperty('temp_c', 75);
        expect(c).toHaveProperty('n_prime', 0.85);
        expect(c).toHaveProperty('k_prime', 0.25);
        expect(c).toHaveProperty('r2', 0.998);
        expect(c).toHaveProperty('bingham_pv', 15.5);
        expect(c).toHaveProperty('bingham_yp', 8.2);
        expect(c).toHaveProperty('bingham_r2', 0.995);
        expect(c.viscosities).toBeTruthy();
    });

    it('metadata uses snake_case for all fields', () => {
        const ctx = makeReportBuildContext();
        const pdf = buildPdfReportInput(ctx);
        const wasm = convertReportInputToWasm(pdf) as any;
        const meta = wasm.metadata;

        expect(meta).toHaveProperty('test_id');
        expect(meta).not.toHaveProperty('testId');
        expect(meta).toHaveProperty('operator_name');
        expect(meta).not.toHaveProperty('operatorName');
        expect(meta).toHaveProperty('laboratory_name');
        expect(meta).toHaveProperty('field_name');
        expect(meta).toHaveProperty('well_number');
        expect(meta).toHaveProperty('instrument_type');
        expect(meta).toHaveProperty('company_name');
    });
});
