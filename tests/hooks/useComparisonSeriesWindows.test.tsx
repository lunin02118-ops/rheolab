// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Experiment } from '@/types';
import { useComparisonSeriesWindows } from '@/components/comparison/useComparisonSeriesWindows';
import { series } from '@/lib/tauri/series';
import { seriesWindowCache } from '@/lib/series/series-window-cache';
import type { SeriesWindow } from '@/lib/series/binary-series';
import type { ComparisonViewport } from '@/lib/store/comparison-store';

interface HookProps {
    experiments: Experiment[];
    viewport?: ComparisonViewport | null;
    visibleMetrics?: string[];
}

vi.mock('@/lib/tauri/core', () => ({
    isTauri: () => true,
}));

vi.mock('@/lib/tauri/series', () => ({
    series: {
        meta: vi.fn(),
        overview: vi.fn(),
        window: vi.fn(),
    },
}));

function makeExperiment(id: string, name = id): Experiment {
    return {
        id,
        name,
        testDate: new Date().toISOString(),
        originalFilename: `${name}.txt`,
        instrumentType: 'Grace',
        waterSource: 'tap',
        fluidType: 'Linear',
        testGroup: '',
        metrics: {},
        rawPoints: [],
        userId: 'u1',
        laboratoryId: 'lab1',
        waterSourceId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    } as unknown as Experiment;
}

function makeSeriesWindow(id: string, times = [0, 60, 120]): SeriesWindow {
    const offset = Number(id.replace(/\D/g, '')) || 0;
    const values = times.map((_, index) => offset * 100 + index);
    return {
        version: 1,
        pointCount: times.length,
        descriptors: [],
        columns: {
            timeSec: new Float64Array(times),
            viscosityCp: new Float64Array(values),
            temperatureC: new Float64Array(times.map(() => 25)),
            shearRate: new Float64Array(times.map(() => 511)),
            shearStress: new Float64Array(times.map(() => 50)),
            pressureBar: new Float64Array(times.map(() => Number.NaN)),
            speedRpm: new Float64Array(times.map(() => 300)),
        },
    };
}

