/**
 * Warm Navigation Comparison Smoke — Tauri native mode.
 *
 * Proves the user-facing lifecycle contract:
 *   1. Add 5 saved experiments to Comparison and warm a persisted viewport.
 *   2. Leave Comparison for a normal route hop and save another experiment on Dashboard.
 *   3. Return to Comparison: the old 5 lines/chips should render from warm cache
 *      without series IPC refetches.
 *   4. Add the 6th experiment: only that new line should request a series window.
 *
 * Output sidecar:
 *   outputs/e2e/perf/warm-navigation-comparison-<runId>.json
 *
 * Run:
 *   npm run perf:warm-nav:tauri
 *   WARM_NAV_LEAVE_MS=30000 npm run perf:warm-nav:tauri
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BSL_REPORT,
  BROOKFIELD_4,
  CHANDLER_SST_63,
  CHANDLER_SWB_96,
  GRACE_REPORT,
  OFITE_1100,
  type TestFixture,
} from './fixtures';

setupBeforeEach(test);

const OUTPUT_DIR = path.resolve('outputs', 'e2e', 'perf');
const DEFAULT_INITIAL_N = 5;
const DEFAULT_LEAVE_MS = 30_000;
const SERIES_SETTLE_MS = 750;
const VIEWPORT = { xMinSec: 10, xMaxSec: 120 };

const FIXTURE_POOL: TestFixture[] = [
  CHANDLER_SST_63,
  CHANDLER_SWB_96,
  GRACE_REPORT,
  BSL_REPORT,
  BROOKFIELD_4,
  OFITE_1100,
];

interface SavedExperiment {
  id: string;
  name: string;
  fixture: string;
}

interface SeriesIpcCall {
  command: string;
  experiment_id: string | null;
  at_ms: number;
  duration_ms: number;
  byte_length: number | null;
  max_points: number | null;
  x_min_sec: number | null;
  x_max_sec: number | null;
}

interface WarmNavPerfState {
  ipc_recorder_status: string;
  series_calls: SeriesIpcCall[];
  js_heap_used_mb: number | null;
  js_heap_total_mb: number | null;
  dom_nodes: number;
}

interface ComparisonStoreSnapshot {
  experiment_count: number;
  experiment_ids: string[];
  active_tab: string | null;
  viewport: { xMinSec: number; xMaxSec: number } | null;
  db_experiments_with_raw_points: number;
  db_experiments_with_columnar_data: number;
}

interface WarmNavigationReport {
  schema: 'rheolab.e2e.perf.warm_navigation_comparison.v1';
  runId: string;
  generatedAt: string;
  platform: string;
  status: 'passed' | 'failed';
  error?: string;
  config: {
    initial_n: number;
    leave_ms: number;
    viewport: { xMinSec: number; xMaxSec: number };
    settle_ms: number;
  };
  setup?: {
    initial_experiments: SavedExperiment[];
    added_experiment: SavedExperiment;
  };
  measurements?: {
    initial_ready_ms: number;
    dashboard_route_ms: number;
    dashboard_save_ms: number;
    away_ms: number;
    return_ready_ms: number;
    old_lines_visible_ms: number;
    sixth_line_ready_ms: number;
    calls_before_return: number;
    calls_after_return: number;
    calls_after_add: number;
    return_series_requests: SeriesIpcCall[];
    add_series_requests: SeriesIpcCall[];
    refetched_existing_lines_on_return: number;
    refetched_existing_lines_after_add: number;
    sixth_line_series_requests: number;
    before_leave_snapshot: ComparisonStoreSnapshot;
    after_leave_snapshot: ComparisonStoreSnapshot;
    after_return_snapshot: ComparisonStoreSnapshot;
    final_perf_state: WarmNavPerfState;
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function compactLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '');
}

function timeStep<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = Date.now();
  return fn().then((result) => ({ result, ms: Date.now() - started }));
}

async function writeWarmNavReport(report: WarmNavigationReport): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `warm-navigation-comparison-${report.runId}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[WarmNav] wrote ${file}`);
}

async function installWarmNavRecorder(page: Page): Promise<string> {
  return page.evaluate(() => {
    type MutableWindow = Window & {
      __rheolabWarmNavPerf?: {
        startedAt: number;
        ipcRecorderStatus: string;
        seriesCalls: SeriesIpcCall[];
      };
      __RHEOLAB_SERIES_PERF_HOOK__?: {
        record?: (call: Omit<SeriesIpcCall, 'at_ms'>) => void;
      };
    };
    interface SeriesIpcCall {
      command: string;
      experiment_id: string | null;
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
      ipcRecorderStatus: 'hook-installed',
      seriesCalls: [] as SeriesIpcCall[],
    };
    w.__rheolabWarmNavPerf = state;
    w.__RHEOLAB_SERIES_PERF_HOOK__ = {
      record(call) {
        state.seriesCalls.push({
          command: call.command,
          experiment_id: call.experiment_id ?? null,
          at_ms: Math.round(performance.now() - startedAt),
          duration_ms: call.duration_ms,
          byte_length: call.byte_length,
          max_points: call.max_points,
          x_min_sec: call.x_min_sec,
          x_max_sec: call.x_max_sec,
        });
      },
    };
    return state.ipcRecorderStatus;
  });
}

async function readWarmNavPerfState(page: Page): Promise<WarmNavPerfState> {
  return page.evaluate(() => {
    type PerfMemory = {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
    };
    type PerfWithMemory = Performance & { memory?: PerfMemory };
    type MutableWindow = Window & {
      __rheolabWarmNavPerf?: {
        ipcRecorderStatus?: string;
        seriesCalls?: SeriesIpcCall[];
      };
    };
    interface SeriesIpcCall {
      command: string;
      experiment_id: string | null;
      at_ms: number;
      duration_ms: number;
      byte_length: number | null;
      max_points: number | null;
      x_min_sec: number | null;
      x_max_sec: number | null;
    }

    const state = (window as MutableWindow).__rheolabWarmNavPerf;
    const heap = (performance as PerfWithMemory).memory;
    return {
      ipc_recorder_status: state?.ipcRecorderStatus ?? 'not-installed',
      series_calls: [...(state?.seriesCalls ?? [])],
      js_heap_used_mb: typeof heap?.usedJSHeapSize === 'number'
        ? Math.round((heap.usedJSHeapSize / 1024 / 1024) * 100) / 100
        : null,
      js_heap_total_mb: typeof heap?.totalJSHeapSize === 'number'
        ? Math.round((heap.totalJSHeapSize / 1024 / 1024) * 100) / 100
        : null,
      dom_nodes: document.getElementsByTagName('*').length,
    };
  });
}

async function readComparisonStoreSnapshot(page: Page): Promise<ComparisonStoreSnapshot> {
  return page.evaluate(() => {
    type StoreApi = {
      getState?: () => {
        experiments?: Array<Record<string, unknown>>;
        experimentIds?: string[];
        activeTab?: string;
        viewport?: { xMinSec: number; xMaxSec: number } | null;
      };
    };
    const store = (window as unknown as { __rheolab_comparison_store?: StoreApi }).__rheolab_comparison_store;
    const state = store?.getState?.();
    const experiments = state?.experiments ?? [];
    const dbExperiments = experiments.filter(exp => typeof exp.id === 'string' && !exp.id.startsWith('file-'));
    return {
      experiment_count: experiments.length,
      experiment_ids: state?.experimentIds ?? experiments.map(exp => String(exp.id ?? '')),
      active_tab: state?.activeTab ?? null,
      viewport: state?.viewport ?? null,
      db_experiments_with_raw_points: dbExperiments.filter(exp => Array.isArray(exp.rawPoints) && exp.rawPoints.length > 0).length,
      db_experiments_with_columnar_data: dbExperiments.filter(exp => {
        const columnar = exp.columnarData as { timeSec?: ArrayLike<unknown> } | undefined;
        return !!columnar?.timeSec && columnar.timeSec.length > 0;
      }).length,
    };
  });
}

async function resetComparisonState(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem('comparison-storage');
    const store = (window as unknown as {
      __rheolab_comparison_store?: {
        setState?: (patch: Record<string, unknown>) => void;
      };
    }).__rheolab_comparison_store;
    store?.setState?.({
      experiments: [],
      experimentIds: [],
      experimentsById: {},
      viewport: null,
      activeTab: 'chart',
    });
  });
}

async function setComparisonViewport(page: Page, viewport: { xMinSec: number; xMaxSec: number }): Promise<void> {
  await page.evaluate((nextViewport) => {
    const store = (window as unknown as {
      __rheolab_comparison_store?: {
        getState?: () => { setViewport?: (viewport: typeof nextViewport) => void };
        setState?: (patch: { viewport: typeof nextViewport }) => void;
      };
    }).__rheolab_comparison_store;
    const setViewport = store?.getState?.().setViewport;
    if (typeof setViewport === 'function') {
      setViewport(nextViewport);
    } else {
      store?.setState?.({ viewport: nextViewport });
    }
  }, viewport);
}

async function findExperimentIdByName(page: Page, name: string): Promise<string> {
  const id = await page.evaluate(async (experimentName) => {
    const invoke = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (command: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__?.invoke;
    if (!invoke) throw new Error('Tauri invoke is unavailable');
    const response = await invoke('experiments_list', {
      query: { page: 1, limit: 10, searchQuery: experimentName },
    }) as { experiments?: Array<{ id?: string; name?: string }> };
    const exact = response.experiments?.find(exp => exp.name === experimentName);
    return exact?.id ?? null;
  }, name);
  if (!id) throw new Error(`Experiment id not found for ${name}`);
  return id;
}

async function readComparisonCap(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const invoke = (window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: (command: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__?.invoke;
    if (!invoke) return 0;
    const result = await invoke('licensing_check', {}) as {
      features?: { maxComparisonExperiments?: number };
      license?: { features?: { maxComparisonExperiments?: number } };
    };
    return result.features?.maxComparisonExperiments
      ?? result.license?.features?.maxComparisonExperiments
      ?? 0;
  });
}

async function saveFixtureExperiment(
  page: Page,
  dashboard: import('./pages').DashboardPage,
  fixture: TestFixture,
  name: string,
): Promise<SavedExperiment> {
  await dashboard.goto();
  await dashboard.uploadFile(fixture);
  await dashboard.waitForAnalysis(90_000);
  const saved = await dashboard.saveExperiment({ name });
  const id = await findExperimentIdByName(page, saved.name);
  return {
    id,
    name: saved.name,
    fixture: fixture.fileName,
  };
}

async function waitForSeriesCalls(
  page: Page,
  command: string,
  experimentIds: string[],
  minCount: number,
): Promise<void> {
  await expect.poll(async () => {
    const state = await readWarmNavPerfState(page);
    return state.series_calls.filter(call => (
      call.command === command &&
      call.experiment_id !== null &&
      experimentIds.includes(call.experiment_id)
    )).length;
  }, { timeout: 45_000 }).toBeGreaterThanOrEqual(minCount);
}

function callsSince(state: WarmNavPerfState, startIndex: number): SeriesIpcCall[] {
  return state.series_calls.slice(startIndex);
}

function countCallsFor(calls: SeriesIpcCall[], experimentIds: string[]): number {
  return calls.filter(call => call.experiment_id !== null && experimentIds.includes(call.experiment_id)).length;
}

test.describe('[WarmNav/Tauri] Comparison route-return lifecycle', () => {
  test.setTimeout(15 * 60_000);

  test('returns to 5 warm comparison lines and adds only the 6th line', async ({
    page,
    dashboard,
    comparison,
  }) => {
    const initialN = parsePositiveInt(process.env.WARM_NAV_INITIAL_N, DEFAULT_INITIAL_N);
    const leaveMs = parsePositiveInt(process.env.WARM_NAV_LEAVE_MS, DEFAULT_LEAVE_MS);
    const runId = `${Date.now()}-tauri`;
    const report: WarmNavigationReport = {
      schema: 'rheolab.e2e.perf.warm_navigation_comparison.v1',
      runId,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      status: 'failed',
      config: {
        initial_n: initialN,
        leave_ms: leaveMs,
        viewport: VIEWPORT,
        settle_ms: SERIES_SETTLE_MS,
      },
    };

    try {
      const comparisonCap = await readComparisonCap(page);
      expect(comparisonCap).toBeGreaterThanOrEqual(initialN + 1);

      const recorderStatus = await installWarmNavRecorder(page);
      expect(recorderStatus).toBe('hook-installed');

      const initialExperiments: SavedExperiment[] = [];
      for (let index = 0; index < initialN; index += 1) {
        const fixture = FIXTURE_POOL[index % FIXTURE_POOL.length];
        const name = `WarmNav_Initial_${compactLabel(fixture.displayName)}_${runId}_${index}`;
        initialExperiments.push(await saveFixtureExperiment(page, dashboard, fixture, name));
      }

      await resetComparisonState(page);

      const initialIds = initialExperiments.map(exp => exp.id);
      const { ms: initialReadyMs } = await timeStep(async () => {
        await comparison.goto();
        await comparison.expectLoaded();
        for (let index = 0; index < initialExperiments.length; index += 1) {
          await comparison.addExperimentByName(initialExperiments[index].name);
          await comparison.expectChipCount(index + 1);
        }
        await comparison.expectChartVisible();
        await waitForSeriesCalls(page, 'experiments_series_overview', initialIds, initialN);
        await comparison.expectCanvasPainted();

        await setComparisonViewport(page, VIEWPORT);
        await waitForSeriesCalls(page, 'experiments_series_window', initialIds, initialN);
        await comparison.expectCanvasPainted();
      });
      const beforeLeaveSnapshot = await readComparisonStoreSnapshot(page);

      const callsBeforeDashboard = (await readWarmNavPerfState(page)).series_calls.length;
      const awayStartedAt = Date.now();
      const { ms: dashboardRouteMs } = await timeStep(async () => {
        await dashboard.goto();
      });

      const afterLeaveSnapshot = await readComparisonStoreSnapshot(page);
      expect(afterLeaveSnapshot.experiment_count).toBe(initialN);
      expect(afterLeaveSnapshot.db_experiments_with_raw_points).toBe(0);
      expect(afterLeaveSnapshot.db_experiments_with_columnar_data).toBe(0);

      const addedFixture = FIXTURE_POOL[initialN % FIXTURE_POOL.length];
      const addedName = `WarmNav_Add_${compactLabel(addedFixture.displayName)}_${runId}_${initialN}`;
      const { result: addedExperiment, ms: dashboardSaveMs } = await timeStep(() =>
        saveFixtureExperiment(page, dashboard, addedFixture, addedName),
      );

      const remainingAwayMs = Math.max(0, leaveMs - (Date.now() - awayStartedAt));
      if (remainingAwayMs > 0) {
        await page.waitForTimeout(remainingAwayMs);
      }

      const callsBeforeReturn = (await readWarmNavPerfState(page)).series_calls.length;
      expect(callsBeforeReturn).toBeGreaterThanOrEqual(callsBeforeDashboard);

      const { ms: returnReadyMs } = await timeStep(async () => {
        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.expectChipCount(initialN);
        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();
      });
      await page.waitForTimeout(SERIES_SETTLE_MS);

      const afterReturnPerf = await readWarmNavPerfState(page);
      const returnSeriesRequests = callsSince(afterReturnPerf, callsBeforeReturn);
      const refetchedExistingLinesOnReturn = countCallsFor(returnSeriesRequests, initialIds);
      expect(refetchedExistingLinesOnReturn).toBe(0);

      const afterReturnSnapshot = await readComparisonStoreSnapshot(page);
      expect(afterReturnSnapshot.viewport).toEqual(VIEWPORT);

      const callsBeforeAdd = afterReturnPerf.series_calls.length;
      const { ms: sixthLineReadyMs } = await timeStep(async () => {
        await comparison.addExperimentByName(addedExperiment.name);
        await comparison.expectChipCount(initialN + 1);
        await waitForSeriesCalls(page, 'experiments_series_window', [addedExperiment.id], 1);
        await comparison.expectCanvasPainted();
      });
      await page.waitForTimeout(SERIES_SETTLE_MS);

      const finalPerf = await readWarmNavPerfState(page);
      const addSeriesRequests = callsSince(finalPerf, callsBeforeAdd);
      const refetchedExistingLinesAfterAdd = countCallsFor(addSeriesRequests, initialIds);
      const sixthLineSeriesRequests = countCallsFor(addSeriesRequests, [addedExperiment.id]);

      expect(refetchedExistingLinesAfterAdd).toBe(0);
      expect(sixthLineSeriesRequests).toBe(1);
      expect(addSeriesRequests.find(call => call.experiment_id === addedExperiment.id)?.command)
        .toBe('experiments_series_window');

      report.status = 'passed';
      report.setup = {
        initial_experiments: initialExperiments,
        added_experiment: addedExperiment,
      };
      report.measurements = {
        initial_ready_ms: initialReadyMs,
        dashboard_route_ms: dashboardRouteMs,
        dashboard_save_ms: dashboardSaveMs,
        away_ms: Date.now() - awayStartedAt,
        return_ready_ms: returnReadyMs,
        old_lines_visible_ms: returnReadyMs,
        sixth_line_ready_ms: sixthLineReadyMs,
        calls_before_return: callsBeforeReturn,
        calls_after_return: afterReturnPerf.series_calls.length,
        calls_after_add: finalPerf.series_calls.length,
        return_series_requests: returnSeriesRequests,
        add_series_requests: addSeriesRequests,
        refetched_existing_lines_on_return: refetchedExistingLinesOnReturn,
        refetched_existing_lines_after_add: refetchedExistingLinesAfterAdd,
        sixth_line_series_requests: sixthLineSeriesRequests,
        before_leave_snapshot: beforeLeaveSnapshot,
        after_leave_snapshot: afterLeaveSnapshot,
        after_return_snapshot: afterReturnSnapshot,
        final_perf_state: finalPerf,
      };
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await writeWarmNavReport(report);
    }
  });
});
