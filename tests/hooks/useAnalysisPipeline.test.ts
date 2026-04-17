// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnalysisPipeline, __resetAnalysisCache } from '@/hooks/useAnalysisPipeline';
import type { ParseResult } from '@/lib/store/experiment-data-store';

// ── Mock analysis client (native Tauri IPC) ─────────────────────────────────

const { mockAnalyzeData, mockDetectSteps, mockRegroupByPattern } = vi.hoisted(() => ({
  mockAnalyzeData: vi.fn(),
  mockDetectSteps: vi.fn(),
  mockRegroupByPattern: vi.fn(),
}));

vi.mock('@/lib/analysis/client', () => ({
  analyzeData: mockAnalyzeData,
  detectSteps: mockDetectSteps,
  regroupByPattern: mockRegroupByPattern,
}));

// ── Mock analysis-settings-store ────────────────────────────────────────────

// Return a STABLE object across renders so useEffect dependencies don't change
const stableExpertSettings = {
  stepSplitting: true,
  splitStartDuration: 30,
  splitEndDuration: 30,
  minDurationForSplit: 90,
  pointsToAverage: 1,
  kIndexType: 'K_ind' as const,
  viscosityShearRates: [40, 100, 170] as number[],
};
const stableStoreValue = { expertSettings: stableExpertSettings };

