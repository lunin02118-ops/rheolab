import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tauri/bridge', () => ({
  getBridge: vi.fn(),
}));

vi.mock('@/lib/analysis/report-types/converters', () => ({
  convertReportInputToWasm: vi.fn((input: unknown) => ({ converted: input })),
  convertComparisonReportInputToWasm: vi.fn((input: unknown) => ({ comparison: input })),
}));

import { getBridge } from '@/lib/tauri/bridge';
import {
  convertReportInputToWasm,
  convertComparisonReportInputToWasm,
} from '@/lib/analysis/report-types/converters';
import {
  generateComparisonExcelReportBlob,
  generateComparisonPdfReportBlob,
  generateExcelReportBlob,
  generatePdfReportBlob,
} from '@/lib/reports/client';

describe('reports client', () => {
  const pdfInput = { metadata: { filename: 'test' }, rawData: [] } as any;
  const excelInput = { metadata: { filename: 'test' }, rawData: [] } as any;
  const comparisonInput = {
    language: 'en',
    unitSystem: 'SI',
    generatedAt: '2026-04-22T00:00:00Z',
    comparisonChart: {},
    experiments: [],
  } as any;
  const bridge = {
    platform: 'tauri' as 'web' | 'tauri' | 'electron',
    isDesktop: true,
    reports: undefined as
      | {
          generatePdf: ReturnType<typeof vi.fn>;
          generateExcel: ReturnType<typeof vi.fn>;
          generateComparisonPdf: ReturnType<typeof vi.fn>;
          generateComparisonExcel: ReturnType<typeof vi.fn>;
        }
      | undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBridge).mockReturnValue(bridge as never);
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.reports = {
      generatePdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
      generateExcel: vi.fn().mockResolvedValue(new Uint8Array([80, 75, 3, 4])),
      generateComparisonPdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
      generateComparisonExcel: vi.fn().mockResolvedValue(new Uint8Array([80, 75, 3, 4])),
    };
  });

  it('generates PDF via native Tauri IPC', async () => {
    const blob = await generatePdfReportBlob(pdfInput);

    expect(blob.type).toBe('application/pdf');
    expect(bridge.reports!.generatePdf).toHaveBeenCalledOnce();
    expect(convertReportInputToWasm).toHaveBeenCalledWith(pdfInput);
  });

  it('generates Excel via native Tauri IPC', async () => {
    const blob = await generateExcelReportBlob(excelInput);

    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(bridge.reports!.generateExcel).toHaveBeenCalledOnce();
    expect(convertReportInputToWasm).toHaveBeenCalledWith(excelInput);
  });

  it('retries PDF on transient Tauri runtime error then succeeds', async () => {
    bridge.reports = {
      generatePdf: vi
        .fn()
        .mockRejectedValueOnce(new Error('__TAURI_INTERNALS__ invoke unavailable'))
        .mockResolvedValueOnce(new Uint8Array([37, 80, 68, 70])),
      generateExcel: vi.fn(),
      generateComparisonPdf: vi.fn(),
      generateComparisonExcel: vi.fn(),
    };

    const blob = await generatePdfReportBlob(pdfInput);

    expect(blob.type).toBe('application/pdf');
    expect(bridge.reports!.generatePdf).toHaveBeenCalledTimes(2);
  });

  it('throws when reports bridge is not available', async () => {
    bridge.reports = undefined;

    await expect(generatePdfReportBlob(pdfInput)).rejects.toThrow('reports_generate_pdf');
  });

  it('throws non-transient errors without retry', async () => {
    bridge.reports = {
      generatePdf: vi.fn().mockRejectedValue(new Error('Database locked')),
      generateExcel: vi.fn(),
      generateComparisonPdf: vi.fn(),
      generateComparisonExcel: vi.fn(),
    };

    await expect(generatePdfReportBlob(pdfInput)).rejects.toThrow('Database locked');
    expect(bridge.reports.generatePdf).toHaveBeenCalledTimes(1);
  });

  // ── Comparison report generation ─────────────────────────────────────

  it('generates comparison PDF via native Tauri IPC', async () => {
    const blob = await generateComparisonPdfReportBlob(comparisonInput);

    expect(blob.type).toBe('application/pdf');
    expect(bridge.reports!.generateComparisonPdf).toHaveBeenCalledOnce();
    expect(convertComparisonReportInputToWasm).toHaveBeenCalledWith(comparisonInput);
  });

  it('generates comparison Excel via native Tauri IPC', async () => {
    const blob = await generateComparisonExcelReportBlob(comparisonInput);

    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(bridge.reports!.generateComparisonExcel).toHaveBeenCalledOnce();
    expect(convertComparisonReportInputToWasm).toHaveBeenCalledWith(comparisonInput);
  });

  it('retries comparison PDF on transient Tauri runtime error then succeeds', async () => {
    bridge.reports = {
      generatePdf: vi.fn(),
      generateExcel: vi.fn(),
      generateComparisonPdf: vi
        .fn()
        .mockRejectedValueOnce(new Error('window is not defined'))
        .mockResolvedValueOnce(new Uint8Array([37, 80, 68, 70])),
      generateComparisonExcel: vi.fn(),
    };

    const blob = await generateComparisonPdfReportBlob(comparisonInput);

    expect(blob.type).toBe('application/pdf');
    expect(bridge.reports.generateComparisonPdf).toHaveBeenCalledTimes(2);
  });

  it('throws when comparison reports bridge is not available', async () => {
    bridge.reports = undefined;

    await expect(generateComparisonPdfReportBlob(comparisonInput)).rejects.toThrow(
      'reports_generate_comparison_pdf',
    );
    await expect(generateComparisonExcelReportBlob(comparisonInput)).rejects.toThrow(
      'reports_generate_comparison_excel',
    );
  });

  it('throws non-transient comparison PDF errors without retry', async () => {
    bridge.reports = {
      generatePdf: vi.fn(),
      generateExcel: vi.fn(),
      generateComparisonPdf: vi.fn().mockRejectedValue(new Error('License expired')),
      generateComparisonExcel: vi.fn(),
    };

    await expect(generateComparisonPdfReportBlob(comparisonInput)).rejects.toThrow('License expired');
    expect(bridge.reports.generateComparisonPdf).toHaveBeenCalledTimes(1);
  });
});
