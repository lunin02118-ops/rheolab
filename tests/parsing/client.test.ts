import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRheologyFile, MAX_FILE_SIZE } from '@/lib/parsing/client';
import { extractFilenameMetadata } from '@/lib/parsing/filename-metadata';
import { getBridge } from '@/lib/tauri/bridge';

vi.mock('@/lib/parsing/filename-metadata', () => ({
  extractFilenameMetadata: vi.fn(),
}));

vi.mock('@/lib/tauri/bridge', () => ({
  getBridge: vi.fn(),
}));

describe('parseRheologyFile', () => {
  const bridge = {
    platform: 'web' as 'web' | 'tauri' | 'electron',
    isDesktop: false,
    apiKeys: {
      active: vi.fn(),
    },
    parsing: {
      parseFile: vi.fn(),
    },
  };

  /** Simulate an active Groq API key in the DB (metadata only). */
  function mockHasActiveKey(has: boolean) {
    bridge.apiKeys.active.mockResolvedValue({
      provider: 'groq',
      count: has ? 1 : 0,
      activeKey: has ? { id: 'ak_1', name: 'Test', provider: 'groq', createdAt: '2026-01-01' } : null,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBridge).mockReturnValue(bridge as never);
    mockHasActiveKey(false);
    bridge.platform = 'web';
    bridge.isDesktop = false;
    bridge.parsing.parseFile.mockRejectedValue(new Error('Not running in Tauri environment'));
    vi.mocked(extractFilenameMetadata).mockResolvedValue({
      filenameMetadata: {
        testId: '8958',
        fieldName: 'Mamontovskoe',
        destination: 'lake 274 pad',
        waterSource: 'lake 274 pad',
      },
      testDate: new Date('2025-10-30'),
    });
  });

  it('uses native tauri parsing path in desktop runtime', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.parsing.parseFile.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [
        {
          time_sec: 0,
          viscosity_cp: 130,
          temperature_c: 24,
          speed_rpm: 300,
          shear_rate_s1: 511,
          shear_stress_pa: 66.4,
          pressure_bar: 0,
        },
      ],
      metadata: {
        filename: 'fixture.csv',
        instrumentType: 'Grace',
        geometry: 'R1B1',
        usedAI: false,
        testDate: '2026-02-13',
      },
      summary: {
        pointCount: 1,
      },
    });

    const file = new File(['t,v\n0,130'], 'fixture.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file);

    expect(bridge.parsing.parseFile).toHaveBeenCalledTimes(1);
    expect(result.parsedBy).toBe('native');
    expect(result.metadata.instrumentType).toBe('Grace');
    expect(result.metadata.testDate).toBeInstanceOf(Date);
    expect(result.metadata.filenameMetadata?.fieldName).toBe('Mamontovskoe');
  });

  it('normalizes camelCase point payload from native tauri parser', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.parsing.parseFile.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [
        {
          timeSec: 60,
          viscosityCp: 140.5,
          temperatureC: 31.2,
          speedRpm: 200,
          shearRateS1: 90,
          shearStressPa: 12.8,
          pressureBar: 0.15,
        },
      ],
      metadata: {
        filename: 'fixture.csv',
        instrumentType: 'Grace',
        geometry: 'R1B1',
        usedAI: false,
        testDate: '2026-02-13',
      },
      summary: {
        pointCount: 1,
      },
    });

    const file = new File(['t,v\n0,140'], 'fixture.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      time_sec: 60,
      viscosity_cp: 140.5,
      temperature_c: 31.2,
      speed_rpm: 200,
      shear_rate_s1: 90,
      shear_stress_pa: 12.8,
      pressure_bar: 0.15,
    });
  });

  it('passes bath_temperature_c through native tauri parse path (snake_case)', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.parsing.parseFile.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [
        {
          time_sec: 0,
          viscosity_cp: 130,
          temperature_c: 24,
          speed_rpm: 300,
          shear_rate_s1: 511,
          shear_stress_pa: 66.4,
          pressure_bar: 0,
          bath_temperature_c: 34.5,
        },
        {
          time_sec: 60,
          viscosity_cp: 140,
          temperature_c: 26,
          speed_rpm: 300,
          shear_rate_s1: 511,
          shear_stress_pa: 71.5,
          pressure_bar: 0,
          bath_temperature_c: 37.1,
        },
      ],
      metadata: {
        filename: '8958 SWB.csv',
        instrumentType: 'Grace M5600',
        geometry: 'R1B5',
        usedAI: false,
        testDate: '2025-10-30',
      },
      summary: { pointCount: 2 },
    });

    const file = new File(['t,v\n0,130\n60,140'], '8958 SWB.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].bath_temperature_c).toBe(34.5);
    expect(result.data[1].bath_temperature_c).toBe(37.1);
  });

  it('normalizes camelCase bathTemperatureC to bath_temperature_c', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.parsing.parseFile.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [
        {
          timeSec: 0,
          viscosityCp: 130,
          temperatureC: 24,
          speedRpm: 300,
          shearRateS1: 511,
          shearStressPa: 66.4,
          pressureBar: 0,
          bathTemperatureC: 42.0,
        },
      ],
      metadata: {
        filename: 'fixture.csv',
        instrumentType: 'Grace',
        geometry: 'R1B1',
        usedAI: false,
        testDate: '2026-02-13',
      },
      summary: { pointCount: 1 },
    });

    const file = new File(['t,v\n0,130'], 'fixture.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].bath_temperature_c).toBe(42.0);
  });

  it('sets bath_temperature_c to undefined when absent from native tauri payload', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.parsing.parseFile.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [
        {
          time_sec: 0,
          viscosity_cp: 130,
          temperature_c: 24,
          speed_rpm: 300,
          shear_rate_s1: 511,
          shear_stress_pa: 66.4,
          pressure_bar: 0,
          // bath_temperature_c absent — Tauri sends 0.0 but received as 0
          bath_temperature_c: 0,
        },
      ],
      metadata: {
        filename: 'fixture.csv',
        instrumentType: 'Grace',
        geometry: 'R1B1',
        usedAI: false,
        testDate: '2026-02-13',
      },
      summary: { pointCount: 1 },
    });

    const file = new File(['t,v\n0,130'], 'fixture.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file);

    expect(result.data).toHaveLength(1);
    // 0 is coerced to undefined since 0 means "no bath sensor in this file"
    expect(result.data[0].bath_temperature_c).toBeUndefined();
  });

  it('throws when native parsing is unavailable on desktop', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.parsing.parseFile.mockRejectedValue(new Error('__TAURI_INTERNALS__ invoke is undefined'));

    const file = new File(['t,v\n0,130'], 'fixture.csv', { type: 'text/csv' });

    // Native is the only parser path — must throw hard error
    await expect(parseRheologyFile(file)).rejects.toThrow('Native parser unavailable');
    // Native Tauri was attempted twice (initial + retry)
    expect(bridge.parsing.parseFile).toHaveBeenCalledTimes(2);
  });

  it('throws when parsing pipeline exhausted in web mode', async () => {
    bridge.platform = 'web';
    bridge.isDesktop = false;
    bridge.parsing.parseFile.mockRejectedValue(new Error('Not running in Tauri environment'));

    const file = new File(['t,v\n0,120'], 'fixture.csv', { type: 'text/csv' });
    await expect(parseRheologyFile(file)).rejects.toThrow('Parsing pipeline exhausted');
  });

  // --------------------------------------------------------------------------
  // assertSupportedFile — static guards (exercised before any async work)
  // --------------------------------------------------------------------------

  it('exports MAX_FILE_SIZE as 10 MB', () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });

  it('throws when file exceeds MAX_FILE_SIZE', async () => {
    const file = new File(['small'], 'test.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'size', { value: MAX_FILE_SIZE + 1 });
    await expect(parseRheologyFile(file)).rejects.toThrow('File too large');
  });

  it('throws when file extension is not in the allowlist', async () => {
    const file = new File(['{}'], 'report.json', { type: 'application/json' });
    await expect(parseRheologyFile(file)).rejects.toThrow('Unsupported file type: .json');
  });

  it('throws when file has no extension', async () => {
    const file = new File(['data'], 'noextension');
    await expect(parseRheologyFile(file)).rejects.toThrow('Unsupported file type');
  });

  // --------------------------------------------------------------------------
  // forceAI guard — must throw before any IPC call when key is absent
  // --------------------------------------------------------------------------

  it('throws when forceAI=true but no API key is available', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    mockHasActiveKey(false);
    const file = new File(['t,v\n0,120'], 'fixture.csv', { type: 'text/csv' });
    await expect(parseRheologyFile(file, { forceAI: true })).rejects.toThrow('Groq API');
    expect(bridge.parsing.parseFile).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Native error re-throw — errors that are not "tauri unavailable" must surface
  // --------------------------------------------------------------------------

  it('rethrows native parse error that is not a Tauri-unavailable message', async () => {
    bridge.parsing.parseFile.mockRejectedValue(new Error('SQL error: constraint violation'));
    const file = new File(['t,v\n0,130'], 'fixture.csv', { type: 'text/csv' });
    await expect(parseRheologyFile(file)).rejects.toThrow('SQL error: constraint violation');
  });

  // --------------------------------------------------------------------------
  // normalizeDate — exercised through metadata in native parse result
  // --------------------------------------------------------------------------

  it('sets metadata.testDate to undefined when native sends a garbage date string', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    vi.mocked(extractFilenameMetadata).mockResolvedValue({ filenameMetadata: undefined, testDate: undefined });
    bridge.parsing.parseFile.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [],
      metadata: { filename: 'fixture.csv', usedAI: false, testDate: 'not-a-date' },
      summary: { pointCount: 0 },
    });
    const file = new File([''], 'fixture.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file);
    expect(result.metadata.testDate).toBeUndefined();
  });

  it('preserves metadata.testDate when native sends a valid ISO string', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    vi.mocked(extractFilenameMetadata).mockResolvedValue({ filenameMetadata: undefined, testDate: undefined });
    bridge.parsing.parseFile.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [],
      metadata: { filename: 'fixture.csv', usedAI: false, testDate: '2025-06-15T00:00:00Z' },
      summary: { pointCount: 0 },
    });
    const file = new File([''], 'fixture.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file);
    expect(result.metadata.testDate).toBeInstanceOf(Date);
  });

  // --------------------------------------------------------------------------
  // buildSummary — triggered when native sends an empty / all-zero summary
  // --------------------------------------------------------------------------

  it('builds summary from data when native summary is empty', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.parsing.parseFile.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [
        { time_sec: 0,  viscosity_cp: 100, temperature_c: 20, speed_rpm: 100, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 0 },
        { time_sec: 60, viscosity_cp: 200, temperature_c: 30, speed_rpm: 100, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 0 },
      ],
      metadata: { filename: 'fixture.csv', usedAI: false },
      summary: null,   // null — forces buildSummary(data) via asRecord check
    });
    const file = new File(['t,v\n0,100\n60,200'], 'fixture.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file);
    expect(result.summary.pointCount).toBe(2);
    expect(result.summary.timeRange?.start).toBe(0);
    expect(result.summary.timeRange?.end).toBe(60);
    expect(result.summary.viscosityRange?.min).toBe(100);
    expect(result.summary.viscosityRange?.max).toBe(200);
  });

  it('includes pressureRange in summary when data has pressure_bar > 0', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.parsing.parseFile.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [
        { time_sec: 0,  viscosity_cp: 100, temperature_c: 20, speed_rpm: 100, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 2.5 },
        { time_sec: 60, viscosity_cp: 120, temperature_c: 22, speed_rpm: 100, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 3.8 },
      ],
      metadata: { filename: 'fixture.csv', usedAI: false },
      summary: null,   // null — forces buildSummary
    });
    const file = new File(['t,v\n0,100\n60,120'], 'fixture.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file);
    expect(result.summary.pressureRange).toBeDefined();
    expect(result.summary.pressureRange?.min).toBe(2.5);
    expect(result.summary.pressureRange?.max).toBe(3.8);
  });

  // --------------------------------------------------------------------------
  // isNativeParseDataFailure path — falls through to "Parsing pipeline exhausted"
  // --------------------------------------------------------------------------

  it('throws Parsing pipeline exhausted when native fails with "no valid data points" and API key is present', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    mockHasActiveKey(true);
    bridge.parsing.parseFile.mockRejectedValue(new Error('no valid data points found'));
    const file = new File(['t,v\n0,120'], 'fixture.csv', { type: 'text/csv' });
    await expect(parseRheologyFile(file)).rejects.toThrow('Parsing pipeline exhausted');
  });
});
