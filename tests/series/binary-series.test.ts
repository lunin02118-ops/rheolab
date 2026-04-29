import { describe, expect, it } from 'vitest';
import { decodeRheoSeriesV1, seriesWindowToColumnarData } from '@/lib/series/binary-series';

const HEADER_BYTES = 20;
const DESCRIPTOR_BYTES = 8;

function alignTo8(value: number): number {
  return (value + 7) & ~7;
}

function makePayload(columns: Array<{ id: number; values: number[]; nullable?: boolean }>): ArrayBuffer {
  const pointCount = columns[0]?.values.length ?? 0;
  const columnCount = columns.length;
  const payloadStart = alignTo8(HEADER_BYTES + columnCount * DESCRIPTOR_BYTES);
  const totalBytes = payloadStart + pointCount * columnCount * 8;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  const magic = 'RHEOSR1\0';
  for (let i = 0; i < magic.length; i++) view.setUint8(i, magic.charCodeAt(i));
  view.setUint16(8, 1, true);
  view.setUint16(10, 0, true);
  view.setUint32(12, pointCount, true);
  view.setUint16(16, columnCount, true);
  view.setUint16(18, 0, true);

  let offset = payloadStart;
  for (let i = 0; i < columns.length; i++) {
    const base = HEADER_BYTES + i * DESCRIPTOR_BYTES;
    view.setUint16(base, columns[i].id, true);
    view.setUint8(base + 2, 1);
    view.setUint8(base + 3, columns[i].nullable ? 1 : 0);
    view.setUint32(base + 4, offset, true);
    for (let j = 0; j < pointCount; j++) {
      view.setFloat64(offset + j * 8, columns[i].values[j], true);
    }
    offset += pointCount * 8;
  }

  return buffer;
}

describe('decodeRheoSeriesV1', () => {
  it('decodes f64 columns from the binary v1 payload', () => {
    const payload = makePayload([
      { id: 1, values: [0, 60, 120] },
      { id: 2, values: [100, 120, 80] },
      { id: 3, values: [20, 21, 22] },
    ]);

    const decoded = decodeRheoSeriesV1(payload);

    expect(decoded.version).toBe(1);
    expect(decoded.pointCount).toBe(3);
    expect(Array.from(decoded.columns.timeSec)).toEqual([0, 60, 120]);
    expect(Array.from(decoded.columns.viscosityCp ?? [])).toEqual([100, 120, 80]);
    expect(Array.from(decoded.columns.temperatureC ?? [])).toEqual([20, 21, 22]);
  });

  it('rejects bad magic', () => {
    const payload = makePayload([{ id: 1, values: [0] }]);
    new Uint8Array(payload)[0] = 0;
    expect(() => decodeRheoSeriesV1(payload)).toThrow(/magic/);
  });

  it('rejects truncated payloads', () => {
    const payload = makePayload([{ id: 1, values: [0, 1, 2] }]);
    expect(() => decodeRheoSeriesV1(payload.slice(0, 24))).toThrow(/truncated|exceeds/);
  });

  it('preserves NaN values and maps nullable columns to null for ColumnarData', () => {
    const payload = makePayload([
      { id: 1, values: [0, 1] },
      { id: 2, values: [50, 60] },
      { id: 3, values: [20, 21] },
      { id: 7, values: [Number.NaN, 3], nullable: true },
    ]);

    const decoded = decodeRheoSeriesV1(payload);
    expect(Number.isNaN(decoded.columns.pressureBar?.[0])).toBe(true);

    const columnar = seriesWindowToColumnarData(decoded);
    expect(columnar.pressureBar).toEqual([null, 3]);
  });
});
