/**
 * Performance Benchmark Suite
 *
 * Measures key performance indicators across the application:
 *  1. JS Heap + DOM nodes at idle state per route
 *  2. Analysis pipeline: WASM execution time (from performance.mark)
 *  3. uPlot chart initialisation time
 *  4. Navigation roundtrip — heap / node leak detection (10 cycles)
 *  5. CDP metrics: layout/style-recalc count and duration per scenario
 *
 * Run with:
 *   npx playwright test --config playwright.benchmark.config.ts
 *   npm run perf:benchmark
 *
 * Output: outputs/e2e/perf/benchmark-<timestamp>.json
 *
 * CDP Performance metrics reference:
 *   JSHeapUsedSize, JSHeapTotalSize, Nodes, Documents,
 *   LayoutCount, RecalcStyleCount, LayoutDuration, RecalcStyleDuration, ScriptDuration
 */

import { test, expect, setupBeforeEach } from './base-test';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHANDLER_SST_63, GRACE_REPORT } from './fixtures';

// ─── Config ────────────────────────────────────────────────────────────────
const NAV_CYCLES = Number(process.env.RHEOLAB_BENCH_NAV_CYCLES ?? 10);
const OUTPUT_DIR = path.resolve('outputs', 'e2e', 'perf');

// ─── Types ──────────────────────────────────────────────────────────────────
type CdpClient = {
    send(cmd: 'Performance.enable'): Promise<void>;
    send(cmd: 'Performance.getMetrics'): Promise<{ metrics: Array<{ name: string; value: number }> }>;
};

interface CdpSnapshot {
    heapUsedMb: number;
    heapTotalMb: number;
    nodes: number;
    layoutCount: number;
    recalcStyleCount: number;
    layoutDurationMs: number;
    recalcStyleDurationMs: number;
    scriptDurationMs: number;
}

interface PerfMeasureEntry {
    name: string;
    duration: number;
    startTime: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function enableCdp(page: Page): Promise<CdpClient> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    return cdp as unknown as CdpClient;
}

async function snapshot(cdp: CdpClient): Promise<CdpSnapshot> {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = new Map<string, number>(metrics.map(x => [x.name, x.value]));
    const mb = (key: string) => (m.get(key) ?? 0) / (1024 * 1024);
    const ms = (key: string) => Math.round(((m.get(key) ?? 0) * 1000) * 100) / 100;
    return {
        heapUsedMb:          Math.round(mb('JSHeapUsedSize') * 100) / 100,
        heapTotalMb:         Math.round(mb('JSHeapTotalSize') * 100) / 100,
        nodes:               m.get('Nodes') ?? 0,
        layoutCount:         m.get('LayoutCount') ?? 0,
        recalcStyleCount:    m.get('RecalcStyleCount') ?? 0,
        layoutDurationMs:    ms('LayoutDuration'),
        recalcStyleDurationMs: ms('RecalcStyleDuration'),
        scriptDurationMs:    ms('ScriptDuration'),
    };
}

