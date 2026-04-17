import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listFixtures, parseFixture } from '@/lib/fixtures/client';
import { getBridge } from '@/lib/tauri/bridge';
import { parseRheologyFile } from '@/lib/parsing/client';

vi.mock('@/lib/tauri/bridge', () => ({
  getBridge: vi.fn(),
}));

vi.mock('@/lib/parsing/client', () => ({
  parseRheologyFile: vi.fn(),
}));

describe('fixtures client', () => {
  const bridge = {
    platform: 'web' as 'web' | 'tauri' | 'electron',
    isDesktop: false,
    fixtures: {
      list: vi.fn(),
      read: vi.fn(),
      parse: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBridge).mockReturnValue(bridge as never);
    bridge.platform = 'web';
    bridge.isDesktop = false;
    bridge.fixtures.list.mockRejectedValue(new Error('Not running in Tauri environment'));
    bridge.fixtures.parse.mockRejectedValue(new Error('Not running in Tauri environment'));
    bridge.fixtures.read.mockRejectedValue(new Error('Not running in Tauri environment'));
  });

  it('uses native fixtures parse command in desktop runtime', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.fixtures.parse.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [
        {
          time_sec: 0,
          viscosity_cp: 123,
          temperature_c: 25,
          speed_rpm: 300,
          shear_rate_s1: 511,
          shear_stress_pa: 62,
          pressure_bar: 0,
        },
      ],
      metadata: {
        filename: 'fixture.csv',
        instrumentType: 'Grace',
        geometry: 'R1B1',
        usedAI: false,
        testDate: '2026-02-13',
        calibration: {
          deviceType: 'Grace',
          rSquared: 0.99,
          slope: 1.01,
          intercept: 0.02,
          hysteresis: 0.01,
          stdev: 0.02,
          status: 'PASS',
          issues: [],
          rawData: '[]',
          calibrationDate: '2026-02-12',
        },
      },
      summary: { pointCount: 1 },
    });

    const result = await parseFixture('fixture.csv');

    expect(bridge.fixtures.parse).toHaveBeenCalledWith('fixture.csv');
    expect(bridge.fixtures.read).not.toHaveBeenCalled();
    expect(parseRheologyFile).not.toHaveBeenCalled();
    expect(result.metadata.testDate).toBeInstanceOf(Date);
    expect(result.metadata.calibration?.calibrationDate).toBeInstanceOf(Date);
  });

  it('does not fallback to web fixtures parse in desktop runtime when bridge is unavailable', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.fixtures.parse.mockRejectedValue(new Error('__TAURI_INTERNALS__ not available'));

    await expect(parseFixture('fixture.csv')).rejects.toThrow(
      'Desktop runtime requires native fixtures parser command',
    );

    expect(bridge.fixtures.parse).toHaveBeenCalledTimes(2);
  });

  it('falls back to read+parse for older desktop binaries without parse command', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.fixtures.parse.mockRejectedValue(
      new Error('unknown IPC command: test_fixtures_parse'),
    );
    bridge.fixtures.read.mockResolvedValue({
      success: true,
      filename: 'fixture.csv',
      bytes: [1, 2, 3],
    });
    vi.mocked(parseRheologyFile).mockResolvedValue({
      success: true,
      source: 'regex',
      data: [],
      metadata: { filename: 'fixture.csv' },
      summary: { pointCount: 0 },
    } as never);

    await parseFixture('fixture.csv', 'llama-3.3-70b-versatile');

    expect(bridge.fixtures.parse).toHaveBeenCalledTimes(1);
    expect(bridge.fixtures.read).toHaveBeenCalledWith('fixture.csv');
    expect(parseRheologyFile).toHaveBeenCalledTimes(1);
  });

  it('passes aiModel as undefined when no model specified', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.fixtures.parse.mockResolvedValue({
      success: true,
      source: 'regex',
      data: [],
      metadata: { filename: 'fixture.csv' },
      summary: { pointCount: 0 },
    });

    const result = await parseFixture('fixture.csv');

    expect(bridge.fixtures.parse).toHaveBeenCalledWith(
      'fixture.csv',
    );
    expect(result.success).toBe(true);
  });

  it('uses fixtures list bridge in desktop runtime', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.fixtures.list.mockResolvedValue({
      success: true,
      fixtures: [{ name: 'fixture.csv', displayName: 'Fixture CSV' }],
      count: 1,
    });

    const items = await listFixtures();

    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('fixture.csv');
    expect(bridge.fixtures.list).toHaveBeenCalledTimes(1);
  });

  it('does not fallback to web fixtures list in desktop runtime when bridge is unavailable', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.fixtures.list.mockRejectedValue(new Error('__TAURI_INTERNALS__ not available'));

    await expect(listFixtures()).rejects.toThrow(
      'Desktop runtime requires native fixtures list command',
    );

    expect(bridge.fixtures.list).toHaveBeenCalledTimes(2);
  });
});
