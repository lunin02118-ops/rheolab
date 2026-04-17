import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listWaterSources } from '@/lib/water-sources/client';
import { getBridge } from '@/lib/tauri/bridge';

vi.mock('@/lib/tauri/bridge', () => ({
  getBridge: vi.fn(),
}));

describe('water-sources client', () => {
  const bridge = {
    waterSources: {
      list: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBridge).mockReturnValue(bridge as never);
  });

  it('returns water sources from unified bridge response', async () => {
    bridge.waterSources.list.mockResolvedValue({
      waterSources: ['Pad 274', 'Lab tank'],
    });

    const result = await listWaterSources();

    expect(bridge.waterSources.list).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['Pad 274', 'Lab tank']);
  });

  it('normalizes missing response field to empty array', async () => {
    bridge.waterSources.list.mockResolvedValue({});
    await expect(listWaterSources()).resolves.toEqual([]);
  });
});
