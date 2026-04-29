/**
 * Comparison Smoke Performance Spec — Tauri native mode (Sprint 2 / S2-L4, commit #4).
 *
 * Records baseline numbers for `L-CMP-N`, `L-CMP-PDF-N`, and `L-CMP-XLSX-N`
 * budgets in `BUDGETS.md` for the comparison-export flow. Runs against the
 * **current TS-assembly path** (legacy `reports_generate_comparison_pdf`
 * IPC); a follow-up Sprint 2 commit (#12, S2-3) re-runs against the native
 * `reports_generate_comparison_*_by_ids` path and produces the A/B report.
 *
 * What it measures, per fixture-count N:
 *   1. **L-CMP-N** — wall_ms from "open Comparison view" to "chart canvas
 *      painted with N legend entries" (perceived UI-ready latency).
 *   2. **L-CMP-PDF-N** — wall_ms for the comparison PDF download (button
 *      click → `downloadPdf` resolves).
 *   3. **L-CMP-XLSX-N** — wall_ms for the comparison XLSX download.
 *
 * Output sidecar at `outputs/e2e/perf/comparison-smoke-<runId>.json` with
 * the schema `rheolab.e2e.perf.comparison_smoke.v1`. Sprint 2 / S2-3 will
 * diff two such sidecars to produce the validation report.
 *
 * Prerequisites:
 * - Tauri build available (debug or release). Debug uses report mocks
 *   (see `base-test.tauri.ts`); release runs real Typst/XLSX. Recorded
 *   `mode` field disambiguates the two so future readers know which it is.
 * - Demo license caps `maxComparisonExperiments` at 3. **N=5 and N=10 are
 *   currently SKIPPED with an explicit `skipped: 'license-cap'` JSON entry.**
 *   A follow-up patch (license-feature override helper) will unlock those
 *   sizes; the spec is written so adding the override is a single-line
 *   change in `setupComparisonExperiments`.
 *
 * Run:
 *   npm run perf:comparison:tauri
 *   # or with a specific N (still capped at 3 until license-override lands):
 *   COMPARISON_SMOKE_N=3 npx playwright test tests/e2e/comparison-smoke-perf.tauri.spec.ts \
 *     --config playwright.tauri.config.ts
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
 * Sizes the spec measures. Each is gated by license cap; only N=3 currently
 * runs end-to-end without a license override. N=5 and N=10 are recorded as
 * skipped in the JSON sidecar so consumers (S2-3 A/B report) can see the gap
 * explicitly instead of inferring it from absent fields.
 */
const TARGET_FIXTURE_COUNTS = [3, 5, 10] as const;

/**
 * Demo-license cap on `maxComparisonExperiments`. Mirrors the runtime check
 * in the existing `multi-fixture-perf.tauri.spec.ts` (line 285 there sets
 * CMP_FIXTURES_COUNT = 3 with the same comment).
 */
const DEMO_LICENSE_CMP_CAP = 3;

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
    cmp_ready_ms: number | null;
    pdf_ms: number | null;
    xlsx_ms: number | null;
    skipped?: 'license-cap' | 'mock-inactive' | 'error';
    skipReason?: string;
}

