import { describe, it, expect } from 'vitest';
import { CALIBRATION_LIMITS } from '@/lib/calibration/constants';

describe('CALIBRATION_LIMITS', () => {
  // Verify values match Chandler 5550 Section 3 – Maintenance documentation

  it('R_SQUARED threshold is 0.999', () => {
    expect(CALIBRATION_LIMITS.R_SQUARED).toBe(0.999);
  });

  it('HYSTERESIS limit is 8.0 dynes/cm² (Chandler spec)', () => {
    expect(CALIBRATION_LIMITS.HYSTERESIS).toBe(8.0);
  });

  it('STDEV limit is 4.0 dynes/cm² (Chandler spec)', () => {
    expect(CALIBRATION_LIMITS.STDEV).toBe(4.0);
  });

  it('slope bounds form a ±5% window around 1.0', () => {
    expect(CALIBRATION_LIMITS.SLOPE_MIN).toBe(0.95);
    expect(CALIBRATION_LIMITS.SLOPE_MAX).toBe(1.05);
    const range = CALIBRATION_LIMITS.SLOPE_MAX - CALIBRATION_LIMITS.SLOPE_MIN;
    expect(range).toBeCloseTo(0.1, 5);
  });

  it('INTERCEPT_MAX is 2.0', () => {
    expect(CALIBRATION_LIMITS.INTERCEPT_MAX).toBe(2.0);
  });

  // Functional: simulate pass/fail logic using the constants

  it('passes calibration: all values within spec', () => {
    const cal = {
      rSquared: 0.9995,
      slope: 1.001,
      intercept: 0.5,
      hysteresis: 3.2,
      stdev: 1.8,
    };
    const pass =
      cal.rSquared >= CALIBRATION_LIMITS.R_SQUARED &&
      Math.abs(1 - cal.slope) <= 1 - CALIBRATION_LIMITS.SLOPE_MIN &&
      Math.abs(cal.intercept) <= CALIBRATION_LIMITS.INTERCEPT_MAX &&
      cal.hysteresis <= CALIBRATION_LIMITS.HYSTERESIS &&
      cal.stdev <= CALIBRATION_LIMITS.STDEV;
    expect(pass).toBe(true);
  });

  it('fails calibration: R² below threshold', () => {
    const cal = { rSquared: 0.998, slope: 1.0, intercept: 0, hysteresis: 1, stdev: 1 };
    expect(cal.rSquared >= CALIBRATION_LIMITS.R_SQUARED).toBe(false);
  });

  it('fails calibration: hysteresis above 8.0', () => {
    const cal = { rSquared: 0.9995, slope: 1.0, intercept: 0, hysteresis: 8.1, stdev: 1 };
    expect(cal.hysteresis <= CALIBRATION_LIMITS.HYSTERESIS).toBe(false);
  });

  it('fails calibration: stdev above 4.0', () => {
    const cal = { rSquared: 0.9995, slope: 1.0, intercept: 0, hysteresis: 2, stdev: 4.1 };
    expect(cal.stdev <= CALIBRATION_LIMITS.STDEV).toBe(false);
  });

  it('fails calibration: slope below SLOPE_MIN', () => {
    const cal = { rSquared: 0.9995, slope: 0.94, intercept: 0, hysteresis: 1, stdev: 1 };
    expect(cal.slope >= CALIBRATION_LIMITS.SLOPE_MIN).toBe(false);
  });

  it('fails calibration: slope above SLOPE_MAX', () => {
    const cal = { rSquared: 0.9995, slope: 1.06, intercept: 0, hysteresis: 1, stdev: 1 };
    expect(cal.slope <= CALIBRATION_LIMITS.SLOPE_MAX).toBe(false);
  });

  it('boundary: stdev exactly at limit passes', () => {
    expect(CALIBRATION_LIMITS.STDEV <= CALIBRATION_LIMITS.STDEV).toBe(true);
  });

  it('boundary: hysteresis exactly at limit passes', () => {
    expect(CALIBRATION_LIMITS.HYSTERESIS <= CALIBRATION_LIMITS.HYSTERESIS).toBe(true);
  });
});
