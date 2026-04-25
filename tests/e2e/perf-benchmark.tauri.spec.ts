/**
 * Performance Benchmark — Tauri native mode
 *
 * Аналог perf-benchmark.spec.ts, но запускается против РЕАЛЬНОГО Tauri-приложения
 * через CDP. Анализ выполняется нативным Rust-кодом — analysisMs отражает
 * реальное время invoke + Rust-парсер, без WASM и без fake-mock данных.
 *
 * Сценарии:
 *   1. Idle heap + DOM nodes по маршрутам (Dashboard / Library / Comparison / Reports)
 *   2. Время нативного анализа и uPlot-инициализации для двух реальных фикстур
 *   3. 10 циклов навигации — детектирование утечек heap и DOM
 *
 * Запуск:
 *   npm run perf:benchmark:tauri
 *   cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:benchmark:tauri
 *
 * Prerequisite: cargo build (выполняется автоматически в globalSetup если нет бинарника).
 * Output: outputs/e2e/perf/benchmark-tauri-<timestamp>.json
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import type { Page } from '@playwright/test';
import { enableCdp, snap, linearSlope, type CdpSnap } from './cdp-helpers';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHANDLER_SST_63, GRACE_REPORT } from './fixtures';
import { ComparisonReportsPage } from './pages/comparison-reports.page';
import {
    appendPerfEntry, loadHistory, printComparison, getVersionInfo,
    type PerfEntry,
} from './perf-history';

// ─── Config ──────────────────────────────────────────────────────────────────

const NAV_CYCLES  = Number(process.env.RHEOLAB_BENCH_NAV_CYCLES ?? 10);
const OUTPUT_DIR  = path.resolve('outputs', 'e2e', 'perf');

// ─── Shared collectors for perf-history aggregation ─────────────────────────
const collected: {
    idleHeap: PerfEntry['idleHeap'];
    analysis: PerfEntry['analysis'];
    navLeak: PerfEntry['navLeak'] | null;
    reportGeneration: NonNullable<PerfEntry['reportGeneration']>;
} = {
    idleHeap: {},
    analysis: [],
    navLeak: null,
    reportGeneration: [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface PerfMark { name: string; duration: number }

async function getPerfMarks(page: Page): Promise<PerfMark[]> {
    return page.evaluate<PerfMark[]>(() => {
        const mon = (window as any).__perfMon;
        return mon ? mon.list() : [];
    });
}

async function clearPerfMarks(page: Page): Promise<void> {
    await page.evaluate(() => {
        const mon = (window as any).__perfMon;
        if (mon) mon.reset();
    });
}

async function navigateTo(page: Page, testId: string, urlPattern: RegExp): Promise<void> {
    await page.getByTestId(testId).first().click();
    await expect(page).toHaveURL(urlPattern, { timeout: 20_000 });
    await page.waitForLoadState('networkidle').catch(() => {/* timeout ok */});
}

// ─── Setup ───────────────────────────────────────────────────────────────────

