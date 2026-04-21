/**
 * Test suite for report generation input validation and conversion.
 * 
 * These tests validate that:
 * 1. Report input data is correctly structured for WASM consumption
 * 2. All raw data fields (including shear_stress_pa, speed_rpm) are mapped
 * 3. Special characters in metadata don't break Typst rendering
 * 4. Edge cases (empty data, missing optional fields) produce valid input
 * 5. show_raw_data flag is correctly passed through the pipeline
 */

import { describe, it, expect } from 'vitest';
import { convertReportInputToWasm } from '@/lib/analysis/report-types/converters';
import type { PdfReportInput, ExcelReportInput } from '@/lib/analysis/report-types/types';

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/** Build a minimal valid PdfReportInput with sensible defaults */
function createMinimalReportInput(overrides?: Partial<PdfReportInput>): PdfReportInput {
  return {
    metadata: {
      filename: 'test_report.xlsx',
      testId: 'TEST-001',
      testDate: '2025-01-01',
      operatorName: 'Оператор',
      laboratoryName: 'Лаборатория',
      fieldName: 'Месторождение',
      wellNumber: 'С-123',
      instrumentType: 'Grace M5600',
      geometry: 'R1B5',
      companyName: 'RheoLab',
    },
    rawData: [
      { time_sec: 0, viscosity_cp: 500, temperature_c: 25, shear_rate: 100, pressure_bar: 1.0 },
      { time_sec: 60, viscosity_cp: 550, temperature_c: 30, shear_rate: 100, pressure_bar: 1.1 },
      { time_sec: 120, viscosity_cp: 600, temperature_c: 35, shear_rate: 100, pressure_bar: 1.2 },
    ],
    cycleResults: [
      {
        cycleNo: 1, timeMin: 2.5, tempC: 35, pressure_bar: 1.1,
        nPrime: 0.85, kPrime: 0.25, r2: 0.998,
        viscAt40: 520, viscAt100: 480, viscAt170: 450,
        binghamPv: 15.5, binghamYp: 8.2, binghamR2: 0.995,
      },
    ],
    recipe: [
      { name: 'Water', unit: 'L/m3', concentration: 950, category: 'Base' },
      { name: 'Polymer', unit: 'kg/m3', concentration: 2.5, category: 'Viscosifier' },
    ],
    waterParams: { source: 'Tap Water', ph: 7.2, salinity: 1500 },
    settings: {
      language: 'ru',
      unitSystem: 'SI',
      showTemperature: true,
      showShearRate: true,
      showPressure: false,
      showTouchPoints: false,
      showCalibration: false,
      showRawData: false,
    },
    ...overrides,
  };
}

/** Build a report input with ALL raw data fields populated (including new shear_stress + rpm) */
function createFullRawDataInput(): PdfReportInput {
  return createMinimalReportInput({
    rawData: [
      { time_sec: 0, viscosity_cp: 1000, temperature_c: 25, shear_rate: 100, shear_stress_pa: 50, speed_rpm: 300, pressure_bar: 30 },
      { time_sec: 30, viscosity_cp: 950, temperature_c: 50, shear_rate: 100, shear_stress_pa: 48, speed_rpm: 300, pressure_bar: 30 },
      { time_sec: 60, viscosity_cp: 900, temperature_c: 75, shear_rate: 100, shear_stress_pa: 45, speed_rpm: 300, pressure_bar: 30 },
      { time_sec: 90, viscosity_cp: 850, temperature_c: 96, shear_rate: 100, shear_stress_pa: 42, speed_rpm: 300, pressure_bar: 30 },
      { time_sec: 120, viscosity_cp: 800, temperature_c: 96, shear_rate: 100, shear_stress_pa: 40, speed_rpm: 300, pressure_bar: 30 },
    ],
    settings: {
      language: 'ru',
      unitSystem: 'SI',
      showTemperature: true,
      showShearRate: true,
      showPressure: true,
      showTouchPoints: false,
      showCalibration: false,
      showRawData: true,  // KEY: raw data page enabled
    },
  });
}

// ──────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────

