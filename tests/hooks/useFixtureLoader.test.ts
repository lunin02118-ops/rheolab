// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── Mock fixtures client ────────────────────────────────────────────────────

const { mockListFixtures, mockParseFixture } = vi.hoisted(() => ({
  mockListFixtures: vi.fn(),
  mockParseFixture: vi.fn(),
}));

vi.mock('@/lib/fixtures/client', () => ({
  listFixtures: mockListFixtures,
  parseFixture: mockParseFixture,
}));

import { useFixtureLoader } from '@/app/dashboard/hooks/useFixtureLoader';

// ── Helpers ─────────────────────────────────────────────────────────────────

const FIXTURES = [
  { name: 'sample1.csv', displayName: 'Sample 1' },
  { name: 'sample2.csv', displayName: 'Sample 2' },
];

const PARSE_RESULT = {
  success: true,
  source: 'regex' as const,
  data: [{ time_sec: 0, viscosity_cp: 10, temperature_c: 20, speed_rpm: 0, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 0 }],
  summary: { pointCount: 1 },
  metadata: { filename: 'sample1.csv', instrumentType: 'OFITE' },
  parsedBy: 'wasm' as const,
};

function makeProps(overrides: Partial<Parameters<typeof useFixtureLoader>[0]> = {}) {
  return {
    onLoad: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useFixtureLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListFixtures.mockResolvedValue(FIXTURES);
    mockParseFixture.mockResolvedValue(PARSE_RESULT);
  });

  it('loads fixture list on mount', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useFixtureLoader(props));

    await waitFor(() => {
      expect(result.current.fixtures).toEqual(FIXTURES);
    });
    expect(mockListFixtures).toHaveBeenCalledOnce();
  });

  it('starts with empty state', () => {
    mockListFixtures.mockReturnValue(new Promise(() => {})); // never resolves
    const props = makeProps();
    const { result } = renderHook(() => useFixtureLoader(props));

    expect(result.current.fixtures).toEqual([]);
    expect(result.current.loadingFixture).toBeNull();
    expect(result.current.showDropdown).toBe(false);
  });

  it('loadFixture calls parseFixture and onLoad on success', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useFixtureLoader(props));

    await act(async () => {
      await result.current.loadFixture('sample1.csv');
    });

    expect(mockParseFixture).toHaveBeenCalledWith('sample1.csv', undefined, undefined, undefined);
    expect(props.onLoad).toHaveBeenCalledWith(PARSE_RESULT);
    expect(props.onError).not.toHaveBeenCalled();
    expect(result.current.loadingFixture).toBeNull();
  });

  it('loadFixture passes aiModel and forceAI', async () => {
    const props = makeProps({ aiModel: 'gpt-4', forceAI: true, externalAiEnabled: true });
    const { result } = renderHook(() => useFixtureLoader(props));

    await act(async () => {
      await result.current.loadFixture('sample2.csv');
    });

    expect(mockParseFixture).toHaveBeenCalledWith('sample2.csv', 'gpt-4', true, true);
  });

  it('loadFixture calls onError on failure', async () => {
    mockParseFixture.mockRejectedValue(new Error('Parse failed'));
    const props = makeProps();
    const { result } = renderHook(() => useFixtureLoader(props));

    await act(async () => {
      await result.current.loadFixture('bad.csv');
    });

    expect(props.onError).toHaveBeenCalledWith('Failed to load fixture: Parse failed');
    expect(props.onLoad).not.toHaveBeenCalled();
    expect(result.current.loadingFixture).toBeNull();
  });

  it('loadFixture handles non-Error thrown values', async () => {
    mockParseFixture.mockRejectedValue('string error');
    const props = makeProps();
    const { result } = renderHook(() => useFixtureLoader(props));

    await act(async () => {
      await result.current.loadFixture('bad.csv');
    });

    expect(props.onError).toHaveBeenCalledWith('Failed to load fixture: string error');
  });

  it('loadFixture closes dropdown', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useFixtureLoader(props));

    act(() => { result.current.setShowDropdown(true); });
    expect(result.current.showDropdown).toBe(true);

    await act(async () => {
      await result.current.loadFixture('sample1.csv');
    });

    expect(result.current.showDropdown).toBe(false);
  });

  it('handles listFixtures failure gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockListFixtures.mockRejectedValue(new Error('network'));
    const props = makeProps();
    const { result } = renderHook(() => useFixtureLoader(props));

    // Should not crash — fixtures remain empty
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });
    expect(result.current.fixtures).toEqual([]);
    consoleSpy.mockRestore();
  });
});
