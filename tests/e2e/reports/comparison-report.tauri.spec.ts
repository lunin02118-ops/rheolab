/**
 * E2E — Real Native Comparison Report Export (no mocks)
 *
 * Runs against a LIVE Tauri app with the real Rust comparison report
 * pipeline (multi-experiment SVG chart + Typst PDF / rust_xlsxwriter Excel).
 *
 * Unlike `tests/e2e/reports/comparison-report.spec.ts` (browser mode with
 * IPC mocks returning 8 KB fake blobs), this spec exercises the full
 * `reports_generate_comparison_pdf_by_ids` /
 * `reports_generate_comparison_excel_by_ids` Tauri commands end-to-end —
 * same binary that ships to alpha users.
 *
 * Prerequisites:
 *   - Tauri app launched via globalSetup (playwright.tauri.config.ts)
 *   - CDP port accessible (default 9222)
 *   - `RHEOLAB_E2E_MOCK_REPORTS` **not** set (real generation)
 *
 * Run:
 *   $env:FULL_EXPORT = "1"
 *   $env:TAURI_BINARY_PATH = "src-tauri\target\release\rheolab-enterprise.exe"
 *   $env:TAURI_E2E_SKIP_BUILD = "1"
 *   npx playwright test --config playwright.tauri.config.ts `
 *     tests/e2e/reports/comparison-report.tauri.spec.ts
 *
 * Why `FULL_EXPORT=1` gate? Typst compilation at debug opt-level is slow
 * (~30–60 s per comparison PDF with 2 experiments); on release it is
 * noticeably faster but still expensive. Skipped in the default E2E run.
 */

import { test, expect } from '../base-test.tauri';
import type { Page } from '@playwright/test';
import { ComparisonReportsPage } from '../pages/comparison-reports.page';
import { CHANDLER_SST_63, GRACE_REPORT } from '../fixtures';
import { enableCdp, snap, fmtDelta, type CdpClient, type CdpSnap } from '../cdp-helpers';
import {
    deleteReportDownloadWithRetry,
    readReportDownloadBuffer,
} from '../report-download-cleanup';

// ─── Perf helpers ────────────────────────────────────────────────────────────

interface ComparisonReportPerfStep {
    id: string;
    heapMb: number;
    heapDeltaMb: number;
    nodes: number;
    nodesDelta: number;
    wallMs: number;
    cpuDeltaMs: number;
    taskDeltaMs: number;
}

async function recordPerfStep(
    id: string,
    prev: CdpSnap | null,
    wallStart: number,
    cdp: CdpClient,
): Promise<{ snap: CdpSnap; step: ComparisonReportPerfStep }> {
    const s = await snap(cdp);
    const step: ComparisonReportPerfStep = {
        id,
        heapMb: s.heapUsedMb,
        heapDeltaMb: prev ? Math.round((s.heapUsedMb - prev.heapUsedMb) * 100) / 100 : 0,
        nodes: s.nodes,
        nodesDelta: prev ? s.nodes - prev.nodes : 0,
        wallMs: Date.now() - wallStart,
        cpuDeltaMs: prev ? Math.round((s.processCpuMs - prev.processCpuMs) * 10) / 10 : 0,
        taskDeltaMs: prev ? Math.round((s.taskDurationMs - prev.taskDurationMs) * 10) / 10 : 0,
    };
    console.log(
        `  [perf] ${id}: heap=${step.heapMb} MB (${fmtDelta(step.heapDeltaMb, ' MB')}), ` +
        `nodes=${step.nodes} (${fmtDelta(step.nodesDelta)}), ` +
        `wall=${step.wallMs} ms, cpu=${fmtDelta(step.cpuDeltaMs, ' ms')}, ` +
        `task=${fmtDelta(step.taskDeltaMs, ' ms')}`,
    );
    return { snap: s, step };
}

/**
 * Reset the Zustand comparison store between tests — Tauri reuses a single
 * WebView2 page, so persisted state survives across `test()` cases unless
 * we explicitly clear it before re-populating.
 */
async function resetComparisonStore(page: Page): Promise<void> {
    await page.evaluate(() => {
        localStorage.removeItem('comparison-storage');
        const store = (window as any).__rheolab_comparison_store;
        if (store) {
            store.setState({ experiments: [] });
            console.log('[E2E] Comparison store force-cleared');
        }
    });
    // Allow React to flush the state reset.
    await page.waitForTimeout(300);
}

