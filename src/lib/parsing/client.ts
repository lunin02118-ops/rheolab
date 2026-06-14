import { getBridge } from '@/lib/tauri/bridge';
import type { ParseResult, ParsedBy } from '@/types';
import type { ParseFileRequest } from '@/types/tauri';

import { enrichParseResult, normalizeParseResult } from './parse-normalize';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['xlsx', 'xls', 'csv', 'txt', 'dat'];
const TAURI_PARSE_RETRY_DELAY_MS = 150;

interface ParseOptions {
  aiModel?: string;
  /** Explicit opt-in for external AI/network calls. Defaults to false. */
  externalAiEnabled?: boolean;
  /** Force AI column mapping even when heuristic parser succeeds. Skips native parser. */
  forceAI?: boolean;
}

/** Mutable context accumulated during a single parse call. */
interface ParseContext {
  parsedBy: ParsedBy;
  warnings: string[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const request: ParseFileRequest = filePath
    ? {
        filename: file.name,
        filePath,
        bytes: null,
        externalAiEnabled: options?.externalAiEnabled ?? null,
        forceAi: options?.forceAI ?? null,
        aiModel: options?.aiModel ?? null,
      }
    : {
        filename: file.name,
        filePath: null,
        // Bytes pre-read by caller — avoids re-reading the file on retries (#32)
        bytes: Array.from(new Uint8Array(buffer)),
        externalAiEnabled: options?.externalAiEnabled ?? null,
        forceAi: options?.forceAI ?? null,
        aiModel: options?.aiModel ?? null,
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
  const externalAiEnabled = options?.externalAiEnabled === true;

  if (options?.forceAI && !externalAiEnabled) {
    throw new Error(
      'Внешние AI-запросы отключены. Включите внешний AI перед принудительным AI-парсингом.',
    );
  }

  // Check whether an active Groq key is configured (metadata only — no plaintext).
  // The key itself is resolved server-side by the Rust parsing command.
  const hasAiKey = desktopRuntime && externalAiEnabled
    ? !!(await bridge.apiKeys.active('groq').catch(() => null))?.activeKey
    : false;

  // eslint-disable-next-line no-console -- dev-only diagnostic
  if (import.meta.env.DEV) console.log('[parseRheologyFile] resolvedOptions:', {
    forceAI: options?.forceAI,
    externalAiEnabled,
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
