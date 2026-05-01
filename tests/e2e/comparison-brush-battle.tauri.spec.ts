/**
 * Comparison Brush Battle Test — Tauri native mode.
 *
 * This is the "hands on the brush" regression test:
 *   - loads real saved experiments from SQLite-backed fixtures;
 *   - zooms the comparison chart;
 *   - drags the lower brush while the pointer is still down;
 *   - captures screenshots before / during / after the drag;
 *   - proves no `experiments_series_window` IPC requests happen during drag;
 *   - proves the main chart is repainting immediately while the brush moves;
 *   - proves the committed chart returns to the precise `window` layer.
 *
 * Run:
 *   npx playwright test --config playwright.tauri.config.ts tests/e2e/comparison-brush-battle.tauri.spec.ts
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import type { Page, TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BSL_REPORT,
  BROOKFIELD_4,
  CHANDLER_SST_63,
  CHANDLER_SWB_96,
  GRACE_REPORT,
  type TestFixture,
} from './fixtures';
import type { DashboardPage } from './pages';

setupBeforeEach(test);

const SCREENSHOT_ROOT = path.resolve('outputs', 'e2e', 'screenshots');
const REPORT_ROOT = path.resolve('outputs', 'e2e', 'perf');
const INITIAL_N = 5;
const WINDOW_SETTLE_MS = 750;
const DURING_DRAG_SETTLE_MS = 220;
const NARROW_WINDOW_MINUTES = 3.5;
const NARROW_WINDOW_TOLERANCE_MINUTES = 0.75;
const NARROW_VIEWPORT_START_SEC = 600;

const FIXTURE_POOL: TestFixture[] = [
  CHANDLER_SST_63,
  CHANDLER_SWB_96,
  GRACE_REPORT,
  BSL_REPORT,
  BROOKFIELD_4,
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

interface PerfState {
  ipc_recorder_status: string;
  series_calls: SeriesIpcCall[];
}

interface BrushState {
  brush_min: number;
  brush_max: number;
  selection_min: number | null;
  selection_max: number | null;
  selection_left_px: number;
  selection_right_px: number;
}

interface CanvasFingerprint {
  width: number;
  height: number;
  hash: number;
  colouredPixels: number;
}

interface BattleReport {
  schema: 'rheolab.e2e.comparison_brush_battle.v1';
  runId: string;
  generatedAt: string;
  status: 'passed' | 'failed';
  error?: string;
  setup?: {
    initialExperiments: SavedExperiment[];
  };
  screenshots: Record<string, string>;
  measurements?: {
    initialViewport: { xMinSec: number; xMaxSec: number } | null;
    committedViewport: { xMinSec: number; xMaxSec: number } | null;
    brushBefore: BrushState | null;
    brushMid: BrushState | null;
    brushLate: BrushState | null;
    brushAfter: BrushState | null;
    canvasBefore: CanvasFingerprint;
    canvasMid: CanvasFingerprint;
    canvasLate: CanvasFingerprint;
    canvasAfter: CanvasFingerprint;
    windowRequestsDuringDrag: SeriesIpcCall[];
    windowRequestsAfterCommit: SeriesIpcCall[];
    initialViewportDurationMin: number | null;
    committedViewportDurationMin: number | null;
    chartLayerDuringDrag: string | null;
    chartLayerAfterCommit: string | null;
  };
}

function compactLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '');
}

async function installSeriesRecorder(page: Page): Promise<string> {
  return page.evaluate(() => {
    type MutableWindow = Window & {
      __rheolabBrushBattlePerf?: {
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
    w.__rheolabBrushBattlePerf = state;
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

async function readPerfState(page: Page): Promise<PerfState> {
  return page.evaluate(() => {
    type MutableWindow = Window & {
      __rheolabBrushBattlePerf?: {
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

    const state = (window as MutableWindow).__rheolabBrushBattlePerf;
    return {
      ipc_recorder_status: state?.ipcRecorderStatus ?? 'not-installed',
      series_calls: [...(state?.seriesCalls ?? [])],
    };
  });
}

function callsSince(state: PerfState, startIndex: number): SeriesIpcCall[] {
  return state.series_calls.slice(startIndex);
}

function viewportDurationMinutes(viewport: { xMinSec: number; xMaxSec: number } | null): number | null {
  if (!viewport) return null;
  return (viewport.xMaxSec - viewport.xMinSec) / 60;
}

function brushSelectionWidthMinutes(state: BrushState | null): number | null {
  if (state?.selection_min == null || state.selection_max == null) return null;
  return state.selection_max - state.selection_min;
}

function expectNarrowWindow(durationMin: number | null, label: string): void {
  expect(durationMin, `${label} duration should exist`).not.toBeNull();
  expect(durationMin!, `${label} duration min`).toBeGreaterThanOrEqual(
    NARROW_WINDOW_MINUTES - NARROW_WINDOW_TOLERANCE_MINUTES,
  );
  expect(durationMin!, `${label} duration min`).toBeLessThanOrEqual(
    NARROW_WINDOW_MINUTES + NARROW_WINDOW_TOLERANCE_MINUTES,
  );
}

function expectBrushPannedWithoutResize(before: BrushState, next: BrushState | null, label: string): void {
  expect(next, `${label} brush state`).not.toBeNull();
  const beforeWidth = brushSelectionWidthMinutes(before);
  const nextWidth = brushSelectionWidthMinutes(next);
  expect(beforeWidth, `${label} before width`).not.toBeNull();
  expect(nextWidth, `${label} next width`).not.toBeNull();

  const leftShift = next!.selection_min! - before.selection_min!;
  const rightShift = next!.selection_max! - before.selection_max!;
  expect(leftShift, `${label} left edge should pan right`).toBeGreaterThan(0.25);
  expect(rightShift, `${label} right edge should pan right`).toBeGreaterThan(0.25);
  expect(Math.abs(leftShift - rightShift), `${label} edges should move together`).toBeLessThanOrEqual(0.25);
  expect(Math.abs(nextWidth! - beforeWidth!), `${label} width should stay stable`).toBeLessThanOrEqual(0.25);
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

async function readComparisonViewport(page: Page): Promise<{ xMinSec: number; xMaxSec: number } | null> {
  return page.evaluate(() => {
    type StoreApi = {
      getState?: () => {
        viewport?: { xMinSec: number; xMaxSec: number } | null;
      };
    };
    const store = (window as unknown as { __rheolab_comparison_store?: StoreApi }).__rheolab_comparison_store;
    return store?.getState?.()?.viewport ?? null;
  });
}

async function waitForComparisonViewport(
  page: Page,
  expected: 'set' | 'clear',
): Promise<{ xMinSec: number; xMaxSec: number } | null> {
  await expect.poll(async () => {
    const viewport = await readComparisonViewport(page);
    if (expected === 'clear') return viewport === null ? 'clear' : 'set';
    return viewport && viewport.xMaxSec > viewport.xMinSec ? 'set' : 'clear';
  }, { timeout: 15_000 }).toBe(expected);
  return readComparisonViewport(page);
}

async function setComparisonViewport(
  page: Page,
  viewport: { xMinSec: number; xMaxSec: number },
): Promise<{ xMinSec: number; xMaxSec: number } | null> {
  await page.evaluate((nextViewport) => {
    const store = (window as unknown as {
      __rheolab_comparison_store?: {
        setState?: (patch: Record<string, unknown>) => void;
      };
    }).__rheolab_comparison_store;
    store?.setState?.({ viewport: nextViewport });
  }, viewport);
  return waitForComparisonViewport(page, 'set');
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

async function saveFixtureExperiment(
  page: Page,
  dashboard: DashboardPage,
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

async function readBrushState(page: Page): Promise<BrushState | null> {
  const brush = page.getByTestId('ChartBrush');
  if (!(await brush.isVisible({ timeout: 5_000 }).catch(() => false))) return null;
  return brush.evaluate((element) => {
    const attrNumber = (name: string): number | null => {
      const raw = element.getAttribute(name);
      if (raw == null || raw === '') return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const brushMin = attrNumber('data-brush-min');
    const brushMax = attrNumber('data-brush-max');
    if (brushMin == null || brushMax == null) return null;
    return {
      brush_min: brushMin,
      brush_max: brushMax,
      selection_min: attrNumber('data-selection-min'),
      selection_max: attrNumber('data-selection-max'),
      selection_left_px: attrNumber('data-selection-left-px') ?? 0,
      selection_right_px: attrNumber('data-selection-right-px') ?? 0,
    };
  });
}

async function readCanvasFingerprint(page: Page): Promise<CanvasFingerprint> {
  const canvas = page.getByTestId('ComparisonChart').locator('.uplot canvas').first();
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');
    const { width, height } = el;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    let hash = 2166136261;
    let colouredPixels = 0;
    const stride = Math.max(4, Math.floor(data.length / 8192));
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      const isBackground = r <= 20 && g <= 30 && b <= 50;
      const isTransparent = a === 0;
      if (!isBackground && !isTransparent) colouredPixels++;
      if (i % stride === 0) {
        hash ^= r + (g << 8) + (b << 16) + (a << 24);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
    return { width, height, hash, colouredPixels };
  });
}

function expectCanvasPainted(fingerprint: CanvasFingerprint, label: string): void {
  expect(fingerprint.width, `${label} canvas width`).toBeGreaterThan(20);
  expect(fingerprint.height, `${label} canvas height`).toBeGreaterThan(20);
  expect(fingerprint.colouredPixels, `${label} painted pixels`).toBeGreaterThan(50);
}

async function captureChartScreenshot(
  page: Page,
  testInfo: TestInfo,
  dir: string,
  name: string,
  report: BattleReport,
): Promise<void> {
  const file = path.join(dir, `${name}.png`);
  await page.getByTestId('ComparisonChart').locator('xpath=..').screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
  report.screenshots[name] = file;
}

async function captureBrushScreenshot(
  page: Page,
  testInfo: TestInfo,
  dir: string,
  name: string,
  report: BattleReport,
): Promise<void> {
  const file = path.join(dir, `${name}.png`);
  await page.getByTestId('ChartBrush').screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
  report.screenshots[name] = file;
}

async function writeBattleReport(report: BattleReport): Promise<void> {
  await mkdir(REPORT_ROOT, { recursive: true });
  const file = path.join(REPORT_ROOT, `comparison-brush-battle-${report.runId}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[BrushBattle] wrote ${file}`);
}

async function expectChartLayer(page: Page, layer: 'overview' | 'window' | 'brush-overview'): Promise<void> {
  const chart = page.getByTestId('ComparisonChart');
  await expect(chart).toHaveAttribute('data-chart-layer', layer, { timeout: 15_000 });
  if (layer === 'window') {
    await expect(chart).toHaveAttribute('data-viewport-window-ready', 'true', { timeout: 15_000 });
  }
}

test.describe('[Battle/Tauri] Comparison brush realtime screenshots', () => {
  test.setTimeout(12 * 60_000);

  test('pans the lower brush smoothly while capturing before/during/after screenshots', async ({
    page,
    dashboard,
    comparison,
  }, testInfo) => {
    const runId = `${Date.now()}-tauri`;
    const screenshotDir = path.join(SCREENSHOT_ROOT, `comparison-brush-battle-${runId}`);
    await mkdir(screenshotDir, { recursive: true });

    const report: BattleReport = {
      schema: 'rheolab.e2e.comparison_brush_battle.v1',
      runId,
      generatedAt: new Date().toISOString(),
      status: 'failed',
      screenshots: {},
    };

    try {
      const recorderStatus = await installSeriesRecorder(page);
      expect(recorderStatus).toBe('hook-installed');

      const savedExperiments: SavedExperiment[] = [];
      for (let index = 0; index < INITIAL_N; index += 1) {
        const fixture = FIXTURE_POOL[index % FIXTURE_POOL.length];
        const name = `BrushBattle_${compactLabel(fixture.displayName)}_${runId}_${index}`;
        savedExperiments.push(await saveFixtureExperiment(page, dashboard, fixture, name));
      }
      report.setup = { initialExperiments: savedExperiments };

      await resetComparisonState(page);
      await comparison.goto();
      await comparison.expectLoaded();
      for (let index = 0; index < savedExperiments.length; index += 1) {
        await comparison.addExperimentByName(savedExperiments[index].name);
        await comparison.expectChipCount(index + 1);
      }
      await comparison.expectChartVisible();
      await comparison.expectCanvasPainted();
      await expectChartLayer(page, 'overview');

      const initialViewport = await setComparisonViewport(page, {
        xMinSec: NARROW_VIEWPORT_START_SEC,
        xMaxSec: NARROW_VIEWPORT_START_SEC + NARROW_WINDOW_MINUTES * 60,
      });
      expect(initialViewport).toBeTruthy();
      const initialViewportDurationMin = viewportDurationMinutes(initialViewport);
      expectNarrowWindow(initialViewportDurationMin, 'initial narrow viewport');
      await expectChartLayer(page, 'window');
      await page.waitForTimeout(WINDOW_SETTLE_MS);
      await comparison.expectCanvasPainted();

      await captureChartScreenshot(page, testInfo, screenshotDir, '01-before-brush-pan-window-layer', report);
      const brushBefore = await readBrushState(page);
      expect(brushBefore, 'brush state before battle drag').not.toBeNull();
      expectNarrowWindow(brushSelectionWidthMinutes(brushBefore), 'initial narrow brush selection');
      const canvasBefore = await readCanvasFingerprint(page);
      expectCanvasPainted(canvasBefore, 'before drag');

      const brush = page.getByTestId('ChartBrush');
      const box = await brush.boundingBox();
      if (!box || box.width < 80 || box.height < 10 || !brushBefore) {
        throw new Error('Comparison brush is not ready for battle drag');
      }

      const callsBeforeDrag = (await readPerfState(page)).series_calls.length;
      const selectionCenterPx = (brushBefore.selection_left_px + brushBefore.selection_right_px) / 2;
      const startX = box.x + Math.max(12, Math.min(box.width - 12, selectionCenterPx));
      const y = box.y + box.height * 0.5;
      const midX = Math.max(box.x + 12, Math.min(box.x + box.width - 12, startX + box.width * 0.045));
      const lateX = Math.max(box.x + 12, Math.min(box.x + box.width - 12, startX + box.width * 0.085));

      await page.mouse.move(startX, y);
      await page.mouse.down();
      await captureChartScreenshot(page, testInfo, screenshotDir, '02-pointer-down-before-move', report);

      await page.mouse.move(midX, y, { steps: 8 });
      await expect(page.getByTestId('ComparisonChart')).toHaveAttribute('data-brush-previewing', 'true');
      await expectChartLayer(page, 'brush-overview');
      const chartLayerDuringDrag = await page.getByTestId('ComparisonChart').getAttribute('data-chart-layer');
      const brushMid = await readBrushState(page);
      const canvasMid = await readCanvasFingerprint(page);
      expectCanvasPainted(canvasMid, 'mid drag');
      await captureChartScreenshot(page, testInfo, screenshotDir, '03-during-drag-mid-pointer-still-down', report);
      await captureBrushScreenshot(page, testInfo, screenshotDir, '03b-brush-closeup-mid-pointer-still-down', report);

      await page.waitForTimeout(DURING_DRAG_SETTLE_MS);
      const duringDragCalls = callsSince(await readPerfState(page), callsBeforeDrag)
        .filter(call => call.command === 'experiments_series_window');
      expect(duringDragCalls, 'window IPC during brush drag before pointerup').toHaveLength(0);

      await page.mouse.move(lateX, y, { steps: 8 });
      const brushLate = await readBrushState(page);
      const canvasLate = await readCanvasFingerprint(page);
      expectCanvasPainted(canvasLate, 'late drag');
      await captureChartScreenshot(page, testInfo, screenshotDir, '04-during-drag-late-pointer-still-down', report);
      await captureBrushScreenshot(page, testInfo, screenshotDir, '04b-brush-closeup-late-pointer-still-down', report);

      const lateDragCalls = callsSince(await readPerfState(page), callsBeforeDrag)
        .filter(call => call.command === 'experiments_series_window');
      expect(lateDragCalls, 'window IPC during full brush drag before pointerup').toHaveLength(0);
      expect(canvasMid.hash, 'main chart should repaint immediately during brush move').not.toBe(canvasBefore.hash);
      expect(canvasLate.hash, 'main chart should keep repainting as brush moves').not.toBe(canvasMid.hash);

      await page.mouse.up();
      await captureChartScreenshot(page, testInfo, screenshotDir, '05-after-pointer-up-before-window-settle', report);

      const committedViewport = await waitForComparisonViewport(page, 'set');
      await expectChartLayer(page, 'window');
      await page.waitForTimeout(WINDOW_SETTLE_MS);
      await comparison.expectCanvasPainted();
      await captureChartScreenshot(page, testInfo, screenshotDir, '06-after-window-ready', report);

      const brushAfter = await readBrushState(page);
      const canvasAfter = await readCanvasFingerprint(page);
      expectCanvasPainted(canvasAfter, 'after commit');
      const committedViewportDurationMin = viewportDurationMinutes(committedViewport);
      const chartLayerAfterCommit = await page.getByTestId('ComparisonChart').getAttribute('data-chart-layer');
      const windowRequestsAfterCommit = callsSince(await readPerfState(page), callsBeforeDrag)
        .filter(call => call.command === 'experiments_series_window');

      expect(brushMid?.brush_min).toBeCloseTo(brushBefore.brush_min, 4);
      expect(brushMid?.brush_max).toBeCloseTo(brushBefore.brush_max, 4);
      expect(brushLate?.brush_min).toBeCloseTo(brushBefore.brush_min, 4);
      expect(brushLate?.brush_max).toBeCloseTo(brushBefore.brush_max, 4);
      expectBrushPannedWithoutResize(brushBefore, brushMid, 'mid-drag narrow brush pan');
      expectBrushPannedWithoutResize(brushBefore, brushLate, 'late-drag narrow brush pan');
      expectBrushPannedWithoutResize(brushBefore, brushAfter, 'after-drag narrow brush pan');
      expectNarrowWindow(brushSelectionWidthMinutes(brushMid), 'mid-drag narrow brush selection');
      expectNarrowWindow(brushSelectionWidthMinutes(brushLate), 'late-drag narrow brush selection');
      expectNarrowWindow(brushSelectionWidthMinutes(brushAfter), 'after-drag narrow brush selection');
      expectNarrowWindow(committedViewportDurationMin, 'committed narrow viewport');
      expect(chartLayerAfterCommit).toBe('window');
      expect(windowRequestsAfterCommit.length, 'one committed window request per selected experiment').toBeGreaterThanOrEqual(INITIAL_N);

      report.status = 'passed';
      report.measurements = {
        initialViewport,
        committedViewport,
        brushBefore,
        brushMid,
        brushLate,
        brushAfter,
        canvasBefore,
        canvasMid,
        canvasLate,
        canvasAfter,
        windowRequestsDuringDrag: [],
        windowRequestsAfterCommit,
        initialViewportDurationMin,
        committedViewportDurationMin,
        chartLayerDuringDrag,
        chartLayerAfterCommit,
      };
    } catch (error) {
      report.error = error instanceof Error ? error.stack ?? error.message : String(error);
      throw error;
    } finally {
      await writeBattleReport(report);
    }
  });
});
