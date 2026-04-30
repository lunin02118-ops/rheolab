import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

import { invoke as invokeCore } from '@tauri-apps/api/core';
import { backup, experiments, isTauri, reports } from '@/lib/tauri';

type MockWindow = {
  __TAURI_INTERNALS__?: {
    invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
  __TAURI__?: {
    invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
  location?: {
    search?: string;
  };
  sessionStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
};

const originalWindow = (globalThis as { window?: unknown }).window;

function setWindow(value: MockWindow | undefined) {
  (globalThis as { window?: unknown }).window = value;
}

describe('tauri api wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setWindow(originalWindow as MockWindow | undefined);
  });

  it('detects tauri when v2 internals are present', () => {
    setWindow({ __TAURI_INTERNALS__: {} });
    expect(isTauri()).toBe(true);
  });

  it('detects tauri via desktop runtime URL hint', () => {
    const setItem = vi.fn();
    setWindow({
      location: { search: '?rheolab_desktop=1' },
      sessionStorage: {
        getItem: vi.fn(() => null),
        setItem,
      },
    });

    expect(isTauri()).toBe(true);
    expect(setItem).toHaveBeenCalledWith('rheolab_desktop_runtime', '1');
  });

  it('does not throw when global isTauri slot is read-only', () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, 'isTauri', {
      value: false,
      writable: false,
      configurable: true,
    });

    setWindow({
      location: { search: '?rheolab_desktop=1' },
      sessionStorage: {
        getItem: vi.fn(() => null),
        setItem,
      },
    });

    expect(() => isTauri()).not.toThrow();
    expect(isTauri()).toBe(true);
    expect(setItem).toHaveBeenCalledWith('rheolab_desktop_runtime', '1');

    delete (globalThis as { isTauri?: unknown }).isTauri;
  });

  it('detects tauri via persisted desktop runtime session hint', () => {
    setWindow({
      location: { search: '' },
      sessionStorage: {
        getItem: vi.fn(() => '1'),
        setItem: vi.fn(),
      },
    });

    expect(isTauri()).toBe(true);
  });

  it('returns false when window is not available', () => {
    setWindow(undefined);
    expect(isTauri()).toBe(false);
  });

  it('still tries core invoke when runtime markers are missing', async () => {
    setWindow({});
    vi.mocked(invokeCore).mockResolvedValue([]);

    const result = await backup.list();

    expect(result).toEqual([]);
    expect(invokeCore).toHaveBeenCalledWith('backup_list', undefined);
  });

  it('uses @tauri-apps/api/core invoke for commands', async () => {
    setWindow({ __TAURI_INTERNALS__: {} });
    vi.mocked(invokeCore).mockResolvedValue([]);

    const result = await backup.list();

    expect(result).toEqual([]);
    expect(invokeCore).toHaveBeenCalledWith('backup_list', undefined);
  });

  it('falls back to legacy global invoke when core invoke fails', async () => {
    const legacyInvoke = vi.fn().mockResolvedValue([{ name: 'legacy' }]);
    setWindow({
      __TAURI_INTERNALS__: {},
      __TAURI__: {
        invoke: legacyInvoke,
      },
    });

    vi.mocked(invokeCore).mockRejectedValue(new Error('core invoke failed'));

    const result = await backup.list();

    expect(result).toEqual([{ name: 'legacy' }]);
    expect(invokeCore).toHaveBeenCalledWith('backup_list', undefined);
    expect(legacyInvoke).toHaveBeenCalledWith('backup_list', undefined);
  });

  it('falls back to __TAURI_INTERNALS__.invoke when core invoke fails', async () => {
    const internalsInvoke = vi.fn().mockResolvedValue([{ name: 'internals' }]);
    setWindow({
      __TAURI_INTERNALS__: {
        invoke: internalsInvoke,
      },
    });

    vi.mocked(invokeCore).mockRejectedValue(new Error('core invoke failed'));

    const result = await backup.list();

    expect(result).toEqual([{ name: 'internals' }]);
    expect(invokeCore).toHaveBeenCalledWith('backup_list', undefined);
    expect(internalsInvoke).toHaveBeenCalledWith('backup_list', undefined);
  });

  it('routes filter metadata request to tauri command', async () => {
    setWindow({ __TAURI_INTERNALS__: {} });
    vi.mocked(invokeCore).mockResolvedValue({
      instrumentTypes: ['BSL R1'],
      fluidTypes: ['Linear'],
      geometries: ['R1B1'],
      reagentNames: ['FP-3630S'],
      laboratoryNames: ['Main Lab'],
      fieldNames: ['Field-A'],
      waterSources: ['Source-A'],
    });

    const result = await experiments.filterMetadata();

    expect(result.instrumentTypes).toEqual(['BSL R1']);
    expect(invokeCore).toHaveBeenCalledWith('experiments_filter_metadata', undefined);
  });

  it('routes native report commands and normalizes byte arrays', async () => {
    setWindow({ __TAURI_INTERNALS__: {} });
    vi.mocked(invokeCore)
      .mockResolvedValueOnce([37, 80, 68, 70]) // %PDF
      .mockResolvedValueOnce(new Uint8Array([80, 75, 3, 4])) // PK..
      .mockResolvedValueOnce([37, 80, 68, 70])
      .mockResolvedValueOnce(new Uint8Array([80, 75, 3, 4]));

    const pdfBytes = await reports.generatePdf('{"mock":"pdf"}');
    const excelBytes = await reports.generateExcel('{"mock":"excel"}');
    const pdfByIdBytes = await reports.generatePdfById({ experimentId: 'exp_1', settings: {} } as any);
    const excelByIdBytes = await reports.generateExcelById({ experimentId: 'exp_1', settings: {} } as any);

    expect(Array.from(pdfBytes)).toEqual([37, 80, 68, 70]);
    expect(Array.from(excelBytes)).toEqual([80, 75, 3, 4]);
    expect(Array.from(pdfByIdBytes)).toEqual([37, 80, 68, 70]);
    expect(Array.from(excelByIdBytes)).toEqual([80, 75, 3, 4]);
    expect(invokeCore).toHaveBeenNthCalledWith(1, 'reports_generate_pdf', { input: '{"mock":"pdf"}' });
    expect(invokeCore).toHaveBeenNthCalledWith(2, 'reports_generate_excel', { input: '{"mock":"excel"}' });
    expect(invokeCore).toHaveBeenNthCalledWith(3, 'reports_generate_pdf_by_id', {
      request: { experimentId: 'exp_1', settings: {} },
    });
    expect(invokeCore).toHaveBeenNthCalledWith(4, 'reports_generate_excel_by_id', {
      request: { experimentId: 'exp_1', settings: {} },
    });
  });
});
