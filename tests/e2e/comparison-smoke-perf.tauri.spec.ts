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
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
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

// ─── Config ─────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve('outputs', 'e2e', 'perf');

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
    measurements: ComparisonSmokeMeasurement[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Wall-clock timer; returns elapsed ms. */
function timeStep<T>(_label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
    const t0 = Date.now();
    return fn().then((result) => ({ result, ms: Date.now() - t0 }));
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
        const measurements: ComparisonSmokeMeasurement[] = [];
        const cmpReports = new ComparisonReportsPage(page);

        const mode = await detectMockMode(page);
        const reportPayloadMode = mode === 'tauri-debug-mocked' ? 'mocked' : 'real';
        const comparisonCap = await readComparisonCap(page);
        console.log(`[CmpSmoke] mode=${mode} cap=${comparisonCap} runId=${runId}`);
        console.log(`[CmpSmoke] target counts=${TARGET_FIXTURE_COUNTS.join(', ')}`);

        for (const n of TARGET_FIXTURE_COUNTS) {
            console.log(`\n━━━ N=${n} ━━━`);

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
                const names = await setupComparisonExperiments(n, runId, dashboard);
                console.log(`  [setup] saved: ${names.join(', ')}`);

                // 3. Clear any stale comparison state (mirrors multi-fixture-perf.tauri.spec.ts).
                await page.evaluate(() => {
                    localStorage.removeItem('comparison-storage');
                });

                // 4. Open comparison view + add all N experiments + measure UI-ready.
                const { ms: cmpReadyMs } = await timeStep('cmp_ready', async () => {
                    await comparison.goto();
                    await comparison.expectLoaded();
                    await page.evaluate(() => {
                        const store = (window as unknown as { __rheolab_comparison_store?: { setState: (s: { experiments: unknown[] }) => void } }).__rheolab_comparison_store;
                        if (store) store.setState({ experiments: [] });
                        localStorage.removeItem('comparison-storage');
                    });
                    await page.waitForTimeout(300);
                    for (let idx = 0; idx < n; idx++) {
                        await comparison.addExperimentByName(names[idx]);
                        await comparison.expectChipCount(idx + 1);
                    }
                    await comparison.expectChartVisible();
                    await comparison.expectCanvasPainted();
                    const legendCount = await comparison.getLegendSeriesCount();
                    expect(legendCount).toBeGreaterThanOrEqual(n);
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
                    const { result: pdfDownload, ms } = await timeStep('pdf', () => {
                        return cmpReports.downloadPdf(60_000);
                    });
                    const pdfInfo = await cmpReports.assertDownload(pdfDownload, 'pdf', minExportBytes);
                    pdfMs = ms;
                    pdfBytes = pdfInfo.size;
                    console.log(`  [L-CMP-PDF-${n}] pdf=${pdfMs} ms bytes=${pdfBytes}`);
                } catch (err) {
                    skipped = reportPayloadMode === 'mocked' ? 'mock-inactive' : 'error';
                    skipReason = `PDF download failed: ${err instanceof Error ? err.message : String(err)}`;
                    console.log(`  [skip pdf] ${skipReason}`);
                }

                try {
                    const { result: xlsxDownload, ms } = await timeStep('xlsx', () => {
                        return cmpReports.downloadExcel(60_000);
                    });
                    const xlsxInfo = await cmpReports.assertDownload(xlsxDownload, 'xlsx', minExportBytes);
                    xlsxMs = ms;
                    xlsxBytes = xlsxInfo.size;
                    console.log(`  [L-CMP-XLSX-${n}] xlsx=${xlsxMs} ms bytes=${xlsxBytes}`);
                } catch (err) {
                    skipped = skipped ?? (reportPayloadMode === 'mocked' ? 'mock-inactive' : 'error');
                    skipReason = (skipReason ? `${skipReason}; ` : '') + `XLSX download failed: ${err instanceof Error ? err.message : String(err)}`;
                    console.log(`  [skip xlsx] ${skipReason}`);
                }

                measurements.push({
                    n,
                    report_payload: reportPayloadMode,
                    cmp_ready_ms: cmpReadyMs,
                    pdf_ms: pdfMs,
                    pdf_bytes: pdfBytes,
                    xlsx_ms: xlsxMs,
                    xlsx_bytes: xlsxBytes,
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
