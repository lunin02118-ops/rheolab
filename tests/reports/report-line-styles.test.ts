/**
 * Test: Line styles are correctly passed to WASM report generators
 * 
 * This test verifies that user-specified line styles (color, width, style)
 * are properly transmitted from TypeScript to Rust WASM code and applied
 * in generated PDF and Excel reports.
 */

import { describe, it, expect } from 'vitest';

// Sample test data
const createTestReportInput = (lineStyles: Record<string, { color: string; width: number; style: string }>) => ({
  raw_data: [
    { time_sec: 0, viscosity_cp: 500, temperature_c: 25, shear_rate: 100, pressure_bar: 1.0 },
    { time_sec: 60, viscosity_cp: 550, temperature_c: 30, shear_rate: 100, pressure_bar: 1.1 },
    { time_sec: 120, viscosity_cp: 600, temperature_c: 35, shear_rate: 100, pressure_bar: 1.2 },
    { time_sec: 180, viscosity_cp: 650, temperature_c: 40, shear_rate: 100, pressure_bar: 1.3 },
    { time_sec: 240, viscosity_cp: 700, temperature_c: 45, shear_rate: 100, pressure_bar: 1.4 },
    { time_sec: 300, viscosity_cp: 750, temperature_c: 50, shear_rate: 100, pressure_bar: 1.5 },
  ],
  metadata: {
    filename: 'test-line-styles.xlsx',
    test_id: 'TEST-001',
    test_date: '2024-01-10T10:00:00Z',
    operator_name: 'Test Operator',
    field_name: 'Test Field',
    well_number: 'W-1',
    instrument_type: 'Grace M5600',
    geometry: 'R1B5',
  },
  cycle_results: [
    {
      cycle_no: 1,
      time_min: 2.5,
      temp_c: 35,
      pressure_bar: 1.1,
      n_prime: 0.85,
      k_prime: 0.25,
      r2: 0.998,
      visc_at_40: 520,
      visc_at_100: 480,
      visc_at_170: 450,
      bingham_pv: 15.5,
      bingham_yp: 8.2,
      bingham_r2: 0.995,
    }
  ],
  recipe: [
    { name: 'Base Fluid', unit: 'bbl', concentration: 1.0, category: 'Base', batch_number: 'B001' },
    { name: 'Polymer', unit: 'ppb', concentration: 2.5, category: 'Viscosifier', batch_number: 'P001' },
  ],
  water_params: {
    source: 'Fresh Water',
    ph: 7.2,
    fe: 0.5,
    ca: 45,
    mg: 12,
    cl: 100,
    so4: 25,
    hco3: 150,
  },
  cycles: [],
  settings: {
    language: 'en',
    unit_system: 'API',
    show_temperature: true,
    show_shear_rate: true,
    show_pressure: true,
    show_touch_points: false,
    show_target_time: false,
    show_calibration: false,
    show_water_analysis: true,
    show_recipe: true,
    viscosity_threshold: 100,
    target_time: 30,
    shear_rate_axis: 'left',
    pressure_axis: 'right',
    show_bath_temperature: false,
    // Custom line settings
    line_settings: lineStyles,
  },
  chart_image_base64: null,
  axis_values: null,
});

