/**
 * Comparison Smoke Performance Spec — Tauri native mode (Sprint 2 / S2-L4, commit #4).
 *
 * Records baseline numbers for `L-CMP-N`, `L-CMP-PDF-N`, and `L-CMP-XLSX-N`
 * budgets in `BUDGETS.md` for the comparison-export flow. Runs against the
 * native `reports_generate_comparison_*_by_ids` path. The legacy
 * TS-assembled payload IPC was removed during the RC hardening lane.
 *
 * What it measures, per fixture-count N:
 *   1. **L-CMP-N** — wall_ms from "open Comparison view" to "chart canvas
 *      painted with N legend entries" (perceived UI-ready latency).
 *   2. **L-CMP-PDF-N** — wall_ms for the comparison PDF download (button
 *      click → `downloadPdf` resolves).
 *   3. **L-CMP-XLSX-N** — wall_ms for the comparison XLSX download.
 *
 * Output sidecar at `outputs/e2e/perf/comparison-smoke-<runId>.json` with
 * the schema `rheolab.e2e.perf.comparison_smoke.v1`.
 *
 * Prerequisites:
 * - Tauri build available (debug or release). Debug uses report mocks
 *   (see `base-test.tauri.ts`); release runs real Typst/XLSX. Recorded
 *   `mode` field disambiguates the two so future readers know which it is.
 * - The effective `maxComparisonExperiments` cap is read from the same
 *   `licensing_check` IPC that the app uses. Counts above that runtime cap are
 *   recorded as skipped instead of being silently absent from the sidecar.
 *
 * Run:
 *   npm run perf:comparison:tauri
 *   # or with specific N values:
 *   COMPARISON_SMOKE_N=3,5 npx playwright test tests/e2e/comparison-smoke-perf.tauri.spec.ts \
 *     --config playwright.tauri.config.ts
 *   # capture real PDF/XLSX payloads instead of debug mock bytes:
 *   RHEOLAB_E2E_REAL_REPORTS=1 COMPARISON_SMOKE_N=3 npm run perf:comparison:tauri
 *   # add direct Win32 RSS phase markers (diagnostic; adds measurement overhead):
 *   COMPARISON_SMOKE_MEMORY_STEPS=1 COMPARISON_SMOKE_N=3 npm run perf:comparison:tauri
 *   # with memory steps, exports are direct-saved to a temp dir by default
 *   # to avoid measuring Playwright/WebView2 browser-download overhead.
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import type { CDPSession, Page } from '@playwright/test';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    CHANDLER_SST_63,
    CHANDLER_SWB_96,
    GRACE_REPORT,
    BSL_REPORT,
    BROOKFIELD_4,
    OFITE_1100,
    type TestFixture,
} from './fixtures';
import { ComparisonReportsPage, type ComparisonPage } from './pages';

setupBeforeEach(test);

const execFileAsync = promisify(execFile);

// ─── Config ─────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve('outputs', 'e2e', 'perf');
const MEMORY_STEPS_ENABLED = process.env.COMPARISON_SMOKE_MEMORY_STEPS === '1';
const EXPORT_SAVE_MODE = (
    process.env.COMPARISON_SMOKE_EXPORT_SAVE_MODE === 'download'
        ? 'download'
        : (process.env.COMPARISON_SMOKE_EXPORT_SAVE_MODE === 'direct' || MEMORY_STEPS_ENABLED ? 'direct' : 'download')
) as 'download' | 'direct';

/**
 * Sizes the spec measures. Each is gated by the runtime license cap. Set
 * COMPARISON_SMOKE_N=3,5 to keep a local run focused. The default matrix still
 * includes N=10 as a policy sentinel: under the beta runtime cap of 8, it
 * should be recorded as skipped rather than treated as a failed smoke.
 */
const DEFAULT_TARGET_FIXTURE_COUNTS = [3, 5, 10] as const;

function parseTargetFixtureCounts(): number[] {
    const raw = process.env.COMPARISON_SMOKE_N?.trim();
    if (!raw) return [...DEFAULT_TARGET_FIXTURE_COUNTS];
    const parsed = raw
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    return parsed.length > 0 ? [...new Set(parsed)] : [...DEFAULT_TARGET_FIXTURE_COUNTS];
}

const TARGET_FIXTURE_COUNTS = parseTargetFixtureCounts();

/**
 * Fixture rotation pool. The spec uploads N copies of these in sequence,
 * suffixing each saved name with `_${runId}_${i}` so the comparison selector
 * has N distinct rows to pick. Picked from DEMO_FIXTURES so they don't
 * require file-input upload (faster).
 */
const FIXTURE_POOL: TestFixture[] = [
    CHANDLER_SST_63,
    CHANDLER_SWB_96,
    GRACE_REPORT,
    BSL_REPORT,
    BROOKFIELD_4,
    OFITE_1100,
];

// ─── JSON sidecar schema ────────────────────────────────────────────────────

interface ComparisonSmokeMeasurement {
    n: number;
    report_payload: 'mocked' | 'real';
    export_save_mode: 'download' | 'direct';
    cmp_ready_ms: number | null;
    pdf_ms: number | null;
    pdf_bytes: number | null;
    xlsx_ms: number | null;
    xlsx_bytes: number | null;
    post_export_cleanup_hint?: RendererCleanupHint;
    memory_steps?: NativeMemoryStep[];
    skipped?: 'license-cap' | 'mock-inactive' | 'error';
    skipReason?: string;
}

interface ComparisonSmokeReport {
    schema: 'rheolab.e2e.perf.comparison_smoke.v1';
    runId: string;
    label: string; // 'native-by-ids'
    mode: 'tauri-debug-mocked' | 'tauri-release-real';
    generatedAt: string;
    platform: string;
    license_cap: number;
    memory_steps_enabled: boolean;
    export_save_mode: 'download' | 'direct';
    native_memory_file?: string | null;
    measurements: ComparisonSmokeMeasurement[];
}

interface NativeMemorySnapshot {
    total_rss_mb: number;
    tauri_rss_mb: number;
    webview2_rss_mb: number;
    renderer_rss_mb: number;
    browser_rss_mb: number;
    gpu_rss_mb: number;
    utility_rss_mb: number;
    other_rss_mb: number;
    webview2_process_count: number;
}

interface SeriesWindowCacheStatsSnapshot {
    entries: number | null;
    byte_size: number | null;
    max_entries: number | null;
    max_bytes: number | null;
}

interface ParsingCacheStatsSnapshot {
    entries: number | null;
    capacity: number | null;
    point_count: number | null;
    estimated_bytes: number | null;
}

interface RustSeriesDecodeCacheStatsSnapshot {
    entries: number | null;
    byte_size: number | null;
    max_entries: number | null;
    max_bytes: number | null;
    ttl_seconds: number | null;
    hits: number | null;
    misses: number | null;
}

