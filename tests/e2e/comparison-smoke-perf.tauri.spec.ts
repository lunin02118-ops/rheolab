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
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { ComparisonReportsPage } from './pages';

setupBeforeEach(test);

const execFileAsync = promisify(execFile);

// ─── Config ─────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve('outputs', 'e2e', 'perf');
const MEMORY_STEPS_ENABLED = process.env.COMPARISON_SMOKE_MEMORY_STEPS === '1';

/**
 * Sizes the spec measures. Each is gated by the runtime license cap. Set
 * COMPARISON_SMOKE_N=3,5 to keep a local run focused while preserving the
 * default broad smoke matrix for scorecards.
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
    cmp_ready_ms: number | null;
    pdf_ms: number | null;
    pdf_bytes: number | null;
    xlsx_ms: number | null;
    xlsx_bytes: number | null;
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

interface NativeMemoryStep extends Partial<NativeMemorySnapshot> {
    phase: string;
    at_ms: number;
    source: 'direct-win32' | 'unavailable';
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

async function recordMemoryStep(
    steps: NativeMemoryStep[],
    runStartedAt: number,
    phase: string,
): Promise<void> {
    if (!MEMORY_STEPS_ENABLED) return;

    try {
        const snap = await snapshotNativeMemory();
        if (!snap) {
            steps.push({ phase, at_ms: Date.now() - runStartedAt, source: 'unavailable' });
            return;
        }
        const step: NativeMemoryStep = {
            phase,
            at_ms: Date.now() - runStartedAt,
            source: 'direct-win32',
            ...snap,
        };
        steps.push(step);
        console.log(
            `  [mem:${phase}] total=${step.total_rss_mb} MB renderer=${step.renderer_rss_mb} MB ` +
            `gpu=${step.gpu_rss_mb} MB tauri=${step.tauri_rss_mb} MB`,
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
        await dashboard.goto();
        await dashboard.uploadFile(fx);
        await dashboard.waitForAnalysis(90_000);
        const expName = `CmpSmoke_N${n}_${fx.displayName.replace(/\s+/g, '')}_${runId}_${i}`;
        const { name } = await dashboard.saveExperiment({ name: expName });
        names.push(name);
        await recordMem?.(`after_save_${i + 1}`);
    }
    return names;
}

// ─── Test ───────────────────────────────────────────────────────────────────

test.describe('[CmpSmoke/Tauri] Comparison-export baseline runner', () => {
    // 3 fixture sizes × (load + save + comparison + PDF + XLSX) = up to ~10 min
    // at N=10 once license-override lands. For now N=3 only takes ~3-4 min.
    test.setTimeout(15 * 60_000);

    test('comparison_smoke_baseline', async ({ page, dashboard, comparison }) => {
        const runId = `${Date.now()}-tauri`;
        const runStartedAt = Date.now();
        const measurements: ComparisonSmokeMeasurement[] = [];
        const cmpReports = new ComparisonReportsPage(page);

        const mode = await detectMockMode(page);
        const reportPayloadMode = mode === 'tauri-debug-mocked' ? 'mocked' : 'real';
        const comparisonCap = await readComparisonCap(page);
        console.log(`[CmpSmoke] mode=${mode} cap=${comparisonCap} runId=${runId}`);
        console.log(`[CmpSmoke] target counts=${TARGET_FIXTURE_COUNTS.join(', ')}`);
        if (MEMORY_STEPS_ENABLED) {
            console.log('[CmpSmoke] direct Win32 memory phase markers enabled');
        }

        for (const n of TARGET_FIXTURE_COUNTS) {
            console.log(`\n━━━ N=${n} ━━━`);
            const memorySteps: NativeMemoryStep[] = [];
            const recordMem = (phase: string) => recordMemoryStep(memorySteps, runStartedAt, `n${n}:${phase}`);

            // 1. License-cap gate — record skipped entry, continue.
            if (n > comparisonCap) {
                console.log(`  [skip] N=${n} > runtime comparison cap (${comparisonCap})`);
                measurements.push({
                    n,
                    report_payload: reportPayloadMode,
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
                        await comparison.addExperimentByName(names[idx]);
                        await comparison.expectChipCount(idx + 1);
                        await recordMem(`after_add_${idx + 1}`);
                    }
                    await comparison.expectChartVisible();
                    await comparison.expectCanvasPainted();
                    const legendCount = await comparison.getLegendSeriesCount();
                    expect(legendCount).toBeGreaterThanOrEqual(n);
                    await recordMem('after_chart_visible');
                });
                console.log(`  [L-CMP-${n}] cmp_ready=${cmpReadyMs} ms`);

                // 5. Measure PDF + XLSX exports.
                await cmpReports.switchToReportTab();
                await cmpReports.expectLoaded();
                await cmpReports.expectExportButtonsEnabled();

                let pdfMs: number | null = null;
                let xlsxMs: number | null = null;
                let pdfBytes: number | null = null;
                let xlsxBytes: number | null = null;
                let skipped: ComparisonSmokeMeasurement['skipped'];
                let skipReason: string | undefined;
                const minExportBytes = reportPayloadMode === 'mocked' ? 4 : 4096;

                try {
                    await recordMem('before_pdf');
                    const { result: pdfDownload, ms } = await timeStep('pdf', () => {
                        return cmpReports.downloadPdf(60_000);
                    });
                    const pdfInfo = await cmpReports.assertDownload(pdfDownload, 'pdf', minExportBytes);
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
                    const { result: xlsxDownload, ms } = await timeStep('xlsx', () => {
                        return cmpReports.downloadExcel(60_000);
                    });
                    const xlsxInfo = await cmpReports.assertDownload(xlsxDownload, 'xlsx', minExportBytes);
                    xlsxMs = ms;
                    xlsxBytes = xlsxInfo.size;
                    console.log(`  [L-CMP-XLSX-${n}] xlsx=${xlsxMs} ms bytes=${xlsxBytes}`);
                    await recordMem('after_xlsx');
                } catch (err) {
                    skipped = skipped ?? (reportPayloadMode === 'mocked' ? 'mock-inactive' : 'error');
                    skipReason = (skipReason ? `${skipReason}; ` : '') + `XLSX download failed: ${err instanceof Error ? err.message : String(err)}`;
                    console.log(`  [skip xlsx] ${skipReason}`);
                }

                await page.evaluate(() => {
                    const store = (window as unknown as { __rheolab_comparison_store?: { setState: (s: { experiments: unknown[] }) => void } }).__rheolab_comparison_store;
                    if (store) store.setState({ experiments: [] });
                    localStorage.removeItem('comparison-storage');
                });
                await dashboard.goto();
                await recordMem('after_route_leave');

                measurements.push({
                    n,
                    report_payload: reportPayloadMode,
                    cmp_ready_ms: cmpReadyMs,
                    pdf_ms: pdfMs,
                    pdf_bytes: pdfBytes,
                    xlsx_ms: xlsxMs,
                    xlsx_bytes: xlsxBytes,
                    ...(MEMORY_STEPS_ENABLED ? { memory_steps: memorySteps } : {}),
                    ...(skipped ? { skipped, skipReason } : {}),
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`  [error] N=${n}: ${msg}`);
                measurements.push({
                    n,
                    report_payload: reportPayloadMode,
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
        const firstMeasuredN = TARGET_FIXTURE_COUNTS.find((n) => n <= comparisonCap);
        const baseline = measurements.find((m) => m.n === firstMeasuredN);
        expect(baseline).toBeTruthy();
        expect(baseline?.cmp_ready_ms).toBeGreaterThan(0);
    });
});