interface ComparisonSmokeReport {
    schema: 'rheolab.e2e.perf.comparison_smoke.v1';
    runId: string;
    label: string; // 'TS-assembly' (current) | 'native-by-ids' (post-S2-1)
    mode: 'tauri-debug-mocked' | 'tauri-release-real';
    generatedAt: string;
    platform: string;
    license_cap_assumed: number;
    measurements: ComparisonSmokeMeasurement[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Wall-clock timer; returns elapsed ms. */
function timeStep<T>(_label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
    const t0 = Date.now();
    return fn().then((result) => ({ result, ms: Date.now() - t0 }));
}

/**
 * Ask the page whether `reports_generate_comparison_pdf` IPC is mocked.
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
        const expName = `CmpSmoke_${fx.displayName.replace(/\s+/g, '')}_${runId}_${i}`;
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
        console.log(`[CmpSmoke] mode=${mode} runId=${runId}`);

        for (const n of TARGET_FIXTURE_COUNTS) {
            console.log(`\n━━━ N=${n} ━━━`);

            // 1. License-cap gate — record skipped entry, continue.
            if (n > DEMO_LICENSE_CMP_CAP) {
                console.log(`  [skip] N=${n} > demo license cap (${DEMO_LICENSE_CMP_CAP})`);
                measurements.push({
                    n,
                    cmp_ready_ms: null,
                    pdf_ms: null,
                    xlsx_ms: null,
                    skipped: 'license-cap',
                    skipReason: `demo license caps maxComparisonExperiments at ${DEMO_LICENSE_CMP_CAP}; license-feature override helper TBD`,
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
                        await comparison.openSelector();
                        await comparison.addExperimentByIndex(idx);
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
                let skipped: ComparisonSmokeMeasurement['skipped'];
                let skipReason: string | undefined;

                try {
                    const { result: pdfDownload, ms } = await timeStep('pdf', async () => {
                        return cmpReports.downloadPdf(60_000);
                    });
                    pdfMs = ms;
                    await cmpReports.assertDownload(pdfDownload, 'pdf');
                    console.log(`  [L-CMP-PDF-${n}] pdf=${pdfMs} ms`);
                } catch (err) {
                    skipped = 'mock-inactive';
                    skipReason = `PDF download failed: ${err instanceof Error ? err.message : String(err)}`;
                    console.log(`  [skip pdf] ${skipReason}`);
                }

                try {
                    const { result: xlsxDownload, ms } = await timeStep('xlsx', async () => {
                        return cmpReports.downloadExcel(60_000);
                    });
                    xlsxMs = ms;
                    await cmpReports.assertDownload(xlsxDownload, 'xlsx');
                    console.log(`  [L-CMP-XLSX-${n}] xlsx=${xlsxMs} ms`);
                } catch (err) {
                    skipped = skipped ?? 'mock-inactive';
                    skipReason = (skipReason ? `${skipReason}; ` : '') + `XLSX download failed: ${err instanceof Error ? err.message : String(err)}`;
                    console.log(`  [skip xlsx] ${skipReason}`);
                }

                measurements.push({
                    n,
                    cmp_ready_ms: cmpReadyMs,
                    pdf_ms: pdfMs,
                    xlsx_ms: xlsxMs,
                    ...(skipped ? { skipped, skipReason } : {}),
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.log(`  [error] N=${n}: ${msg}`);
                measurements.push({
                    n,
                    cmp_ready_ms: null,
                    pdf_ms: null,
                    xlsx_ms: null,
                    skipped: 'error',
                    skipReason: msg,
                });
            }
        }

        // 6. Write JSON sidecar.
        const report: ComparisonSmokeReport = {
            schema: 'rheolab.e2e.perf.comparison_smoke.v1',
            runId,
            label: 'TS-assembly', // post-S2-1: re-run with label='native-by-ids' for the A/B
            mode,
            generatedAt: new Date().toISOString(),
            platform: process.platform,
            license_cap_assumed: DEMO_LICENSE_CMP_CAP,
            measurements,
        };

        await mkdir(OUTPUT_DIR, { recursive: true });
        const outPath = path.join(OUTPUT_DIR, `comparison-smoke-${runId}.json`);
        await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
        console.log(`\n[CmpSmoke] wrote ${outPath}`);

        // 7. Summary table on stdout for CI logs.
        console.log('\n# Comparison smoke baseline summary\n');
        console.log('| N | cmp_ready_ms | pdf_ms | xlsx_ms | status |');
        console.log('|---:|---:|---:|---:|---|');
        for (const m of measurements) {
            const status = m.skipped ? `SKIP (${m.skipped})` : 'OK';
            console.log(
                `| ${m.n} | ${m.cmp_ready_ms ?? '—'} | ${m.pdf_ms ?? '—'} | ${m.xlsx_ms ?? '—'} | ${status} |`,
            );
        }

        // 8. Sanity assertion: at least N=3 must produce a cmp_ready_ms number.
        const baseline = measurements.find((m) => m.n === 3);
        expect(baseline).toBeTruthy();
        expect(baseline?.cmp_ready_ms).toBeGreaterThan(0);
    });
});