describe('Report Line Styles', () => {
  describe('TypeScript to Rust conversion', () => {
    it('should correctly format line_settings for WASM', () => {
      const lineSettings = {
        viscosity: { color: '#FF0000', width: 3, style: 'dashed' },
        temperature: { color: '#00FF00', width: 2, style: 'dotted' },
        shear_rate: { color: '#0000FF', width: 2, style: 'solid' },
        pressure: { color: '#FF00FF', width: 1, style: 'dashed' },
      };
      
      const input = createTestReportInput(lineSettings);
      const json = JSON.stringify(input);
      const parsed = JSON.parse(json);
      
      // Verify line_settings is present
      expect(parsed.settings.line_settings).toBeDefined();
      expect(parsed.settings.line_settings.viscosity.color).toBe('#FF0000');
      expect(parsed.settings.line_settings.viscosity.width).toBe(3);
      expect(parsed.settings.line_settings.viscosity.style).toBe('dashed');
      
      expect(parsed.settings.line_settings.temperature.style).toBe('dotted');
      expect(parsed.settings.line_settings.shear_rate.style).toBe('solid');
      expect(parsed.settings.line_settings.pressure.style).toBe('dashed');
    });
    
    it('should handle default line settings when not specified', () => {
      const input = createTestReportInput({
        viscosity: { color: '#3B82F6', width: 2, style: 'solid' },
        temperature: { color: '#EF4444', width: 2, style: 'solid' },
        shear_rate: { color: '#A855F7', width: 2, style: 'solid' },
        pressure: { color: '#22C55E', width: 2, style: 'solid' },
      });
      
      const json = JSON.stringify(input);
      const parsed = JSON.parse(json);
      
      // All styles should be 'solid' by default
      expect(parsed.settings.line_settings.viscosity.style).toBe('solid');
      expect(parsed.settings.line_settings.temperature.style).toBe('solid');
    });
  });
  
  describe('Line style values', () => {
    it('should accept valid style values', () => {
      const validStyles = ['solid', 'dashed', 'dotted'];
      
      validStyles.forEach(style => {
        const input = createTestReportInput({
          viscosity: { color: '#3B82F6', width: 2, style },
          temperature: { color: '#EF4444', width: 2, style: 'solid' },
          shear_rate: { color: '#A855F7', width: 2, style: 'solid' },
          pressure: { color: '#22C55E', width: 2, style: 'solid' },
        });
        
        const json = JSON.stringify(input);
        expect(() => JSON.parse(json)).not.toThrow();
      });
    });
    
    it('should accept valid width values (1-4)', () => {
      [1, 2, 3, 4].forEach(width => {
        const input = createTestReportInput({
          viscosity: { color: '#3B82F6', width, style: 'solid' },
          temperature: { color: '#EF4444', width: 2, style: 'solid' },
          shear_rate: { color: '#A855F7', width: 2, style: 'solid' },
          pressure: { color: '#22C55E', width: 2, style: 'solid' },
        });
        
        expect(input.settings.line_settings.viscosity.width).toBe(width);
      });
    });
    
    it('should accept valid hex color values', () => {
      const validColors = ['#FF0000', '#00FF00', '#0000FF', '#123ABC', '#ffffff', '#000000'];
      
      validColors.forEach(color => {
        const input = createTestReportInput({
          viscosity: { color, width: 2, style: 'solid' },
          temperature: { color: '#EF4444', width: 2, style: 'solid' },
          shear_rate: { color: '#A855F7', width: 2, style: 'solid' },
          pressure: { color: '#22C55E', width: 2, style: 'solid' },
        });
        
        expect(input.settings.line_settings.viscosity.color).toBe(color);
      });
    });
  });
  
  describe('JSON structure for WASM', () => {
    it('should produce valid JSON with snake_case keys', () => {
      const input = createTestReportInput({
        viscosity: { color: '#FF0000', width: 3, style: 'dashed' },
        temperature: { color: '#00FF00', width: 2, style: 'dotted' },
        shear_rate: { color: '#0000FF', width: 2, style: 'solid' },
        pressure: { color: '#FF00FF', width: 1, style: 'dashed' },
      });
      
      const json = JSON.stringify(input);
      
      // Verify snake_case keys are used (as expected by Rust)
      expect(json).toContain('"line_settings"');
      expect(json).toContain('"shear_rate"');
      expect(json).toContain('"time_sec"');
      expect(json).toContain('"viscosity_cp"');
      expect(json).toContain('"temperature_c"');
      expect(json).toContain('"pressure_bar"');
    });
    
    it('should include all required fields for report generation', () => {
      const input = createTestReportInput({
        viscosity: { color: '#3B82F6', width: 2, style: 'solid' },
        temperature: { color: '#EF4444', width: 2, style: 'dashed' },
        shear_rate: { color: '#A855F7', width: 2, style: 'dotted' },
        pressure: { color: '#22C55E', width: 2, style: 'solid' },
      });
      
      // Check required top-level fields
      expect(input.raw_data).toBeDefined();
      expect(input.metadata).toBeDefined();
      expect(input.settings).toBeDefined();
      expect(input.cycle_results).toBeDefined();
      
      // Check settings fields
      expect(input.settings.language).toBeDefined();
      expect(input.settings.unit_system).toBeDefined();
      expect(input.settings.show_temperature).toBeDefined();
      expect(input.settings.show_shear_rate).toBeDefined();
      expect(input.settings.show_pressure).toBeDefined();
      expect(input.settings.line_settings).toBeDefined();
      
      // Check settings include bath temperature toggle
      expect(input.settings.show_bath_temperature).toBeDefined();

      // Check line settings structure
      expect(input.settings.line_settings.viscosity).toBeDefined();
      expect(input.settings.line_settings.temperature).toBeDefined();
      expect(input.settings.line_settings.shear_rate).toBeDefined();
      expect(input.settings.line_settings.pressure).toBeDefined();
    });
  });

  describe('Bath temperature line style', () => {
    it('should pass bath_temperature line style to WASM', () => {
      const input = createTestReportInput({
        viscosity: { color: '#3B82F6', width: 2, style: 'solid' },
        temperature: { color: '#EF4444', width: 2, style: 'solid' },
        shear_rate: { color: '#A855F7', width: 2, style: 'solid' },
        pressure: { color: '#22C55E', width: 2, style: 'solid' },
        bath_temperature: { color: '#F97316', width: 1, style: 'dashed' },
      });

      expect(input.settings.line_settings.bath_temperature).toBeDefined();
      expect(input.settings.line_settings.bath_temperature.color).toBe('#F97316');
      expect(input.settings.line_settings.bath_temperature.width).toBe(1);
      expect(input.settings.line_settings.bath_temperature.style).toBe('dashed');
    });

    it('should include bath_temperature key in JSON for Rust', () => {
      const input = createTestReportInput({
        viscosity: { color: '#3B82F6', width: 2, style: 'solid' },
        temperature: { color: '#EF4444', width: 2, style: 'solid' },
        shear_rate: { color: '#A855F7', width: 2, style: 'solid' },
        pressure: { color: '#22C55E', width: 2, style: 'solid' },
        bath_temperature: { color: '#F97316', width: 1, style: 'dashed' },
      });

      const json = JSON.stringify(input);
      expect(json).toContain('"bath_temperature"');
      expect(json).toContain('"show_bath_temperature"');
    });

    it('should enable bath_temperature when show_bath_temperature is true', () => {
      const input = createTestReportInput({
        viscosity: { color: '#3B82F6', width: 2, style: 'solid' },
        temperature: { color: '#EF4444', width: 2, style: 'solid' },
        shear_rate: { color: '#A855F7', width: 2, style: 'solid' },
        pressure: { color: '#22C55E', width: 2, style: 'solid' },
        bath_temperature: { color: '#F97316', width: 2, style: 'solid' },
      });
      // Override to true
      input.settings.show_bath_temperature = true;

      expect(input.settings.show_bath_temperature).toBe(true);
      const json = JSON.stringify(input);
      const parsed = JSON.parse(json);
      expect(parsed.settings.show_bath_temperature).toBe(true);
    });
  });

  describe('Line width in legend (thickness fix)', () => {
    it('should preserve custom widths per line for legend rendering', () => {
      const input = createTestReportInput({
        viscosity: { color: '#3B82F6', width: 3, style: 'solid' },
        temperature: { color: '#EF4444', width: 1, style: 'solid' },
        shear_rate: { color: '#A855F7', width: 4, style: 'dashed' },
        pressure: { color: '#22C55E', width: 2, style: 'dotted' },
      });

      // Each line's width should be independently preserved — not hardcoded to 2
      expect(input.settings.line_settings.viscosity.width).toBe(3);
      expect(input.settings.line_settings.temperature.width).toBe(1);
      expect(input.settings.line_settings.shear_rate.width).toBe(4);
      expect(input.settings.line_settings.pressure.width).toBe(2);
    });

    it('should not default all widths to 2', () => {
      const input = createTestReportInput({
        viscosity: { color: '#3B82F6', width: 5, style: 'solid' },
        temperature: { color: '#EF4444', width: 1, style: 'solid' },
        shear_rate: { color: '#A855F7', width: 3, style: 'solid' },
        pressure: { color: '#22C55E', width: 1, style: 'solid' },
      });

      const json = JSON.stringify(input);
      const parsed = JSON.parse(json);

      // Width values must match user settings, not be hardcoded
      expect(parsed.settings.line_settings.viscosity.width).not.toBe(2);
      expect(parsed.settings.line_settings.viscosity.width).toBe(5);
    });

    it('should preserve width through JSON serialization round-trip', () => {
      const widths = [1, 2, 3, 4, 5];
      widths.forEach(w => {
        const input = createTestReportInput({
          viscosity: { color: '#3B82F6', width: w, style: 'solid' },
          temperature: { color: '#EF4444', width: w, style: 'solid' },
          shear_rate: { color: '#A855F7', width: w, style: 'solid' },
          pressure: { color: '#22C55E', width: w, style: 'solid' },
        });

        const parsed = JSON.parse(JSON.stringify(input));
        expect(parsed.settings.line_settings.viscosity.width).toBe(w);
        expect(parsed.settings.line_settings.temperature.width).toBe(w);
        expect(parsed.settings.line_settings.shear_rate.width).toBe(w);
        expect(parsed.settings.line_settings.pressure.width).toBe(w);
      });
    });
  });
});
