import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

import { getBridge, resetBridge } from '@/lib/tauri/bridge';

type MockWindow = {
  __TAURI_INTERNALS__?: {
    invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
  __TAURI__?: {
    invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
};

const originalWindow = (globalThis as { window?: unknown }).window;
const originalFetch = globalThis.fetch;
const originalGlobalIsTauri = (globalThis as { isTauri?: unknown }).isTauri;

function setWindow(value: MockWindow | undefined) {
  (globalThis as { window?: unknown }).window = value;
}

describe('platform bridge runtime selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBridge();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    delete (globalThis as { isTauri?: unknown }).isTauri;
  });

  afterEach(() => {
    resetBridge();
    setWindow(originalWindow as MockWindow | undefined);
    globalThis.fetch = originalFetch;
    if (typeof originalGlobalIsTauri === 'undefined') {
      delete (globalThis as { isTauri?: unknown }).isTauri;
    } else {
      (globalThis as { isTauri?: unknown }).isTauri = originalGlobalIsTauri;
    }
  });

  it('throws when no desktop runtime is available', () => {
    setWindow(undefined);
    expect(() => getBridge()).toThrow('requires Tauri desktop runtime');
  });

  it('keeps tauri bridge when runtime probe temporarily reports web', () => {
    setWindow({ __TAURI_INTERNALS__: {} });
    const desktopBridge = getBridge();
    expect(desktopBridge.platform).toBe('tauri');

    setWindow(undefined);
    const resolvedAgain = getBridge();
    expect(resolvedAgain.platform).toBe('tauri');
  });

});
