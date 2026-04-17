import { extractFilenameMetadata } from '@/lib/parsing/filename-metadata';
import { getBridge } from '@/lib/tauri/bridge';
import { toFiniteNumber } from '@/lib/utils/numbers';
import type { ParseResult, ParsedBy } from '@/types';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['xlsx', 'xls', 'csv', 'txt', 'dat'];
const TAURI_PARSE_RETRY_DELAY_MS = 150;

interface ParseOptions {
  aiModel?: string;
  /** Force AI column mapping even when heuristic parser succeeds. Skips native parser. */
  forceAI?: boolean;
}

/** Mutable context accumulated during a single parse call. */
interface ParseContext {
  parsedBy: ParsedBy;
  warnings: string[];
}

type FilenameMetadata = NonNullable<ParseResult['metadata']['filenameMetadata']>;
type NumericValue = number | string | null | undefined;
type UnknownRecord = Record<string, unknown>;

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

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as UnknownRecord;
}

function readNumber(record: UnknownRecord, keys: string[], fallback = 0): number {
  for (const key of keys) {
    if (key in record) {
      return toFiniteNumber(record[key] as NumericValue, fallback);
    }
  }
  return fallback;
}

function normalizeDataPoints(data: unknown): ParseResult['data'] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((point) => {
    const record = asRecord(point) ?? {};
    return {
      time_sec: readNumber(record, ['time_sec', 'timeSec', 'time'], 0),
      viscosity_cp: readNumber(record, ['viscosity_cp', 'viscosityCp', 'viscosity'], 0),
      temperature_c: readNumber(record, ['temperature_c', 'temperatureC', 'temperature'], 0),
      speed_rpm: readNumber(record, ['speed_rpm', 'speedRpm', 'rpm'], 0),
      shear_rate_s1: readNumber(record, ['shear_rate_s1', 'shearRateS1', 'shear_rate', 'shearRate'], 0),
      shear_stress_pa: readNumber(record, ['shear_stress_pa', 'shearStressPa', 'shear_stress', 'shearStress'], 0),
      pressure_bar: readNumber(record, ['pressure_bar', 'pressureBar', 'pressure'], 0),
      bath_temperature_c: readNumber(record, ['bath_temperature_c', 'bathTemperatureC'], 0) || undefined,
    };
  });
}

function normalizeTimeRange(value: unknown): ParseResult['summary']['timeRange'] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const start = readNumber(record, ['start'], 0);
  const end = readNumber(record, ['end'], start);
  const durationMinutes = readNumber(
    record,
    ['durationMinutes', 'duration_minutes'],
    (end - start) / 60,
  );

  return { start, end, durationMinutes };
}

function normalizeRangeWithAvg(
  value: unknown,
): ParseResult['summary']['viscosityRange'] | ParseResult['summary']['temperatureRange'] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const min = readNumber(record, ['min'], 0);
  const max = readNumber(record, ['max'], min);
  const avgPresent = 'avg' in record;

  return {
    min,
    max,
    ...(avgPresent ? { avg: readNumber(record, ['avg'], min) } : {}),
  };
}

function normalizeRange(value: unknown): ParseResult['summary']['pressureRange'] | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  return {
    min: readNumber(record, ['min'], 0),
    max: readNumber(record, ['max'], 0),
  };
}

function normalizeSummary(summary: unknown, data: ParseResult['data']): ParseResult['summary'] {
  const record = asRecord(summary);
  if (!record) {
    return buildSummary(data);
  }

  const normalized = {
    pointCount: Math.max(
      0,
      Math.round(readNumber(record, ['pointCount', 'point_count'], data.length)),
    ),
    timeRange: normalizeTimeRange(record.timeRange ?? record.time_range),
    viscosityRange: normalizeRangeWithAvg(record.viscosityRange ?? record.viscosity_range),
    temperatureRange: normalizeRangeWithAvg(record.temperatureRange ?? record.temperature_range),
    pressureRange: normalizeRange(record.pressureRange ?? record.pressure_range),
  };

  if (
    normalized.pointCount <= 0 &&
    !normalized.timeRange &&
    !normalized.viscosityRange &&
    !normalized.temperatureRange &&
    !normalized.pressureRange
  ) {
    return buildSummary(data);
  }

  return normalized;
}

