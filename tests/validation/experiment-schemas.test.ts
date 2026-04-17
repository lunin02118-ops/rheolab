import { describe, it, expect } from 'vitest';
import {
  WaterParamsSchema,
  RheoPointSchema,
  ExperimentReagentInputSchema,
  HydrationMetricsSchema,
  RheologyMetricsSchema,
  CalibrationSchema,
  ExperimentSavePayloadSchema,
  ReagentCatalogCreateSchema,
  ReagentCatalogUpdateSchema,
} from '@/lib/validation/experiment-schemas';

// ── WaterParamsSchema ────────────────────────────────────────────────────────

describe('WaterParamsSchema', () => {
  it('accepts valid water params', () => {
    const result = WaterParamsSchema.safeParse({
      ph: 7.2,
      fe: 0.01,
      ca: 120,
      mg: 30,
      cl: 250,
      so4: 80,
      hco3: 150,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all-null water params (empty form state)', () => {
    const result = WaterParamsSchema.safeParse({
      ph: null, fe: null, ca: null, mg: null, cl: null, so4: null, hco3: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts mixed null and number values', () => {
    const result = WaterParamsSchema.safeParse({
      ph: 7.2, fe: null, ca: 120, mg: null, cl: 250, so4: null, hco3: 150,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing fields', () => {
    const result = WaterParamsSchema.safeParse({ ph: 7 });
    expect(result.success).toBe(false);
  });

  it('rejects string values', () => {
    const result = WaterParamsSchema.safeParse({
      ph: '7.2',
      fe: 0, ca: 0, mg: 0, cl: 0, so4: 0, hco3: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ── RheoPointSchema ──────────────────────────────────────────────────────────

describe('RheoPointSchema', () => {
  it('accepts minimal required fields', () => {
    const result = RheoPointSchema.safeParse({
      time_sec: 0,
      viscosity_cp: 25.5,
      temperature_c: 20,
    });
    expect(result.success).toBe(true);
  });

  it('accepts all optional fields', () => {
    const result = RheoPointSchema.safeParse({
      time_sec: 60,
      viscosity_cp: 30,
      temperature_c: 25,
      shear_rate_s1: 170,
      shear_rate: 170,
      shear_stress_pa: 5.1,
      speed_rpm: 60,
      pressure_bar: 1.0,
      ph: 7.0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects Infinity in finite fields', () => {
    const result = RheoPointSchema.safeParse({
      time_sec: 0,
      viscosity_cp: Infinity,
      temperature_c: 20,
    });
    expect(result.success).toBe(false);
  });

  it('rejects NaN in finite fields', () => {
    const result = RheoPointSchema.safeParse({
      time_sec: 0,
      viscosity_cp: NaN,
      temperature_c: 20,
    });
    expect(result.success).toBe(false);
  });
});

// ── ExperimentReagentInputSchema ────────────────────────────────────────────

describe('ExperimentReagentInputSchema', () => {
  it('accepts valid reagent input', () => {
    const result = ExperimentReagentInputSchema.safeParse({
      reagentId: 'r-001',
      reagentName: 'Guar HV',
      concentration: 3.5,
      unit: 'kg/m3',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null batchNumber and productionDate', () => {
    const result = ExperimentReagentInputSchema.safeParse({
      reagentId: 'r-001',
      reagentName: 'Guar',
      concentration: 2,
      unit: 'kg/m3',
      batchNumber: null,
      productionDate: null,
    });
    expect(result.success).toBe(true);
  });

  it('coerces productionDate string to Date', () => {
    const result = ExperimentReagentInputSchema.safeParse({
      reagentId: 'r-001',
      reagentName: 'Guar',
      concentration: 2,
      unit: 'kg/m3',
      productionDate: '2024-01-15',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.productionDate).toBeInstanceOf(Date);
    }
  });
});

// ── HydrationMetricsSchema / RheologyMetricsSchema ──────────────────────────

describe('HydrationMetricsSchema', () => {
  it('accepts cold_water_5c subgroup', () => {
    const result = HydrationMetricsSchema.safeParse({
      maxViscosity: 120,
      timeToMax: 25,
      viscosityAt20Min: 80,
      avgViscosity55to60: 60,
      subgroup: 'cold_water_5c',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown subgroup', () => {
    const result = HydrationMetricsSchema.safeParse({
      maxViscosity: 120,
      timeToMax: 25,
      viscosityAt20Min: 80,
      avgViscosity55to60: 60,
      subgroup: 'unknown_group',
    });
    expect(result.success).toBe(false);
  });
});

describe('RheologyMetricsSchema', () => {
  it('accepts with_stabilizer subgroup', () => {
    const result = RheologyMetricsSchema.safeParse({
      n_prime: 0.45,
      k_prime: 0.32,
      initialViscosity_5_10: 90,
      comparisonViscosity_5_30: 75,
      avgViscosity_10_120: 65,
      subgroup: 'with_stabilizer',
    });
    expect(result.success).toBe(true);
  });
});

// ── CalibrationSchema ────────────────────────────────────────────────────────

describe('CalibrationSchema', () => {
  it('accepts PASS calibration', () => {
    const result = CalibrationSchema.safeParse({
      deviceType: 'HAAKE',
      rSquared: 0.9998,
      slope: 1.002,
      intercept: 0.001,
      hysteresis: 0.003,
      stdev: 0.15,
      status: 'PASS',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown status', () => {
    const result = CalibrationSchema.safeParse({
      deviceType: 'HAAKE',
      rSquared: 0.99,
      slope: 1,
      intercept: 0,
      hysteresis: 0,
      stdev: 0,
      status: 'UNKNOWN',
    });
    expect(result.success).toBe(false);
  });

  it('defaults rawData to empty array when omitted', () => {
    const result = CalibrationSchema.safeParse({
      deviceType: 'FANN',
      rSquared: 0.99,
      slope: 1,
      intercept: 0,
      hysteresis: 0,
      stdev: 0,
      status: 'FAIL',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rawData).toEqual([]);
    }
  });
});

// ── ExperimentSavePayloadSchema ──────────────────────────────────────────────

describe('ExperimentSavePayloadSchema', () => {
  const base = {
    name: 'Test Exp 001',
    originalFilename: 'exp001.xlsx',
    testDate: '2024-06-01',
    instrumentType: 'HAAKE RS',
    waterSource: 'Пресная вода',
    fluidType: 'Linear' as const,
    testGroup: 'Hydration' as const,
    metrics: { maxViscosity: 100 },
    rawPoints: [{ time_sec: 0, viscosity_cp: 25, temperature_c: 20 }],
  };

  it('accepts valid minimal payload', () => {
    const result = ExperimentSavePayloadSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('rejects empty experiment name', () => {
    const result = ExperimentSavePayloadSchema.safeParse({ ...base, name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('name');
    }
  });

  it('rejects empty waterSource', () => {
    const result = ExperimentSavePayloadSchema.safeParse({ ...base, waterSource: '' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid fluidType enum value', () => {
    const result = ExperimentSavePayloadSchema.safeParse({ ...base, fluidType: 'InvalidFluidType' });
    expect(result.success).toBe(false);
  });

  it('coerces testDate string to Date', () => {
    const result = ExperimentSavePayloadSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.testDate).toBeInstanceOf(Date);
    }
  });

  it('accepts testDate as Date object (Zod v4 regression guard)', () => {
    // Zod v4 z.coerce.date() rejected Date objects with "expected date, received Date".
    // Our union schema must accept both JS Date and ISO string.
    const result = ExperimentSavePayloadSchema.safeParse({ ...base, testDate: new Date('2024-06-01') });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.testDate).toBeInstanceOf(Date);
      expect(result.data.testDate.getFullYear()).toBe(2024);
    }
  });

  it('accepts productionDate as Date object in reagent', () => {
    const result = ExperimentSavePayloadSchema.safeParse({
      ...base,
      reagents: [{
        reagentId: 'r-1',
        reagentName: 'Гуар',
        concentration: 3,
        unit: 'kg/m3',
        productionDate: new Date('2023-05-10'),
      }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reagents[0].productionDate).toBeInstanceOf(Date);
    }
  });

  it('defaults reagents to [] when omitted', () => {
    const result = ExperimentSavePayloadSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reagents).toEqual([]);
    }
  });

  it('rejects Unicode-only name (1+ chars pass)', () => {
    const result = ExperimentSavePayloadSchema.safeParse({ ...base, name: 'Опыт №1' });
    expect(result.success).toBe(true);
  });

  it('accepts overwrite flag', () => {
    const result = ExperimentSavePayloadSchema.safeParse({ ...base, overwrite: true });
    expect(result.success).toBe(true);
  });
});

// ── ReagentCatalogCreateSchema ───────────────────────────────────────────────

describe('ReagentCatalogCreateSchema', () => {
  it('accepts valid reagent', () => {
    const result = ReagentCatalogCreateSchema.safeParse({
      name: 'Гуар ВВ',
      category: 'Полимер',
    });
    expect(result.success).toBe(true);
  });

  it('trims name whitespace', () => {
    const result = ReagentCatalogCreateSchema.safeParse({
      name: '  Гуар  ',
      category: 'Полимер',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Гуар');
    }
  });

  it('rejects empty name', () => {
    const result = ReagentCatalogCreateSchema.safeParse({ name: '', category: 'X' });
    expect(result.success).toBe(false);
  });
});

describe('ReagentCatalogUpdateSchema', () => {
  it('accepts partial update', () => {
    const result = ReagentCatalogUpdateSchema.safeParse({ description: 'Updated' });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all optional)', () => {
    const result = ReagentCatalogUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