interface RendererMemorySnapshot {
    route: string;
    js_heap_mb: number | null;
    js_heap_limit_mb: number | null;
    dom_nodes: number;
    canvas_count: number;
    canvas_pixel_bytes: number;
    uplot_count: number;
    comparison_page_root_count: number;
    comparison_chart_root_count: number;
    comparison_chart_uplot_count: number;
    comparison_chart_canvas_count: number;
    comparison_report_root_count: number;
    dashboard_chart_root_count: number;
    dashboard_chart_uplot_count: number;
    dashboard_chart_canvas_count: number;
    uplot_init_measure_count: number;
    uplot_init_total_ms: number | null;
    comparison_uplot_lifecycle_active_instances: number | null;
    comparison_uplot_lifecycle_max_active_instances: number | null;
    comparison_uplot_lifecycle_create_count: number | null;
    comparison_uplot_lifecycle_destroy_count: number | null;
    comparison_uplot_lifecycle_set_data_count: number | null;
    comparison_uplot_lifecycle_size_count: number | null;
    comparison_uplot_lifecycle_redraw_count: number | null;
    comparison_uplot_lifecycle_first_paint_count: number | null;
    comparison_uplot_lifecycle_event_count: number | null;
    series_cache_entries: number | null;
    series_cache_bytes: number | null;
    series_cache_max_entries: number | null;
    series_cache_max_bytes: number | null;
    rust_series_decode_cache_entries: number | null;
    rust_series_decode_cache_bytes: number | null;
    rust_series_decode_cache_max_entries: number | null;
    rust_series_decode_cache_max_bytes: number | null;
    rust_series_decode_cache_ttl_seconds: number | null;
    rust_series_decode_cache_hits: number | null;
    rust_series_decode_cache_misses: number | null;
    comparison_store_experiment_count: number;
    comparison_store_selected_count: number;
    comparison_store_raw_count: number;
    comparison_store_columnar_count: number;
    comparison_store_db_raw_count: number;
    comparison_store_db_columnar_count: number;
    experiment_store_parse_points: number | null;
    experiment_store_columnar_points: number | null;
    parse_cache_entries: number | null;
    parse_cache_capacity: number | null;
    parse_cache_point_count: number | null;
    parse_cache_estimated_bytes: number | null;
}

interface NativeMemoryStep extends Partial<NativeMemorySnapshot>, Partial<RendererMemorySnapshot> {
    phase: string;
    at_ms: number;
    source: 'direct-win32' | 'unavailable';
    error?: string;
}

interface RendererCleanupHint {
    phase: string;
    page_event: boolean;
    cdp_collect_garbage: boolean;
    error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Wall-clock timer; returns elapsed ms. */
function timeStep<T>(_label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
    const t0 = Date.now();
    return fn().then((result) => ({ result, ms: Date.now() - t0 }));
}

function encodePowerShell(script: string): string {
    return Buffer.from(script, 'utf16le').toString('base64');
}

function psPath(value: string): string {
    return value.replace(/'/g, "''");
}

async function snapshotNativeMemory(): Promise<NativeMemorySnapshot | null> {
    if (process.platform !== 'win32') return null;

    const pidFile = path.resolve('.tauri-e2e.pid');
    if (!existsSync(pidFile)) return null;

    const script = `
$ErrorActionPreference = 'Stop'
$pidFile = '${psPath(pidFile)}'
if (-not (Test-Path $pidFile)) { Write-Output '{}'; exit 0 }
$rootPid = [int](Get-Content $pidFile -Raw).Trim()
$tauriProc = Get-Process -Id $rootPid -ErrorAction SilentlyContinue
if ($null -eq $tauriProc) { Write-Output '{}'; exit 0 }

$allWmi = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine -ErrorAction SilentlyContinue
$descendants = [System.Collections.Generic.HashSet[int]]::new()
$queue = [System.Collections.Generic.Queue[int]]::new()
$queue.Enqueue($rootPid)
while ($queue.Count -gt 0) {
  $cur = $queue.Dequeue()
  foreach ($p in $allWmi) {
    if ($p.ParentProcessId -eq $cur -and -not $descendants.Contains([int]$p.ProcessId)) {
      $null = $descendants.Add([int]$p.ProcessId)
      $queue.Enqueue([int]$p.ProcessId)
    }
  }
}

function Get-WebView2Type([string]$CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return 'other' }
  if ($CommandLine -match '(?i)(?:^|\\s)--type=([a-z0-9-]+)') {
    switch ($matches[1].ToLowerInvariant()) {
      'renderer' { return 'renderer' }
      'gpu-process' { return 'gpu' }
      'utility' { return 'utility' }
      'browser' { return 'browser' }
      default { return 'other' }
    }
  }
  if ($CommandLine -match '(?i)--embedded-browser-webview') { return 'browser' }
  return 'other'
}

$webview2WsMb = 0.0
$rendererWsMb = 0.0
$browserWsMb = 0.0
$gpuWsMb = 0.0
$utilityWsMb = 0.0
$otherWsMb = 0.0
$webview2Count = 0

foreach ($procMeta in @($allWmi)) {
  $procPid = [int]$procMeta.ProcessId
  if (-not $descendants.Contains($procPid)) { continue }
  if ([string]::IsNullOrWhiteSpace($procMeta.Name)) { continue }
  if ($procMeta.Name.ToLowerInvariant() -ne 'msedgewebview2.exe') { continue }
  $p = Get-Process -Id $procPid -ErrorAction SilentlyContinue
  if ($null -eq $p) { continue }
  $wsMb = [math]::Round($p.WorkingSet64 / 1MB, 2)
  $webview2WsMb += $wsMb
  $webview2Count++
  $type = Get-WebView2Type -CommandLine $procMeta.CommandLine
  switch ($type) {
    'renderer' { $rendererWsMb += $wsMb }
    'browser' { $browserWsMb += $wsMb }
    'gpu' { $gpuWsMb += $wsMb }
    'utility' { $utilityWsMb += $wsMb }
    default { $otherWsMb += $wsMb }
  }
}

$tauriWsMb = [math]::Round($tauriProc.WorkingSet64 / 1MB, 2)
$out = [PSCustomObject]@{
  total_rss_mb = [math]::Round($tauriWsMb + $webview2WsMb, 2)
  tauri_rss_mb = $tauriWsMb
  webview2_rss_mb = [math]::Round($webview2WsMb, 2)
  renderer_rss_mb = [math]::Round($rendererWsMb, 2)
  browser_rss_mb = [math]::Round($browserWsMb, 2)
  gpu_rss_mb = [math]::Round($gpuWsMb, 2)
  utility_rss_mb = [math]::Round($utilityWsMb, 2)
  other_rss_mb = [math]::Round($otherWsMb, 2)
  webview2_process_count = $webview2Count
}
$out | ConvertTo-Json -Compress -Depth 4
`;

    const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)],
        { timeout: 10_000 },
    );
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === '{}') return null;
    return JSON.parse(trimmed) as NativeMemorySnapshot;
}

