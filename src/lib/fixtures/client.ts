import { getBridge } from '@/lib/tauri/bridge';
import { parseRheologyFile } from '@/lib/parsing/client';
import type { ParseResult } from '@/types';
import type { FixtureSummaryItem, ParseFileResponse } from '@/types/tauri';

const TAURI_RETRY_DELAY_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDate(value: unknown): Date | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeNativeParseResult(result: ParseFileResponse): ParseResult {
  const calibration = result.metadata.calibration
    ? {
      ...result.metadata.calibration,
      calibrationDate:
        normalizeDate(result.metadata.calibration.calibrationDate) ??
        result.metadata.calibration.calibrationDate ??
        null,
    }
    : undefined;

  return {
    ...result,
    metadata: {
      ...result.metadata,
      testDate: normalizeDate(result.metadata.testDate),
      calibration,
    },
  } as ParseResult;
}

function isCommandNotFound(error: unknown, commandName: string): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('unknown ipc command') ||
    message.includes(`command ${commandName.toLowerCase()} not found`) ||
    (message.includes(commandName.toLowerCase()) && message.includes('not found'))
  );
}

function isNotTauriRuntime(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('not running in tauri') ||
    message.includes('tauri_internals') ||
    message.includes('window is not defined') ||
    (message.includes('cannot read') && message.includes('invoke'))
  );
}

function createDesktopNativeFixturesError(operation: string, error: unknown): Error {
  const details = error instanceof Error ? error.message : String(error);
  return new Error(
    `Desktop runtime requires native ${operation}. Tauri bridge is unavailable: ${details}`,
  );
}

/**
 * Unified fixture list loader.
 * Desktop/Tauri path avoids Next API + auth middleware.
 */
export async function listFixtures(): Promise<FixtureSummaryItem[]> {
  const bridge = getBridge();
  const desktopRuntime = bridge.isDesktop;

  try {
    const response = await bridge.fixtures.list();
    if (!response.success) {
      return [];
    }
    return Array.isArray(response.fixtures) ? response.fixtures : [];
  } catch (error) {
    let listErrorRef: unknown = error;

    if (isNotTauriRuntime(error) && desktopRuntime) {
      await delay(TAURI_RETRY_DELAY_MS);
      try {
        const retried = await bridge.fixtures.list();
        if (!retried.success) {
          return [];
        }
        return Array.isArray(retried.fixtures) ? retried.fixtures : [];
      } catch (retryError) {
        listErrorRef = retryError;
      }
    }

    if (desktopRuntime) {
      throw createDesktopNativeFixturesError('fixtures list command', listErrorRef);
    }

    if (!isNotTauriRuntime(listErrorRef) && !isCommandNotFound(listErrorRef, 'test_fixtures_list')) {
      throw listErrorRef;
    }
  }
  
  return [];
}

/**
 * Unified fixture parse loader.
 * In desktop mode reads local file bytes via Tauri command and parses locally.
 */
export async function parseFixture(filename: string, aiModel?: string, forceAI?: boolean): Promise<ParseResult> {
  const bridge = getBridge();
  const desktopRuntime = bridge.isDesktop;
  let parseErrorRef: unknown;

  // When Force AI is enabled, skip the native Tauri parser (which has no AI)
  // and fall through to the WASM+AI path via parseRheologyFile.
  if (!forceAI) {
    try {
      const parsed = await bridge.fixtures.parse(filename);
      return normalizeNativeParseResult(parsed);
    } catch (parseError) {
      parseErrorRef = parseError;
    }
  }

  // forceAI=true: read raw bytes and parse via WASM+AI
  if (forceAI) {
    const response = await bridge.fixtures.read(filename);
    if (!response.success || !response.bytes) {
      throw new Error(response.error || `Failed to read fixture: ${filename}`);
    }
    const bytes = new Uint8Array(response.bytes);
    const file = new File([bytes], response.filename || filename);
    return parseRheologyFile(file, { aiModel, forceAI: true });
  }

  if (isNotTauriRuntime(parseErrorRef) && desktopRuntime) {
    await delay(TAURI_RETRY_DELAY_MS);
    try {
      const retried = await bridge.fixtures.parse(filename);
      return normalizeNativeParseResult(retried);
    } catch (retryError) {
      parseErrorRef = retryError;
    }
  }

  if (isCommandNotFound(parseErrorRef, 'test_fixtures_parse')) {
      // Compatibility fallback for older desktop binaries without test_fixtures_parse command.
    const response = await bridge.fixtures.read(filename);
    if (!response.success || !response.bytes) {
      throw new Error(response.error || `Failed to read fixture: ${filename}`);
    }

    const bytes = new Uint8Array(response.bytes);
    const file = new File([bytes], response.filename || filename);

    // API key is resolved server-side by the Rust parsing command
    return parseRheologyFile(file, { aiModel, forceAI });
  }

  if (desktopRuntime && isNotTauriRuntime(parseErrorRef)) {
    throw createDesktopNativeFixturesError('fixtures parser command', parseErrorRef);
  }

  if (!isNotTauriRuntime(parseErrorRef)) {
    throw parseErrorRef;
  }

  throw parseErrorRef;
}
