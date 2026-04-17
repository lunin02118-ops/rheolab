/**
 * @fileoverview Verification tests for Force AI parsing.
 *
 * Architecture (Tauri native + S-1 security fix):
 *
 *   Tauri desktop + forceAI=true:
 *     parseRheologyFile() → parseViaTauriNative(forceAi=true) → Rust IPC
 *     → parsing_parse_file(force_ai=true) → resolve_active_ai_key (DB) +
 *       extract_candidate_headers + call_groq_ai_mapping (reqwest HTTP) +
 *       parse_rheo_data_with_ai_hint
 *     → ParseFileResponse { source: 'ai', used_ai: true }
 *     parsedBy = 'native'
 *
 * Key invariants verified here:
 * 1. Tauri+forceAI → parseFile called with forceAi:true, parsedBy='native'
 * 2. forceAI without active key → early error thrown
 * 3. source='ai' when Rust returns source:'ai'
 * 4. apiKey is NEVER sent over IPC (resolved server-side)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRheologyFile } from '@/lib/parsing/client';
import { extractFilenameMetadata } from '@/lib/parsing/filename-metadata';
import { getBridge } from '@/lib/tauri/bridge';

vi.mock('@/lib/parsing/filename-metadata', () => ({
  extractFilenameMetadata: vi.fn(),
}));

vi.mock('@/lib/tauri/bridge', () => ({
  getBridge: vi.fn(),
}));

const SAMPLE_POINT = {
  time_sec: 0,
  viscosity_cp: 100,
  temperature_c: 25,
  speed_rpm: 300,
  shear_rate_s1: 511,
  shear_stress_pa: 51.1,
  pressure_bar: 0,
};

/** Rust ParseFileResponse when AI path succeeds */
const AI_NATIVE_RESPONSE = {
  success: true,
  source: 'ai',
  data: [SAMPLE_POINT],
  metadata: { filename: 'fixture.csv', usedAI: true, instrumentType: null, geometry: 'R1B1' },
  summary: { pointCount: 1 },
};

/** Rust ParseFileResponse for normal heuristic parse */
const NATIVE_HEURISTIC_RESPONSE = {
  success: true,
  source: 'regex',
  data: [SAMPLE_POINT],
  metadata: { filename: 'fixture.csv', usedAI: false },
  summary: { pointCount: 1 },
};

