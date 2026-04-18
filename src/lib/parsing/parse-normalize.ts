/**
 * @fileoverview Normalization helpers for raw parse results.
 *
 * Pure functions that coerce unknown WASM/API responses into well-typed
 * ParseResult shapes. Extracted from client.ts to keep each module under 400 LOC.
 *
 * @module parsing/parse-normalize
 */

import { extractFilenameMetadata } from '@/lib/parsing/filename-metadata';
import { toFiniteNumber } from '@/lib/utils/numbers';
import type { ParseResult } from '@/types';

type FilenameMetadata = NonNullable<ParseResult['metadata']['filenameMetadata']>;
type NumericValue = number | string | null | undefined;
type UnknownRecord = Record<string, unknown>;

function normalizeDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? undefined : parsed;
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object') return null;
  return value as UnknownRecord;
}

function readNumber(record: UnknownRecord, keys: string[], fallback = 0): number {
  for (const key of keys) {
    if (key in record) {
      return toFiniteNumber(record[key] as NumericValue, fallback);
    }
  }
  return fallback;
}

export function normalizeDataPoints(data: unknown): ParseResult['data'] {
  if (!Array.isArray(data)) return [];

  return data.map((point) => {
    const record = asRecord(point) ?? {};
    return {
      time_sec: readNumber(record, ['time_sec', 'timeSec', 'time'], 0),
      viscosity_cp: readNumber(record, ['viscosity_cp', 'viscosityCp', 'viscosity'], 0),
      temperature_c: readNumber(record, ['temperature_c', 'temperatureC', 'temperature'], 0),
      speed_rpm: readNumber(record, ['speed_rpm', 'speedRpm', 'rpm'], 0),
      shear_rate_s1: readNumber(record, ['shear_rate_s1', 'shearRateS1', 'shear_rate', 'shearRate'], 0),
      shear_stress_pa: readNumber(record, ['shear_stress_pa', 'shearStressPa', 'shear_stress', 'shearStress'], 0),
      pressure_bar: readNumber(record, ['pressure_bar', 'pressureBar', 'pressure'], 0),
      bath_temperature_c: readNumber(record, ['bath_temperature_c', 'bathTemperatureC'], 0) || undefined,
    };
  });
}

function normalizeTimeRange(value: unknown): ParseResult['summary']['timeRange'] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const start = readNumber(record, ['start'], 0);
  const end = readNumber(record, ['end'], start);
  const durationMinutes = readNumber(
    record,
    ['durationMinutes', 'duration_minutes'],
    (end - start) / 60,
  );

  return { start, end, durationMinutes };
}

function normalizeRangeWithAvg(
  value: unknown,
): ParseResult['summary']['viscosityRange'] | ParseResult['summary']['temperatureRange'] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const min = readNumber(record, ['min'], 0);
  const max = readNumber(record, ['max'], min);
  const avgPresent = 'avg' in record;

  return {
    min,
    max,
    ...(avgPresent ? { avg: readNumber(record, ['avg'], min) } : {}),
  };
}

function normalizeRange(value: unknown): ParseResult['summary']['pressureRange'] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    min: readNumber(record, ['min'], 0),
    max: readNumber(record, ['max'], 0),
  };
}

export function buildSummary(data: ParseResult['data']): ParseResult['summary'] {
  if (!data || data.length === 0) {
    return {
      pointCount: 0,
      timeRange: { start: 0, end: 0, durationMinutes: 0 },
      viscosityRange: { min: 0, max: 0, avg: 0 },
      temperatureRange: { min: 0, max: 0, avg: 0 },
    };
  }

  let minTime = Infinity,  maxTime = -Infinity;
  let minVisc = Infinity,  maxVisc = -Infinity,  sumVisc = 0;
  let minTemp = Infinity,  maxTemp = -Infinity,  sumTemp = 0;
  let minPres = Infinity,  maxPres = -Infinity,  hasPressure = false;

  for (const p of data) {
    if (p.time_sec < minTime) minTime = p.time_sec;
    if (p.time_sec > maxTime) maxTime = p.time_sec;
    if (p.viscosity_cp < minVisc) minVisc = p.viscosity_cp;
    if (p.viscosity_cp > maxVisc) maxVisc = p.viscosity_cp;
    sumVisc += p.viscosity_cp;
    if (p.temperature_c < minTemp) minTemp = p.temperature_c;
    if (p.temperature_c > maxTemp) maxTemp = p.temperature_c;
    sumTemp += p.temperature_c;
    if ((p.pressure_bar || 0) > 0) {
      const pbar = p.pressure_bar!;
      if (pbar < minPres) minPres = pbar;
      if (pbar > maxPres) maxPres = pbar;
      hasPressure = true;
    }
  }

  const n = data.length;
  const durationMinutes = Math.round(((maxTime - minTime) / 60) * 10) / 10;

  return {
    pointCount: n,
    timeRange: { start: minTime, end: maxTime, durationMinutes },
    viscosityRange: {
      min: Math.round(minVisc * 100) / 100,
      max: Math.round(maxVisc * 100) / 100,
      avg: Math.round((sumVisc / n) * 100) / 100,
    },
    temperatureRange: {
      min: Math.round(minTemp * 10) / 10,
      max: Math.round(maxTemp * 10) / 10,
      avg: Math.round((sumTemp / n) * 10) / 10,
    },
    ...(hasPressure && {
      pressureRange: {
        min: Math.round(minPres * 100) / 100,
        max: Math.round(maxPres * 100) / 100,
      },
    }),
  };
}