async function snapshotRendererMemory(page: Page): Promise<RendererMemorySnapshot> {
    return page.evaluate(async () => {
        type PerfMemory = {
            usedJSHeapSize?: number;
            jsHeapSizeLimit?: number;
        };
        type PerfWithMemory = Performance & { memory?: PerfMemory };
        type CacheStats = {
            entries?: number;
            byteSize?: number;
            maxEntries?: number;
            maxBytes?: number;
        };
        type StoreApi = {
            getState?: () => Record<string, unknown>;
        };
        type ComparisonStats = {
            experimentCount?: number;
            selectedCount?: number;
            rawCount?: number;
            columnarCount?: number;
            dbRawCount?: number;
            dbColumnarCount?: number;
        };
        type ExperimentDataStats = {
            parsePoints?: number;
            columnarPoints?: number;
            hasParseResult?: boolean;
        };
        type TauriInternals = {
            invoke?: (command: string, args?: unknown) => Promise<unknown>;
        };
        type UPlotLifecycleLabelStats = {
            activeInstances?: number;
            maxActiveInstances?: number;
            createCount?: number;
            destroyCount?: number;
            setDataCount?: number;
            sizeCount?: number;
            redrawCount?: number;
            firstPaintCount?: number;
        };
        type UPlotLifecycleEvent = {
            label?: string;
        };
        type UPlotLifecycleState = {
            events?: UPlotLifecycleEvent[];
            stats?: () => Record<string, UPlotLifecycleLabelStats>;
        };

        const toMb = (bytes: number | undefined): number | null => (
            Number.isFinite(bytes) ? Math.round((Number(bytes) / 1024 / 1024) * 100) / 100 : null
        );
        const arrayLength = (value: unknown): number => (
            Array.isArray(value) ? value.length : 0
        );
        const columnarLength = (value: unknown): number => {
            if (!value || typeof value !== 'object') return 0;
            const timeSec = (value as { timeSec?: { length?: unknown } }).timeSec;
            const length = Number(timeSec?.length);
            return Number.isFinite(length) ? length : 0;
        };

        const perfMemory = (performance as PerfWithMemory).memory;
        const cache = (window as unknown as {
            __rheolab_series_window_cache?: { stats?: () => CacheStats };
        }).__rheolab_series_window_cache;
        const cacheStats = cache?.stats?.();

        const comparisonStatsHook = (window as unknown as {
            __rheolab_comparison_stats?: () => ComparisonStats;
        }).__rheolab_comparison_stats;
        const comparisonStats = comparisonStatsHook?.();
        const comparisonStore = (window as unknown as {
            __rheolab_comparison_store?: StoreApi;
        }).__rheolab_comparison_store;
        const comparisonState = comparisonStore?.getState?.() ?? {};
        const comparisonExperiments = Array.isArray(comparisonState.experiments)
            ? comparisonState.experiments as Array<Record<string, unknown>>
            : [];
        const comparisonExperimentIds = Array.isArray(comparisonState.experimentIds)
            ? comparisonState.experimentIds as unknown[]
            : [];

        let rawCount = Number.isFinite(comparisonStats?.rawCount) ? Number(comparisonStats?.rawCount) : 0;
        let columnarCount = Number.isFinite(comparisonStats?.columnarCount) ? Number(comparisonStats?.columnarCount) : 0;
        let dbRawCount = Number.isFinite(comparisonStats?.dbRawCount) ? Number(comparisonStats?.dbRawCount) : 0;
        let dbColumnarCount = Number.isFinite(comparisonStats?.dbColumnarCount) ? Number(comparisonStats?.dbColumnarCount) : 0;
        if (!comparisonStats) {
            for (const exp of comparisonExperiments) {
                const id = typeof exp.id === 'string' ? exp.id : '';
                const isDb = !id.startsWith('file-');
                const hasRaw = arrayLength(exp.rawPoints) > 0;
                const hasColumnar = columnarLength(exp.columnarData) > 0;
                if (hasRaw) rawCount += 1;
                if (hasColumnar) columnarCount += 1;
                if (isDb && hasRaw) dbRawCount += 1;
                if (isDb && hasColumnar) dbColumnarCount += 1;
            }
        }

        const experimentStatsHook = (window as unknown as {
            __rheolab_experiment_data_stats?: () => ExperimentDataStats;
        }).__rheolab_experiment_data_stats;
        const experimentStats = experimentStatsHook?.();
        const legacyExperimentStore = (window as unknown as {
            __rheolab_experiment_data_store?: StoreApi;
        }).__rheolab_experiment_data_store;
        const experimentState = legacyExperimentStore?.getState?.() ?? {};
        const parseResult = experimentState.parseResult && typeof experimentState.parseResult === 'object'
            ? experimentState.parseResult as Record<string, unknown>
            : null;

        let parseCache: ParsingCacheStatsSnapshot = {
            entries: null,
            capacity: null,
            point_count: null,
            estimated_bytes: null,
        };
        let rustSeriesDecodeCache: RustSeriesDecodeCacheStatsSnapshot = {
            entries: null,
            byte_size: null,
            max_entries: null,
            max_bytes: null,
            ttl_seconds: null,
            hits: null,
            misses: null,
        };
        const invoke = (window as unknown as {
            __TAURI_INTERNALS__?: TauriInternals;
        }).__TAURI_INTERNALS__?.invoke;
        if (invoke) {
            try {
                const stats = await invoke('parsing_cache_stats', {}) as {
                    entries?: number;
                    capacity?: number;
                    pointCount?: number;
                    estimatedBytes?: number;
                };
                parseCache = {
                    entries: Number.isFinite(stats.entries) ? Number(stats.entries) : null,
                    capacity: Number.isFinite(stats.capacity) ? Number(stats.capacity) : null,
                    point_count: Number.isFinite(stats.pointCount) ? Number(stats.pointCount) : null,
                    estimated_bytes: Number.isFinite(stats.estimatedBytes) ? Number(stats.estimatedBytes) : null,
                };
            } catch {
                // Older binaries do not expose parsing_cache_stats. Keep fields null.
            }
            try {
                const stats = await invoke('series_decode_cache_stats', {}) as {
                    entries?: number;
                    byteSize?: number;
                    maxEntries?: number;
                    maxBytes?: number;
                    ttlSeconds?: number;
                    hits?: number;
                    misses?: number;
                };
                rustSeriesDecodeCache = {
                    entries: Number.isFinite(stats.entries) ? Number(stats.entries) : null,
                    byte_size: Number.isFinite(stats.byteSize) ? Number(stats.byteSize) : null,
                    max_entries: Number.isFinite(stats.maxEntries) ? Number(stats.maxEntries) : null,
                    max_bytes: Number.isFinite(stats.maxBytes) ? Number(stats.maxBytes) : null,
                    ttl_seconds: Number.isFinite(stats.ttlSeconds) ? Number(stats.ttlSeconds) : null,
                    hits: Number.isFinite(stats.hits) ? Number(stats.hits) : null,
                    misses: Number.isFinite(stats.misses) ? Number(stats.misses) : null,
                };
            } catch {
                // Older binaries do not expose series_decode_cache_stats. Keep fields null.
            }
        }

        const seriesStats: SeriesWindowCacheStatsSnapshot = {
            entries: Number.isFinite(cacheStats?.entries) ? Number(cacheStats?.entries) : null,
            byte_size: Number.isFinite(cacheStats?.byteSize) ? Number(cacheStats?.byteSize) : null,
            max_entries: Number.isFinite(cacheStats?.maxEntries) ? Number(cacheStats?.maxEntries) : null,
            max_bytes: Number.isFinite(cacheStats?.maxBytes) ? Number(cacheStats?.maxBytes) : null,
        };
        const canvases = [...document.querySelectorAll('canvas')];
        const canvasPixelBytes = canvases.reduce((sum, canvas) => (
            sum + Math.max(0, canvas.width) * Math.max(0, canvas.height) * 4
        ), 0);
        const countSelector = (selector: string): number => document.querySelectorAll(selector).length;
        const uplotInitMeasures = performance.getEntriesByName('uplot:init', 'measure');
        const uplotInitTotalMs = uplotInitMeasures.reduce((sum, entry) => sum + entry.duration, 0);
        const lifecycle = (window as unknown as {
            __rheolab_uplot_lifecycle?: UPlotLifecycleState;
        }).__rheolab_uplot_lifecycle;
        const comparisonLifecycle = lifecycle?.stats?.().comparison;
        const comparisonLifecycleEventCount = lifecycle?.events
            ? lifecycle.events.filter(event => event.label === 'comparison').length
            : null;

        return {
            route: window.location.pathname,
            js_heap_mb: toMb(perfMemory?.usedJSHeapSize),
            js_heap_limit_mb: toMb(perfMemory?.jsHeapSizeLimit),
            dom_nodes: document.getElementsByTagName('*').length,
            canvas_count: canvases.length,
            canvas_pixel_bytes: canvasPixelBytes,
            uplot_count: document.querySelectorAll('.uplot').length,
            comparison_page_root_count: countSelector('[data-testid="ComparisonPageRoot"]'),
            comparison_chart_root_count: countSelector('[data-testid="ComparisonChart"]'),
            comparison_chart_uplot_count: countSelector('[data-testid="ComparisonChart"] .uplot'),
            comparison_chart_canvas_count: countSelector('[data-testid="ComparisonChart"] canvas'),
            comparison_report_root_count: countSelector('[data-testid="ComparisonReportTabRoot"]'),
            dashboard_chart_root_count: countSelector('[data-testid="DashboardChartContainer"]'),
            dashboard_chart_uplot_count: countSelector('[data-testid="DashboardChartContainer"] .uplot'),
            dashboard_chart_canvas_count: countSelector('[data-testid="DashboardChartContainer"] canvas'),
            uplot_init_measure_count: uplotInitMeasures.length,
            uplot_init_total_ms: uplotInitMeasures.length > 0 ? Math.round(uplotInitTotalMs * 100) / 100 : null,
            comparison_uplot_lifecycle_active_instances: Number.isFinite(comparisonLifecycle?.activeInstances)
                ? Number(comparisonLifecycle?.activeInstances)
                : null,
            comparison_uplot_lifecycle_max_active_instances: Number.isFinite(comparisonLifecycle?.maxActiveInstances)
                ? Number(comparisonLifecycle?.maxActiveInstances)
                : null,
            comparison_uplot_lifecycle_create_count: Number.isFinite(comparisonLifecycle?.createCount)
                ? Number(comparisonLifecycle?.createCount)
                : null,
            comparison_uplot_lifecycle_destroy_count: Number.isFinite(comparisonLifecycle?.destroyCount)
                ? Number(comparisonLifecycle?.destroyCount)
                : null,
            comparison_uplot_lifecycle_set_data_count: Number.isFinite(comparisonLifecycle?.setDataCount)
                ? Number(comparisonLifecycle?.setDataCount)
                : null,
            comparison_uplot_lifecycle_size_count: Number.isFinite(comparisonLifecycle?.sizeCount)
                ? Number(comparisonLifecycle?.sizeCount)
                : null,
            comparison_uplot_lifecycle_redraw_count: Number.isFinite(comparisonLifecycle?.redrawCount)
                ? Number(comparisonLifecycle?.redrawCount)
                : null,
            comparison_uplot_lifecycle_first_paint_count: Number.isFinite(comparisonLifecycle?.firstPaintCount)
                ? Number(comparisonLifecycle?.firstPaintCount)
                : null,
            comparison_uplot_lifecycle_event_count: Number.isFinite(comparisonLifecycleEventCount)
                ? Number(comparisonLifecycleEventCount)
                : null,
            series_cache_entries: seriesStats.entries,
            series_cache_bytes: seriesStats.byte_size,
            series_cache_max_entries: seriesStats.max_entries,
            series_cache_max_bytes: seriesStats.max_bytes,
            rust_series_decode_cache_entries: rustSeriesDecodeCache.entries,
            rust_series_decode_cache_bytes: rustSeriesDecodeCache.byte_size,
            rust_series_decode_cache_max_entries: rustSeriesDecodeCache.max_entries,
            rust_series_decode_cache_max_bytes: rustSeriesDecodeCache.max_bytes,
            rust_series_decode_cache_ttl_seconds: rustSeriesDecodeCache.ttl_seconds,
            rust_series_decode_cache_hits: rustSeriesDecodeCache.hits,
            rust_series_decode_cache_misses: rustSeriesDecodeCache.misses,
            comparison_store_experiment_count: Number.isFinite(comparisonStats?.experimentCount)
                ? Number(comparisonStats?.experimentCount)
                : comparisonExperiments.length,
            comparison_store_selected_count: Number.isFinite(comparisonStats?.selectedCount)
                ? Number(comparisonStats?.selectedCount)
                : comparisonExperimentIds.length,
            comparison_store_raw_count: rawCount,
            comparison_store_columnar_count: columnarCount,
            comparison_store_db_raw_count: dbRawCount,
            comparison_store_db_columnar_count: dbColumnarCount,
            experiment_store_parse_points: Number.isFinite(experimentStats?.parsePoints)
                ? Number(experimentStats?.parsePoints)
                : (parseResult ? arrayLength(parseResult.data) : null),
            experiment_store_columnar_points: Number.isFinite(experimentStats?.columnarPoints)
                ? Number(experimentStats?.columnarPoints)
                : (parseResult ? columnarLength(parseResult.columnarData) : null),
            parse_cache_entries: parseCache.entries,
            parse_cache_capacity: parseCache.capacity,
            parse_cache_point_count: parseCache.point_count,
            parse_cache_estimated_bytes: parseCache.estimated_bytes,
        };
    });
}