function normalizeParseResult(result: ParseResult): ParseResult {
  const data = normalizeDataPoints((result as { data?: unknown }).data);
  const summary = normalizeSummary((result as { summary?: unknown }).summary, data);
  const testDate = normalizeDate(result.metadata?.testDate);
  const calibrationDate = normalizeDate(result.metadata?.calibration?.calibrationDate);

  return {
    ...result,
    data,
    summary,
    metadata: {
      ...result.metadata,
      testDate,
      calibration: result.metadata.calibration
        ? {
          ...result.metadata.calibration,
          calibrationDate: calibrationDate ?? result.metadata.calibration.calibrationDate,
        }
        : undefined,
    },
  };
}

function hasFilenameMetadata(metadata: FilenameMetadata): boolean {
  return Boolean(
    metadata.testId ||
      metadata.testType ||
      metadata.testTypeFull ||
      metadata.fieldName ||
      metadata.wellNumber ||
      metadata.operatorName ||
      metadata.destination ||
      metadata.waterSource ||
      metadata.temperature !== undefined ||
      metadata.laboratoryName ||
      (metadata.recipe && metadata.recipe.length > 0),
  );
}

function mergeFilenameMetadata(
  primary?: FilenameMetadata,
  secondary?: FilenameMetadata,
): FilenameMetadata | undefined {
  if (!primary && !secondary) {
    return undefined;
  }

  const merged: FilenameMetadata = {
    testId: primary?.testId ?? secondary?.testId,
    testType: primary?.testType ?? secondary?.testType,
    testTypeFull: primary?.testTypeFull ?? secondary?.testTypeFull,
    fieldName: primary?.fieldName ?? secondary?.fieldName,
    wellNumber: primary?.wellNumber ?? secondary?.wellNumber,
    operatorName: primary?.operatorName ?? secondary?.operatorName,
    destination: primary?.destination ?? secondary?.destination,
    waterSource:
      primary?.waterSource ??
      secondary?.waterSource ??
      primary?.destination ??
      secondary?.destination,
    temperature: primary?.temperature ?? secondary?.temperature,
    laboratoryName: primary?.laboratoryName ?? secondary?.laboratoryName,
    recipe:
      primary?.recipe && primary.recipe.length > 0
        ? primary.recipe
        : secondary?.recipe,
  };

  return hasFilenameMetadata(merged) ? merged : undefined;
}

async function enrichParseResult(
  result: ParseResult,
  filename: string,
): Promise<ParseResult> {
  const filenameExtraction = await extractFilenameMetadata(filename);
  const filenameMetadata = mergeFilenameMetadata(
    result.metadata.filenameMetadata,
    filenameExtraction.filenameMetadata,
  );

  return normalizeParseResult({
    ...result,
    metadata: {
      ...result.metadata,
      filenameMetadata,
      testDate: result.metadata.testDate ?? filenameExtraction.testDate,
    },
  });
}

function isTauriParsingUnavailable(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('not running in tauri') ||
    message.includes('tauri_internals') ||
    message.includes('__tauri_internals__') ||
    message.includes('window is not defined') ||
    (message.includes('cannot read') && message.includes('invoke')) ||
    message.includes('unknown ipc command') ||
    message.includes('command parsing_parse_file not found') ||
    (message.includes('parsing_parse_file') && message.includes('not found'))
  );
}

/**
 * Returns true when the native parser executed but could not extract data.
 * These failures should fall through to WASM+AI when an API key is available.
 */
