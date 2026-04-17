import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReagent,
  deleteReagent,
  exportReagents,
  importReagents,
  listReagents,
  updateReagent,
} from '@/lib/reagents/client';
import { getBridge } from '@/lib/tauri/bridge';

vi.mock('@/lib/tauri/bridge', () => ({
  getBridge: vi.fn(),
}));

describe('reagents client', () => {
  const bridge = {
    reagents: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      exportData: vi.fn(),
      importData: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBridge).mockReturnValue(bridge as never);
  });

  it('routes list/create/update/delete through unified bridge', async () => {
    const payload = {
      reagentName: 'WG-9000F',
      category: 'polymer',
      quantity: 10,
      unit: 'kg',
      minQuantity: 2,
      maxQuantity: 20,
      costPerUnit: 100,
    };

    bridge.reagents.list.mockResolvedValue([{ id: 'r_1', reagentName: 'WG-9000F' }]);
    bridge.reagents.create.mockResolvedValue({ success: true, reagent: { id: 'r_1' } });
    bridge.reagents.update.mockResolvedValue({ success: true, reagent: { id: 'r_1' } });
    bridge.reagents.delete.mockResolvedValue({ success: true });

    await listReagents();
    await createReagent(payload as never);
    await updateReagent('r_1', payload as never);
    await deleteReagent('r_1');

    expect(bridge.reagents.list).toHaveBeenCalledTimes(1);
    expect(bridge.reagents.create).toHaveBeenCalledWith(payload);
    expect(bridge.reagents.update).toHaveBeenCalledWith('r_1', payload);
    expect(bridge.reagents.delete).toHaveBeenCalledWith('r_1');
  });

  it('routes export/import through unified bridge', async () => {
    bridge.reagents.exportData.mockResolvedValue({
      success: true,
      total: 1,
      reagents: [{ id: 'r_1' }],
      exportedAt: '2026-02-13T00:00:00.000Z',
    });
    bridge.reagents.importData.mockResolvedValue({
      success: true,
      imported: 1,
      updated: 0,
      skipped: 0,
      errors: [],
      totalProcessed: 1,
    });

    const exported = await exportReagents();
    const imported = await importReagents([{ id: 'r_1' }]);

    expect(bridge.reagents.exportData).toHaveBeenCalledTimes(1);
    expect(bridge.reagents.importData).toHaveBeenCalledWith([{ id: 'r_1' }]);
    expect(exported.success).toBe(true);
    expect(imported.success).toBe(true);
  });
});
