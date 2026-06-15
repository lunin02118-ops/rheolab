/**
 * RC manual smoke, automated:
 * saved metadata-only detail -> Report tab -> by-id PDF/XLSX export.
 *
 * Runs against the real Tauri backend/report renderer. The app-side hooks used
 * here are inert unless this spec installs explicit global callbacks, so the
 * smoke checks request parity without relying on late IPC monkey-patching.
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import type { Download, Page } from '@playwright/test';
import type { Worksheet } from 'exceljs';
import ExcelJS from 'exceljs';
import { CHANDLER_SST_63 } from './fixtures';
import {
  deleteReportDownloadWithRetry,
  readReportDownloadBuffer,
} from './report-download-cleanup';

setupBeforeEach(test);

type ReportByIdRequest = {
  experimentId?: string;
  settings?: {
    reportSettings?: {
      showAdvancedStats?: boolean;
      reportViscosityRates?: number[];
    };
    analysisSettings?: {
      pointsToAverage?: number;
      viscosityShearRates?: number[];
    };
    detectionSettings?: {
      stepSplitting?: boolean;
      splitStartDuration?: number;
      splitEndDuration?: number;
      minDurationForSplit?: number;
    };
  };
  waterOverride?: Record<string, unknown> | null;
};

type ReportRequestEvent = {
  kind: 'pdf' | 'excel' | 'all';
  request: ReportByIdRequest;
};

type FullDataLoadEvent = {
  experimentId: string;
  reason: 'save' | 'legacy-detail-fallback' | 'unknown';
};

const DEFAULT_BEGINNER_RATES = [40, 100, 170];
const EXPERT_SETTINGS = {
  pointsToAverage: 12,
  viscosityShearRates: [40, 220],
  stepSplitting: false,
  splitStartDuration: 11,
  splitEndDuration: 12,
  minDurationForSplit: 120,
  aiModel: 'e2e-model',
  externalAiEnabled: false,
  forceAiParsing: false,
  timeShiftEnabled: false,
};

async function installSavedReportSmokeHooks(page: Page): Promise<void> {
  await page.evaluate(() => {
    type SmokeWindow = Window & {
      __rheolabSavedReportSmoke?: {
        reportRequests: ReportRequestEvent[];
        fullDataLoads: FullDataLoadEvent[];
      };
      __RHEOLAB_REPORT_BY_ID_REQUEST_HOOK__?: (event: ReportRequestEvent) => void;
      __RHEOLAB_FULL_DATA_LOAD_HOOK__?: (event: FullDataLoadEvent) => void;
    };
    type ReportByIdRequest = {
      experimentId?: string;
      settings?: unknown;
      waterOverride?: Record<string, unknown> | null;
    };
    type ReportRequestEvent = {
      kind: 'pdf' | 'excel' | 'all';
      request: ReportByIdRequest;
    };
    type FullDataLoadEvent = {
      experimentId: string;
      reason: 'save' | 'legacy-detail-fallback' | 'unknown';
    };

    const w = window as SmokeWindow;
    const state = {
      reportRequests: [] as ReportRequestEvent[],
      fullDataLoads: [] as FullDataLoadEvent[],
    };
    w.__rheolabSavedReportSmoke = state;

    w.__RHEOLAB_REPORT_BY_ID_REQUEST_HOOK__ = (event) => {
      state.reportRequests.push(structuredClone(event));
    };
    w.__RHEOLAB_FULL_DATA_LOAD_HOOK__ = (event) => {
      state.fullDataLoads.push(structuredClone(event));
    };
  });
}

async function readSmokeState(page: Page): Promise<{
  reportRequests: ReportRequestEvent[];
  fullDataLoads: FullDataLoadEvent[];
}> {
  return page.evaluate(() => {
    type SmokeWindow = Window & {
      __rheolabSavedReportSmoke?: {
        reportRequests: ReportRequestEvent[];
        fullDataLoads: FullDataLoadEvent[];
      };
    };
    type ReportRequestEvent = {
      kind: 'pdf' | 'excel' | 'all';
      request: ReportByIdRequest;
    };
    type ReportByIdRequest = {
      experimentId?: string;
      settings?: unknown;
      waterOverride?: Record<string, unknown> | null;
    };
    type FullDataLoadEvent = {
      experimentId: string;
      reason: 'save' | 'legacy-detail-fallback' | 'unknown';
    };

    const state = (window as SmokeWindow).__rheolabSavedReportSmoke;
    return {
      reportRequests: [...(state?.reportRequests ?? [])],
      fullDataLoads: [...(state?.fullDataLoads ?? [])],
    };
  }) as Promise<{
    reportRequests: ReportRequestEvent[];
    fullDataLoads: FullDataLoadEvent[];
  }>;
}

function eventsSince<T>(events: T[], start: number): T[] {
  return events.slice(start);
}

async function assertDownloadBytes(
  download: Download,
  ext: '.pdf' | '.xlsx',
  minSizeBytes: number,
  inspectBytes?: (bytes: Buffer<ArrayBufferLike>) => Promise<void> | void,
): Promise<{ filename: string; size: number }> {
  const label = `saved report ${ext}`;
  const { buffer: bytes, filePath, filename } = await readReportDownloadBuffer(download, label);
  expect(filename.toLowerCase()).toContain(ext);
  try {
    expect(bytes.length).toBeGreaterThanOrEqual(minSizeBytes);
    if (ext === '.pdf') {
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('%PDF');
    } else {
      expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    }
    await inspectBytes?.(bytes);
    return { filename, size: bytes.length };
  } finally {
    await deleteReportDownloadWithRetry(download, label, { filePath });
  }
}

function stringifyCellValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const maybeRichText = value as { richText?: Array<{ text?: string }> };
    if (Array.isArray(maybeRichText.richText)) {
      return maybeRichText.richText.map(part => part.text ?? '').join('');
    }
    const maybeFormula = value as { result?: unknown; text?: string; hyperlink?: string };
    if (maybeFormula.result != null) return stringifyCellValue(maybeFormula.result);
    if (maybeFormula.text != null) return maybeFormula.text;
    if (maybeFormula.hyperlink != null) return maybeFormula.hyperlink;
  }
  return String(value);
}

function worksheetText(sheet: Worksheet): string {
  const parts: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = stringifyCellValue(cell.value);
      if (text) parts.push(text);
    });
  });
  return parts.join('\n');
}

async function assertSavedReportWorkbookStructure(bytes: Buffer<ArrayBufferLike>): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  type XlsxLoadBuffer = Parameters<typeof workbook.xlsx.load>[0];
  const stableBytes = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as unknown as XlsxLoadBuffer;
  await workbook.xlsx.load(stableBytes);

  expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(
    expect.arrayContaining(['Report', 'DebugInfo']),
  );

  const reportSheet = workbook.getWorksheet('Report');
  const debugSheet = workbook.getWorksheet('DebugInfo');
  expect(reportSheet).toBeTruthy();
  expect(debugSheet).toBeTruthy();
  expect(debugSheet?.state).toBe('hidden');

  const reportText = worksheetText(reportSheet!);
  expect(reportText).toContain('Сводка');
  expect(reportText).toContain('Рецептура');
  expect(reportText).toContain('Анализ воды');
  expect(reportText).toContain('E2E Report Water');
  expect(reportText).toContain('pH');
  expect(reportText).toContain('Fe');
  expect(reportText).toContain('Ca');
  expect(reportText).toContain('Mg');
  expect(reportText).toContain('Cl');
  expect(reportText).toContain('SO4');
  expect(reportText).toContain('HCO3');
  expect(reportText).toContain('8.2');
  expect(reportText).toContain('12.3');
  expect(reportText).toContain('4.5');
  expect(reportText).toContain('89.0');
  expect(reportText).toContain('7.8');
  expect(reportText).toContain('145.0');

  const debugText = worksheetText(debugSheet!);
  expect(debugText).toContain('Show Shear Rate');
  expect(debugText).toContain('Show Pressure');
}

async function findExperimentIdByName(page: Page, name: string): Promise<string> {
  const id = await page.evaluate(async (experimentName) => {
    const invoke = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (command: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error('Tauri invoke is unavailable');
    const response = await invoke('experiments_list', {
      query: { page: 1, limit: 5, searchQuery: experimentName },
    }) as { experiments?: Array<{ id?: string; name?: string }> };
    const exact = response.experiments?.find(exp => exp.name === experimentName);
    return exact?.id ?? null;
  }, name);
  if (!id) throw new Error(`Experiment id not found for ${name}`);
  return id;
}

async function fillWaterOverrides(page: Page): Promise<void> {
  await page.getByTestId('WaterTabButton').click();
  await expect(page.getByText('Анализ воды').first()).toBeVisible({ timeout: 10_000 });

  await page.locator('input[placeholder^="Озеро Самотлор"]').fill('E2E Report Water');

  const inputs = page.locator('input[type="number"]');
  const values = ['8.2', '0.12', '12.3', '4.5', '89', '7.8', '145'];
  for (let i = 0; i < values.length; i += 1) {
    await inputs.nth(i).fill(values[i]);
  }
}

async function ensureWaterSectionIncluded(page: Page): Promise<void> {
  const toggle = page.getByTestId('ReportWaterAnalysisToggle');
  if (!(await toggle.isChecked())) {
    await toggle.click();
  }
}

async function setExpertModeWithSettings(page: Page): Promise<void> {
  await page.evaluate((expertSettings) => {
    localStorage.setItem('rheolab-ui-mode', 'expert');
    localStorage.setItem('rheolab-analysis-settings', JSON.stringify({
      state: { expertSettings },
      version: 0,
    }));
  }, EXPERT_SETTINGS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);
}

test.describe('[RC Manual Smoke/Tauri] saved Report tab by-id', () => {
  test.setTimeout(8 * 60_000);

  test('metadata-only saved report exports by id and keeps save full-load lazy', async ({
    page,
    dashboard,
    library,
    reports,
  }) => {
    const experimentName = `SavedReportByIdSmoke_${Date.now()}`;

    await dashboard.goto();
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis(90_000);
    await dashboard.saveExperiment({ name: experimentName });
    const experimentId = await findExperimentIdByName(page, experimentName);

    await installSavedReportSmokeHooks(page);

    await library.goto();
    await library.expectLoaded();
    await library.search(experimentName);
    await library.loadExperimentByName(experimentName);
    await dashboard.expectChartVisible();

    let state = await readSmokeState(page);
    expect(state.fullDataLoads).toEqual([]);
    await expect(page.getByTestId('SaveExperimentButton')).not.toHaveText(/Загрузка/i);

    await fillWaterOverrides(page);

    const beforeReportTab = (await readSmokeState(page)).fullDataLoads.length;
    await reports.goto();
    await expect(page.getByTestId('ReportDownloadButton')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Загружаем полный набор данных/i)).toHaveCount(0);
    await ensureWaterSectionIncluded(page);

    state = await readSmokeState(page);
    expect(eventsSince(state.fullDataLoads, beforeReportTab)).toEqual([]);

    if (!(await reports.formatPdfCheckbox.isChecked())) await reports.formatPdfCheckbox.click();
    if (await reports.formatExcelCheckbox.isChecked()) await reports.formatExcelCheckbox.click();

    const beforeBeginnerPdf = (await readSmokeState(page)).reportRequests.length;
    const beginnerPdf = await reports.downloadPdf(180_000);
    const beginnerPdfStats = await assertDownloadBytes(beginnerPdf, '.pdf', 4_096);
    state = await readSmokeState(page);
    const beginnerRequestEvent = eventsSince(state.reportRequests, beforeBeginnerPdf)
      .find(event => event.kind === 'pdf');
    expect(beginnerRequestEvent).toBeTruthy();
    const beginnerRequest = beginnerRequestEvent!.request;
    expect(beginnerRequest.experimentId).toBe(experimentId);
    expect(beginnerRequest.settings?.reportSettings?.showAdvancedStats).toBe(true);
    expect(beginnerRequest.settings?.reportSettings?.reportViscosityRates).toEqual(DEFAULT_BEGINNER_RATES);
    expect(beginnerRequest.settings?.analysisSettings).toEqual({
      pointsToAverage: 1,
      viscosityShearRates: DEFAULT_BEGINNER_RATES,
    });
    expect(beginnerRequest.settings?.detectionSettings).toEqual({
      stepSplitting: true,
      splitStartDuration: 30,
      splitEndDuration: 30,
      minDurationForSplit: 90,
    });
    expect(beginnerRequest.waterOverride).toEqual({
      source: 'E2E Report Water',
      ph: 8.2,
      fe: 0.12,
      ca: 12.3,
      mg: 4.5,
      cl: 89,
      so4: 7.8,
      hco3: 145,
    });

    const beforeExcel = (await readSmokeState(page)).reportRequests.length;
    const xlsx = await reports.downloadExcel(180_000);
    const xlsxStats = await assertDownloadBytes(
      xlsx,
      '.xlsx',
      4_096,
      assertSavedReportWorkbookStructure,
    );
    state = await readSmokeState(page);
    expect(eventsSince(state.reportRequests, beforeExcel).some(event => event.kind === 'excel')).toBe(true);

    await setExpertModeWithSettings(page);
    await installSavedReportSmokeHooks(page);

    await library.goto();
    await library.expectLoaded();
    await library.search(experimentName);
    await library.loadExperimentByName(experimentName);
    await dashboard.expectChartVisible();
    await reports.goto();

    if (!(await reports.formatPdfCheckbox.isChecked())) await reports.formatPdfCheckbox.click();
    if (await reports.formatExcelCheckbox.isChecked()) await reports.formatExcelCheckbox.click();

    const beforeExpertPdf = (await readSmokeState(page)).reportRequests.length;
    const expertPdf = await reports.downloadPdf(180_000);
    const expertPdfStats = await assertDownloadBytes(expertPdf, '.pdf', 4_096);
    state = await readSmokeState(page);
    const expertRequestEvent = eventsSince(state.reportRequests, beforeExpertPdf)
      .find(event => event.kind === 'pdf');
    expect(expertRequestEvent).toBeTruthy();
    const expertRequest = expertRequestEvent!.request;
    expect(expertRequest.experimentId).toBe(experimentId);
    expect(expertRequest.settings?.reportSettings?.showAdvancedStats).toBe(true);
    expect(expertRequest.settings?.analysisSettings).toEqual({
      pointsToAverage: EXPERT_SETTINGS.pointsToAverage,
      viscosityShearRates: EXPERT_SETTINGS.viscosityShearRates,
    });
    expect(expertRequest.settings?.detectionSettings).toEqual({
      stepSplitting: EXPERT_SETTINGS.stepSplitting,
      splitStartDuration: EXPERT_SETTINGS.splitStartDuration,
      splitEndDuration: EXPERT_SETTINGS.splitEndDuration,
      minDurationForSplit: EXPERT_SETTINGS.minDurationForSplit,
    });

    const fullDataLoadsBeforeSave = (await readSmokeState(page)).fullDataLoads.length;
    await page.getByTestId('SaveExperimentButton').click();
    await expect(page.getByTestId('SaveExperimentDialogWindow')).toBeVisible({ timeout: 30_000 });
    state = await readSmokeState(page);
    const saveLoads = eventsSince(state.fullDataLoads, fullDataLoadsBeforeSave);
    expect(saveLoads).toEqual([{ experimentId, reason: 'save' }]);

    console.log('[SavedReportByIdSmoke] real by-id downloads', {
      beginnerPdf: beginnerPdfStats,
      xlsx: xlsxStats,
      expertPdf: expertPdfStats,
      fullDataLoads: state.fullDataLoads,
      reportRequestKinds: state.reportRequests.map(event => event.kind),
    });
  });
});