setupBeforeEach(test);

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Idle heap + DOM nodes per route
// ─────────────────────────────────────────────────────────────────────────────
test.describe('[Perf/Tauri] Idle heap per route', () => {
    test.setTimeout(120_000);

    test('heap and DOM nodes at idle state — native Tauri', async ({ page, dashboard }) => {
        await dashboard.goto();
        await page.waitForTimeout(1_000);
        const cdp = await enableCdp(page);
        const runId = `${Date.now()}-tauri`;

        const routes = [
            { testId: 'DashboardNavButton',  urlPattern: /\/dashboard$/ },
            { testId: 'LibraryNavButton',     urlPattern: /\/library/   },
            { testId: 'ComparisonNavButton',  urlPattern: /\/comparison/ },
        ];

        const routeSnapshots: Record<string, CdpSnap> = {};

        for (const { testId, urlPattern } of routes) {
            await navigateTo(page, testId, urlPattern);
            await page.waitForTimeout(500);
            const s = await snap(cdp);
            const label = testId.replace('NavButton', '');
            routeSnapshots[label] = s;
            console.log(`[Bench/Tauri] ${label}: heap=${s.heapUsedMb} MB, nodes=${s.nodes}`);
        }

        const report = {
            scenario: 'idle-heap-tauri',
            runId,
            generatedAt: new Date().toISOString(),
            routeSnapshots,
        };
        await mkdir(OUTPUT_DIR, { recursive: true });
        await writeFile(
            path.join(OUTPUT_DIR, `idle-heap-tauri-${runId}.json`),
            JSON.stringify(report, null, 2), 'utf8',
        );

        // Collect for history
        for (const [label, s] of Object.entries(routeSnapshots)) {
            collected.idleHeap[label] = { heapMb: s.heapUsedMb, nodes: s.nodes };
        }

        for (const [label, s] of Object.entries(routeSnapshots)) {
            expect(s.heapUsedMb,  `${label}: heap should be < 300 MB`).toBeLessThan(300);
            expect(s.nodes,       `${label}: DOM nodes should be < 10 000`).toBeLessThan(10_000);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Real native analysis timing
// Fixture files → Tauri invoke → Rust parser → analysisMs is REAL
// ─────────────────────────────────────────────────────────────────────────────
test.describe('[Perf/Tauri] Native analysis timing', () => {
    test.setTimeout(300_000);

    test('WASM-free native analysis and uPlot init — real fixtures', async ({ page, dashboard }) => {
        await dashboard.goto();
        const cdp = await enableCdp(page);
        const runId = `${Date.now()}-tauri`;

        const fixtures = [
            { fixture: CHANDLER_SST_63, label: 'Chandler SST-63' },
            { fixture: GRACE_REPORT,    label: 'Grace Report'    },
        ];

        const results: Array<{
            fixture:      string;
            analysisMs:   number | null;
            uplotInitMs:  number | null;
            heapBeforeMb: number;
            heapAfterMb:  number;
            heapDeltaMb:  number;
            nodesDelta:   number;
        }> = [];

        for (const { fixture, label } of fixtures) {
            await clearPerfMarks(page);
            const snapBefore = await snap(cdp);

            await dashboard.uploadFile(fixture);
            await dashboard.waitForAnalysis(120_000);
            await page.waitForTimeout(1_000);

            const snapAfter = await snap(cdp);
            const marks     = await getPerfMarks(page);

            const analysisMark = marks.find(m => m.name === 'analysis');
            const uplotMark    = marks.find(m => m.name === 'uplot:init');

            const entry = {
                fixture:      label,
                analysisMs:   analysisMark ? Math.round(analysisMark.duration) : null,
                uplotInitMs:  uplotMark    ? Math.round(uplotMark.duration)    : null,
                heapBeforeMb: snapBefore.heapUsedMb,
                heapAfterMb:  snapAfter.heapUsedMb,
                heapDeltaMb:  Math.round((snapAfter.heapUsedMb - snapBefore.heapUsedMb) * 100) / 100,
                nodesDelta:   snapAfter.nodes - snapBefore.nodes,
            };
            results.push(entry);

            console.log(
                `[Bench/Tauri] ${label}: analysis=${entry.analysisMs ?? 'N/A'} ms, ` +
                `uplot=${entry.uplotInitMs ?? 'N/A'} ms, ` +
                `heap+${entry.heapDeltaMb} MB, nodes+${entry.nodesDelta}`,
            );

            // Reset for next fixture
            const resetLink = page.getByTestId('UploadCardResetLink');
            if (await resetLink.isVisible({ timeout: 1_000 }).catch(() => false)) {
                await resetLink.click();
                await page.waitForTimeout(300);
            }
        }

        const report = {
            scenario: 'analysis-timing-tauri',
            runId,
            generatedAt: new Date().toISOString(),
            results,
        };
        await mkdir(OUTPUT_DIR, { recursive: true });
        await writeFile(
            path.join(OUTPUT_DIR, `analysis-timing-tauri-${runId}.json`),
            JSON.stringify(report, null, 2), 'utf8',
        );

        // Collect for history
        collected.analysis = results.map(r => ({
            fixture: r.fixture,
            analysisMs: r.analysisMs,
            uplotMs: r.uplotInitMs,
            heapDeltaMb: r.heapDeltaMb,
        }));

        for (const entry of results) {
            if (entry.analysisMs !== null) {
                expect(entry.analysisMs,
                    `${entry.fixture}: native analysis should be < 10 s`).toBeLessThan(10_000);
            }
            if (entry.uplotInitMs !== null) {
                expect(entry.uplotInitMs,
                    `${entry.fixture}: uPlot init should be < 500 ms`).toBeLessThan(500);
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — Navigation roundtrip (leak detection)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('[Perf/Tauri] Navigation roundtrip — heap/node leak detection', () => {
    test.setTimeout(600_000);

    test(`${NAV_CYCLES} navigation cycles — heap and node growth`, async ({ page, dashboard }) => {
        await dashboard.goto();
        await page.waitForTimeout(500);
        const cdp  = await enableCdp(page);
        const runId = `${Date.now()}-tauri`;

        type Sample = CdpSnap & { cycle: number; timestamp: number };
        const samples: Sample[] = [];

        samples.push({ cycle: 0, timestamp: Date.now(), ...(await snap(cdp)) });

        const navPairs = [
            { to: 'LibraryNavButton',     toUrl: /\/library/    },
            { to: 'ComparisonNavButton',  toUrl: /\/comparison/ },
            { to: 'DashboardNavButton',   toUrl: /\/dashboard$/ },
        ];

        for (let cycle = 1; cycle <= NAV_CYCLES; cycle++) {
            for (const pair of navPairs) {
                await navigateTo(page, pair.to, pair.toUrl);
            }
            await page.waitForTimeout(400);
            samples.push({ cycle, timestamp: Date.now(), ...(await snap(cdp)) });
        }

        const baseline  = samples[0];
        const final     = samples[samples.length - 1];
        const heapArr   = samples.slice(1).map(s => s.heapUsedMb);
        const nodesArr  = samples.slice(1).map(s => s.nodes);
        const slope     = linearSlope(heapArr);
        const peakHeap  = Math.max(...heapArr);
        const nodesRatio = nodesArr[nodesArr.length - 1] / (nodesArr[0] || 1);

        console.log(
            `[Bench/Tauri] nav slope=${slope.toFixed(3)} MB/cycle  ` +
            `peak=${peakHeap.toFixed(1)} MB  ` +
            `nodesRatio=${nodesRatio.toFixed(2)}  ` +
            `finalHeap=${final.heapUsedMb} MB (baseline ${baseline.heapUsedMb} MB)`,
        );

        const report = {
            scenario: 'nav-leak-tauri',
            runId,
            generatedAt: new Date().toISOString(),
            cycles: NAV_CYCLES,
            baselineHeapMb: baseline.heapUsedMb,
            finalHeapMb:    final.heapUsedMb,
            peakHeapMb:     peakHeap,
            slope,
            nodesRatio,
            samples,
        };
        await mkdir(OUTPUT_DIR, { recursive: true });
        await writeFile(
            path.join(OUTPUT_DIR, `nav-leak-tauri-${runId}.json`),
            JSON.stringify(report, null, 2), 'utf8',
        );

        // Collect for history
        collected.navLeak = {
            cycles: NAV_CYCLES,
            slopeMbPerCycle: slope,
            peakHeapMb: peakHeap,
            nodesRatio,
            baselineHeapMb: baseline.heapUsedMb,
            finalHeapMb: final.heapUsedMb,
        };

        expect(slope,
            `Heap slope ${slope.toFixed(3)} MB/cycle > 3 → route-level leak`).toBeLessThan(3);
        expect(nodesRatio,
            `DOM nodes ratio ${nodesRatio.toFixed(2)}× > 2 → DOM not cleaning up`).toBeLessThan(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 — Report generation timing (single-exp + comparison)
//
// Gated behind FULL_EXPORT=1 because Typst compilation at debug opt-level
// takes 30–60 s per PDF.  On release builds it's significantly faster.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('[Perf/Tauri] Report generation timing', () => {
    test.skip(() => process.env.FULL_EXPORT !== '1', 'FULL_EXPORT=1 required for report generation benchmark');
    test.setTimeout(900_000);

    test('single-exp + comparison report generation — wall time, size, heap', async ({
        page, dashboard, reports, comparison,
    }) => {
        const cdp = await enableCdp(page);
        const fs = await import('fs');

        // ── 1. Upload + analyze fixture ──────────────────────────────────
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis(120_000);

        // ── 2. Single-experiment PDF ─────────────────────────────────────
        await reports.goto();
        await reports.expectPdfButtonVisible();
        {
            const snapBefore = await snap(cdp);
            const t0 = Date.now();
            const dl = await reports.downloadPdf(300_000);
            const wallMs = Date.now() - t0;
            const snapAfter = await snap(cdp);
            const filePath = await dl.path();
            const sizeBytes = filePath ? fs.statSync(filePath).size : 0;
            const heapDelta = Math.round((snapAfter.heapUsedMb - snapBefore.heapUsedMb) * 100) / 100;

            console.log(`[Bench/Tauri] Single-exp PDF: ${wallMs} ms, ${sizeBytes} bytes, heap+${heapDelta} MB`);
            collected.reportGeneration.push({ type: 'single-exp-pdf', wallMs, sizeBytes, heapDeltaMb: heapDelta });

            expect(sizeBytes, 'Single-exp PDF must be > 1 KB').toBeGreaterThan(1024);
            expect(heapDelta, 'Single-exp PDF leaked > 50 MB').toBeLessThan(50);
        }

        // ── 3. Single-experiment Excel ───────────────────────────────────
        {
            const snapBefore = await snap(cdp);
            const t0 = Date.now();
            const dl = await reports.downloadExcel(120_000);
            const wallMs = Date.now() - t0;
            const snapAfter = await snap(cdp);
            const filePath = await dl.path();
            const sizeBytes = filePath ? fs.statSync(filePath).size : 0;
            const heapDelta = Math.round((snapAfter.heapUsedMb - snapBefore.heapUsedMb) * 100) / 100;

            console.log(`[Bench/Tauri] Single-exp Excel: ${wallMs} ms, ${sizeBytes} bytes, heap+${heapDelta} MB`);
            collected.reportGeneration.push({ type: 'single-exp-excel', wallMs, sizeBytes, heapDeltaMb: heapDelta });

            expect(sizeBytes, 'Single-exp Excel must be > 1 KB').toBeGreaterThan(1024);
            expect(heapDelta, 'Single-exp Excel leaked > 50 MB').toBeLessThan(50);
        }

        // ── 4. Save first experiment, upload second, save ────────────────
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis(120_000);
        const exp1 = await dashboard.saveExperiment({ name: `Bench-PDF-1 ${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis(120_000);
        const exp2 = await dashboard.saveExperiment({ name: `Bench-PDF-2 ${Date.now()}` });

        // ── 5. Comparison setup ──────────────────────────────────────────
        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.addExperimentByName(exp1.name);
        await comparison.addExperimentByName(exp2.name);
        await comparison.expectChipCount(2);

        const cmpReports = new ComparisonReportsPage(page);
        await cmpReports.switchToReportTab();
        await cmpReports.expectExportButtonsEnabled();

        // ── 6. Comparison PDF ────────────────────────────────────────────
        {
            const snapBefore = await snap(cdp);
            const t0 = Date.now();
            const dl = await cmpReports.downloadPdf(300_000);
            const wallMs = Date.now() - t0;
            const snapAfter = await snap(cdp);
            const filePath = await dl.path();
            const sizeBytes = filePath ? fs.statSync(filePath).size : 0;
            const heapDelta = Math.round((snapAfter.heapUsedMb - snapBefore.heapUsedMb) * 100) / 100;

            console.log(`[Bench/Tauri] Comparison PDF: ${wallMs} ms, ${sizeBytes} bytes, heap+${heapDelta} MB`);
            collected.reportGeneration.push({ type: 'comparison-pdf', wallMs, sizeBytes, heapDeltaMb: heapDelta });

            expect(sizeBytes, 'Comparison PDF must be > 5 KB').toBeGreaterThan(5 * 1024);
            expect(heapDelta, 'Comparison PDF leaked > 50 MB').toBeLessThan(50);
        }

        // ── 7. Comparison Excel ──────────────────────────────────────────
        {
            const snapBefore = await snap(cdp);
            const t0 = Date.now();
            const dl = await cmpReports.downloadExcel(120_000);
            const wallMs = Date.now() - t0;
            const snapAfter = await snap(cdp);
            const filePath = await dl.path();
            const sizeBytes = filePath ? fs.statSync(filePath).size : 0;
            const heapDelta = Math.round((snapAfter.heapUsedMb - snapBefore.heapUsedMb) * 100) / 100;

            console.log(`[Bench/Tauri] Comparison Excel: ${wallMs} ms, ${sizeBytes} bytes, heap+${heapDelta} MB`);
            collected.reportGeneration.push({ type: 'comparison-excel', wallMs, sizeBytes, heapDeltaMb: heapDelta });

            expect(sizeBytes, 'Comparison Excel must be > 5 KB').toBeGreaterThan(5 * 1024);
            expect(heapDelta, 'Comparison Excel leaked > 50 MB').toBeLessThan(50);
        }

        // ── Summary table ────────────────────────────────────────────────
        console.log('\n── Report generation perf summary ──');
        console.table(collected.reportGeneration);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate — append to perf-history.jsonl and print comparison
// ─────────────────────────────────────────────────────────────────────────────
test.describe('[Perf/Tauri] History aggregation', () => {
    test('append run to perf-history.jsonl and compare with previous', async () => {
        const { version, gitSha } = await getVersionInfo();
        const history = await loadHistory();

        const entry: PerfEntry = {
            timestamp: new Date().toISOString(),
            version,
            gitSha,
            idleHeap: collected.idleHeap,
            analysis: collected.analysis,
            navLeak: collected.navLeak ?? {
                cycles: 0, slopeMbPerCycle: 0, peakHeapMb: 0,
                nodesRatio: 0, baselineHeapMb: 0, finalHeapMb: 0,
            },
            reportGeneration: collected.reportGeneration.length > 0
                ? collected.reportGeneration
                : undefined,
        };

        await appendPerfEntry(entry);
        printComparison(entry, history);

        console.log(`[Perf/Tauri] History now has ${history.length + 1} entries.`);
    });
});
