import { getBridge } from '@/lib/tauri/bridge';
import {
  convertReportInputToWasm,
  convertComparisonReportInputToWasm,
  type ExcelReportInput,
  type PdfReportInput,
} from '@/lib/analysis/report-types/converters';
import type { ComparisonReportInput } from '@/lib/analysis/report-types/comparison-report-inputs';
import type { ComparisonReportByIdsRequest } from '@/types/tauri';

const TAURI_REPORT_RETRY_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Copy only the relevant slice of the underlying buffer, avoiding the
  // full-array allocation that Uint8Array.from() caused previously.
  // We cast to ArrayBuffer because TypedArray.buffer is always a plain
  // ArrayBuffer in browser/Tauri WebView2 (SharedArrayBuffer requires
  // cross-origin isolation headers which are not present here).
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isTauriRuntimeUnavailable(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('not running in tauri') ||
    message.includes('tauri_internals') ||
    message.includes('__tauri_internals__') ||
    message.includes('window is not defined') ||
    (message.includes('cannot read') && message.includes('invoke'))
  );
}

async function tryGeneratePdfNative(input: PdfReportInput): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge.reports) {
    throw new Error('Unknown IPC command reports_generate_pdf');
  }
  // Pass the structured object directly — Tauri serialises it via serde on the
  // Rust side, eliminating the JS JSON.stringify heap allocation.
  const payload = convertReportInputToWasm(input);
  const bytes = await bridge.reports.generatePdf(payload);
  return new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' });
}

async function tryGenerateExcelNative(input: ExcelReportInput): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge.reports) {
    throw new Error('Unknown IPC command reports_generate_excel');
  }
  const payload = convertReportInputToWasm(input);
  const bytes = await bridge.reports.generateExcel(payload);
  return new Blob([toArrayBuffer(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * Generate PDF report blob via native Tauri IPC.
 */
export async function generatePdfReportBlob(input: PdfReportInput): Promise<Blob> {
  try {
    return await tryGeneratePdfNative(input);
  } catch (error) {
    if (isTauriRuntimeUnavailable(error)) {
      await delay(TAURI_REPORT_RETRY_DELAY_MS);
      return await tryGeneratePdfNative(input);
    }
    throw error;
  }
}

/**
 * Generate Excel report blob via native Tauri IPC.
 */
export async function generateExcelReportBlob(input: ExcelReportInput): Promise<Blob> {
  try {
    return await tryGenerateExcelNative(input);
  } catch (error) {
    if (isTauriRuntimeUnavailable(error)) {
      await delay(TAURI_REPORT_RETRY_DELAY_MS);
      return await tryGenerateExcelNative(input);
    }
    throw error;
  }
}

// ── Comparison (multi-experiment) report generation ───────────────────────

async function tryGenerateComparisonPdfNative(input: ComparisonReportInput): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge.reports?.generateComparisonPdf) {
    throw new Error('Unknown IPC command reports_generate_comparison_pdf');
  }
  const payload = convertComparisonReportInputToWasm(input);
  const bytes = await bridge.reports.generateComparisonPdf(payload);
  return new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' });
}

async function tryGenerateComparisonExcelNative(input: ComparisonReportInput): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge.reports?.generateComparisonExcel) {
    throw new Error('Unknown IPC command reports_generate_comparison_excel');
  }
  const payload = convertComparisonReportInputToWasm(input);
  const bytes = await bridge.reports.generateComparisonExcel(payload);
  return new Blob([toArrayBuffer(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

async function tryGenerateComparisonPdfByIdsNative(
  request: ComparisonReportByIdsRequest,
): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge.reports?.generateComparisonPdfByIds) {
    throw new Error('Unknown IPC command reports_generate_comparison_pdf_by_ids');
  }
  const bytes = await bridge.reports.generateComparisonPdfByIds(request);
  return new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' });
}

async function tryGenerateComparisonExcelByIdsNative(
  request: ComparisonReportByIdsRequest,
): Promise<Blob> {
  const bridge = getBridge();
  if (!bridge.reports?.generateComparisonExcelByIds) {
    throw new Error('Unknown IPC command reports_generate_comparison_excel_by_ids');
  }
  const bytes = await bridge.reports.generateComparisonExcelByIds(request);
  return new Blob([toArrayBuffer(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
/**
 * Generate a multi-experiment **comparison** PDF blob via native Tauri IPC.
 *
 * Page 1 is the summary chart + summary table; pages 2..N+1 are one compact
 * per-experiment report each.  See
 * `docs/adr/ADR-0010-comparison-report-generation.md` for the data contract.
 */
export async function generateComparisonPdfReportBlob(input: ComparisonReportInput): Promise<Blob> {
  try {
    return await tryGenerateComparisonPdfNative(input);
  } catch (error) {
    if (isTauriRuntimeUnavailable(error)) {
      await delay(TAURI_REPORT_RETRY_DELAY_MS);
      return await tryGenerateComparisonPdfNative(input);
    }
    throw error;
  }
}

/**
 * Generate a multi-experiment **comparison** XLSX blob via native Tauri IPC.
 *
 * Workbook layout: Summary sheet (sheet 0), one sheet per experiment
 * (sheets 1..N), plus a hidden DebugInfo sheet.  Proposed sheet names are
 * sanitised and deduplicated on the Rust side.
 */
export async function generateComparisonExcelReportBlob(input: ComparisonReportInput): Promise<Blob> {
  try {
    return await tryGenerateComparisonExcelNative(input);
  } catch (error) {
    if (isTauriRuntimeUnavailable(error)) {
      await delay(TAURI_REPORT_RETRY_DELAY_MS);
      return await tryGenerateComparisonExcelNative(input);
    }
    throw error;
  }
}

export async function generateComparisonPdfReportByIdsBlob(
  request: ComparisonReportByIdsRequest,
): Promise<Blob> {
  try {
    return await tryGenerateComparisonPdfByIdsNative(request);
  } catch (error) {
    if (isTauriRuntimeUnavailable(error)) {
      await delay(TAURI_REPORT_RETRY_DELAY_MS);
      return await tryGenerateComparisonPdfByIdsNative(request);
    }
    throw error;
  }
}

export async function generateComparisonExcelReportByIdsBlob(
  request: ComparisonReportByIdsRequest,
): Promise<Blob> {
  try {
    return await tryGenerateComparisonExcelByIdsNative(request);
  } catch (error) {
    if (isTauriRuntimeUnavailable(error)) {
      await delay(TAURI_REPORT_RETRY_DELAY_MS);
      return await tryGenerateComparisonExcelByIdsNative(request);
    }
    throw error;
  }
}