// Real Typst/Excel generation — gate with FULL_EXPORT=1.
test.skip(() => process.env.FULL_EXPORT !== '1', 'FULL_EXPORT=1 required for real native comparison export');

// Each test may take several minutes (2× save + 2× analysis + Typst compile).
test.setTimeout(900_000);

/**
 * Setup — navigate to app, inject auth/licensing/dialog mocks (but NOT
 * reports), then allow the real Rust IPC to handle
 * `reports_generate_comparison_*_by_ids` commands.
 */
test.beforeEach(async ({ page }) => {
    // Wait for Tauri WebView2 to land on the real app origin — CDP connects
    // sometimes before the shell has finished navigating from about:blank.
    const deadline = Date.now() + 60_000;
    let ready = false;
    while (!ready && Date.now() < deadline) {
        const url = page.url();
        if (url.includes('tauri.localhost') || url.includes('localhost:')) {
            ready = true;
            break;
        }
        await page.waitForTimeout(500);
    }
    if (!ready) {
        throw new Error(`[comparison-report.tauri] Tauri app did not navigate to tauri.localhost within 60s (url=${page.url()})`);
    }
    await page.waitForLoadState('domcontentloaded');

    // Skip native save-dialog prompts during download — Playwright intercepts.
    await page.evaluate((token: string) => {
        try {
            localStorage.setItem('rheolab_session_token', token);
            localStorage.removeItem('comparison-storage');
            sessionStorage.setItem('__e2e_skip_dialogs', '1');
        } catch {
            // Storage can be unavailable on about:blank — caller will retry.
        }
    }, 'tauri-e2e-session-token');

    // IPC Proxy: mock only auth/licensing/dialog; let reports + fixtures + analysis
    // + experiments go through to the real Rust backend.
    await page.evaluate(() => {
        const internals: any = (window as any).__TAURI_INTERNALS__;
        if (!internals || internals.__e2eProxy) return;

        const proxy = new Proxy(internals, {
            get(target: any, prop: string | symbol) {
                if (prop === '__e2eProxy') return true;
                if (prop !== 'invoke') return target[prop];

                return async function realCompInvoke(...args: any[]) {
                    const [cmd] = args;
                    const user = {
                        id: 'tauri-e2e-admin', name: 'E2E Admin', email: 'admin',
                        role: 'admin', isActive: true, laboratoryId: null,
                    };
                    const devLicense = {
                        status: 'active', source: 'key',
                        features: {
                            maxExperiments: -1, maxComparisonExperiments: 10,
                            calibrationAnalysis: true, calibrationParsing: true,
                            comparison: true, exportPdf: true, exportExcel: true,
                            aiParsing: true, watermark: false,
                            chandler5550Support: true, bslR1Support: true,
                        },
                        key: 'e2e-key', licenseType: 'developer',
                        customerName: 'E2E',
                        expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(),
                        daysRemaining: 365, experimentsRemaining: -1,
                        message: null, showWarning: false,
                    };

                    if (cmd === 'auth_session') return { valid: true, user };
                    if (cmd === 'auth_sign_in') return { success: true, sessionToken: 'tauri-e2e-session-token', user };
                    if (cmd === 'auth_sign_out') return undefined;
                    if (cmd === 'licensing_check' || cmd === 'licensing_get_status') return devLicense;
                    if (cmd === 'licensing_activate_full') return { ...devLicense, message: 'Activated' };
                    if (cmd === 'licensing_can_save') return true;
                    if (cmd === 'licensing_register_experiment') return { ...devLicense, showWarning: false };
                    if (cmd === 'licensing_machine_id') return 'tauri-e2e-machine';
                    if (cmd === 'licensing_was_ever_licensed') return true;
                    if (cmd === 'api_keys_check_active') return { isValid: true, provider: 'groq', key: 'e2e-stub' };
                    if (cmd === 'api_keys_list') return [];
                    if (cmd === 'plugin:dialog|save' || cmd === 'plugin:dialog|open' ||
                        cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return null;

                    // Everything else (experiments_*, reports_*, analysis_*, fixtures_*) hits real Rust.
                    return target.invoke(...args);
                };
            },
        });

        try {
            Object.defineProperty(window, '__TAURI_INTERNALS__', {
                configurable: true, enumerable: true, writable: true, value: proxy,
            });
        } catch {
            // No fallback — real export requires proxy install.
        }
    });

    // Do NOT call page.goto('https://tauri.localhost/') — the release Tauri
    // WebView2 treats a direct goto as a fresh navigation and may reject it
    // with ERR_CONNECTION_REFUSED because the internal asset protocol is
    // already active. We are already on the right origin at this point.
});

/**
 * Prepare two saved experiments + add both to Comparison + open the new
 * Report sub-tab. Records per-step CDP perf metrics along the way so the
 * test exercises AND measures the new feature surface end-to-end.
 */
async function setupComparisonWithTwoExperiments(
    page: Page,
    dashboard: any,
    comparison: any,
    namePrefix: string,
): Promise<{ reports: ComparisonReportsPage; cdp: CdpClient; steps: ComparisonReportPerfStep[]; lastSnap: CdpSnap }> {
    const cdp = await enableCdp(page);
    const steps: ComparisonReportPerfStep[] = [];
    let prev: CdpSnap | null = null;

    // ── 1. Initial baseline on dashboard ────────────────────────────────
    await dashboard.goto();
    {
        const t0 = Date.now();
        const { snap: s, step } = await recordPerfStep('initial_dashboard', prev, t0, cdp);
        prev = s;
        steps.push(step);
    }

    // ── 2. Upload + analyze experiment #1 ───────────────────────────────
    {
        const t0 = Date.now();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        const { snap: s, step } = await recordPerfStep('upload_chandler_sst', prev, t0, cdp);
        prev = s;
        steps.push(step);
    }
    const exp1 = await dashboard.saveExperiment({ name: `${namePrefix}-1 ${Date.now()}` });

    // ── 3. Upload + analyze experiment #2 ───────────────────────────────
    await dashboard.goto();
    {
        const t0 = Date.now();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        const { snap: s, step } = await recordPerfStep('upload_grace_report', prev, t0, cdp);
        prev = s;
        steps.push(step);
    }
    const exp2 = await dashboard.saveExperiment({ name: `${namePrefix}-2 ${Date.now()}` });

    // ── 4. Navigate to Comparison view + add both experiments ───────────
    await comparison.goto();
    await resetComparisonStore(page);
    await comparison.expectLoaded();
    {
        const t0 = Date.now();
        await comparison.addExperimentByName(exp1.name);
        await comparison.addExperimentByName(exp2.name);
        await comparison.expectChipCount(2);
        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();
        const { snap: s, step } = await recordPerfStep('comparison_chart_ready', prev, t0, cdp);
        prev = s;
        steps.push(step);
    }

    // ── 5. Switch to NEW Report sub-tab (feature under test) ────────────
    const reports = new ComparisonReportsPage(page);
    {
        const t0 = Date.now();
        await reports.switchToReportTab();
        await reports.expectLoaded();
        await reports.expectExportButtonsEnabled();
        const { snap: s, step } = await recordPerfStep('report_sub_tab_opened', prev, t0, cdp);
        prev = s;
        steps.push(step);
    }

    return { reports, cdp, steps, lastSnap: prev! };
}

test.describe('Real Native Comparison Report — feature + perf on new sub-tab', () => {
    test('PDF generation + perf metrics on Comparison → Report sub-tab', async ({
        page, dashboard, comparison,
    }) => {
        const { reports, cdp, steps } = await setupComparisonWithTwoExperiments(
            page, dashboard, comparison, 'Comp-E2E-PDF',
        );
        let prev = await snap(cdp);

        // ── 6. Trigger real Rust PDF generation (no mocks) ────────────────
        console.log('\n── Generating comparison PDF via real Rust backend ──');
        const t0 = Date.now();
        const download = await reports.downloadPdf(180_000);
        const { snap: afterPdf, step: pdfStep } = await recordPerfStep('pdf_generated', prev, t0, cdp);
        prev = afterPdf;
        steps.push(pdfStep);

        const { buffer, filePath, filename } = await readReportDownloadBuffer(download, 'comparison PDF');
        try {
            console.log(`[comparison-report/tauri] PDF: ${buffer.length} bytes → ${filename}`);

            // Real PDF must exceed the 8 KB web-mode mock and match magic bytes.
            expect(buffer.length).toBeGreaterThan(5 * 1024);
            expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
            expect(filename).toMatch(/^comparison-report_.*\.pdf$/i);

            // Heap must not balloon after PDF export (regression guard).
            expect(pdfStep.heapDeltaMb, 'PDF generation leaked > 30 MB').toBeLessThan(30);
        } finally {
            await deleteReportDownloadWithRetry(download, 'comparison PDF', { filePath });
        }

        console.log('\n── Perf summary (PDF flow) ──');
        console.table(steps);
    });

    test('Excel generation + perf metrics on Comparison → Report sub-tab', async ({
        page, dashboard, comparison,
    }) => {
        const { reports, cdp, steps } = await setupComparisonWithTwoExperiments(
            page, dashboard, comparison, 'Comp-E2E-XLSX',
        );
        let prev = await snap(cdp);

        console.log('\n── Generating comparison XLSX via real Rust backend ──');
        const t0 = Date.now();
        const download = await reports.downloadExcel(120_000);
        const { snap: afterXlsx, step: xlsxStep } = await recordPerfStep('xlsx_generated', prev, t0, cdp);
        prev = afterXlsx;
        steps.push(xlsxStep);

        const { buffer, filePath, filename } = await readReportDownloadBuffer(download, 'comparison XLSX');
        try {
            console.log(`[comparison-report/tauri] XLSX: ${buffer.length} bytes → ${filename}`);

            expect(buffer.length).toBeGreaterThan(5 * 1024);
            expect(buffer.slice(0, 2).toString('ascii')).toBe('PK');
            expect(filename).toMatch(/^comparison-report_.*\.xlsx$/i);

            expect(xlsxStep.heapDeltaMb, 'XLSX generation leaked > 30 MB').toBeLessThan(30);
        } finally {
            await deleteReportDownloadWithRetry(download, 'comparison XLSX', { filePath });
        }

        console.log('\n── Perf summary (XLSX flow) ──');
        console.table(steps);
    });

    test('UI toggles + language switch on Comparison → Report sub-tab', async ({
        page, dashboard, comparison,
    }) => {
        const { reports, cdp } = await setupComparisonWithTwoExperiments(
            page, dashboard, comparison, 'Comp-E2E-UI',
        );

        // ── Verify all NEW section-toggles exist + are interactive ─────────
        await expect(reports.calibrationToggle, 'Calibration toggle missing').toBeVisible();
        await expect(reports.rawDataToggle, 'Raw-data toggle missing').toBeVisible();
        await expect(reports.recipeToggle, 'Recipe toggle missing').toBeVisible();
        await expect(reports.waterAnalysisToggle, 'Water-analysis toggle missing').toBeVisible();
        await expect(reports.rheologyToggle, 'Rheology toggle missing').toBeVisible();

        // ── Verify default toggle states ───────────────────────────────────
        expect(await reports.calibrationToggle.getAttribute('data-state')).toBe('off');
        expect(await reports.rawDataToggle.getAttribute('data-state')).toBe('off');
        expect(await reports.recipeToggle.getAttribute('data-state')).toBe('on');
        expect(await reports.waterAnalysisToggle.getAttribute('data-state')).toBe('off');
        expect(await reports.rheologyToggle.getAttribute('data-state')).toBe('on');

        // ── Flip each toggle and confirm aria-checked actually flips ───────
        const toggles: Array<[string, typeof reports.calibrationToggle]> = [
            ['calibration', reports.calibrationToggle],
            ['rawData', reports.rawDataToggle],
            ['recipe', reports.recipeToggle],
            ['waterAnalysis', reports.waterAnalysisToggle],
            ['rheology', reports.rheologyToggle],
        ];

        for (const [label, locator] of toggles) {
            const before = await locator.getAttribute('aria-checked');
            await locator.click();
            // Small debounce — Radix Switch flips synchronously but give React a tick.
            await page.waitForTimeout(150);
            const after = await locator.getAttribute('aria-checked');
            expect(
                after,
                `${label} toggle did not change aria-checked (was "${before}", still "${after}")`,
            ).not.toBe(before);
            console.log(`  ✓ Toggle "${label}" flipped: ${before} → ${after}`);
        }

        // ── Language switch (RU → EN → RU) + perf check ────────────────────
        const prev = await snap(cdp);
        const t0 = Date.now();
        await reports.selectLanguage('en');
        await page.waitForTimeout(200);
        await reports.selectLanguage('ru');
        await page.waitForTimeout(200);
        const { step } = await recordPerfStep('language_switch_ru_en_ru', prev, t0, cdp);

        // Two language flips should be near-instant — well under 2 s wall time.
        expect(step.wallMs, 'Language switch is unexpectedly slow').toBeLessThan(2000);
        expect(step.heapDeltaMb, 'Language switch leaks heap').toBeLessThan(5);

        // Export buttons must still be enabled after all the UI fiddling.
        await reports.expectExportButtonsEnabled();
    });
});