function normalizeSummary(summary: unknown, data: ParseResult['data']): ParseResult['summary'] {
  const record = asRecord(summary);
  if (!record) return buildSummary(data);

  const normalized = {
    pointCount: Math.max(
      0,
      Math.round(readNumber(record, ['pointCount', 'point_count'], data.length)),
    ),
    timeRange: normalizeTimeRange(record.timeRange ?? record.time_range),
    viscosityRange: normalizeRangeWithAvg(record.viscosityRange ?? record.viscosity_range),
    temperatureRange: normalizeRangeWithAvg(record.temperatureRange ?? record.temperature_range),
    pressureRange: normalizeRange(record.pressureRange ?? record.pressure_range),
  };

  if (
    normalized.pointCount <= 0 &&
    !normalized.timeRange &&
    !normalized.viscosityRange &&
    !normalized.temperatureRange &&
    !normalized.pressureRange
  ) {
    return buildSummary(data);
  }

  return normalized;
}

export function normalizeParseResult(result: ParseResult): ParseResult {
  const data = normalizeDataPoints((result as { data?: unknown }).data);
  const summary = normalizeSummary((result as { summary?: unknown }).summary, data);
  const testDate = normalizeDate(result.metadata?.testDate);
  const calibrationDate = normalizeDate(result.metadata?.calibration?.calibrationDate);

  return {
    ...result,
    data,
    summary,
    metadata: {
      ...result.metadata,
      testDate,
      calibration: result.metadata.calibration
        ? {
          ...result.metadata.calibration,
          calibrationDate: calibrationDate ?? result.metadata.calibration.calibrationDate,
        }
        : undefined,
    },
  };
}

function hasFilenameMetadata(metadata: FilenameMetadata): boolean {
  return Boolean(
    metadata.testId ||
      metadata.testType ||
      metadata.testTypeFull ||
      metadata.fieldName ||
      metadata.wellNumber ||
      metadata.operatorName ||
      metadata.destination ||
      metadata.waterSource ||
      metadata.temperature !== undefined ||
      metadata.laboratoryName ||
      (metadata.recipe && metadata.recipe.length > 0),
  );
}

function mergeFilenameMetadata(
  primary?: FilenameMetadata,
  secondary?: FilenameMetadata,
): FilenameMetadata | undefined {
  if (!primary && !secondary) return undefined;

  const merged: FilenameMetadata = {
    testId: primary?.testId ?? secondary?.testId,
    testType: primary?.testType ?? secondary?.testType,
    testTypeFull: primary?.testTypeFull ?? secondary?.testTypeFull,
    fieldName: primary?.fieldName ?? secondary?.fieldName,
    wellNumber: primary?.wellNumber ?? secondary?.wellNumber,
    operatorName: primary?.operatorName ?? secondary?.operatorName,
    destination: primary?.destination ?? secondary?.destination,
    waterSource:
      primary?.waterSource ??
      secondary?.waterSource ??
      primary?.destination ??
      secondary?.destination,
    temperature: primary?.temperature ?? secondary?.temperature,
    laboratoryName: primary?.laboratoryName ?? secondary?.laboratoryName,
    recipe:
      primary?.recipe && primary.recipe.length > 0
        ? primary.recipe
        : secondary?.recipe,
  };

  return hasFilenameMetadata(merged) ? merged : undefined;
}

export async function enrichParseResult(
  result: ParseResult,
  filename: string,
): Promise<ParseResult> {
  const filenameExtraction = await extractFilenameMetadata(filename);
  const filenameMetadata = mergeFilenameMetadata(
    result.metadata.filenameMetadata,
    filenameExtraction.filenameMetadata,
  );

  return normalizeParseResult({
    ...result,
    metadata: {
      ...result.metadata,
      filenameMetadata,
      testDate: result.metadata.testDate ?? filenameExtraction.testDate,
    },
  });
}
