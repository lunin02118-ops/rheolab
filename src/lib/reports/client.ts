import { getBridge } from '@/lib/tauri/bridge';
import {
  convertReportInputToWasm,
  type ExcelReportInput,
  type PdfReportInput,
} from '@/lib/analysis/report-types/converters';
import type { ComparisonReportByIdsRequest, ExperimentReportByIdRequest } from '@/types/tauri';

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

async function tryGeneratePdfByIdNative(
  request: ExperimentReportByIdRequest,
): Promise<Uint8Array> {
  const bridge = getBridge();
  if (!bridge.reports?.generatePdfById) {
    throw new Error('Unknown IPC command reports_generate_pdf_by_id');
  }
  return await bridge.reports.generatePdfById(request);
}

async function tryGenerateExcelByIdNative(
  request: ExperimentReportByIdRequest,
): Promise<Uint8Array> {
  const bridge = getBridge();
  if (!bridge.reports?.generateExcelById) {
    throw new Error('Unknown IPC command reports_generate_excel_by_id');
  }
  return await bridge.reports.generateExcelById(request);
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

export async function generatePdfReportByIdBytes(
  request: ExperimentReportByIdRequest,
): Promise<Uint8Array> {
  try {
    return await tryGeneratePdfByIdNative(request);
  } catch (error) {
    if (isTauriRuntimeUnavailable(error)) {
      await delay(TAURI_REPORT_RETRY_DELAY_MS);
      return await tryGeneratePdfByIdNative(request);
    }
    throw error;
  }
}

export async function generateExcelReportByIdBytes(
  request: ExperimentReportByIdRequest,
): Promise<Uint8Array> {
  try {
    return await tryGenerateExcelByIdNative(request);
  } catch (error) {
    if (isTauriRuntimeUnavailable(error)) {
      await delay(TAURI_REPORT_RETRY_DELAY_MS);
      return await tryGenerateExcelByIdNative(request);
    }
    throw error;
  }
}

export async function generatePdfReportByIdBlob(
  request: ExperimentReportByIdRequest,
): Promise<Blob> {
  const bytes = await generatePdfReportByIdBytes(request);
  return new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' });
}

export async function generateExcelReportByIdBlob(
  request: ExperimentReportByIdRequest,
): Promise<Blob> {
  const bytes = await generateExcelReportByIdBytes(request);
  return new Blob([toArrayBuffer(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ── Comparison (multi-experiment) report generation ───────────────────────

async function tryGenerateComparisonPdfByIdsNative(
  request: ComparisonReportByIdsRequest,
): Promise<Uint8Array> {
  const bridge = getBridge();
  if (!bridge.reports?.generateComparisonPdfByIds) {
    throw new Error('Unknown IPC command reports_generate_comparison_pdf_by_ids');
  }
  return await bridge.reports.generateComparisonPdfByIds(request);
}

async function tryGenerateComparisonExcelByIdsNative(
  request: ComparisonReportByIdsRequest,
): Promise<Uint8Array> {
  const bridge = getBridge();
  if (!bridge.reports?.generateComparisonExcelByIds) {
    throw new Error('Unknown IPC command reports_generate_comparison_excel_by_ids');
  }
  return await bridge.reports.generateComparisonExcelByIds(request);
}

export async function generateComparisonPdfReportByIdsBytes(
  request: ComparisonReportByIdsRequest,
): Promise<Uint8Array> {
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

export async function generateComparisonExcelReportByIdsBytes(
  request: ComparisonReportByIdsRequest,
): Promise<Uint8Array> {
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

export async function generateComparisonPdfReportByIdsBlob(
  request: ComparisonReportByIdsRequest,
): Promise<Blob> {
  const bytes = await generateComparisonPdfReportByIdsBytes(request);
  return new Blob([toArrayBuffer(bytes)], { type: 'application/pdf' });
}

export async function generateComparisonExcelReportByIdsBlob(
  request: ComparisonReportByIdsRequest,
): Promise<Blob> {
  const bytes = await generateComparisonExcelReportByIdsBytes(request);
  return new Blob([toArrayBuffer(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