function makeEmptySeriesWindow(): SeriesWindow {
    return {
        version: 1,
        pointCount: 0,
        descriptors: [],
        columns: {
            timeSec: new Float64Array([]),
        },
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('useComparisonSeriesWindows', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        seriesWindowCache.clear();
        vi.mocked(series.meta).mockResolvedValue({
            experimentId: 'exp-1',
            pointCount: 3,
            timeMinSec: 0,
            timeMaxSec: 120,
            availableMetrics: [],
            dataHash: 'hash-1',
        });
        vi.mocked(series.overview).mockImplementation((experimentId: string) =>
            Promise.resolve(makeSeriesWindow(experimentId)),
        );
        vi.mocked(series.window).mockImplementation((experimentId: string) =>
            Promise.resolve(makeSeriesWindow(experimentId)),
        );
    });

    it('loads each DB-backed experiment independently', async () => {
        const { result } = renderHook(({ experiments }: HookProps) =>
            useComparisonSeriesWindows({ experiments }), {
            initialProps: { experiments: [makeExperiment('exp-1'), makeExperiment('exp-2')] },
        });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(2);
        });

        expect(series.overview).toHaveBeenCalledTimes(2);
        expect(series.window).not.toHaveBeenCalled();
        expect(result.current.experiments[0]).toMatchObject({ id: 'exp-1', rawPoints: [] });
        expect((result.current.experiments[0] as Record<string, any>).columnarData.timeSec.length).toBe(3);
    });

    it('requests only normalized visible metrics when provided', async () => {
        const { result } = renderHook(({ experiments, visibleMetrics }: HookProps) =>
            useComparisonSeriesWindows({ experiments, visibleMetrics }), {
            initialProps: {
                experiments: [makeExperiment('exp-1')],
                visibleMetrics: ['viscosity_cp', 'temperature_c', 'temperatureC', 'none'],
            },
        });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(1);
        });

        expect(series.overview).toHaveBeenCalledTimes(1);
        expect(vi.mocked(series.overview).mock.calls[0][1]).toEqual(['viscosityCp', 'temperatureC']);
    });

    it('uses a different cache key when the visible metric set changes', async () => {
        const experiment = makeExperiment('exp-1');
        const { rerender } = renderHook(({ experiments, visibleMetrics }: HookProps) =>
            useComparisonSeriesWindows({ experiments, visibleMetrics }), {
            initialProps: {
                experiments: [experiment],
                visibleMetrics: ['viscosity_cp'],
            },
        });

        await waitFor(() => {
            expect(series.overview).toHaveBeenCalledTimes(1);
        });

        rerender({
            experiments: [experiment],
            visibleMetrics: ['viscosity_cp', 'temperature_c'],
        });

        await waitFor(() => {
            expect(series.overview).toHaveBeenCalledTimes(2);
        });

        expect(vi.mocked(series.overview).mock.calls.map(call => call[1])).toEqual([
            ['viscosityCp'],
            ['viscosityCp', 'temperatureC'],
        ]);
    });

    it('adding a sixth experiment loads only the new line when old lines are ready', async () => {
        const initial = [
            makeExperiment('exp-1'),
            makeExperiment('exp-2'),
            makeExperiment('exp-3'),
            makeExperiment('exp-4'),
            makeExperiment('exp-5'),
        ];
        const { result, rerender } = renderHook(({ experiments }: HookProps) =>
            useComparisonSeriesWindows({ experiments }), {
            initialProps: { experiments: initial },
        });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(5);
        });
        expect(series.overview).toHaveBeenCalledTimes(5);

        rerender({ experiments: [...initial, makeExperiment('exp-6')] });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(6);
        });

        expect(series.overview).toHaveBeenCalledTimes(6);
        expect(vi.mocked(series.overview).mock.calls.map(call => call[0])).toEqual([
            'exp-1',
            'exp-2',
            'exp-3',
            'exp-4',
            'exp-5',
            'exp-6',
        ]);
    });

    it('keeps existing in-flight line loads alive when another experiment is added', async () => {
        const requests = new Map<string, ReturnType<typeof deferred<SeriesWindow>>>();
        vi.mocked(series.overview).mockImplementation((experimentId: string) => {
            const request = deferred<SeriesWindow>();
            requests.set(experimentId, request);
            return request.promise;
        });

        const initial = [makeExperiment('exp-1'), makeExperiment('exp-2')];
        const { result, rerender } = renderHook(({ experiments }: HookProps) =>
            useComparisonSeriesWindows({ experiments }), {
            initialProps: { experiments: initial },
        });

        await waitFor(() => {
            expect(series.overview).toHaveBeenCalledTimes(2);
        });

        rerender({ experiments: [...initial, makeExperiment('exp-3')] });

        await waitFor(() => {
            expect(series.overview).toHaveBeenCalledTimes(3);
        });

        requests.get('exp-1')?.resolve(makeSeriesWindow('exp-1'));
        requests.get('exp-2')?.resolve(makeSeriesWindow('exp-2'));
        requests.get('exp-3')?.resolve(makeSeriesWindow('exp-3'));

        await waitFor(() => {
            expect(result.current.readyCount).toBe(3);
        });
    });

    it('reuses shared cache after unmount and skips file-backed experiments', async () => {
        const dbExperiment = makeExperiment('exp-1');
        const fileExperiment = makeExperiment('file-1');
        const first = renderHook(({ experiments }: HookProps) =>
            useComparisonSeriesWindows({ experiments }), {
            initialProps: { experiments: [dbExperiment, fileExperiment] },
        });

        await waitFor(() => {
            expect(first.result.current.readyCount).toBe(2);
        });
        first.unmount();

        const second = renderHook(({ experiments }: HookProps) =>
            useComparisonSeriesWindows({ experiments }), {
            initialProps: { experiments: [dbExperiment, fileExperiment] },
        });

        await waitFor(() => {
            expect(second.result.current.readyCount).toBe(2);
        });

        expect(series.overview).toHaveBeenCalledTimes(1);
        expect(series.window).not.toHaveBeenCalled();
        expect(second.result.current.experiments[1]).toBe(fileExperiment);
    });

    it('requests bounded windows for a persisted viewport', async () => {
        const viewport = { xMinSec: 30, xMaxSec: 90 };
        const experiments = [makeExperiment('exp-1'), makeExperiment('exp-2')];
        const { result } = renderHook(({ experiments, viewport }: HookProps) =>
            useComparisonSeriesWindows({ experiments, viewport, sessionId: 'session-1' }), {
            initialProps: { experiments, viewport },
        });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(2);
        });

        expect(series.overview).toHaveBeenCalledTimes(2);
        expect(series.window).toHaveBeenCalledTimes(2);
        expect(vi.mocked(series.window).mock.calls.map(call => call.slice(0, 3))).toEqual([
            ['exp-1', 30, 90],
            ['exp-2', 30, 90],
        ]);
        expect(result.current.brushExperiments).toHaveLength(2);
    });

    it('loads overview for the brush during a cold persisted viewport without using window data as brush extent', async () => {
        const viewport = { xMinSec: 600, xMaxSec: 720 };
        const experiment = makeExperiment('exp-1');
        const overview = deferred<SeriesWindow>();
        const windowed = deferred<SeriesWindow>();
        vi.mocked(series.overview).mockReturnValue(overview.promise);
        vi.mocked(series.window).mockReturnValue(windowed.promise);

        const { result } = renderHook(({ experiments, viewport }: HookProps) =>
            useComparisonSeriesWindows({ experiments, viewport, sessionId: 'session-1' }), {
            initialProps: { experiments: [experiment], viewport },
        });

        await waitFor(() => {
            expect(series.overview).toHaveBeenCalledTimes(1);
        });

        windowed.resolve(makeSeriesWindow('exp-1', [600, 660, 720]));

        await waitFor(() => {
            expect(result.current.readyCount).toBe(1);
        });

        const chartColumnar = (result.current.experiments[0] as Record<string, any>).columnarData;
        expect(Array.from(chartColumnar.timeSec)).toEqual([600, 660, 720]);
        expect((result.current.brushExperiments[0] as Record<string, any>).columnarData).toBeUndefined();
        expect(result.current.isViewportWindowReady).toBe(true);

        overview.resolve(makeSeriesWindow('exp-1', [0, 600, 1200]));

        await waitFor(() => {
            const brushColumnar = (result.current.brushExperiments[0] as Record<string, any>).columnarData;
            expect(Array.from(brushColumnar.timeSec)).toEqual([0, 600, 1200]);
        });
    });

    it('keeps brush experiments on overview data while chart experiments use window data', async () => {
        const experiment = makeExperiment('exp-1');
        vi.mocked(series.overview).mockResolvedValue(makeSeriesWindow('exp-1', [0, 600, 1200]));
        vi.mocked(series.window).mockResolvedValue(makeSeriesWindow('exp-1', [600, 660, 720]));

        // Explicitly widen `initialProps` to `HookProps` so TypeScript does not
        // infer `viewport: null` as a literal type — the second `rerender`
        // call below passes a viewport object on the same prop.
        const initialProps: HookProps = { experiments: [experiment], viewport: null };
        const { result, rerender } = renderHook(({ experiments, viewport }: HookProps) =>
            useComparisonSeriesWindows({ experiments, viewport, sessionId: 'session-1' }), {
            initialProps,
        });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(1);
        });
        const overviewColumnar = (result.current.experiments[0] as Record<string, any>).columnarData;

        rerender({ experiments: [experiment], viewport: { xMinSec: 600, xMaxSec: 720 } });

        await waitFor(() => {
            const chartColumnar = (result.current.experiments[0] as Record<string, any>).columnarData;
            expect(Array.from(chartColumnar.timeSec)).toEqual([600, 660, 720]);
        });

        const chartColumnar = (result.current.experiments[0] as Record<string, any>).columnarData;
        const brushColumnar = (result.current.brushExperiments[0] as Record<string, any>).columnarData;
        expect(chartColumnar).not.toBe(overviewColumnar);
        expect(brushColumnar).toBe(overviewColumnar);
        expect(Array.from(brushColumnar.timeSec)).toEqual([0, 600, 1200]);
    });

    it('keeps window series on the same time origin as the full experiment', async () => {
        const viewport = { xMinSec: 4800, xMaxSec: 4920 };
        const experiments = [makeExperiment('exp-1')];
        vi.mocked(series.window).mockResolvedValue(makeSeriesWindow('exp-1', [4800, 4860, 4920]));
        vi.mocked(series.meta).mockResolvedValue({
            experimentId: 'exp-1',
            pointCount: 3,
            timeMinSec: 0,
            timeMaxSec: 4920,
            availableMetrics: [],
            dataHash: 'hash-1',
        });

        const { result } = renderHook(({ experiments, viewport }: HookProps) =>
            useComparisonSeriesWindows({ experiments, viewport, sessionId: 'session-1' }), {
            initialProps: { experiments, viewport },
        });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(1);
        });

        const columnarData = (result.current.experiments[0] as Record<string, any>).columnarData;
        expect(columnarData.timeOriginSec).toBe(0);
        expect(Array.from(columnarData.timeSec)).toEqual([4800, 4860, 4920]);
        // The parallel brush overview may establish the full-series time origin
        // before the window load resolves, making the meta request unnecessary.
        if (vi.mocked(series.meta).mock.calls.length > 0) {
            expect(series.meta).toHaveBeenCalledWith('exp-1');
        }
    });

    it('falls back to overview visual data when a viewport window is empty', async () => {
        const viewport: ComparisonViewport | null = { xMinSec: 3000, xMaxSec: 3600 };
        const experiments = [makeExperiment('exp-1')];
        const initialProps: HookProps = { experiments, viewport };
        vi.mocked(series.window).mockResolvedValue(makeEmptySeriesWindow());
        vi.mocked(series.overview).mockResolvedValue(makeSeriesWindow('exp-1'));

        const { result, rerender } = renderHook(({ experiments, viewport }: HookProps) =>
            useComparisonSeriesWindows({ experiments, viewport, sessionId: 'session-1' }), {
            initialProps,
        });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(1);
        });

        expect(series.window).toHaveBeenCalledTimes(1);
        expect(series.overview).toHaveBeenCalledTimes(1);
        expect(result.current.usedViewportFallback).toBe(true);
        expect(result.current.isViewportWindowReady).toBe(true);
        expect(result.current.isBrushOverviewReady).toBe(true);
        expect(Array.from((result.current.experiments[0] as Record<string, any>).columnarData.timeSec)).toEqual([0, 60, 120]);
        expect((result.current.brushExperiments[0] as Record<string, any>).columnarData.timeSec.length).toBe(3);

        rerender({ experiments, viewport });
        await new Promise(resolve => window.setTimeout(resolve, 150));

        expect(series.window).toHaveBeenCalledTimes(1);
        expect(series.overview).toHaveBeenCalledTimes(1);
    });

    it('falls back per-line when only one viewport line is empty', async () => {
        const viewport: ComparisonViewport | null = { xMinSec: 3000, xMaxSec: 3600 };
        const experiments = [makeExperiment('exp-1'), makeExperiment('exp-2')];
        vi.mocked(series.window).mockImplementation((experimentId: string) =>
            Promise.resolve(experimentId === 'exp-1'
                ? makeEmptySeriesWindow()
                : makeSeriesWindow(experimentId, [3000, 3060, 3120])),
        );
        vi.mocked(series.overview).mockImplementation((experimentId: string) =>
            Promise.resolve(makeSeriesWindow(experimentId, [0, 60, 120, 3000, 3600])),
        );

        const { result } = renderHook(({ experiments, viewport }: HookProps) =>
            useComparisonSeriesWindows({ experiments, viewport, sessionId: 'session-1' }), {
            initialProps: { experiments, viewport },
        });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(2);
        });

        const firstChartColumnar = (result.current.experiments[0] as Record<string, any>).columnarData;
        const secondChartColumnar = (result.current.experiments[1] as Record<string, any>).columnarData;
        const firstBrushColumnar = (result.current.brushExperiments[0] as Record<string, any>).columnarData;
        const secondBrushColumnar = (result.current.brushExperiments[1] as Record<string, any>).columnarData;

        expect(result.current.usedViewportFallback).toBe(true);
        expect(result.current.isViewportWindowReady).toBe(true);
        expect(result.current.isBrushOverviewReady).toBe(true);
        expect(Array.from(firstChartColumnar.timeSec)).toEqual([0, 60, 120, 3000, 3600]);
        expect(Array.from(secondChartColumnar.timeSec)).toEqual([3000, 3060, 3120]);
        expect(Array.from(firstBrushColumnar.timeSec)).toEqual([0, 60, 120, 3000, 3600]);
        expect(Array.from(secondBrushColumnar.timeSec)).toEqual([0, 60, 120, 3000, 3600]);
        expect(firstChartColumnar).toBe(firstBrushColumnar);
        expect(secondChartColumnar).not.toBe(secondBrushColumnar);
    });

    it('keeps existing lines ready and loads only the added experiment for the same viewport', async () => {
        const viewport = { xMinSec: 30, xMaxSec: 90 };
        const initial = [
            makeExperiment('exp-1'),
            makeExperiment('exp-2'),
            makeExperiment('exp-3'),
            makeExperiment('exp-4'),
            makeExperiment('exp-5'),
        ];
        const { result, rerender } = renderHook(({ experiments, viewport }: HookProps) =>
            useComparisonSeriesWindows({ experiments, viewport, sessionId: 'session-1' }), {
            initialProps: { experiments: initial, viewport },
        });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(5);
        });
        expect(series.window).toHaveBeenCalledTimes(5);

        rerender({ experiments: [...initial, makeExperiment('exp-6')], viewport });

        await waitFor(() => {
            expect(result.current.readyCount).toBe(6);
        });

        expect(series.overview).toHaveBeenCalledTimes(6);
        expect(series.window).toHaveBeenCalledTimes(6);
        expect(vi.mocked(series.window).mock.calls.map(call => call[0])).toEqual([
            'exp-1',
            'exp-2',
            'exp-3',
            'exp-4',
            'exp-5',
            'exp-6',
        ]);
    });

    it('debounces rapid viewport changes before requesting window data', async () => {
        const experiment = makeExperiment('exp-1');
        const experiments = [experiment];
        const { rerender } = renderHook(({ experiments, viewport }: HookProps) =>
            useComparisonSeriesWindows({ experiments, viewport }), {
            initialProps: { experiments, viewport: { xMinSec: 0, xMaxSec: 60 } },
        });

        rerender({ experiments, viewport: { xMinSec: 10, xMaxSec: 70 } });
        rerender({ experiments, viewport: { xMinSec: 20, xMaxSec: 80 } });

        await new Promise(resolve => window.setTimeout(resolve, 50));
        expect(series.window).not.toHaveBeenCalled();

        await waitFor(() => {
            expect(series.window).toHaveBeenCalledTimes(1);
        });
        expect(vi.mocked(series.window).mock.calls[0].slice(0, 3)).toEqual(['exp-1', 20, 80]);
    });
});
