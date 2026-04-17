/**
 * Tauri Core Utilities
 *
 * Environment detection (`isTauri`) and type-safe IPC (`invoke`) shared by all
 * domain modules.  Nothing else should live here — keep it minimal so that type
 * splitting remains clean.
 */

import { invoke as tauriInvoke, isTauri as tauriCoreIsTauri } from '@tauri-apps/api/core';
import { TauriError } from './errors';

const TAURI_BOOT_RETRY_ATTEMPTS = 2;
const TAURI_BOOT_RETRY_DELAY_MS = 150;
const DESKTOP_HINT_QUERY_KEY = 'rheolab_desktop';
const DESKTOP_HINT_SESSION_KEY = 'rheolab_desktop_runtime';
const DESKTOP_HINT_GLOBAL_KEY = '__RHEOLAB_DESKTOP_RUNTIME__';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function persistDesktopHint(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage?.setItem(DESKTOP_HINT_SESSION_KEY, '1');
  } catch (_e) {
    // Ignore session storage failures in restricted environments.
  }

  try {
    (globalThis as Record<string, unknown>)[DESKTOP_HINT_GLOBAL_KEY] = true;
  } catch (_e) {
    // Ignore read-only global object slots in constrained runtimes.
  }
}

function hasDesktopHint(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    if (window.sessionStorage?.getItem(DESKTOP_HINT_SESSION_KEY) === '1') {
      return true;
    }
  } catch (_e) {
    // Ignore session storage failures in restricted environments.
  }

  try {
    const search = window.location?.search ?? '';
    if (search) {
      const params = new URLSearchParams(search);
      if (params.get(DESKTOP_HINT_QUERY_KEY) === '1') {
        persistDesktopHint();
        return true;
      }
    }
  } catch (_e) {
    // Ignore malformed location/search parsing.
  }

  return false;
}

function getInternalInvoke():
  | (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>)
  | undefined {
  return window.__TAURI_INTERNALS__?.invoke;
}

function isTransientTauriError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('tauri_internals') ||
    message.includes('__tauri_internals__') ||
    message.includes('window is not defined') ||
    (message.includes('cannot read') && message.includes('invoke'))
  );
}

/**
 * Check if running in Tauri environment
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  if (hasDesktopHint()) {
    return true;
  }

  try {
    if (tauriCoreIsTauri()) {
      persistDesktopHint();
      return true;
    }
  } catch (_e) {
    // Ignore core helper failures and fall back to runtime probes below.
  }

  const globalMarker =
    Boolean((globalThis as Record<string, unknown>)[DESKTOP_HINT_GLOBAL_KEY]) ||
    typeof (globalThis as { isTauri?: unknown }).isTauri === 'boolean' &&
    (globalThis as { isTauri?: boolean }).isTauri === true;
  const hasLegacyGlobal = typeof window.__TAURI__ !== 'undefined';
  const hasV2Internals =
    typeof window.__TAURI_INTERNALS__ !== 'undefined' ||
    typeof getInternalInvoke() === 'function';
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const hasTauriUserAgent = userAgent.includes('tauri');
  const detected = globalMarker || hasLegacyGlobal || hasV2Internals || hasTauriUserAgent;

  if (detected) {
    persistDesktopHint();
  }

  return detected;
}

/**
 * Invoke a Tauri command.
 *
 * Retries on transient startup errors (Tauri IPC not yet initialised) and
 * falls back to legacy `window.__TAURI__.invoke` in older runtimes.
 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window === 'undefined') {
    throw new Error('Not running in Tauri environment');
  }

  // Probe runtime once to persist desktop hint when available.
  isTauri();

  let lastError: unknown;
  for (let attempt = 1; attempt <= TAURI_BOOT_RETRY_ATTEMPTS; attempt++) {
    try {
      return await tauriInvoke<T>(cmd, args);
    } catch (error) {
      lastError = error;
    }

    const internalInvoke = getInternalInvoke();
    if (typeof internalInvoke === 'function') {
      try {
        return await internalInvoke<T>(cmd, args);
      } catch (internalError) {
        lastError = internalError;
      }
    }

    const legacyInvoke = window.__TAURI__?.invoke;
    if (typeof legacyInvoke === 'function') {
      try {
        return await legacyInvoke<T>(cmd, args);
      } catch (legacyError) {
        lastError = legacyError;
      }
    }

    if (
      attempt < TAURI_BOOT_RETRY_ATTEMPTS &&
      isTransientTauriError(lastError)
    ) {
      await delay(TAURI_BOOT_RETRY_DELAY_MS * attempt);
      continue;
    }

    throw (lastError ?? new Error('Tauri invoke failed'));
  }

  throw (lastError ?? new Error('Tauri invoke failed'));
}

/**
 * Type-safe Tauri IPC wrapper that normalises all errors into {@link TauriError}
 * and logs them before re-throwing.
 *
 * All domain modules (`src/lib/tauri/*.ts`) must use this instead of the raw
 * `invoke`.  The raw `invoke` function remains available for `core.ts`-internal
 * use only (retry logic, legacy fallbacks).
 */
export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error) {
    const tauriError = TauriError.from(error);
    console.error(
      `[IPC] ${cmd} failed (${tauriError.kind}):`,
      tauriError.message,
      tauriError.raw,
    );
    throw tauriError;
  }
}