function isNativeParseDataFailure(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('no valid data points') ||
    message.includes('native parser error')
  );
}

async function parseViaTauriNative(file: File, buffer: ArrayBuffer, options?: ParseOptions): Promise<ParseResult> {
  const bridge = getBridge();
  // On Tauri desktop, the File object contains a native .path property.
  // Passing filePath lets Rust read the file directly — avoids 8× array conversion over IPC (~120 MB → ~10 MB per parse).
  const filePath = (file as unknown as { path?: string }).path;
  const request = filePath
    ? { filename: file.name, filePath, forceAi: options?.forceAI, aiModel: options?.aiModel }
    : {
        filename: file.name,
        // Bytes pre-read by caller — avoids re-reading the file on retries (#32)
        bytes: Array.from(new Uint8Array(buffer)),
        forceAi: options?.forceAI,
        aiModel: options?.aiModel,
      };
  const response = await bridge.parsing.parseFile(request);
  return normalizeParseResult(response as unknown as ParseResult);
}

function assertSupportedFile(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }

  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type: .${ext}`);
  }
}

function buildSummary(data: ParseResult['data']): ParseResult['summary'] {
  if (!data || data.length === 0) {
    return {
      pointCount: 0,
      timeRange: { start: 0, end: 0, durationMinutes: 0 },
      viscosityRange: { min: 0, max: 0, avg: 0 },
      temperatureRange: { min: 0, max: 0, avg: 0 },
    };
  }

  // Single-pass iteration — Math.min/max spread throws RangeError on arrays
  // larger than ~65k elements, and creates 4 unnecessary intermediate arrays.
  let minTime = Infinity,  maxTime = -Infinity;
  let minVisc = Infinity,  maxVisc = -Infinity,  sumVisc = 0;
  let minTemp = Infinity,  maxTemp = -Infinity,  sumTemp = 0;
  let minPres = Infinity,  maxPres = -Infinity,  hasPressure = false;

  for (const p of data) {
    if (p.time_sec < minTime) minTime = p.time_sec;
    if (p.time_sec > maxTime) maxTime = p.time_sec;
    if (p.viscosity_cp < minVisc) minVisc = p.viscosity_cp;
    if (p.viscosity_cp > maxVisc) maxVisc = p.viscosity_cp;
    sumVisc += p.viscosity_cp;
    if (p.temperature_c < minTemp) minTemp = p.temperature_c;
    if (p.temperature_c > maxTemp) maxTemp = p.temperature_c;
    sumTemp += p.temperature_c;
    if ((p.pressure_bar || 0) > 0) {
      const pbar = p.pressure_bar!;
      if (pbar < minPres) minPres = pbar;
      if (pbar > maxPres) maxPres = pbar;
      hasPressure = true;
    }
  }

  const n = data.length;
  const durationMinutes = Math.round(((maxTime - minTime) / 60) * 10) / 10;

  return {
    pointCount: n,
    timeRange: { start: minTime, end: maxTime, durationMinutes },
    viscosityRange: {
      min: Math.round(minVisc * 100) / 100,
      max: Math.round(maxVisc * 100) / 100,
      avg: Math.round((sumVisc / n) * 100) / 100,
    },
    temperatureRange: {
      min: Math.round(minTemp * 10) / 10,
      max: Math.round(maxTemp * 10) / 10,
      avg: Math.round((sumTemp / n) * 10) / 10,
    },
    ...(hasPressure && {
      pressureRange: {
        min: Math.round(minPres * 100) / 100,
        max: Math.round(maxPres * 100) / 100,
      },
    }),
  };
}

/**
 * Desktop file parsing via Tauri commands.
 *
 * Parse chain: Tauri native → (retry) → WASM → legacy API.
 * Each transition is recorded in `parsedBy` / `warnings`.
 */
export async function parseRheologyFile(
  file: File,
  options?: ParseOptions,
): Promise<ParseResult> {
  assertSupportedFile(file);
  const bridge = getBridge();
  const desktopRuntime = bridge.platform === 'tauri';

  // Check whether an active Groq key is configured (metadata only — no plaintext).
  // The key itself is resolved server-side by the Rust parsing command.
  const hasAiKey = desktopRuntime
    ? !!(await bridge.apiKeys.active('groq').catch(() => null))?.activeKey
    : false;

  // eslint-disable-next-line no-console -- dev-only diagnostic
  if (import.meta.env.DEV) console.log('[parseRheologyFile] resolvedOptions:', {
    forceAI: options?.forceAI,
    aiModel: options?.aiModel,
    hasAiKey,
  });

  // Early guard: when Force AI is requested, an API key is required.
  if (options?.forceAI && !hasAiKey) {
    console.warn('[parseRheologyFile] forceAI=true but no API key resolved! AI parsing will fail.');
    throw new Error(
      'Принудительный AI-парсинг включён, но Groq API ключ не найден. ' +
      'Добавьте ключ в Настройки → API Ключи.',
    );
  }

  const ctx: ParseContext = { parsedBy: 'native', warnings: [] };

  // Read the file buffer once — reused for native and WASM paths to avoid
  // multiple file reads on retry/fallback chains (#32 fix)
  const fileBuffer = await file.arrayBuffer();

  // On Tauri desktop with forceAI, route directly through the native Rust parser
  // (which calls Groq HTTP API internally). WASM is disabled at build time in Tauri
  // so we must not fall through to the WASM path in desktop mode.
  if (desktopRuntime && options?.forceAI) {
    const nativeResult = await parseViaTauriNative(file, fileBuffer, options);
    ctx.parsedBy = 'native';
    return applyContext(await enrichParseResult(nativeResult, file.name), ctx);
  }

  // When AI is forced in browser (non-Tauri), skip the native parser and go
  // straight to the WASM+AI path so the AI column-mapping callback fires.
  if (!options?.forceAI) {
    try {
      const nativeResult = await parseViaTauriNative(file, fileBuffer, options);
      ctx.parsedBy = 'native';
      return applyContext(await enrichParseResult(nativeResult, file.name), ctx);
    } catch (nativeError) {
      let nativeUnavailableError: unknown = nativeError;

      // When the native parser ran but could not extract data and we have an
      // API key, skip retries and fall straight through to the WASM+AI path.
      const canRetryWithAI = isNativeParseDataFailure(nativeError) && hasAiKey;

      if (!isTauriParsingUnavailable(nativeError) && !canRetryWithAI) {
        throw nativeError;
      }

      if (canRetryWithAI) {
        ctx.warnings.push(
          'Native parser found no data, falling through to WASM AI path',
        );
      } else if (desktopRuntime) {
        await delay(TAURI_PARSE_RETRY_DELAY_MS);
        try {
          const retriedNativeResult = await parseViaTauriNative(file, fileBuffer, options);
          ctx.parsedBy = 'native';
          return applyContext(await enrichParseResult(retriedNativeResult, file.name), ctx);
        } catch (retryError) {
          if (!isTauriParsingUnavailable(retryError)) {
            throw retryError;
          }
          nativeUnavailableError = retryError;
        }

        const reason = nativeUnavailableError instanceof Error
          ? nativeUnavailableError.message
          : String(nativeUnavailableError);
        throw new Error(`Native parser unavailable: ${reason}`);
      }
    }
  } // end !forceAI block

  // Unreachable: native Tauri is the only parser path.
  throw new Error('Parsing pipeline exhausted: no parser available');
}

/** Stamp parsedBy + warnings onto a ParseResult. */
function applyContext(result: ParseResult, ctx: ParseContext): ParseResult {
  return {
    ...result,
    parsedBy: ctx.parsedBy,
    ...(ctx.warnings.length > 0 ? { warnings: ctx.warnings } : {}),
  };
}
