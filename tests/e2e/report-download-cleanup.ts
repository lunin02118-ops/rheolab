import { expect, type Download } from '@playwright/test';
import fs from 'node:fs';

const TRANSIENT_DOWNLOAD_CLEANUP_CODES = new Set([
  'EBUSY',
  'EMFILE',
  'ENFILE',
  'ENOTEMPTY',
  'EPERM',
]);

type DownloadCleanupOptions = {
  attempts?: number;
  delayMs?: number;
  filePath?: string;
};

type ErrorLike = {
  code?: unknown;
  message?: unknown;
};

export type ReportDownloadBytes = {
  buffer: Buffer;
  filePath: string;
  filename: string;
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const code = (error as ErrorLike).code;
  return typeof code === 'string' ? code : null;
}

function isTransientFsError(error: unknown): boolean {
  const code = errorCode(error);
  return code !== null && TRANSIENT_DOWNLOAD_CLEANUP_CODES.has(code);
}

function formatError(error: unknown): string {
  if (error == null) return 'unknown error';
  if (typeof error === 'object' && 'message' in error) {
    const message = String((error as ErrorLike).message ?? error);
    const code = errorCode(error);
    return code ? `${code}: ${message}` : message;
  }
  return String(error);
}

export async function readReportDownloadBuffer(
  download: Download,
  label: string,
): Promise<ReportDownloadBytes> {
  const filePath = await download.path();
  expect(filePath, `download ${label} has no path`).toBeTruthy();

  return {
    buffer: Buffer.from(fs.readFileSync(filePath!)),
    filePath: filePath!,
    filename: download.suggestedFilename(),
  };
}

export async function deleteReportDownloadWithRetry(
  download: Download,
  label: string,
  options: DownloadCleanupOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 8;
  const delayMs = options.delayMs ?? 200;
  let filePath = options.filePath ?? null;
  let lastError: unknown = null;

  if (!filePath) {
    try {
      filePath = await download.path();
    } catch {
      // Playwright may throw here when the download is already gone.
    }
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await download.delete();
      if (!filePath || !fs.existsSync(filePath)) {
        return;
      }
    } catch (error) {
      lastError = error;
      if (filePath && !fs.existsSync(filePath)) {
        return;
      }
    }

    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.rmSync(filePath, { force: true });
        if (!fs.existsSync(filePath)) {
          return;
        }
      } catch (error) {
        lastError = error;
        if (!fs.existsSync(filePath)) {
          return;
        }
      }
    }

    if (attempt < attempts && (lastError == null || isTransientFsError(lastError))) {
      const waitMs = Math.min(delayMs * attempt, 2_000);
      console.warn(
        `[report-download-cleanup] ${label} cleanup retry ${attempt}/${attempts} after ` +
        `${formatError(lastError)}`,
      );
      await delay(waitMs);
      continue;
    }

    break;
  }

  const location = filePath ? ` at ${filePath}` : '';
  throw new Error(
    `[report-download-cleanup] failed to clean ${label}${location}: ${formatError(lastError)}`,
  );
}
