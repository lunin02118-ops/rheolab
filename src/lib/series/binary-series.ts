import type { ChartColumnarData } from '@/types';

const MAGIC = 'RHEOSR1\0';
const HEADER_BYTES = 20;
const DESCRIPTOR_BYTES = 8;
const F64_BYTES = 8;

export type SeriesMetricKey =
  | 'timeSec'
  | 'viscosityCp'
  | 'temperatureC'
  | 'shearRate'
  | 'shearStress'
  | 'speedRpm'
  | 'pressureBar'
  | 'bathTemperatureC';

const METRIC_BY_ID: Record<number, SeriesMetricKey> = {
  1: 'timeSec',
  2: 'viscosityCp',
  3: 'temperatureC',
  4: 'shearRate',
  5: 'shearStress',
  6: 'speedRpm',
  7: 'pressureBar',
  8: 'bathTemperatureC',
};

export interface SeriesColumnDescriptor {
  metricId: number;
  key: SeriesMetricKey;
  dtype: 'f64';
  nullable: boolean;
  offset: number;
}

export interface SeriesWindow {
  version: number;
  pointCount: number;
  descriptors: SeriesColumnDescriptor[];
  columns: Partial<Record<SeriesMetricKey, Float64Array>> & {
    timeSec: Float64Array;
  };
}

export interface SeriesMetaResponse {
  experimentId: string;
  pointCount: number;
  timeMinSec?: number | null;
  timeMaxSec?: number | null;
  availableMetrics: Array<{ id: number; key: SeriesMetricKey | string }>;
  dataHash: string;
}

export type RheoSeriesBinaryInput = ArrayBuffer | ArrayBufferView | number[];

export interface SeriesWindowToColumnarOptions {
  timeOriginSec?: number;
}

function asArrayBuffer(input: RheoSeriesBinaryInput): ArrayBuffer {
  if (input instanceof ArrayBuffer) return input;
  if (Array.isArray(input)) return Uint8Array.from(input).buffer;
  if (input.buffer instanceof ArrayBuffer) {
    if (input.byteOffset === 0 && input.byteLength === input.buffer.byteLength) {
      return input.buffer;
    }
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }

  const copy = new Uint8Array(input.byteLength);
  copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
  return copy.buffer;
}

function readMagic(view: DataView): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += String.fromCharCode(view.getUint8(i));
  }
  return out;
}

export function decodeRheoSeriesV1(input: RheoSeriesBinaryInput): SeriesWindow {
  const buffer = asArrayBuffer(input);
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error('RHEO_SERIES_V1 payload is too short');
  }

  const view = new DataView(buffer);
  const magic = readMagic(view);
  if (magic !== MAGIC) {
    throw new Error('Invalid RHEO_SERIES_V1 magic');
  }

  const version = view.getUint16(8, true);
  if (version !== 1) {
    throw new Error(`Unsupported RHEO_SERIES version: ${version}`);
  }

  const pointCount = view.getUint32(12, true);
  const columnCount = view.getUint16(16, true);
  const descriptorEnd = HEADER_BYTES + columnCount * DESCRIPTOR_BYTES;
  if (descriptorEnd > buffer.byteLength) {
    throw new Error('RHEO_SERIES_V1 descriptor table is truncated');
  }

  const descriptors: SeriesColumnDescriptor[] = [];
  const columns: Partial<Record<SeriesMetricKey, Float64Array>> = {};

  for (let i = 0; i < columnCount; i++) {
    const base = HEADER_BYTES + i * DESCRIPTOR_BYTES;
    const metricId = view.getUint16(base, true);
    const dtype = view.getUint8(base + 2);
    const nullable = view.getUint8(base + 3) === 1;
    const offset = view.getUint32(base + 4, true);
    const key = METRIC_BY_ID[metricId];

    if (!key) {
      throw new Error(`Unknown RHEO_SERIES metric id: ${metricId}`);
    }
    if (dtype !== 1) {
      throw new Error(`Unsupported RHEO_SERIES dtype for ${key}: ${dtype}`);
    }
    if (offset % F64_BYTES !== 0) {
      throw new Error(`Unaligned RHEO_SERIES column offset for ${key}: ${offset}`);
    }

    const byteLength = pointCount * F64_BYTES;
    if (offset + byteLength > buffer.byteLength) {
      throw new Error(`RHEO_SERIES column ${key} exceeds payload length`);
    }

    descriptors.push({ metricId, key, dtype: 'f64', nullable, offset });
    columns[key] = new Float64Array(buffer, offset, pointCount);
  }

  if (!columns.timeSec) {
    throw new Error('RHEO_SERIES payload has no timeSec column');
  }

  return {
    version,
    pointCount,
    descriptors,
    columns: columns as SeriesWindow['columns'],
  };
}

function zeroColumn(values: Float64Array | undefined, length: number): Float64Array {
  return values ?? new Float64Array(length);
}

function nanColumn(values: Float64Array | undefined, length: number): Float64Array {
  if (values) return values;
  const out = new Float64Array(length);
  out.fill(Number.NaN);
  return out;
}

function minFiniteTimeSec(series: SeriesWindow): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < series.columns.timeSec.length; i++) {
    const value = series.columns.timeSec[i];
    if (Number.isFinite(value) && value < min) min = value;
  }
  return Number.isFinite(min) ? min : 0;
}

export function seriesWindowToColumnarData(
  series: SeriesWindow,
  options: SeriesWindowToColumnarOptions = {},
): ChartColumnarData {
  const n = series.pointCount;
  const { columns } = series;
  return {
    timeSec: columns.timeSec,
    timeOriginSec: Number.isFinite(options.timeOriginSec)
      ? options.timeOriginSec
      : minFiniteTimeSec(series),
    viscosityCp: zeroColumn(columns.viscosityCp, n),
    temperatureC: zeroColumn(columns.temperatureC, n),
    shearRate: nanColumn(columns.shearRate, n),
    shearStress: nanColumn(columns.shearStress, n),
    pressureBar: nanColumn(columns.pressureBar, n),
    speedRpm: nanColumn(columns.speedRpm, n),
    ...(columns.bathTemperatureC
      ? { bathTemperatureC: columns.bathTemperatureC }
      : {}),
  };
}