describe('Force AI parsing', () => {
  const bridge = {
    platform: 'tauri' as 'web' | 'tauri' | 'electron',
    isDesktop: true,
    apiKeys: {
      active: vi.fn(),
    },
    parsing: {
      parseFile: vi.fn(),
    },
  };

  /** Simulate an active Groq API key in the DB (metadata only, no plaintext). */
  function mockHasActiveKey(has: boolean) {
    bridge.apiKeys.active.mockResolvedValue({
      provider: 'groq',
      count: has ? 1 : 0,
      activeKey: has ? { id: 'ak_1', name: 'Test', provider: 'groq', createdAt: '2026-01-01' } : null,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBridge).mockReturnValue(bridge as never);
    mockHasActiveKey(true);
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    // Default: native parser succeeds with heuristic result
    bridge.parsing.parseFile.mockResolvedValue(NATIVE_HEURISTIC_RESPONSE);
    vi.mocked(extractFilenameMetadata).mockResolvedValue({
      filenameMetadata: undefined,
      testDate: undefined,
    });
  });

  // ─── Tauri + forceAI=true: native Rust path ────────────────────────

  describe('Tauri desktop + forceAI=true → native Rust/Groq path', () => {
    it('calls parseFile (IPC) with forceAi:true — does NOT fall through to WASM', async () => {
      bridge.parsing.parseFile.mockResolvedValue(AI_NATIVE_RESPONSE);

      const file = new File(['t,v\n0,100'], 'fixture.csv', { type: 'text/csv' });
      const result = await parseRheologyFile(file, { forceAI: true, aiModel: 'llama-4-scout' });

      // Native Rust IPC MUST be called (Groq HTTP happens inside Rust)
      expect(bridge.parsing.parseFile).toHaveBeenCalledTimes(1);
      expect(result.parsedBy).toBe('native');
      expect(result.success).toBe(true);
    });

    it('passes forceAi=true and aiModel into the IPC request without apiKey', async () => {
      bridge.parsing.parseFile.mockResolvedValue(AI_NATIVE_RESPONSE);

      const file = new File(['t,v\n0,100'], 'fixture.csv', { type: 'text/csv' });
      await parseRheologyFile(file, { forceAI: true, aiModel: 'my-model' });

      expect(bridge.parsing.parseFile).toHaveBeenCalledWith(
        expect.objectContaining({
          forceAi: true,
          aiModel: 'my-model',
        }),
      );
      // S-1: API key must NEVER be sent over IPC
      expect(bridge.parsing.parseFile).toHaveBeenCalledWith(
        expect.not.objectContaining({ apiKey: expect.anything() }),
      );
    });

    it('propagates source="ai" and usedAI=true from Rust response', async () => {
      bridge.parsing.parseFile.mockResolvedValue(AI_NATIVE_RESPONSE);

      const file = new File(['t,v\n0,100'], 'fixture.csv', { type: 'text/csv' });
      const result = await parseRheologyFile(file, { forceAI: true });

      expect(result.source).toBe('ai');
      expect(result.metadata.usedAI).toBe(true);
      expect(result.parsedBy).toBe('native');
    });

    it('propagates geometry from Rust AI response', async () => {
      bridge.parsing.parseFile.mockResolvedValue({
        ...AI_NATIVE_RESPONSE,
        metadata: { ...AI_NATIVE_RESPONSE.metadata, geometry: 'R1B5' },
      });

      const file = new File(['t,v\n0,100'], 'fixture.csv', { type: 'text/csv' });
      const result = await parseRheologyFile(file, { forceAI: true });

      expect(result.metadata.geometry).toBe('R1B5');
    });
  });

  // ─── Early guard: missing apiKey ───────────────────────────────────

  it('throws when forceAI=true but no active key in Tauri mode', async () => {
    mockHasActiveKey(false);

    const file = new File(['t,v\n0,100'], 'fixture.csv', { type: 'text/csv' });

    await expect(parseRheologyFile(file, { forceAI: true }))
      .rejects.toThrow(/API/i);

    // Error is thrown before any IPC call
    expect(bridge.parsing.parseFile).not.toHaveBeenCalled();
  });

  it('throws when forceAI=true but no active key in web mode', async () => {
    bridge.platform = 'web';
    bridge.isDesktop = false;
    // In web mode, bridge.apiKeys.active isn't called (hasAiKey defaults to false)

    const file = new File(['t,v\n0,100'], 'fixture.csv', { type: 'text/csv' });

    await expect(parseRheologyFile(file, { forceAI: true }))
      .rejects.toThrow(/API/i);
  });

  // ─── Normal (non-forceAI) Tauri parsing — unaffected ──────────────

  it('does not break normal Tauri heuristic parsing when forceAI is not set', async () => {
    const file = new File(['t,v\n0,100'], 'fixture.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file);

    expect(bridge.parsing.parseFile).toHaveBeenCalledTimes(1);
    // forceAi NOT included OR false/undefined in the request
    expect(bridge.parsing.parseFile).toHaveBeenCalledWith(
      expect.not.objectContaining({ forceAi: true }),
    );
    expect(result.parsedBy).toBe('native');
    expect(result.source).toBe('regex');
  });

  it('does not break normal Tauri parsing when forceAI=false explicitly', async () => {
    const file = new File(['t,v\n0,100'], 'fixture.csv', { type: 'text/csv' });
    const result = await parseRheologyFile(file, { forceAI: false });

    expect(bridge.parsing.parseFile).toHaveBeenCalledTimes(1);
    expect(result.parsedBy).toBe('native');
  });
});