describe('Report Generation Input', () => {

  // ── Raw Data Fields ──

  describe('raw data field mapping', () => {
    it('includes shear_stress_pa and speed_rpm in WASM conversion', () => {
      const input = createFullRawDataInput();
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const rawData = wasm.raw_data as Array<Record<string, unknown>>;

      expect(rawData).toHaveLength(5);
      expect(rawData[0]).toHaveProperty('shear_stress_pa', 50);
      expect(rawData[0]).toHaveProperty('speed_rpm', 300);
      expect(rawData[0]).toHaveProperty('pressure_bar', 30);
      expect(rawData[0]).toHaveProperty('time_sec', 0);
      expect(rawData[0]).toHaveProperty('viscosity_cp', 1000);
      expect(rawData[0]).toHaveProperty('temperature_c', 25);
      expect(rawData[0]).toHaveProperty('shear_rate', 100);
    });

    it('maps missing optional fields to null for WASM', () => {
      const input = createMinimalReportInput({
        rawData: [
          { time_sec: 10, viscosity_cp: 500 },        // no optional fields
        ],
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const rawData = wasm.raw_data as Array<Record<string, unknown>>;

      expect(rawData[0].shear_stress_pa).toBeNull();
      expect(rawData[0].speed_rpm).toBeNull();
      expect(rawData[0].pressure_bar).toBeNull();
      expect(rawData[0].temperature_c).toBeNull();
      expect(rawData[0].shear_rate).toBeNull();
    });

    it('maps partial raw data fields correctly', () => {
      const input = createMinimalReportInput({
        rawData: [
          { time_sec: 10, viscosity_cp: 500, shear_stress_pa: 25 },  // only stress, no rpm
        ],
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const rawData = wasm.raw_data as Array<Record<string, unknown>>;

      expect(rawData[0].shear_stress_pa).toBe(25);
      expect(rawData[0].speed_rpm).toBeNull();
    });
  });

  // ── show_raw_data flag ──

  describe('show_raw_data setting', () => {
    it('passes show_raw_data=true through conversion', () => {
      const input = createMinimalReportInput({
        settings: {
          language: 'ru', unitSystem: 'SI',
          showTemperature: true, showShearRate: true, showPressure: false,
          showTouchPoints: false, showCalibration: false,
          showRawData: true,
        },
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const settings = wasm.settings as Record<string, unknown>;
      expect(settings.show_raw_data).toBe(true);
    });

    it('defaults show_raw_data to false when not specified', () => {
      const input = createMinimalReportInput();
      delete input.settings.showRawData;
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const settings = wasm.settings as Record<string, unknown>;
      expect(settings.show_raw_data).toBe(false);
    });
  });

  // ── JSON Structure Validation ──

  describe('WASM JSON structure', () => {
    it('produces valid JSON that can be serialized/deserialized', () => {
      const input = createFullRawDataInput();
      const wasm = convertReportInputToWasm(input);
      const json = JSON.stringify(wasm);

      expect(json).toBeTruthy();
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json);
      expect(parsed.metadata).toBeDefined();
      expect(parsed.raw_data).toBeDefined();
      expect(parsed.cycle_results).toBeDefined();
      expect(parsed.recipe).toBeDefined();
      expect(parsed.settings).toBeDefined();
    });

    it('includes all 7 raw data columns in snake_case', () => {
      const input = createFullRawDataInput();
      const wasm = convertReportInputToWasm(input);
      const json = JSON.stringify(wasm);
      const parsed = JSON.parse(json);

      const point = parsed.raw_data[0];
      const requiredKeys = ['time_sec', 'viscosity_cp', 'temperature_c', 'shear_rate', 'shear_stress_pa', 'speed_rpm', 'pressure_bar'];
      for (const key of requiredKeys) {
        expect(point).toHaveProperty(key);
      }
    });

    it('uses correct snake_case for all settings fields', () => {
      const input = createFullRawDataInput();
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const settings = wasm.settings as Record<string, unknown>;

      expect(settings).toHaveProperty('language');
      expect(settings).toHaveProperty('unit_system');
      expect(settings).toHaveProperty('show_temperature');
      expect(settings).toHaveProperty('show_shear_rate');
      expect(settings).toHaveProperty('show_pressure');
      expect(settings).toHaveProperty('show_raw_data');
      expect(settings).toHaveProperty('show_calibration');
      expect(settings).toHaveProperty('show_touch_points');
    });
  });

  // ── Special Characters in Metadata ──

  describe('special characters in metadata', () => {
    it('handles Typst-dangerous characters in filename', () => {
      const dangerousNames = [
        'report_{test}.xlsx',       // curly braces
        'report_[test].xlsx',       // square brackets
        'report_#1.xlsx',           // hash
        'report@field.xlsx',        // at sign
        'report_$100.xlsx',         // dollar sign
        'price < cost > value.xlsx', // angle brackets
        'test *bold* result.xlsx',  // asterisks
        'file `code` name.xlsx',   // backticks
        'my_file_v2.xlsx',         // underscores
      ];

      for (const name of dangerousNames) {
        const input = createMinimalReportInput({
          metadata: { filename: name },
        });
        const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
        const metadata = wasm.metadata as Record<string, unknown>;
        
        // The converter should pass the name as-is; escaping happens in Rust
        expect(metadata.filename).toBe(name);
        
        // Must be valid JSON
        expect(() => JSON.stringify(wasm)).not.toThrow();
      }
    });

    it('handles curly braces in company name (Typst delimiter bug)', () => {
      const input = createMinimalReportInput({
        metadata: { filename: 'test.xlsx', companyName: 'Company {Inc}' },
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const metadata = wasm.metadata as Record<string, unknown>;
      expect(metadata.company_name).toBe('Company {Inc}');
    });

    it('handles curly braces in recipe names', () => {
      const input = createMinimalReportInput({
        recipe: [
          { name: 'Reagent {A}', unit: 'kg/m3', concentration: 1.0 },
        ],
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const recipe = wasm.recipe as Array<Record<string, unknown>>;
      expect(recipe[0].name).toBe('Reagent {A}');
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('handles empty raw data array', () => {
      const input = createMinimalReportInput({ rawData: [] });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      expect(wasm.raw_data).toEqual([]);
      expect(wasm.axis_values).toBeNull();
    });

    it('handles missing rawData (undefined)', () => {
      const input = createMinimalReportInput();
      // @ts-expect-error test undefined rawData
      delete input.rawData;
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      expect(wasm.raw_data).toEqual([]);
    });

    it('handles very large raw data sets', () => {
      const bigData = Array.from({ length: 5000 }, (_, i) => ({
        time_sec: i * 10,
        viscosity_cp: 500 + Math.random() * 500,
        temperature_c: 25 + i * 0.01,
        shear_rate: 100,
        shear_stress_pa: 50,
        speed_rpm: 300,
        pressure_bar: 30,
      }));

      const input = createMinimalReportInput({ rawData: bigData });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const rawData = wasm.raw_data as Array<Record<string, unknown>>;
      
      expect(rawData).toHaveLength(5000);
      expect(rawData[4999]).toHaveProperty('shear_stress_pa', 50);
      expect(rawData[4999]).toHaveProperty('speed_rpm', 300);
    });

    it('handles calibration data with show_calibration enabled', () => {
      const input = createMinimalReportInput({
        metadata: {
          filename: 'test.xlsx',
          calibration: {
            deviceType: 'Viscometer V1',
            calibrationDate: '2025-01-01',
            rSquared: 0.9999,
            slope: 1.001,
            intercept: 0.05,
            hysteresis: 0.1,
            stdev: 0.02,
            status: 'PASS',
          },
        },
        settings: {
          language: 'ru', unitSystem: 'SI',
          showTemperature: true, showShearRate: true, showPressure: false,
          showTouchPoints: false, showCalibration: true, showRawData: true,
        },
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const metadata = wasm.metadata as Record<string, unknown>;
      const calibration = metadata.calibration as Record<string, unknown>;

      expect(calibration).toBeDefined();
      expect(calibration.r_squared).toBe(0.9999);
      expect(calibration.status).toBe('PASS');
    });

    it('handles both PDF and Excel inputs identically', () => {
      const pdfInput = createFullRawDataInput();
      const excelInput: ExcelReportInput = { ...pdfInput };

      const pdfWasm = convertReportInputToWasm(pdfInput);
      const excelWasm = convertReportInputToWasm(excelInput);

      expect(JSON.stringify(pdfWasm)).toBe(JSON.stringify(excelWasm));
    });
  });

  // ── Regression: Report Data Structure Completeness ──

  describe('regression: complete data structure', () => {
    it('raw_data columns count matches expected table schema (9 columns)', () => {
      const input = createFullRawDataInput();
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const rawData = wasm.raw_data as Array<Record<string, unknown>>;

      // 9 columns: #, time_sec, viscosity_cp, temperature_c, shear_rate,
      //            shear_stress_pa, speed_rpm, pressure_bar, bath_temperature_c
      // The # column is generated by the Rust code (index+1), so raw_data has 8 fields
      const point = rawData[0];
      const dataKeys = Object.keys(point);
      expect(dataKeys).toHaveLength(8);
      expect(dataKeys).toContain('time_sec');
      expect(dataKeys).toContain('viscosity_cp');
      expect(dataKeys).toContain('temperature_c');
      expect(dataKeys).toContain('shear_rate');
      expect(dataKeys).toContain('shear_stress_pa');
      expect(dataKeys).toContain('speed_rpm');
      expect(dataKeys).toContain('pressure_bar');
      expect(dataKeys).toContain('bath_temperature_c');
    });

    it('settings include all necessary render flags', () => {
      const input = createFullRawDataInput();
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const settings = wasm.settings as Record<string, unknown>;

      // All flags required by the Rust report generator
      const requiredFlags = [
        'language', 'unit_system',
        'show_temperature', 'show_shear_rate', 'show_pressure',
        'show_touch_points', 'show_calibration', 'show_raw_data',
        'shear_rate_axis', 'pressure_axis',
        'viscosity_shear_rates',
      ];

      for (const flag of requiredFlags) {
        expect(settings).toHaveProperty(flag);
      }
    });

    it('metadata has all required fields for Typst template', () => {
      const input = createMinimalReportInput();
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const metadata = wasm.metadata as Record<string, unknown>;

      const requiredFields = [
        'filename', 'test_id', 'test_date', 'operator_name',
        'laboratory_name', 'field_name', 
        'well_number', 'instrument_type', 'company_name',
      ];

      for (const field of requiredFields) {
        expect(metadata).toHaveProperty(field);
      }
    });

    it('cycle_results uses snake_case field names', () => {
      const input = createMinimalReportInput();
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const cycles = wasm.cycle_results as Array<Record<string, unknown>>;

      const cycle = cycles[0];
      expect(cycle).toHaveProperty('cycle_no');
      expect(cycle).toHaveProperty('time_min');
      expect(cycle).toHaveProperty('temp_c');
      expect(cycle).toHaveProperty('n_prime');
      expect(cycle).toHaveProperty('k_prime');
      expect(cycle).toHaveProperty('r2');
      expect(cycle).toHaveProperty('visc_at_40');
      expect(cycle).toHaveProperty('visc_at_100');
      expect(cycle).toHaveProperty('visc_at_170');
      expect(cycle).toHaveProperty('bingham_pv');
      expect(cycle).toHaveProperty('bingham_yp');
      expect(cycle).toHaveProperty('bingham_r2');
    });
  });

  // ── Settings Visibility Flags ──

  describe('settings visibility flags', () => {
    type VisibilityCase = { tsFlag: keyof typeof settingsBase; wasmFlag: string };
    const settingsBase = {
      language: 'ru' as const,
      unitSystem: 'SI' as const,
      showTouchPoints: false,
      showCalibration: false,
      showRawData: false,
      showTemperature: false,
      showShearRate: false,
      showPressure: false,
      showBathTemperature: false,
    };

    const visibilityLines: VisibilityCase[] = [
      { tsFlag: 'showTemperature',     wasmFlag: 'show_temperature' },
      { tsFlag: 'showShearRate',       wasmFlag: 'show_shear_rate' },
      { tsFlag: 'showPressure',        wasmFlag: 'show_pressure' },
      { tsFlag: 'showBathTemperature', wasmFlag: 'show_bath_temperature' },
    ];

    for (const { tsFlag, wasmFlag } of visibilityLines) {
      it(`${tsFlag}: true → ${wasmFlag}: true in WASM settings`, () => {
        const input = createMinimalReportInput({
          settings: { ...settingsBase, [tsFlag]: true } as PdfReportInput['settings'],
        });
        const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
        const settings = wasm.settings as Record<string, unknown>;
        expect(settings[wasmFlag]).toBe(true);
      });

      it(`${tsFlag}: false → ${wasmFlag}: false in WASM settings`, () => {
        const input = createMinimalReportInput({
          settings: { ...settingsBase, [tsFlag]: false } as PdfReportInput['settings'],
        });
        const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
        const settings = wasm.settings as Record<string, unknown>;
        expect(settings[wasmFlag]).toBe(false);
      });
    }

    it('showBathTemperature defaults to false when omitted', () => {
      const input = createMinimalReportInput();
      // ensure field is absent (createMinimalReportInput doesn't set it)
      delete (input.settings as Record<string, unknown>)['showBathTemperature'];
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const settings = wasm.settings as Record<string, unknown>;
      expect(settings['show_bath_temperature']).toBe(false);
    });

    it('all visibility flags are independent — toggling one does not affect others', () => {
      const input = createMinimalReportInput({
        settings: {
          ...settingsBase,
          showTemperature: true,
          showShearRate: false,
          showPressure: true,
          showBathTemperature: false,
        },
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const settings = wasm.settings as Record<string, unknown>;

      expect(settings['show_temperature']).toBe(true);
      expect(settings['show_shear_rate']).toBe(false);
      expect(settings['show_pressure']).toBe(true);
      expect(settings['show_bath_temperature']).toBe(false);
    });
  });

  // ── bath_temperature_c raw data passthrough ──

  describe('bath_temperature_c raw data field', () => {
    it('passes bath_temperature_c through converter when present', () => {
      const input = createMinimalReportInput({
        rawData: [
          { time_sec: 0, viscosity_cp: 500, temperature_c: 30, bath_temperature_c: 45.5 },
          { time_sec: 60, viscosity_cp: 550, temperature_c: 31, bath_temperature_c: 46.0 },
        ],
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const rawData = wasm.raw_data as Array<Record<string, unknown>>;

      expect(rawData[0].bath_temperature_c).toBe(45.5);
      expect(rawData[1].bath_temperature_c).toBe(46.0);
    });

    it('maps bath_temperature_c to null when absent', () => {
      const input = createMinimalReportInput({
        rawData: [{ time_sec: 0, viscosity_cp: 500 }],
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const rawData = wasm.raw_data as Array<Record<string, unknown>>;

      expect(rawData[0].bath_temperature_c).toBeNull();
    });

    it('bath_temperature_c and temperature_c are independent fields', () => {
      const input = createMinimalReportInput({
        rawData: [{ time_sec: 0, viscosity_cp: 500, temperature_c: 30, bath_temperature_c: 55 }],
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const rawData = wasm.raw_data as Array<Record<string, unknown>>;

      expect(rawData[0].temperature_c).toBe(30);      // sample temp
      expect(rawData[0].bath_temperature_c).toBe(55); // heater/bath temp
    });
  });

  // ── Axis Mode (single source of truth for PDF & Excel) ──

  describe('axis mode — single source of truth', () => {
    /**
     * The axis layout mode ('individual' | 'shared') comes from
     * chartSettings.comparisonAxisMode and must flow through the converter
     * unchanged so the Rust generator produces the correct chart axes.
     *
     * 'individual' (Раздельные): viscosity on its own left scale;
     *   shear rate / pressure move to the right secondary axis.
     * 'shared'     (Общие):      metrics on the same side share one scale.
     */

    it('defaults axis_mode to "individual" when axisMode is not specified', () => {
      const input = createMinimalReportInput();
      // axisMode intentionally absent from settings
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const settings = wasm.settings as Record<string, unknown>;

      expect(settings.axis_mode).toBe('individual');
    });

    it('converts axisMode "individual" to axis_mode "individual" in WASM settings', () => {
      const input = createMinimalReportInput({
        settings: {
          language: 'ru', unitSystem: 'SI',
          showTemperature: true, showShearRate: true, showPressure: false,
          showTouchPoints: false, showCalibration: false,
          axisMode: 'individual',
        },
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const settings = wasm.settings as Record<string, unknown>;

      expect(settings.axis_mode).toBe('individual');
    });

    it('converts axisMode "shared" to axis_mode "shared" in WASM settings', () => {
      const input = createMinimalReportInput({
        settings: {
          language: 'ru', unitSystem: 'SI',
          showTemperature: true, showShearRate: true, showPressure: false,
          showTouchPoints: false, showCalibration: false,
          axisMode: 'shared',
        },
      });
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const settings = wasm.settings as Record<string, unknown>;

      expect(settings.axis_mode).toBe('shared');
    });

    it('axis_mode is present in serialised JSON sent to Rust', () => {
      const input = createMinimalReportInput({
        settings: {
          language: 'ru', unitSystem: 'SI',
          showTemperature: true, showShearRate: true, showPressure: false,
          showTouchPoints: false, showCalibration: false,
          axisMode: 'individual',
        },
      });
      const wasm = convertReportInputToWasm(input);
      const json = JSON.stringify(wasm);
      const parsed = JSON.parse(json) as { settings: Record<string, unknown> };

      // Rust deserialises "axis_mode" from this JSON; must be present & correct
      expect(parsed.settings.axis_mode).toBe('individual');
    });

    it('axis_mode appears in ExcelReportInput conversion as well', () => {
      // ExcelReportInput has the same settings shape as PdfReportInput
      const input: import('@/lib/analysis/report-types/types').ExcelReportInput = {
        ...(createMinimalReportInput() as unknown as import('@/lib/analysis/report-types/types').ExcelReportInput),
        settings: {
          language: 'en', unitSystem: 'API',
          showTemperature: false, showShearRate: true, showPressure: false,
          showTouchPoints: false, showCalibration: false,
          axisMode: 'shared',
        },
      };
      const wasm = convertReportInputToWasm(input) as Record<string, unknown>;
      const settings = wasm.settings as Record<string, unknown>;

      expect(settings.axis_mode).toBe('shared');
    });

    it('axis_mode is independent of shearRateAxis setting', () => {
      // Changing shearRateAxis does not affect axis_mode and vice-versa
      const makeInput = (axisMode: 'individual' | 'shared', shearRateAxis: string) =>
        createMinimalReportInput({
          settings: {
            language: 'ru', unitSystem: 'SI',
            showTemperature: true, showShearRate: true, showPressure: false,
            showTouchPoints: false, showCalibration: false,
            axisMode,
            shearRateAxis,
          },
        });

      const w1 = convertReportInputToWasm(makeInput('individual', 'left')) as Record<string, unknown>;
      const w2 = convertReportInputToWasm(makeInput('individual', 'right')) as Record<string, unknown>;
      const w3 = convertReportInputToWasm(makeInput('shared', 'left')) as Record<string, unknown>;

      expect((w1.settings as Record<string, unknown>).axis_mode).toBe('individual');
      expect((w1.settings as Record<string, unknown>).shear_rate_axis).toBe('left');

      expect((w2.settings as Record<string, unknown>).axis_mode).toBe('individual');
      expect((w2.settings as Record<string, unknown>).shear_rate_axis).toBe('right');

      expect((w3.settings as Record<string, unknown>).axis_mode).toBe('shared');
      expect((w3.settings as Record<string, unknown>).shear_rate_axis).toBe('left');
    });
  });
});
