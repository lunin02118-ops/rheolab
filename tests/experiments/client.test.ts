import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteExperiment,
  exportExperimentsToFile,
  getExperimentFilterMetadata,
  getExperimentById,
  getExperimentExportLaboratories,
  getExperimentsCount,
  getLastExperimentContext,
  listExperiments,
  saveExperiment,
} from '@/lib/experiments/client';
import { getBridge } from '@/lib/tauri/bridge';

vi.mock('@/lib/tauri/bridge', () => ({
  getBridge: vi.fn(),
}));

describe('experiments client', () => {
  const bridge = {
    experiments: {
      list: vi.fn(),
      count: vi.fn(),
      filterMetadata: vi.fn(),
      get: vi.fn(),
      getBatch: vi.fn(),
      checkExistence: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
      lastContext: vi.fn(),
      exportLaboratories: vi.fn(),
      exportToFile: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBridge).mockReturnValue(bridge as never);
  });

  it('routes list/get/save/delete through unified bridge', async () => {
    const query = { page: 2, limit: 10, sortBy: 'createdAt' as const };
    const payload = { metadata: { fieldName: 'Test field' }, data: [] };

    bridge.experiments.list.mockResolvedValue({ experiments: [], pagination: { page: 2, limit: 10, total: 0, totalPages: 0 } });
    bridge.experiments.get.mockResolvedValue({ success: true, experiment: { id: 'exp_1' } });
    bridge.experiments.save.mockResolvedValue({ success: true, experimentId: 'exp_1' });
    bridge.experiments.delete.mockResolvedValue({ success: true });

    await listExperiments(query);
    await getExperimentById('exp_1');
    await saveExperiment(payload as never);
    await deleteExperiment('exp_1');

    expect(bridge.experiments.list).toHaveBeenCalledWith(query);
    expect(bridge.experiments.get).toHaveBeenCalledWith('exp_1');
    // save() calls toWirePayload() before forwarding — verify routing only (not the payload shape)
    expect(bridge.experiments.save).toHaveBeenCalledWith(expect.any(Object));
    expect(bridge.experiments.delete).toHaveBeenCalledWith('exp_1');
  });

  it('normalizes count to zero when bridge returns undefined', async () => {
    bridge.experiments.count.mockResolvedValue({ count: undefined });
    await expect(getExperimentsCount()).resolves.toBe(0);

    bridge.experiments.count.mockResolvedValue({ count: 17 });
    await expect(getExperimentsCount()).resolves.toBe(17);
  });

  it('loads filter metadata through unified bridge', async () => {
    bridge.experiments.filterMetadata.mockResolvedValue({
      instrumentTypes: ['BSL R1', 'Chandler 5550'],
      fluidTypes: ['Crosslinked', 'Linear'],
      geometries: ['R1B1'],
      reagentNames: ['FP-3630S'],
      laboratoryNames: ['Main Lab'],
      fieldNames: ['Field-A'],
      waterSources: ['Source-A'],
    });

    const metadata = await getExperimentFilterMetadata();

    expect(bridge.experiments.filterMetadata).toHaveBeenCalledTimes(1);
    expect(metadata.instrumentTypes).toEqual(['BSL R1', 'Chandler 5550']);
    expect(metadata.fieldNames).toEqual(['Field-A']);
  });

  it('maps last context payload to app shape', async () => {
    bridge.experiments.lastContext.mockResolvedValue({
      fieldName: 'Mamontovskoe',
      operatorName: 'Admin',
      waterSource: 'Pad 274',
      reagents: [
        {
          reagentId: 'r_1',
          reagentName: 'WG-9000F',
          concentration: 3.4,
          unit: 'kg/m3',
          batchNumber: 'B-001',
          productionDate: '2026-01-01',
        },
      ],
    });

    const context = await getLastExperimentContext();

    expect(context.fieldName).toBe('Mamontovskoe');
    expect(context.operatorName).toBe('Admin');
    expect(context.waterSource).toBe('Pad 274');
    expect(context.reagents).toHaveLength(1);
    expect(context.reagents[0]).toMatchObject({
      reagentId: 'r_1',
      reagentName: 'WG-9000F',
      concentration: 3.4,
      unit: 'kg/m3',
      batchNumber: 'B-001',
      productionDate: '2026-01-01',
    });
  });

  it('routes export workflows through unified bridge', async () => {
    bridge.experiments.exportLaboratories.mockResolvedValue({
      success: true,
      laboratories: [{ id: 'lab_1', name: 'Main Lab', count: 5 }],
    });
    bridge.experiments.exportToFile.mockResolvedValue({
      success: true,
      path: '/tmp/export.db',
    });

    const labs = await getExperimentExportLaboratories();
    const exported = await exportExperimentsToFile(['lab_1']);

    expect(bridge.experiments.exportLaboratories).toHaveBeenCalledTimes(1);
    expect(bridge.experiments.exportToFile).toHaveBeenCalledWith(['lab_1']);
    expect(labs.success).toBe(true);
    expect(exported.success).toBe(true);
  });
});
