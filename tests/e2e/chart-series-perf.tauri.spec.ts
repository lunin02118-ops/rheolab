/**
 * Chart Series Performance Spec — Tauri native mode.
 *
 * Measures the saved-experiment detail chart path after the binary-series
 * refactor:
 *   1. Metadata-only detail load from Library to first painted chart.
 *   2. Binary overview/window IPC payload bytes.
 *   3. Zoom selection -> experiments_series_window refetch latency.
 *   4. JS heap / long tasks, with optional direct Win32 RSS phase markers.
 *
 * Output sidecar:
 *   outputs/e2e/perf/chart-series-<runId>.json
 *
 * Run:
 *   npm run perf:chart:tauri
 *   CHART_SERIES_MEMORY_STEPS=1 npm run perf:chart:tauri
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHANDLER_SST_63 } from './fixtures';
import {
  recordNativeMemoryStep,
  type NativeMemoryStep,
} from './perf/native-memory';

setupBeforeEach(test);

const OUTPUT_DIR = path.resolve('outputs', 'e2e', 'perf');
const MEMORY_STEPS_ENABLED = process.env.CHART_SERIES_MEMORY_STEPS === '1';
const MAX_POINTS = Number.parseInt(process.env.CHART_SERIES_MAX_POINTS ?? '1500', 10);
const SERIES_METRICS = [
  'viscosityCp',
  'temperatureC',
  'shearRate',
  'shearStressPa',
  'pressureBar',
  'speedRpm',
  'bathTemperatureC',
];

interface SeriesIpcCall {
  command: string;
  at_ms: number;
  duration_ms: number;
  byte_length: number | null;
  max_points: number | null;
  x_min_sec: number | null;
  x_max_sec: number | null;
}

interface ChartPerfState {
  ipc_recorder_status: string;
  series_calls: SeriesIpcCall[];
  long_task_count: number;
  long_task_total_ms: number;
  long_task_max_ms: number;
  js_heap_used_mb: number | null;
  js_heap_total_mb: number | null;
  dom_nodes: number;
  uplot_init_ms: number | null;
}

interface ChartPhaseStep extends NativeMemoryStep {
  js_heap_used_mb: number | null;
  js_heap_total_mb: number | null;
  dom_nodes: number;
  long_task_count: number;
  long_task_total_ms: number;
  long_task_max_ms: number;
  series_call_count: number;
  overview_call_count: number;
  window_call_count: number;
}

interface DirectSeriesProbe {
  point_count: number | null;
  time_min_sec: number | null;
  time_max_sec: number | null;
  overview_bytes: number | null;
  window_bytes: number | null;
  window_range: { x_min_sec: number; x_max_sec: number } | null;
}

interface ChartSeriesReport {
  schema: 'rheolab.e2e.perf.chart_series.v1';
  runId: string;
  generatedAt: string;
  platform: string;
  fixture: string;
  max_points: number;
  metrics: string[];
  memory_steps_enabled: boolean;
  native_memory_file?: string | null;
  measurement: {
    experiment_id: string;
    experiment_name: string;
    detail_first_paint_ms: number;
    zoom_window_ms: number | null;
    direct_series: DirectSeriesProbe;
    overview_call_count: number;
    window_call_count: number;
    first_overview_bytes: number | null;
    first_window_bytes: number | null;
    ipc_recorder_status: string;
    phase_steps: ChartPhaseStep[];
    final_perf_state: ChartPerfState;
  };
}

function timeStep<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  return fn().then((result) => ({ result, ms: Date.now() - t0 }));
}

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function installChartPerfRecorder(page: Page): Promise<string> {
  return page.evaluate(() => {
    type MutableWindow = Window & {
      __rheolabChartPerf?: {
        startedAt: number;
        ipcRecorderStatus: string;
        seriesCalls: SeriesIpcCall[];
        longTasks: { startTime: number; duration: number }[];
        observer?: PerformanceObserver;
      };
      __RHEOLAB_SERIES_PERF_HOOK__?: {
        record?: (call: {
          command: string;
          duration_ms: number;
          byte_length: number | null;
          max_points: number | null;
          x_min_sec: number | null;
          x_max_sec: number | null;
        }) => void;
      };
    };

    interface SeriesIpcCall {
      command: string;
      at_ms: number;
      duration_ms: number;
      byte_length: number | null;
      max_points: number | null;
      x_min_sec: number | null;
      x_max_sec: number | null;
    }

    const w = window as MutableWindow;
    const startedAt = performance.now();
    const state = {
      startedAt,
      ipcRecorderStatus: 'not-installed',
      seriesCalls: [] as SeriesIpcCall[],
      longTasks: [] as { startTime: number; duration: number }[],
      observer: undefined as PerformanceObserver | undefined,
    };
    w.__rheolabChartPerf = state;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      state.observer = observer;
    } catch {
      // Long Task API is optional in embedded WebView2 test contexts.
    }

    w.__RHEOLAB_SERIES_PERF_HOOK__ = {
      record(call) {
        state.seriesCalls.push({
          command: call.command,
          at_ms: Math.round(performance.now() - startedAt),
          duration_ms: call.duration_ms,
          byte_length: call.byte_length,
          max_points: call.max_points,
          x_min_sec: call.x_min_sec,
          x_max_sec: call.x_max_sec,
        });
      },
    };
    state.ipcRecorderStatus = 'hook-installed';
    return state.ipcRecorderStatus;
  });
}

async function readChartPerfState(page: Page): Promise<ChartPerfState> {
  return page.evaluate(() => {
    type PerfMemory = {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
    };
    type PerfWithMemory = Performance & { memory?: PerfMemory };
    type MutableWindow = Window & {
      __rheolabChartPerf?: {
        ipcRecorderStatus?: string;
        seriesCalls?: SeriesIpcCall[];
        longTasks?: { startTime: number; duration: number }[];
      };
    };
    interface SeriesIpcCall {
      command: string;
      at_ms: number;
      duration_ms: number;
      byte_length: number | null;
      max_points: number | null;
      x_min_sec: number | null;
      x_max_sec: number | null;
    }

    const state = (window as MutableWindow).__rheolabChartPerf;
    const longTasks = state?.longTasks ?? [];
    const heap = (performance as PerfWithMemory).memory;
    const uplotMeasure = performance.getEntriesByName('uplot:init').slice(-1)[0];
    return {
      ipc_recorder_status: state?.ipcRecorderStatus ?? 'not-installed',
      series_calls: [...(state?.seriesCalls ?? [])],
      long_task_count: longTasks.length,
      long_task_total_ms: Math.round(longTasks.reduce((sum, entry) => sum + entry.duration, 0) * 10) / 10,
      long_task_max_ms: longTasks.length
        ? Math.round(Math.max(...longTasks.map(entry => entry.duration)) * 10) / 10
        : 0,
      js_heap_used_mb: typeof heap?.usedJSHeapSize === 'number'
        ? Math.round((heap.usedJSHeapSize / 1024 / 1024) * 100) / 100
        : null,
      js_heap_total_mb: typeof heap?.totalJSHeapSize === 'number'
        ? Math.round((heap.totalJSHeapSize / 1024 / 1024) * 100) / 100
        : null,
      dom_nodes: document.getElementsByTagName('*').length,
      uplot_init_ms: uplotMeasure
        ? Math.round(uplotMeasure.duration * 10) / 10
        : null,
    };
  });
}

async function recordPhase(
  page: Page,
  steps: ChartPhaseStep[],
  runStartedAt: number,
  phase: string,
): Promise<void> {
  const perf = await readChartPerfState(page);
  const native = MEMORY_STEPS_ENABLED
    ? await recordNativeMemoryStep(runStartedAt, phase)
    : { phase, at_ms: Date.now() - runStartedAt, source: 'unavailable' as const };
  const step: ChartPhaseStep = {
    ...native,
    js_heap_used_mb: perf.js_heap_used_mb,
    js_heap_total_mb: perf.js_heap_total_mb,
    dom_nodes: perf.dom_nodes,
    long_task_count: perf.long_task_count,
    long_task_total_ms: perf.long_task_total_ms,
    long_task_max_ms: perf.long_task_max_ms,
    series_call_count: perf.series_calls.length,
    overview_call_count: perf.series_calls.filter(call => call.command === 'experiments_series_overview').length,
    window_call_count: perf.series_calls.filter(call => call.command === 'experiments_series_window').length,
  };
  steps.push(step);

  const rss = MEMORY_STEPS_ENABLED && step.renderer_rss_mb != null
    ? ` renderer=${step.renderer_rss_mb} MB total=${step.total_rss_mb} MB`
    : '';
  console.log(
    `[chart:${phase}] heap=${step.js_heap_used_mb ?? 'n/a'} MB ` +
    `series=${step.series_call_count} overview=${step.overview_call_count} window=${step.window_call_count}${rss}`,
  );
}

async function findExperimentIdByName(page: Page, name: string): Promise<string> {
  const id = await page.evaluate(async (experimentName) => {
    const invoke = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (command: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error('Tauri invoke is unavailable');
    const response = await invoke('experiments_list', {
      query: { page: 1, limit: 5, searchQuery: experimentName },
    }) as { experiments?: Array<{ id?: string; name?: string }> };
    const exact = response.experiments?.find(exp => exp.name === experimentName);
    const fallback = response.experiments?.[0];
    return exact?.id ?? fallback?.id ?? null;
  }, name);

  if (!id) throw new Error(`Experiment id not found for ${name}`);
  return id;
}

async function probeDirectSeriesEndpoints(page: Page, experimentId: string): Promise<DirectSeriesProbe> {
  return page.evaluate(async ({ id, metrics, maxPoints }) => {
    function byteLengthOf(value: unknown): number | null {
      if (value instanceof ArrayBuffer) return value.byteLength;
      if (ArrayBuffer.isView(value)) return value.byteLength;
      if (Array.isArray(value)) return value.length;
      if (value && typeof value === 'object' && 'byteLength' in value) {
        const n = Number((value as { byteLength?: unknown }).byteLength);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    }

    const invoke = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (command: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error('Tauri invoke is unavailable');

    const meta = await invoke('experiments_series_meta', { experimentId: id }) as {
      pointCount?: number;
      timeMinSec?: number | null;
      timeMaxSec?: number | null;
    };
    const overview = await invoke('experiments_series_overview', {
      experimentId: id,
      metrics,
      maxPoints,
    });

    const min = Number(meta.timeMinSec);
    const max = Number(meta.timeMaxSec);
    let windowBytes: number | null = null;
    let windowRange: { x_min_sec: number; x_max_sec: number } | null = null;
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      const span = max - min;
      const xMinSec = min + span * 0.25;
      const xMaxSec = min + span * 0.75;
      const windowPayload = await invoke('experiments_series_window', {
        experimentId: id,
        xMinSec,
        xMaxSec,
        metrics,
        maxPoints,
        downsampleMode: 'minmax',
      });
      windowBytes = byteLengthOf(windowPayload);
      windowRange = { x_min_sec: xMinSec, x_max_sec: xMaxSec };
    }

    return {
      point_count: Number.isFinite(Number(meta.pointCount)) ? Number(meta.pointCount) : null,
      time_min_sec: Number.isFinite(min) ? min : null,
      time_max_sec: Number.isFinite(max) ? max : null,
      overview_bytes: byteLengthOf(overview),
      window_bytes: windowBytes,
      window_range: windowRange,
    };
  }, { id: experimentId, metrics: SERIES_METRICS, maxPoints: MAX_POINTS });
}

async function waitForDashboardCanvasPainted(page: Page): Promise<void> {
  const canvas = page.locator('[data-testid="DashboardChartContainer"] .uplot canvas').first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => {
    return canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d');
      if (!ctx || el.width < 2 || el.height < 2) return false;
      const imageData = ctx.getImageData(0, 0, el.width, el.height);
      const data = imageData.data;
      let coloured = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        const isBackground = r <= 20 && g <= 30 && b <= 50;
        if (a !== 0 && !isBackground) coloured++;
      }
      return coloured > 50;
    });
  }, { timeout: 20_000, message: 'dashboard uPlot canvas should paint data' }).toBe(true);
}

async function dragZoomChart(page: Page): Promise<void> {
  const overlay = page.locator('[data-testid="DashboardChartContainer"] .uplot .u-over').first();
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await overlay.scrollIntoViewIfNeeded();
  const box = await overlay.boundingBox();
  expect(box, 'uPlot overlay box').toBeTruthy();
  if (!box) return;

  const y = box.y + box.height * 0.5;
  const x1 = box.x + box.width * 0.25;
  const x2 = box.x + box.width * 0.72;
  await page.mouse.move(x1, y);
  await page.mouse.down();
  await page.mouse.move(x2, y, { steps: 14 });
  await page.mouse.up();
}

function countSeriesCalls(state: ChartPerfState, command: string): number {
  return state.series_calls.filter(call => call.command === command).length;
}

test.describe('[ChartSeries/Tauri] Binary series chart runner', () => {
  test.setTimeout(8 * 60_000);

  test('chart_series_binary_first_paint_and_zoom_window', async ({ page, dashboard, library }) => {
    const runId = `${Date.now()}-tauri`;
    const runStartedAt = Date.now();
    const phaseSteps: ChartPhaseStep[] = [];
    const experimentName = `ChartSeriesPerf_${runId}`;

    const recorderStatus = await installChartPerfRecorder(page);
    console.log(`[ChartSeries] recorder=${recorderStatus} maxPoints=${MAX_POINTS}`);
    await recordPhase(page, phaseSteps, runStartedAt, 'before_setup');

    await dashboard.goto();
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis(90_000);
    await dashboard.saveExperiment({ name: experimentName });
    await recordPhase(page, phaseSteps, runStartedAt, 'after_save');

    const experimentId = await findExperimentIdByName(page, experimentName);
    const directSeries = await probeDirectSeriesEndpoints(page, experimentId);
    expect(directSeries.overview_bytes).toBeGreaterThan(0);
    expect(directSeries.window_bytes).toBeGreaterThan(0);
    await recordPhase(page, phaseSteps, runStartedAt, 'after_direct_series_probe');

    const { ms: detailFirstPaintMs } = await timeStep(async () => {
      await recordPhase(page, phaseSteps, runStartedAt, 'before_detail_load');
      await library.goto();
      await library.expectLoaded();
      await library.search(experimentName);
      await library.loadExperimentByName(experimentName);
      await waitForDashboardCanvasPainted(page);
    });
    await recordPhase(page, phaseSteps, runStartedAt, 'after_first_paint');
    console.log(`[ChartSeries] first_paint=${detailFirstPaintMs} ms`);

    const beforeZoom = await readChartPerfState(page);
    const windowCallsBeforeZoom = countSeriesCalls(beforeZoom, 'experiments_series_window');
    let zoomWindowMs: number | null = null;

    const { ms } = await timeStep(async () => {
      await recordPhase(page, phaseSteps, runStartedAt, 'before_zoom');
      await dragZoomChart(page);
      await expect.poll(async () => {
        const state = await readChartPerfState(page);
        return countSeriesCalls(state, 'experiments_series_window');
      }, { timeout: 20_000, message: 'zoom should trigger experiments_series_window' })
        .toBeGreaterThan(windowCallsBeforeZoom);
      await waitForDashboardCanvasPainted(page);
    });
    zoomWindowMs = ms;
    await recordPhase(page, phaseSteps, runStartedAt, 'after_zoom_window');
    console.log(`[ChartSeries] zoom_window=${zoomWindowMs} ms`);

    await page.locator('[data-testid="DashboardChartContainer"] .uplot').first().dblclick();
    await page.waitForTimeout(300);
    await recordPhase(page, phaseSteps, runStartedAt, 'after_reset');

    await library.goto();
    await recordPhase(page, phaseSteps, runStartedAt, 'after_route_leave');

    const finalPerfState = await readChartPerfState(page);
    const overviewCalls = finalPerfState.series_calls.filter(call => call.command === 'experiments_series_overview');
    const windowCalls = finalPerfState.series_calls.filter(call => call.command === 'experiments_series_window');

    const report: ChartSeriesReport = {
      schema: 'rheolab.e2e.perf.chart_series.v1',
      runId,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      fixture: CHANDLER_SST_63.fileName,
      max_points: MAX_POINTS,
      metrics: SERIES_METRICS,
      memory_steps_enabled: MEMORY_STEPS_ENABLED,
      native_memory_file: process.env.TAURI_E2E_NATIVE_MEM_FILE ?? null,
      measurement: {
        experiment_id: experimentId,
        experiment_name: experimentName,
        detail_first_paint_ms: detailFirstPaintMs,
        zoom_window_ms: zoomWindowMs,
        direct_series: directSeries,
        overview_call_count: overviewCalls.length,
        window_call_count: windowCalls.length,
        first_overview_bytes: finiteOrNull(overviewCalls[0]?.byte_length),
        first_window_bytes: finiteOrNull(windowCalls[0]?.byte_length),
        ipc_recorder_status: finalPerfState.ipc_recorder_status,
        phase_steps: phaseSteps,
        final_perf_state: finalPerfState,
      },
    };

    await mkdir(OUTPUT_DIR, { recursive: true });
    const outPath = path.join(OUTPUT_DIR, `chart-series-${runId}.json`);
    await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[ChartSeries] wrote ${outPath}`);
    console.log('\n# Chart binary series summary\n');
    console.log('| metric | value |');
    console.log('|---|---:|');
    console.log(`| detail_first_paint_ms | ${detailFirstPaintMs} |`);
    console.log(`| zoom_window_ms | ${zoomWindowMs ?? 'n/a'} |`);
    console.log(`| direct_overview_bytes | ${directSeries.overview_bytes ?? 'n/a'} |`);
    console.log(`| direct_window_bytes | ${directSeries.window_bytes ?? 'n/a'} |`);
    console.log(`| app_overview_calls | ${overviewCalls.length} |`);
    console.log(`| app_window_calls | ${windowCalls.length} |`);
    console.log(`| final_js_heap_mb | ${finalPerfState.js_heap_used_mb ?? 'n/a'} |`);
    console.log(`| long_task_count | ${finalPerfState.long_task_count} |`);

    expect(detailFirstPaintMs).toBeGreaterThan(0);
    expect(overviewCalls.length).toBeGreaterThan(0);
    expect(windowCalls.length).toBeGreaterThan(0);
  });
});