async function getPerfMarks(page: Page): Promise<PerfMeasureEntry[]> {
    return page.evaluate<PerfMeasureEntry[]>(() => {
         
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

async function navigateTo(page: Page, testId: string, expectedUrlPattern: RegExp): Promise<number> {
    const t0 = Date.now();
    await page.getByTestId(testId).first().click();
    await expect(page).toHaveURL(expectedUrlPattern, { timeout: 15_000 });
    await page.waitForLoadState('networkidle').catch(() => {/* timeout ok */});
    return Date.now() - t0;
}

async function dismissDialogs(page: Page): Promise<void> {
    for (let i = 0; i < 3; i++) {
        const btn = page.getByRole('button', { name: /Понятно|OK|Close/i }).first();
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
            await btn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(200);
        } else break;
    }
}

// ─── Setup ──────────────────────────────────────────────────────────────────
setupBeforeEach(test);

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Idle Heap & DOM per Route
// ─────────────────────────────────────────────────────────────────────────────
test.describe('[Perf] Idle heap & DOM per route', () => {
    test.setTimeout(120_000);

    test('measures JS heap and DOM nodes on each idle page', async ({ page }) => {
        await dismissDialogs(page);
        const cdp = await enableCdp(page);
        const runId = Date.now().toString();

        const routes = [
            { testId: 'DashboardNavButton',   url: /\/dashboard$/,            label: 'Analysis'   },
            { testId: 'LibraryNavButton',      url: /\/dashboard\/library/,   label: 'Library'    },
            { testId: 'ComparisonNavButton',   url: /\/dashboard\/comparison/, label: 'Comparison' },
            { testId: 'ReportsNavButton',      url: /\/dashboard\/reports/,   label: 'Reports'    },
        ];

        const routeSnapshots: Record<string, CdpSnapshot & { navDurationMs: number }> = {};

        for (const route of routes) {
            const navMs = await navigateTo(page, route.testId, route.url);
            // Let React finish rendering
            await page.waitForTimeout(800);
            const snap = await snapshot(cdp);
            routeSnapshots[route.label] = { ...snap, navDurationMs: navMs };
            console.log(`[Bench] ${route.label}: heap=${snap.heapUsedMb} MB, nodes=${snap.nodes}, nav=${navMs} ms`);
        }

        const report = {
            scenario: 'idle-heap-per-route',
            runId,
            generatedAt: new Date().toISOString(),
            results: routeSnapshots,
        };

        await mkdir(OUTPUT_DIR, { recursive: true });
        await writeFile(
            path.join(OUTPUT_DIR, `idle-heap-${runId}.json`),
            JSON.stringify(report, null, 2), 'utf8',
        );

        // Soft assertions — warn rather than fail, threshold is generous
        for (const [label, snap] of Object.entries(routeSnapshots)) {
            expect(snap.heapUsedMb, `${label}: heap should be < 300 MB`).toBeLessThan(300);
            expect(snap.nodes, `${label}: DOM nodes should be < 10000`).toBeLessThan(10_000);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Analysis Pipeline & Chart Init Timing
// ─────────────────────────────────────────────────────────────────────────────
test.describe('[Perf] Analysis pipeline & chart timing', () => {
    test.setTimeout(180_000);

    test('measures WASM analysis and uPlot init time for two fixtures', async ({ page, dashboard }) => {
        const isFakeParse = !!process.env.RHEOLAB_E2E_FAKE_PARSE;
        if (isFakeParse) {
            console.log(
                '[Bench] FAKE-PARSE mode — analysisMs will be null (no Tauri binary).\n' +
                '        Real native analysis timing: npm run perf:benchmark:tauri',
            );
        }

        await dismissDialogs(page);
        const cdp = await enableCdp(page);
        const runId = Date.now().toString();
        const results: Array<{
            fixture: string;
            analysisMs: number | null;
            uplotInitMs: number | null;
            heapBeforeMb: number;
            heapAfterMb: number;
            heapDeltaMb: number;
            nodesDelta: number;
        }> = [];

        const fixtures = [
            { fixture: CHANDLER_SST_63, label: 'Chandler SST-63' },
            { fixture: GRACE_REPORT,    label: 'Grace Report'    },
        ];

        for (const { fixture, label } of fixtures) {
            await clearPerfMarks(page);
            const snapBefore = await snapshot(cdp);

            await dashboard.uploadFile(fixture);
            await dashboard.waitForAnalysis(90_000);

            // Give chart time to initialize
            await page.waitForTimeout(1000);
            const snapAfter = await snapshot(cdp);

            const marks = await getPerfMarks(page);
            const analysisMark = marks.find(m => m.name === 'analysis');
            const uplotMark    = marks.find(m => m.name === 'uplot:init');

            const entry = {
                fixture:        label,
                analysisMs:     analysisMark ? Math.round(analysisMark.duration) : null,
                uplotInitMs:    uplotMark    ? Math.round(uplotMark.duration)    : null,
                heapBeforeMb:   snapBefore.heapUsedMb,
                heapAfterMb:    snapAfter.heapUsedMb,
                heapDeltaMb:    Math.round((snapAfter.heapUsedMb - snapBefore.heapUsedMb) * 100) / 100,
                nodesDelta:     snapAfter.nodes - snapBefore.nodes,
            };
            results.push(entry);

            console.log(
                `[Bench] ${label}: analysis=${entry.analysisMs ?? 'N/A'} ms, ` +
                `uplot=${entry.uplotInitMs ?? 'N/A'} ms, ` +
                `heap+${entry.heapDeltaMb} MB, nodes+${entry.nodesDelta}`,
            );
        }

        const report = { scenario: 'analysis-timing', runId, generatedAt: new Date().toISOString(), results };
        await mkdir(OUTPUT_DIR, { recursive: true });
        await writeFile(path.join(OUTPUT_DIR, `analysis-timing-${runId}.json`), JSON.stringify(report, null, 2), 'utf8');

        // Assertions — generous upper bounds
        for (const entry of results) {
            if (entry.analysisMs !== null) {
                expect(entry.analysisMs, `${entry.fixture}: WASM analysis should be < 10 s`).toBeLessThan(10_000);
            }
            if (entry.uplotInitMs !== null) {
                expect(entry.uplotInitMs, `${entry.fixture}: uPlot init should be < 500 ms`).toBeLessThan(500);
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — Navigation Roundtrip (leak detection)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('[Perf] Navigation roundtrip leak detection', () => {
    test.setTimeout(300_000);

    test(`${NAV_CYCLES} navigation cycles — heap and node growth`, async ({ page }) => {
        await dismissDialogs(page);
        const cdp = await enableCdp(page);
        const runId = Date.now().toString();

        type CycleEntry = CdpSnapshot & { cycle: number; timestamp: number };
        const samples: CycleEntry[] = [];

        // Baseline
        await page.waitForTimeout(500);
        samples.push({ cycle: 0, timestamp: Date.now(), ...(await snapshot(cdp)) });

        const navPairs = [
            { from: 'DashboardNavButton',  fromUrl: /\/dashboard$/,             to: 'LibraryNavButton',     toUrl: /\/library/   },
            { from: 'LibraryNavButton',    fromUrl: /\/library/,                to: 'ComparisonNavButton',  toUrl: /\/comparison/ },
            { from: 'ComparisonNavButton', fromUrl: /\/comparison/,             to: 'DashboardNavButton',   toUrl: /\/dashboard$/ },
        ];

        for (let cycle = 1; cycle <= NAV_CYCLES; cycle++) {
            for (const pair of navPairs) {
                await navigateTo(page, pair.to, pair.toUrl);
            }
            await page.waitForTimeout(400);
            samples.push({ cycle, timestamp: Date.now(), ...(await snapshot(cdp)) });
        }

        const baseline = samples[0];
        const final    = samples[samples.length - 1];
        const peakHeap = Math.max(...samples.map(s => s.heapUsedMb));
        const peakNodes = Math.max(...samples.map(s => s.nodes));

        const summary = {
            cycles:          NAV_CYCLES,
            baselineHeapMb:  baseline.heapUsedMb,
            finalHeapMb:     final.heapUsedMb,
            peakHeapMb:      Math.round(peakHeap * 100) / 100,
            heapDeltaMb:     Math.round((final.heapUsedMb - baseline.heapUsedMb) * 100) / 100,
            baselineNodes:   baseline.nodes,
            finalNodes:      final.nodes,
            peakNodes:       peakNodes,
            nodesDelta:      final.nodes - baseline.nodes,
            layoutCountDelta:      final.layoutCount - baseline.layoutCount,
            recalcStyleCountDelta: final.recalcStyleCount - baseline.recalcStyleCount,
            scriptDurationDeltaMs: Math.round((final.scriptDurationMs - baseline.scriptDurationMs) * 100) / 100,
        };

        console.log('[Bench] Navigation roundtrip summary:', summary);

        const report = { scenario: 'navigation-leak-detection', runId, generatedAt: new Date().toISOString(), summary, samples };
        await mkdir(OUTPUT_DIR, { recursive: true });
        await writeFile(path.join(OUTPUT_DIR, `nav-leak-${runId}.json`), JSON.stringify(report, null, 2), 'utf8');

        expect(summary.heapDeltaMb,  'Heap growth over navigation cycles should be < 80 MB').toBeLessThan(80);
        expect(summary.nodesDelta,   'DOM node growth over navigation cycles should be < 15000').toBeLessThan(15_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 — Full Benchmark Summary (aggregated)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('[Perf] Summary report', () => {
    test.setTimeout(600_000);

    test('produces a single aggregated benchmark JSON report', async ({ page, dashboard }) => {
        await dismissDialogs(page);
        const cdp = await enableCdp(page);
        const runId = Date.now().toString();

        // — 4a. Idle heap per route —
        const routeSnapshots: Record<string, { heapUsedMb: number; nodes: number; navMs: number }> = {};
        for (const { testId, url, label } of [
            { testId: 'DashboardNavButton',  url: /\/dashboard$/,             label: 'Analysis'   },
            { testId: 'LibraryNavButton',     url: /\/dashboard\/library/,    label: 'Library'    },
            { testId: 'ComparisonNavButton',  url: /\/dashboard\/comparison/, label: 'Comparison' },
            { testId: 'ReportsNavButton',     url: /\/dashboard\/reports/,    label: 'Reports'    },
        ]) {
            const navMs = await navigateTo(page, testId, url);
            await page.waitForTimeout(600);
            const snap = await snapshot(cdp);
            routeSnapshots[label] = { heapUsedMb: snap.heapUsedMb, nodes: snap.nodes, navMs };
        }

        // — 4b. Go to Analysis, upload Chandler fixture —
        await navigateTo(page, 'DashboardNavButton', /\/dashboard$/);
        await clearPerfMarks(page);
        const snapPreAnalysis = await snapshot(cdp);
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis(90_000);
        await page.waitForTimeout(800);
        const snapPostAnalysis = await snapshot(cdp);
        const analysisMarks = await getPerfMarks(page);

        // — 4c. Navigation leak (5 cycles) —
        const navLeak: Array<{ cycle: number; heapMb: number; nodes: number }> = [];
        const snapNavBase = await snapshot(cdp);
        navLeak.push({ cycle: 0, heapMb: snapNavBase.heapUsedMb, nodes: snapNavBase.nodes });

        for (let i = 1; i <= 5; i++) {
            await navigateTo(page, 'LibraryNavButton', /\/library/);
            await navigateTo(page, 'ComparisonNavButton', /\/comparison/);
            await navigateTo(page, 'DashboardNavButton', /\/dashboard$/);
            await page.waitForTimeout(300);
            const s = await snapshot(cdp);
            navLeak.push({ cycle: i, heapMb: s.heapUsedMb, nodes: s.nodes });
        }

        // — Assemble report —
        const analysisMark = analysisMarks.find(m => m.name === 'analysis');
        const uplotMarks   = analysisMarks.filter(m => m.name === 'uplot:init');
        const avgUplotMs   = uplotMarks.length
            ? Math.round(uplotMarks.reduce((a, b) => a + b.duration, 0) / uplotMarks.length)
            : null;

        const navLeakFirst  = navLeak[0];
        const navLeakFinal  = navLeak[navLeak.length - 1];

        const report = {
            scenario:     'full-benchmark-summary',
            runId,
            generatedAt:  new Date().toISOString(),
            navCycles:    5,

            idleHeapPerRoute: routeSnapshots,

            analysis: {
                fixture:        CHANDLER_SST_63.displayName,
                heapDeltaMb:    Math.round((snapPostAnalysis.heapUsedMb - snapPreAnalysis.heapUsedMb) * 100) / 100,
                nodesDelta:     snapPostAnalysis.nodes - snapPreAnalysis.nodes,
                analysisMs:     analysisMark ? Math.round(analysisMark.duration) : null,
                uplotInitInstances: uplotMarks.length,
                avgUplotInitMs:     avgUplotMs,
            },

            navigationLeak: {
                baselineHeapMb: navLeakFirst.heapMb,
                finalHeapMb:    navLeakFinal.heapMb,
                heapDeltaMb:    Math.round((navLeakFinal.heapMb - navLeakFirst.heapMb) * 100) / 100,
                baselineNodes:  navLeakFirst.nodes,
                finalNodes:     navLeakFinal.nodes,
                nodesDelta:     navLeakFinal.nodes - navLeakFirst.nodes,
                samples:        navLeak,
            },
        };

        await mkdir(OUTPUT_DIR, { recursive: true });
        const outPath = path.join(OUTPUT_DIR, `benchmark-${runId}.json`);
        await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

        console.log(`[Bench] Full report written → ${outPath}`);
        console.log('[Bench] Analysis:', report.analysis);
        console.log('[Bench] Nav leak:', report.navigationLeak);

        // Soft assertions
        if (report.analysis.analysisMs !== null) {
            expect(report.analysis.analysisMs).toBeLessThan(10_000);
        }
        expect(report.navigationLeak.heapDeltaMb).toBeLessThan(80);
        expect(report.navigationLeak.nodesDelta).toBeLessThan(15_000);
    });
});
