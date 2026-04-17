import { describe, expect, it } from 'vitest';
import { extractFilenameMetadata } from '@/lib/parsing/filename-metadata';

describe('extractFilenameMetadata', () => {
  it('extracts structured metadata from filename via regex heuristics', async () => {
    const filename =
      '8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv';
    const result = await extractFilenameMetadata(filename);

    expect(result.filenameMetadata?.testId).toBe('8958');
    expect(result.filenameMetadata?.testType).toBe('SWB');
    expect(result.filenameMetadata?.fieldName).toBe('Mamontovskoe');
    expect(result.filenameMetadata?.destination).toBe('lake 274 pad');
    expect(result.filenameMetadata?.waterSource).toBe('lake 274 pad');
    expect(result.filenameMetadata?.temperature).toBe(96);
    expect(result.filenameMetadata?.recipe).toHaveLength(3);
    expect(result.filenameMetadata?.recipe?.[0]).toMatchObject({
      abbreviation: 'WG-9000F',
      concentration: 3.4,
      unit: 'kg/m3',
    });
    expect(result.testDate).toBeInstanceOf(Date);
    expect(result.testDate?.getFullYear()).toBe(2025);
    expect(result.testDate?.getMonth()).toBe(9);
    expect(result.testDate?.getDate()).toBe(30);
  });

  it('extracts recipe components from filename', async () => {
    const filename = '8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)@96C 30.10.25.csv';
    const result = await extractFilenameMetadata(filename);

    expect(result.filenameMetadata?.testType).toBe('SWB');
    expect(result.filenameMetadata?.testId).toBe('8958');
    expect(result.filenameMetadata?.fieldName).toBe('Mamontovskoe');
    expect(result.filenameMetadata?.destination).toBe('lake 274 pad');
    expect(result.filenameMetadata?.waterSource).toBe('lake 274 pad');
    expect(result.filenameMetadata?.recipe?.[0]).toMatchObject({
      abbreviation: 'WG-9000F',
      concentration: 3.4,
    });
    expect(result.testDate).toBeInstanceOf(Date);
    expect(result.testDate?.getFullYear()).toBe(2025);
    expect(result.testDate?.getMonth()).toBe(9);
    expect(result.testDate?.getDate()).toBe(30);
  });
});