async function recordMemoryStep(
    steps: NativeMemoryStep[],
    runStartedAt: number,
    phase: string,
    page?: Page,
): Promise<void> {
    if (!MEMORY_STEPS_ENABLED) return;

    try {
        const [snap, renderer] = await Promise.all([
            snapshotNativeMemory(),
            page ? snapshotRendererMemory(page) : Promise.resolve(null),
        ]);
        if (!snap) {
            steps.push({
                phase,
                at_ms: Date.now() - runStartedAt,
                source: 'unavailable',
                ...(renderer ?? {}),
            });
            return;
        }
        const step: NativeMemoryStep = {
            phase,
            at_ms: Date.now() - runStartedAt,
            source: 'direct-win32',
            ...snap,
            ...(renderer ?? {}),
        };
        steps.push(step);
        console.log(
            `  [mem:${phase}] total=${step.total_rss_mb} MB renderer=${step.renderer_rss_mb} MB ` +
            `gpu=${step.gpu_rss_mb} MB tauri=${step.tauri_rss_mb} MB ` +
            `js=${step.js_heap_mb ?? 'n/a'} MB series=${step.series_cache_bytes ?? 'n/a'} B ` +
            `rustSeries=${step.rust_series_decode_cache_bytes ?? 'n/a'} B ` +
            `cmpRaw=${step.comparison_store_raw_count ?? 'n/a'} cmpCol=${step.comparison_store_columnar_count ?? 'n/a'}`,
        );
    } catch (error) {
        steps.push({
            phase,
            at_ms: Date.now() - runStartedAt,
            source: 'unavailable',
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

interface ComparisonUPlotLifecycleStats {
    activeInstances: number;
    maxActiveInstances: number;
    createCount: number;
    destroyCount: number;
    setDataCount: number;
    sizeCount: number;
    redrawCount: number;
    firstPaintCount: number;
    eventCount: number;
}

type ComparisonUPlotLifecycleCountKey = Exclude<keyof ComparisonUPlotLifecycleStats, 'eventCount'>;

async function readComparisonUPlotLifecycleStats(page: Page): Promise<ComparisonUPlotLifecycleStats> {
    return page.evaluate(() => {
        type LabelStats = {
            activeInstances?: number;
            maxActiveInstances?: number;
            createCount?: number;
            destroyCount?: number;
            setDataCount?: number;
            sizeCount?: number;
            redrawCount?: number;
            firstPaintCount?: number;
        };
        type LifecycleState = {
            events?: Array<{ label?: string }>;
            stats?: () => Record<string, LabelStats>;
        };
        const lifecycle = (window as unknown as {
            __rheolab_uplot_lifecycle?: LifecycleState;
        }).__rheolab_uplot_lifecycle;
        const stats = lifecycle?.stats?.().comparison ?? {};
        const numberValue = (value: unknown): number => (
            Number.isFinite(Number(value)) ? Number(value) : 0
        );
        return {
            activeInstances: numberValue(stats.activeInstances),
            maxActiveInstances: numberValue(stats.maxActiveInstances),
            createCount: numberValue(stats.createCount),
            destroyCount: numberValue(stats.destroyCount),
            setDataCount: numberValue(stats.setDataCount),
            sizeCount: numberValue(stats.sizeCount),
            redrawCount: numberValue(stats.redrawCount),
            firstPaintCount: numberValue(stats.firstPaintCount),
            eventCount: Array.isArray(lifecycle?.events)
                ? lifecycle.events.filter(event => event.label === 'comparison').length
                : 0,
        };
    });
}

async function waitForComparisonUPlotLifecycleCount(
    page: Page,
    key: ComparisonUPlotLifecycleCountKey,
    minValue: number,
    timeoutMs = 5_000,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const stats = await readComparisonUPlotLifecycleStats(page);
        if (stats[key] >= minValue) return true;
        await page.waitForTimeout(50);
    }
    const stats = await readComparisonUPlotLifecycleStats(page);
    console.log(`[CmpSmoke] lifecycle wait timed out for ${key} >= ${minValue}: ${JSON.stringify(stats)}`);
    return false;
}

/**
 * Ask the page whether comparison report IPC is mocked.
 * Returns true in debug builds where `base-test.tauri.ts` installs report
 * mocks, false in release builds.
 *
 * Used to tag the JSON sidecar with `mode` so downstream A/B reports know
 * whether the wall_ms numbers are "real" or "lower bound + dialog overhead".
 */
async function detectMockMode(page: Page): Promise<'tauri-debug-mocked' | 'tauri-release-real'> {
    return page.evaluate<'tauri-debug-mocked' | 'tauri-release-real'>(() => {
        const w = window as unknown as { __RHEOLAB_E2E_REPORT_MOCK_INSTALLED?: boolean };
        return w.__RHEOLAB_E2E_REPORT_MOCK_INSTALLED ? 'tauri-debug-mocked' : 'tauri-release-real';
    });
}

async function readComparisonCap(page: Page): Promise<number> {
    return page.evaluate<number>(async () => {
        const internals = (window as any).__TAURI_INTERNALS__;
        if (!internals) return 3;
        const result = await internals.invoke('licensing_check', {});
        const cap = Number(result?.features?.maxComparisonExperiments);
        return Number.isFinite(cap) && cap > 0 ? cap : 3;
    });
}

async function clickComparisonExportAndWait(
    page: Page,
    click: () => Promise<unknown>,
    kind: 'pdf' | 'excel',
    timeoutMs: number,
): Promise<void> {
    await page.evaluate(
        ({ expectedKind, timeout }) => {
            type ExportWaitWindow = Window & {
                __rheolab_export_wait_result?: Promise<{ timedOut: boolean; kind?: string }>;
                __rheolab_export_wait_cleanup?: () => void;
            };
            const w = window as ExportWaitWindow;
            w.__rheolab_export_wait_cleanup?.();
            w.__rheolab_export_wait_result = new Promise<{ timedOut: boolean; kind?: string }>((resolve) => {
            const cleanup = () => {
                window.clearTimeout(timer);
                window.removeEventListener('rheolab:comparison-export-buffers-released', onRelease);
                w.__rheolab_export_wait_cleanup = undefined;
            };
            const onRelease = (event: Event) => {
                const detail = (event as CustomEvent<{ kind?: string }>).detail;
                if (detail?.kind !== expectedKind) return;
                cleanup();
                resolve({ timedOut: false, kind: detail.kind });
            };
            const timer = window.setTimeout(() => {
                cleanup();
                resolve({ timedOut: true });
            }, timeout);
            window.addEventListener('rheolab:comparison-export-buffers-released', onRelease);
            w.__rheolab_export_wait_cleanup = cleanup;
        });
        },
        { expectedKind: kind, timeout: timeoutMs },
    );

    await click();
    const result = await page.evaluate(() => {
        type ExportWaitWindow = Window & {
            __rheolab_export_wait_result?: Promise<{ timedOut: boolean; kind?: string }>;
        };
        return (window as ExportWaitWindow).__rheolab_export_wait_result ?? Promise.resolve({ timedOut: true });
    });
    expect(result.timedOut).toBe(false);
}

async function assertDirectExportFile(
    outputDir: string,
    expectedExt: 'pdf' | 'xlsx',
    minSizeBytes: number,
): Promise<{ filename: string; size: number }> {
    const files = (await readdir(outputDir))
        .filter((file) => file.toLowerCase().endsWith(`.${expectedExt}`))
        .sort();
    expect(files.length).toBeGreaterThan(0);
    const filename = files[files.length - 1];
    const filePath = path.join(outputDir, filename);
    const stats = await stat(filePath);
    expect(stats.size).toBeGreaterThanOrEqual(minSizeBytes);
    await rm(filePath, { force: true });
    return { filename, size: stats.size };
}

async function requestRendererCleanupHint(page: Page, phase: string): Promise<RendererCleanupHint> {
    const hint: RendererCleanupHint = {
        phase,
        page_event: false,
        cdp_collect_garbage: false,
    };

    try {
        await page.evaluate((eventPhase) => {
            try {
                for (const entry of performance.getEntriesByType('measure')) {
                    if (entry.name.startsWith('cmp:')) {
                        performance.clearMeasures(entry.name);
                    }
                }
            } catch {
                // Diagnostic cleanup only.
            }
            window.dispatchEvent(new CustomEvent('rheolab:comparison-export-cleanup', {
                detail: { phase: eventPhase },
            }));
        }, phase);
        hint.page_event = true;
    } catch (error) {
        hint.error = `page cleanup hint failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    let cdp: CDPSession | null = null;
    try {
        cdp = await page.context().newCDPSession(page);
        await cdp.send('HeapProfiler.enable');
        await cdp.send('HeapProfiler.collectGarbage');
        hint.cdp_collect_garbage = true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        hint.error = hint.error ? `${hint.error}; CDP GC failed: ${message}` : `CDP GC failed: ${message}`;
    } finally {
        await cdp?.detach().catch(() => undefined);
    }

    await page.waitForTimeout(500);
    return hint;
}

async function waitForComparisonStoreSelectedCount(page: Page, targetCount: number): Promise<void> {
    await expect.poll(async () => page.evaluate(() => {
        type StoreApi = { getState?: () => { experiments?: unknown[]; experimentIds?: unknown[] } };
        type ComparisonStats = { selectedCount?: number; experimentCount?: number };
        const stats = (window as unknown as {
            __rheolab_comparison_stats?: () => ComparisonStats;
        }).__rheolab_comparison_stats?.();
        const statsCount = Number(stats?.selectedCount ?? stats?.experimentCount);
        if (Number.isFinite(statsCount)) return statsCount;
        const store = (window as unknown as {
            __rheolab_comparison_store?: StoreApi;
        }).__rheolab_comparison_store;
        const state = store?.getState?.();
        const ids = Array.isArray(state?.experimentIds) ? state.experimentIds.length : 0;
        const experiments = Array.isArray(state?.experiments) ? state.experiments.length : 0;
        return Math.max(ids, experiments);
    }), { timeout: 10_000 }).toBeGreaterThanOrEqual(targetCount);
}

async function waitForComparisonSeriesReady(page: Page, targetCount: number): Promise<boolean> {
    const deadline = Date.now() + 20_000;
    let lastSnapshot: unknown = null;

    while (Date.now() < deadline) {
        const snapshot = await page.evaluate((target) => {
            type CacheStats = { entries?: number; byteSize?: number };
            const cache = (window as unknown as {
                __rheolab_series_window_cache?: { stats?: () => CacheStats };
            }).__rheolab_series_window_cache;
            const cacheStats = cache?.stats?.();
            const seriesEntries = Number(cacheStats?.entries ?? 0);
            const seriesBytes = Number(cacheStats?.byteSize ?? 0);
            const legendCount = document.querySelectorAll('[data-testid="ComparisonLegendItem"]').length;
            const chartCanvasCount = document.querySelectorAll('[data-testid="ComparisonChart"] .uplot canvas').length;
            return {
                target,
                seriesEntries: Number.isFinite(seriesEntries) ? seriesEntries : 0,
                seriesBytes: Number.isFinite(seriesBytes) ? seriesBytes : 0,
                legendCount,
                chartCanvasCount,
            };
        }, targetCount);
        lastSnapshot = snapshot;

        if (
            snapshot.chartCanvasCount > 0 &&
            (
                snapshot.legendCount >= targetCount ||
                snapshot.seriesEntries >= targetCount
            )
        ) {
            return true;
        }

        await page.waitForTimeout(250);
    }

    console.log(`[CmpSmoke] series-ready wait timed out for target=${targetCount}: ${JSON.stringify(lastSnapshot)}`);
    return false;
}

async function addExperimentByNameWithMemoryPhases(
    comparison: ComparisonPage,
    name: string,
    targetCount: number,
    recordMem: (phase: string) => Promise<void>,
): Promise<void> {
    const phasePrefix = `add_${targetCount}`;
    await recordMem(`before_${phasePrefix}`);
    await comparison.openSelector();
    await recordMem(`after_${phasePrefix}_selector_open`);
    await comparison.searchExperiment(name);
    await recordMem(`after_${phasePrefix}_selector_search`);

    const btn = comparison.page
        .getByTestId('ComparisonSelectorExperimentButton')
        .filter({ hasText: name })
        .first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
    const lifecycleBeforeClick = await readComparisonUPlotLifecycleStats(comparison.page);
    await recordMem(`before_${phasePrefix}_click`);
    await btn.click();
    await recordMem(`after_${phasePrefix}_click`);
    await recordMem(`after_${phasePrefix}_click_before_chart_commit`);

    await waitForComparisonStoreSelectedCount(comparison.page, targetCount);
    await comparison.expectChipCount(targetCount);
    await recordMem(`after_${phasePrefix}_react_commit`);
    await recordMem(`after_${phasePrefix}_store_update`);

    await comparison.closeSelector();
    const expectedCreateCount = lifecycleBeforeClick.createCount + 1;
    const expectedSetDataCount = lifecycleBeforeClick.setDataCount + 1;
    const expectedFirstPaintCount = lifecycleBeforeClick.firstPaintCount + 1;
    await waitForComparisonUPlotLifecycleCount(comparison.page, 'createCount', expectedCreateCount);
    await recordMem(`after_${phasePrefix}_uplot_init`);
    await waitForComparisonUPlotLifecycleCount(comparison.page, 'setDataCount', expectedSetDataCount);
    await recordMem(`after_${phasePrefix}_uplot_set_data`);
    await waitForComparisonUPlotLifecycleCount(comparison.page, 'firstPaintCount', expectedFirstPaintCount);
    await recordMem(`after_${phasePrefix}_first_canvas_paint`);
    await waitForComparisonSeriesReady(comparison.page, targetCount);
    await recordMem(`after_${phasePrefix}_series_ready`);

    await comparison.page.waitForTimeout(100);
    await recordMem(`after_${phasePrefix}_compositor_settle_100ms`);
    await comparison.page.waitForTimeout(400);
    await recordMem(`after_${phasePrefix}_compositor_settle_500ms`);
    await comparison.page.waitForTimeout(300);
    await recordMem(`after_${phasePrefix}_dom_settle`);
}

/**
 * Uploads + saves N experiments rotating through FIXTURE_POOL.
 * Returns the list of saved experiment names.
 */
async function setupComparisonExperiments(
    n: number,
    runId: string,
    dashboard: import('./pages').DashboardPage,
    recordMem?: (phase: string) => Promise<void>,
): Promise<string[]> {
    const names: string[] = [];
    for (let i = 0; i < n; i++) {
        const fx = FIXTURE_POOL[i % FIXTURE_POOL.length];
        const phasePrefix = `fixture_${i + 1}`;
        await recordMem?.(`before_${phasePrefix}_dashboard_goto`);
        await dashboard.goto();
        await recordMem?.(`after_${phasePrefix}_dashboard_goto`);
        await recordMem?.(`before_${phasePrefix}_upload`);
        await dashboard.uploadFile(fx);
        await recordMem?.(`after_${phasePrefix}_upload`);
        await recordMem?.(`before_${phasePrefix}_parse_wait`);
        await dashboard.waitForAnalysis(90_000);
        await recordMem?.(`after_${phasePrefix}_parse`);
        const expName = `CmpSmoke_N${n}_${fx.displayName.replace(/\s+/g, '')}_${runId}_${i}`;
        await recordMem?.(`before_${phasePrefix}_save_dialog`);
        const { name } = await dashboard.saveExperiment({
            name: expName,
            onAfterDialogOpen: () => recordMem?.(`after_${phasePrefix}_save_dialog_open`) ?? Promise.resolve(),
            onBeforeCommit: () => recordMem?.(`before_${phasePrefix}_save_commit`) ?? Promise.resolve(),
            onAfterCommit: () => recordMem?.(`after_${phasePrefix}_save_persist`) ?? Promise.resolve(),
        });
        names.push(name);
        await recordMem?.(`after_${phasePrefix}_save`);
        await dashboard.page.waitForTimeout(300);
        await recordMem?.(`after_${phasePrefix}_post_save_settle`);
        await recordMem?.(`after_${phasePrefix}_cleanup`);
    }
    return names;
}

// ─── Test ───────────────────────────────────────────────────────────────────

test.describe('[CmpSmoke/Tauri] Comparison-export baseline runner', () => {
    // 3 fixture sizes × (load + save + comparison + PDF + XLSX). N=10 is kept
    // as a cap-policy sentinel and is skipped by the current beta runtime cap.
    test.setTimeout(15 * 60_000);

    test('comparison_smoke_baseline', async ({ page, dashboard, comparison }) => {
        const runId = `${Date.now()}-tauri`;
        const runStartedAt = Date.now();
        const measurements: ComparisonSmokeMeasurement[] = [];
        const cmpReports = new ComparisonReportsPage(page);

        const mode = await detectMockMode(page);
        const reportPayloadMode = mode === 'tauri-debug-mocked' ? 'mocked' : 'real';
        const comparisonCap = await readComparisonCap(page);
        const directExportDir = EXPORT_SAVE_MODE === 'direct'
            ? path.join(tmpdir(), `rheolab-comparison-export-${runId}`)
            : null;
        if (directExportDir) {
            await mkdir(directExportDir, { recursive: true });
            await page.evaluate((dir) => {
                sessionStorage.setItem('__e2e_report_output_dir', dir);
            }, directExportDir);
        }
        console.log(`[CmpSmoke] mode=${mode} cap=${comparisonCap} runId=${runId}`);
        console.log(`[CmpSmoke] target counts=${TARGET_FIXTURE_COUNTS.join(', ')}`);
        console.log(`[CmpSmoke] export_save_mode=${EXPORT_SAVE_MODE}`);
        if (MEMORY_STEPS_ENABLED) {
            console.log('[CmpSmoke] direct Win32 memory phase markers enabled');
        }

        for (const n of TARGET_FIXTURE_COUNTS) {
            console.log(`\n━━━ N=${n} ━━━`);
            const memorySteps: NativeMemoryStep[] = [];
            const recordMem = (phase: string) => recordMemoryStep(memorySteps, runStartedAt, `n${n}:${phase}`, page);

            // 1. License-cap gate — record skipped entry, continue.
            if (n > comparisonCap) {
                console.log(`  [skip] N=${n} > runtime comparison cap (${comparisonCap})`);
                measurements.push({
                    n,
                    report_payload: reportPayloadMode,
                    export_save_mode: EXPORT_SAVE_MODE,
                    cmp_ready_ms: null,
                    pdf_ms: null,
                    pdf_bytes: null,
                    xlsx_ms: null,
                    xlsx_bytes: null,
                    skipped: 'license-cap',
                    skipReason: `runtime license caps maxComparisonExperiments at ${comparisonCap}`,
                });
                continue;
            }

            try {
                // 2. Upload + save N experiments.
                console.log(`  [setup] uploading + saving ${n} experiments...`);
                await recordMem('app_start');
                await recordMem('before_setup');
                const names = await setupComparisonExperiments(n, runId, dashboard, recordMem);
                console.log(`  [setup] saved: ${names.join(', ')}`);
                await recordMem('after_setup');

                // 3. Clear any stale comparison state (mirrors multi-fixture-perf.tauri.spec.ts).
                await page.evaluate(() => {
                    localStorage.removeItem('comparison-storage');
                });

                // 4. Open comparison view + add all N experiments + measure UI-ready.
                const { ms: cmpReadyMs } = await timeStep('cmp_ready', async () => {
                    await recordMem('before_comparison_open');
                    await comparison.goto();
                    await comparison.expectLoaded();
                    await recordMem('after_comparison_open');
                    await page.evaluate(() => {
                        const store = (window as unknown as { __rheolab_comparison_store?: { setState: (s: { experiments: unknown[] }) => void } }).__rheolab_comparison_store;
                        if (store) store.setState({ experiments: [] });
                        localStorage.removeItem('comparison-storage');
                    });
                    await page.waitForTimeout(300);
                    for (let idx = 0; idx < n; idx++) {
                        await addExperimentByNameWithMemoryPhases(comparison, names[idx], idx + 1, recordMem);
                        await recordMem(`after_add_${idx + 1}`);
                    }
                    await comparison.expectChartVisible();
                    await comparison.expectCanvasPainted();
                    await recordMem('after_chart_canvas_painted');
                    const legendCount = await comparison.getLegendSeriesCount();
                    expect(legendCount).toBeGreaterThanOrEqual(n);
                    await recordMem('after_chart_visible');
                    await recordMem('after_chart_ready');
                });
                console.log(`  [L-CMP-${n}] cmp_ready=${cmpReadyMs} ms`);

                // 5. Measure PDF + XLSX exports.
                await recordMem('before_report_tab');
                await cmpReports.switchToReportTab();
                await cmpReports.expectLoaded();
                await cmpReports.expectExportButtonsEnabled();
                await recordMem('after_report_tab_open');

                let pdfMs: number | null = null;
                let xlsxMs: number | null = null;
                let pdfBytes: number | null = null;
                let xlsxBytes: number | null = null;
                let postExportCleanupHint: RendererCleanupHint | undefined;
                let skipped: ComparisonSmokeMeasurement['skipped'];
                let skipReason: string | undefined;
                const minExportBytes = reportPayloadMode === 'mocked' ? 4 : 4096;

                try {
                    await recordMem('before_pdf');
                    const { result: pdfInfo, ms } = await timeStep('pdf', async () => {
                        if (EXPORT_SAVE_MODE === 'direct') {
                            expect(directExportDir).toBeTruthy();
                            await clickComparisonExportAndWait(page, () => cmpReports.pdfButton.click(), 'pdf', 60_000);
                            return await assertDirectExportFile(directExportDir!, 'pdf', minExportBytes);
                        }
                        const pdfDownload = await cmpReports.downloadPdf(60_000);
                        return await cmpReports.assertDownload(pdfDownload, 'pdf', minExportBytes);
                    });
                    pdfMs = ms;
                    pdfBytes = pdfInfo.size;
                    console.log(`  [L-CMP-PDF-${n}] pdf=${pdfMs} ms bytes=${pdfBytes}`);
                    await recordMem('after_pdf');
                } catch (err) {
                    skipped = reportPayloadMode === 'mocked' ? 'mock-inactive' : 'error';
                    skipReason = `PDF download failed: ${err instanceof Error ? err.message : String(err)}`;
                    console.log(`  [skip pdf] ${skipReason}`);
                }

                try {
                    await recordMem('before_xlsx');
                    const { result: xlsxInfo, ms } = await timeStep('xlsx', async () => {
                        if (EXPORT_SAVE_MODE === 'direct') {
                            expect(directExportDir).toBeTruthy();
                            await clickComparisonExportAndWait(page, () => cmpReports.excelButton.click(), 'excel', 60_000);
                            return await assertDirectExportFile(directExportDir!, 'xlsx', minExportBytes);
                        }
                        const xlsxDownload = await cmpReports.downloadExcel(60_000);
                        return await cmpReports.assertDownload(xlsxDownload, 'xlsx', minExportBytes);
                    });
                    xlsxMs = ms;
                    xlsxBytes = xlsxInfo.size;
                    console.log(`  [L-CMP-XLSX-${n}] xlsx=${xlsxMs} ms bytes=${xlsxBytes}`);
                    await recordMem('after_xlsx');
                } catch (err) {
                    skipped = skipped ?? (reportPayloadMode === 'mocked' ? 'mock-inactive' : 'error');
                    skipReason = (skipReason ? `${skipReason}; ` : '') + `XLSX download failed: ${err instanceof Error ? err.message : String(err)}`;
                    console.log(`  [skip xlsx] ${skipReason}`);
                }

                if (MEMORY_STEPS_ENABLED) {
                    postExportCleanupHint = await requestRendererCleanupHint(page, `n${n}:after_exports`);
                    await recordMem('after_gc_hint');
                    await recordMem('after_export_gc_hint');
                }

                await recordMem('before_route_leave');
                await page.evaluate(() => {
                    const store = (window as unknown as { __rheolab_comparison_store?: { setState: (s: { experiments: unknown[] }) => void } }).__rheolab_comparison_store;
                    if (store) store.setState({ experiments: [] });
                    localStorage.removeItem('comparison-storage');
                });
                await recordMem('after_comparison_store_clear');
                await dashboard.goto();
                await recordMem('after_route_leave');
                await page.waitForTimeout(300);
                await recordMem('after_chart_unmount_settle');
                if (MEMORY_STEPS_ENABLED) {
                    await requestRendererCleanupHint(page, `n${n}:after_route_leave`);
                    await recordMem('after_second_gc_hint');
                }

                measurements.push({
                    n,
                    report_payload: reportPayloadMode,
                    export_save_mode: EXPORT_SAVE_MODE,
                    cmp_ready_ms: cmpReadyMs,
                    pdf_ms: pdfMs,
                    pdf_bytes: pdfBytes,
                    xlsx_ms: xlsxMs,
                    xlsx_bytes: xlsxBytes,
                    post_export_cleanup_hint: postExportCleanupHint,
                    ...(MEMORY_STEPS_ENABLED ? { memory_steps: memorySteps } : {}),
                    ...(skipped ? { skipped, skipReason } : {}),
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`  [error] N=${n}: ${msg}`);
                measurements.push({
                    n,
                    report_payload: reportPayloadMode,
                    export_save_mode: EXPORT_SAVE_MODE,
                    cmp_ready_ms: null,
                    pdf_ms: null,
                    pdf_bytes: null,
                    xlsx_ms: null,
                    xlsx_bytes: null,
                    ...(MEMORY_STEPS_ENABLED ? { memory_steps: memorySteps } : {}),
                    skipped: 'error',
                    skipReason: msg,
                });
            }
        }

        // 6. Write JSON sidecar.
        const report: ComparisonSmokeReport = {
            schema: 'rheolab.e2e.perf.comparison_smoke.v1',
            runId,
            label: 'native-by-ids',
            mode,
            generatedAt: new Date().toISOString(),
            platform: process.platform,
            license_cap: comparisonCap,
            memory_steps_enabled: MEMORY_STEPS_ENABLED,
            export_save_mode: EXPORT_SAVE_MODE,
            native_memory_file: process.env.TAURI_E2E_NATIVE_MEM_FILE ?? null,
            measurements,
        };

        await mkdir(OUTPUT_DIR, { recursive: true });
        const outPath = path.join(OUTPUT_DIR, `comparison-smoke-${runId}.json`);
        await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
        console.log(`\n[CmpSmoke] wrote ${outPath}`);

        // 7. Summary table on stdout for CI logs.
        console.log('\n# Comparison smoke baseline summary\n');
        console.log('| N | payload | cmp_ready_ms | pdf_ms | pdf_bytes | xlsx_ms | xlsx_bytes | status |');
        console.log('|---:|---|---:|---:|---:|---:|---:|---|');
        for (const m of measurements) {
            const status = m.skipped ? `SKIP (${m.skipped})` : 'OK';
            console.log(
                `| ${m.n} | ${m.report_payload} | ${m.cmp_ready_ms ?? '—'} | ${m.pdf_ms ?? '—'} | ${m.pdf_bytes ?? '—'} | ${m.xlsx_ms ?? '—'} | ${m.xlsx_bytes ?? '—'} | ${status} |`,
            );
        }

        // 8. Sanity assertion: the first requested in-cap N must produce a cmp_ready_ms number.
        // Skip-only runs such as COMPARISON_SMOKE_N=10 are valid cap-policy
        // sentinel smokes when every requested N is above the runtime cap.
        const firstMeasuredN = TARGET_FIXTURE_COUNTS.find((n) => n <= comparisonCap);
        if (firstMeasuredN === undefined) {
            expect(measurements).toHaveLength(TARGET_FIXTURE_COUNTS.length);
            expect(measurements.every((m) => m.skipped === 'license-cap')).toBe(true);
            return;
        }
        const baseline = measurements.find((m) => m.n === firstMeasuredN);
        expect(baseline).toBeTruthy();
        expect(baseline?.cmp_ready_ms).toBeGreaterThan(0);
    });
});
