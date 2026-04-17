/**
 * Calibration Types
 * 
 * Типы для данных калибровки вместо `z.any()`.
 */

/**
 * Точка данных калибровки с полными метриками
 */
export interface CalibrationDataPoint {
  rpm: number;
  dialReading: number;
  shearStress: number;
  viscosity?: number;
  shearRate: number;
  calculatedStress: number;
  error: number;
  signal?: number;
}

/**
 * Точка сырых данных калибровки (legacy формат)
 */
export interface CalibrationRawDataPoint {
  shear_rate: number;
  viscosity: number;
  torque: number;
  temperature: number;
}

/**
 * Результат калибровки
 */
export interface CalibrationResult {
  deviceType: string;
  rSquared: number;
  slope: number;
  intercept: number;
  hysteresis: number;
  stdev: number;
  status: 'PASS' | 'FAIL';
  lastCalDate?: string;
  calibrationDate?: Date | null;
  issues: string[];
  rawData: CalibrationDataPoint[];
}