vi.mock('@/lib/store/analysis-settings-store', () => ({
  useAnalysisSettingsStore: () => stableStoreValue,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeParseResult = (overrides: Partial<ParseResult> = {}): ParseResult => ({
  success: true,
  source: 'regex',
  data: [
    { time_sec: 0, viscosity_cp: 25, temperature_c: 20, speed_rpm: 0, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 0 },
    { time_sec: 60, viscosity_cp: 30, temperature_c: 22, speed_rpm: 0, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 0 },
    { time_sec: 120, viscosity_cp: 35, temperature_c: 24, speed_rpm: 0, shear_rate_s1: 0, shear_stress_pa: 0, pressure_bar: 0 },
  ],
  summary: { pointCount: 3 },
  metadata: { filename: 'test.xlsx', instrumentType: 'HAAKE', geometry: 'R1B5' },
  parsedBy: 'wasm',
  ...overrides,
});

const defaultProps = {
  parseResult: null as ParseResult | null,
  isExpert: false,
  cycleOverrides: new Map<number, number[]>(),
  patternOverride: null as number[] | null | undefined,
  setError: vi.fn(),
};

const successResult = {
  cycles: [{ index: 0, points: [], steps: [] }],
  results: new Map([[0, { viscosity: 30 }]]),
  allSteps: [{ index: 0, points: [] }],
};

/**
 * Fire the 100ms debounce and flush all microtasks so async callbacks settle.
 * Uses fake timers — calls vi.runAllTimers() inside act, then double-flushes.
 */
async function runDebounceAndFlush() {
  // Fire the setTimeout(runAnalysis, 100)
  await act(async () => {
    vi.runAllTimers();
  });
  // Flush async promise chains (analyzeData, setState, etc.)
  await act(async () => {});
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useAnalysisPipeline – null/empty parseResult', () => {
  beforeEach(() => {
    __resetAnalysisCache();
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAnalyzeData.mockResolvedValue(successResult);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty initial state when parseResult is null', () => {
    const { result } = renderHook(() =>
      useAnalysisPipeline({ ...defaultProps, parseResult: null }),
    );
    expect(result.current.cycles).toEqual([]);
    expect(result.current.allSteps).toEqual([]);
    expect(result.current.cycleResults.size).toBe(0);
    expect(result.current.isAnalyzing).toBe(false);
  });

  it('returns empty state and never calls analyzeData when data is empty', async () => {
    const emptyResult = makeParseResult({ data: [] });
    renderHook(() =>
      useAnalysisPipeline({ ...defaultProps, parseResult: emptyResult }),
    );
    await act(async () => { vi.runAllTimers(); });
    expect(mockAnalyzeData).not.toHaveBeenCalled();
  });
});

describe('useAnalysisPipeline – analysis execution', () => {
  beforeEach(() => {
    __resetAnalysisCache();
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAnalyzeData.mockResolvedValue(successResult);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls analyzeData after the 100ms debounce', async () => {
    renderHook(() =>
      useAnalysisPipeline({ ...defaultProps, parseResult: makeParseResult() }),
    );
    await runDebounceAndFlush();
    expect(mockAnalyzeData).toHaveBeenCalledOnce();
  });

  it('calls analyzeData with correct geometry from metadata', async () => {
    const parseResult = makeParseResult({
      metadata: { filename: 'x.xlsx', instrumentType: 'FANN', geometry: 'F1.1' },
    });
    renderHook(() => useAnalysisPipeline({ ...defaultProps, parseResult }));
    await runDebounceAndFlush();
    expect(mockAnalyzeData).toHaveBeenCalledOnce();
    // 2nd argument to analyzeData is geometry
    expect(mockAnalyzeData.mock.calls[0][1]).toBe('F1.1');
  });

  it('defaults geometry to R1B5 when metadata.geometry is absent', async () => {
    const pr = makeParseResult({ metadata: { filename: 'x.xlsx', instrumentType: 'HAAKE' } });
    renderHook(() => useAnalysisPipeline({ ...defaultProps, parseResult: pr }));
    await runDebounceAndFlush();
    expect(mockAnalyzeData.mock.calls[0][1]).toBe('R1B5');
  });

  it('updates cycles and allSteps after successful analysis', async () => {
    const { result } = renderHook(() =>
      useAnalysisPipeline({ ...defaultProps, parseResult: makeParseResult() }),
    );
    await runDebounceAndFlush();
    expect(result.current.cycles).toHaveLength(1);
    expect(result.current.allSteps).toHaveLength(1);
  });

  it('isAnalyzing is false after analysis completes', async () => {
    const { result } = renderHook(() =>
      useAnalysisPipeline({ ...defaultProps, parseResult: makeParseResult() }),
    );
    await runDebounceAndFlush();
    expect(result.current.isAnalyzing).toBe(false);
  });

  it('calls setError with Russian prefix when analysis throws a non-transient error', async () => {
    const setError = vi.fn();
    mockAnalyzeData.mockRejectedValue(new Error('Cannot read property'));
    renderHook(() =>
      useAnalysisPipeline({ ...defaultProps, parseResult: makeParseResult(), setError }),
    );
    await runDebounceAndFlush();
    expect(setError).toHaveBeenCalledOnce();
    expect(setError.mock.calls[0][0]).toContain('Ошибка анализа данных');
  });
});

describe('useAnalysisPipeline – beginner vs expert mode', () => {
  beforeEach(() => {
    __resetAnalysisCache();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('beginner mode: calls analyzeData even when patternOverride is set', async () => {
    mockAnalyzeData.mockResolvedValue(successResult);
    renderHook(() =>
      useAnalysisPipeline({
        ...defaultProps,
        parseResult: makeParseResult(),
        isExpert: false,
        patternOverride: [1, 2, 3],
      }),
    );
    await runDebounceAndFlush();
    expect(mockAnalyzeData).toHaveBeenCalled();
    expect(mockRegroupByPattern).not.toHaveBeenCalled();
  });

  it('expert mode without patternOverride: calls analyzeData', async () => {
    mockAnalyzeData.mockResolvedValue(successResult);
    renderHook(() =>
      useAnalysisPipeline({
        ...defaultProps,
        parseResult: makeParseResult(),
        isExpert: true,
        patternOverride: null,
      }),
    );
    await runDebounceAndFlush();
    expect(mockAnalyzeData).toHaveBeenCalled();
    expect(mockRegroupByPattern).not.toHaveBeenCalled();
  });

  it('expert mode with patternOverride: calls detectSteps + regroupByPattern', async () => {
    mockDetectSteps.mockResolvedValue([{ index: 0, points: [] }]);
    mockRegroupByPattern.mockResolvedValue(successResult);
    renderHook(() =>
      useAnalysisPipeline({
        ...defaultProps,
        parseResult: makeParseResult(),
        isExpert: true,
        patternOverride: [1, 2, 3],
      }),
    );
    await runDebounceAndFlush();
    expect(mockDetectSteps).toHaveBeenCalled();
    expect(mockRegroupByPattern).toHaveBeenCalled();
    expect(mockAnalyzeData).not.toHaveBeenCalled();
  });

  it('expert mode with empty patternOverride array: falls through to analyzeData', async () => {
    mockAnalyzeData.mockResolvedValue(successResult);
    renderHook(() =>
      useAnalysisPipeline({
        ...defaultProps,
        parseResult: makeParseResult(),
        isExpert: true,
        patternOverride: [],
      }),
    );
    await runDebounceAndFlush();
    expect(mockAnalyzeData).toHaveBeenCalled();
    expect(mockRegroupByPattern).not.toHaveBeenCalled();
  });
});

describe('useAnalysisPipeline – error handling', () => {
  beforeEach(() => {
    __resetAnalysisCache();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls setError after non-transient error without retrying', async () => {
    const setError = vi.fn();
    mockAnalyzeData.mockRejectedValue(new Error('TypeError: not a function'));

    renderHook(() =>
      useAnalysisPipeline({ ...defaultProps, parseResult: makeParseResult(), setError }),
    );

    await runDebounceAndFlush();

    expect(mockAnalyzeData).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledOnce();
    expect(setError.mock.calls[0][0]).toContain('Ошибка анализа данных');
  });

  it('calls setError with message when analysis throws any error', async () => {
    const setError = vi.fn();
    mockAnalyzeData.mockRejectedValue(new Error('native analysis failed'));

    renderHook(() =>
      useAnalysisPipeline({ ...defaultProps, parseResult: makeParseResult(), setError }),
    );

    await runDebounceAndFlush();

    expect(mockAnalyzeData).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledOnce();
    expect(setError.mock.calls[0][0]).toContain('Ошибка анализа данных');
  });
});

// ── Cancellation (AbortController) ──────────────────────────────────────────

describe('useAnalysisPipeline – cancellation (AbortController)', () => {
  beforeEach(() => {
    __resetAnalysisCache();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not apply stale state when experiment switches mid-flight', async () => {
    // First analyzeData call hangs until we manually resolve it
    let resolveFirst!: (v: typeof successResult) => void;
    const firstPromise = new Promise<typeof successResult>((res) => { resolveFirst = res; });

    mockAnalyzeData
      .mockReturnValueOnce(firstPromise)   // experiment-1 call: hangs
      .mockResolvedValue(successResult);   // experiment-2 call: resolves immediately

    const parseResult1 = makeParseResult({ metadata: { filename: 'a.xlsx', instrumentType: 'HAAKE', geometry: 'R1B1' } });
    const parseResult2 = makeParseResult({ metadata: { filename: 'b.xlsx', instrumentType: 'HAAKE', geometry: 'R1B5' } });

    const { result, rerender } = renderHook(
      ({ pr }) => useAnalysisPipeline({ ...defaultProps, parseResult: pr }),
      { initialProps: { pr: parseResult1 } },
    );

    // Fire experiment-1 debounce — analyzeData called, promise is pending
    await act(async () => { vi.runAllTimers(); });
    expect(mockAnalyzeData).toHaveBeenCalledTimes(1);

    // Switch to experiment-2 — this aborts analyse-1 via controller.abort()
    rerender({ pr: parseResult2 });
    await act(async () => { vi.runAllTimers(); }); // fire experiment-2 debounce
    await act(async () => {}); // flush second analyzeData (resolves immediately)

    // Now late-resolve the stale first call — its state update must be suppressed
    await act(async () => { resolveFirst(successResult); });
    await act(async () => {}); // drain any lingering microtasks

    expect(mockAnalyzeData).toHaveBeenCalledTimes(2);
    // isAnalyzing settled: experiment-2 completed normally
    expect(result.current.isAnalyzing).toBe(false);
  });

  it('suppresses setError when analysis error arrives after cancellation', async () => {
    const setError = vi.fn();

    // First analyzeData call hangs, then rejects after we abort it
    let rejectFirst!: (e: Error) => void;
    const firstPromise = new Promise<typeof successResult>((_, rej) => { rejectFirst = rej; });

    mockAnalyzeData
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValue(successResult);

    const parseResult1 = makeParseResult();
    const parseResult2 = makeParseResult({ metadata: { filename: 'b.xlsx', instrumentType: 'HAAKE', geometry: 'R1B5' } });

    const { rerender } = renderHook(
      ({ pr }) => useAnalysisPipeline({ ...defaultProps, parseResult: pr, setError }),
      { initialProps: { pr: parseResult1 } },
    );

    // Fire experiment-1 debounce
    await act(async () => { vi.runAllTimers(); });
    expect(mockAnalyzeData).toHaveBeenCalledTimes(1);

    // Switch experiment — aborts experiment-1
    rerender({ pr: parseResult2 });
    await act(async () => { vi.runAllTimers(); });
    await act(async () => {}); // flush experiment-2 analysis

    // Stale experiment-1 promise rejects after the signal is already aborted
    await act(async () => { rejectFirst(new Error('stale error that must be suppressed')); });
    await act(async () => {});

    // setError must NOT have been called — the error came from a cancelled operation
    expect(setError).not.toHaveBeenCalled();
  });
});
