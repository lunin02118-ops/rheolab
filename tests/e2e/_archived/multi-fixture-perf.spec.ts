/**
 * Multi-Fixture Workflow Performance Spec
 *
 * Прогоняет полный workflow (загрузка 6 фикстур → сравнение 4 → PDF × 2)
 * и на каждом шаге снимает CDP-метрики:
 *   - JS Heap (used / total)
 *   - DOM nodes
 *   - performance.marks от WASM и uPlot (если доступны)
 *   - wall-clock время шага
 *
 * Результат сохраняется в outputs/e2e/perf/workflow-<runId>.json.
 *
 * Запуск:
 *   npm run perf:workflow
 *   npx playwright test --config playwright.workflow-perf.config.ts
 *
 * Сравнение с предыдущим эталоном:
 *   npm run perf:compare outputs/e2e/perf/workflow-<old>.json outputs/e2e/perf/workflow-<new>.json
 *
 * Схема выходного JSON:
 *   steps.<stepId>.heapUsedMb     — JS Heap в MB в конце шага
 *   steps.<stepId>.heapDeltaMb    — прирост Heap относительно предыдущего шага
 *   steps.<stepId>.nodes          — DOM-узлы в конце шага
 *   steps.<stepId>.nodesDelta     — прирост узлов
 *   steps.<stepId>.analysisMs     — время WASM-анализа (из performance.mark, если есть)
 *   steps.<stepId>.uplotInitMs    — время инициализации uPlot (если есть)
 *   steps.<stepId>.wallMs         — wall-clock время шага
 *   peakHeapMb                    — максимальный Heap за весь тест
 *   peakNodes                     — максимальное кол-во DOM-узлов
 *   totalWallMs                   — суммарное wall-clock время
 */

import { test, expect, setupBeforeEach } from './base-test';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    CHANDLER_SST_63,
    CHANDLER_SWB_96,
    GRACE_REPORT,
    BROOKFIELD_4,
    BSL_REPORT,
    OFITE_1100,
} from './fixtures';

setupBeforeEach(test);

// ─── Config ─────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve('outputs', 'e2e', 'perf');

// ─── CDP helpers ─────────────────────────────────────────────────────────────

type CdpClient = {
    send(cmd: 'Performance.enable'): Promise<void>;
    send(cmd: 'Performance.getMetrics'): Promise<{ metrics: Array<{ name: string; value: number }> }>;
};

async function enableCdp(page: Page): Promise<CdpClient> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    return cdp as unknown as CdpClient;
}

interface CdpSnap {
    heapUsedMb: number;
    heapTotalMb: number;
    nodes: number;
}

async function snap(cdp: CdpClient): Promise<CdpSnap> {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const m = new Map<string, number>(metrics.map(x => [x.name, x.value]));
    const mb = (key: string) => Math.round((m.get(key) ?? 0) / (1024 * 1024) * 100) / 100;
    return {
        heapUsedMb:  mb('JSHeapUsedSize'),
        heapTotalMb: mb('JSHeapTotalSize'),
        nodes:       m.get('Nodes') ?? 0,
    };
}

// ─── Performance marks helpers ───────────────────────────────────────────────

interface PerfMarkEntry { name: string; duration: number }

async function getPerfMarks(page: Page): Promise<PerfMarkEntry[]> {
    return page.evaluate<PerfMarkEntry[]>(() => {
         
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

// ─── Step recorder ───────────────────────────────────────────────────────────

interface StepData {
    heapUsedMb: number;
    heapTotalMb: number;
    nodes: number;
    heapDeltaMb: number;
    nodesDelta: number;
    analysisMs: number | null;
    uplotInitMs: number | null;
    wallMs: number;
    note?: string;
}

type StepMap = Record<string, StepData>;

// ─── Test ────────────────────────────────────────────────────────────────────

test.describe('[PerfWorkflow] Full workflow baseline', () => {
    test.setTimeout(900_000); // 15 min generous limit

    test('workflow_perf_baseline', async ({ page, dashboard, comparison, reports }) => {
        const runId = Date.now().toString();
        const testStart = Date.now();
        const steps: StepMap = {};
        const allHeapSamples: number[] = [];
        const allNodeSamples: number[] = [];

        const cdp = await enableCdp(page);

        // Helper: record one step
        async function recordStep(
            id: string,
            prevSnap: CdpSnap,
            wallStart: number,
            page: Page,
            note?: string,
        ): Promise<CdpSnap> {
            // Allow micro-tasks to flush
            await page.waitForTimeout(300);
            const current = await snap(cdp);
            const marks = await getPerfMarks(page);
            const analysisMark = marks.findLast(m => m.name === 'analysis');
            const uplotMark    = marks.findLast(m => m.name === 'uplot:init');

            const entry: StepData = {
                heapUsedMb:  current.heapUsedMb,
                heapTotalMb: current.heapTotalMb,
                nodes:       current.nodes,
                heapDeltaMb: Math.round((current.heapUsedMb - prevSnap.heapUsedMb) * 100) / 100,
                nodesDelta:  current.nodes - prevSnap.nodes,
                analysisMs:  analysisMark ? Math.round(analysisMark.duration) : null,
                uplotInitMs: uplotMark    ? Math.round(uplotMark.duration)    : null,
                wallMs:      Date.now() - wallStart,
                ...(note ? { note } : {}),
            };
            steps[id] = entry;
            allHeapSamples.push(current.heapUsedMb);
            allNodeSamples.push(current.nodes);

            const parts = [
                `heap=${current.heapUsedMb} MB (Δ${entry.heapDeltaMb > 0 ? '+' : ''}${entry.heapDeltaMb})`,
                `nodes=${current.nodes} (Δ${entry.nodesDelta > 0 ? '+' : ''}${entry.nodesDelta})`,
                entry.analysisMs !== null ? `analysis=${entry.analysisMs} ms` : null,
                entry.uplotInitMs !== null ? `uplot=${entry.uplotInitMs} ms` : null,
                `wall=${entry.wallMs} ms`,
            ].filter(Boolean).join(', ');
            console.log(`  [perf] ${id}: ${parts}`);

            return current;
        }

        // ── Step 0: initial baseline ─────────────────────────────────────────
        let prev = await snap(cdp);
        steps['initial'] = {
            heapUsedMb:  prev.heapUsedMb,
            heapTotalMb: prev.heapTotalMb,
            nodes:       prev.nodes,
            heapDeltaMb: 0,
            nodesDelta:  0,
            analysisMs:  null,
            uplotInitMs: null,
            wallMs:      0,
            note: 'Baseline after navigation to Analysis page',
        };
        allHeapSamples.push(prev.heapUsedMb);
        allNodeSamples.push(prev.nodes);
        console.log(`\n[perf] initial: heap=${prev.heapUsedMb} MB, nodes=${prev.nodes}`);

        // ── Steps 1–6: upload + analyze + save each fixture ──────────────────
        const allFixtures = [
            CHANDLER_SST_63,
            CHANDLER_SWB_96,
            GRACE_REPORT,
            BROOKFIELD_4,
            BSL_REPORT,
            OFITE_1100,
        ];
        const savedNames: string[] = [];

        for (let i = 0; i < allFixtures.length; i++) {
            const fx = allFixtures[i];
            const stepId = `after_${fx.displayName.replace(/\s+/g, '_').toLowerCase()}`;
            console.log(`\n── Fixture ${i + 1}/${allFixtures.length}: ${fx.displayName} ──`);

            if (i > 0) {
                const reset = dashboard.page.getByTestId('UploadCardResetLink');
                if (await reset.isVisible({ timeout: 3_000 }).catch(() => false)) {
                    await reset.click();
                    await page.waitForTimeout(300);
                } else {
                    await dashboard.goto();
                }
            }

            await clearPerfMarks(page);
            const wallStart = Date.now();

            await dashboard.uploadFile(fx);
            await dashboard.waitForAnalysis(90_000);

            const expName = `Perf_${fx.displayName.replace(/\s+/g, '')}_${runId}_${i}`;
            await dashboard.saveExperiment({ name: expName });
            savedNames.push(expName);

            prev = await recordStep(stepId, prev, wallStart, page, fx.displayName);
        }

        // ── Step 7: navigate to Comparison, add 4 experiments ───────────────
        console.log('\n── Comparison: 4 experiments ──');
        const cmpStart = Date.now();
        await clearPerfMarks(page);

        await comparison.goto();
        await comparison.expectLoaded();

        const CMP_FIXTURES_COUNT = 4; // Chandler SST, Chandler SWB, Grace, Brookfield
        for (let idx = 0; idx < CMP_FIXTURES_COUNT; idx++) {
            await comparison.openSelector();
            await comparison.addExperimentByIndex(idx);
            await comparison.expectChipCount(idx + 1);
        }

        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();

        prev = await recordStep('comparison_4_loaded', prev, cmpStart, page,
            '4 experiments loaded in comparison chart');

        // Verify legend count (sanity check)
        const legendCount = await comparison.getLegendSeriesCount();
        expect(legendCount).toBeGreaterThanOrEqual(4);
        console.log(`  ✓ Legend: ${legendCount} series`);

        // ── Steps 8–9: PDF export × 2 fixtures ──────────────────────────────
        const pdfFixtures = [CHANDLER_SST_63, GRACE_REPORT];
        for (const fx of pdfFixtures) {
            const stepId = `pdf_${fx.displayName.replace(/\s+/g, '_').toLowerCase()}`;
            console.log(`\n── PDF: ${fx.displayName} ──`);

            await dashboard.goto();
            await clearPerfMarks(page);
            const wallStart = Date.now();

            await dashboard.uploadFile(fx);
            await dashboard.waitForAnalysis(90_000);

            await reports.goto();
            await reports.expectPdfButtonVisible();
            const dl = await reports.downloadPdf(60_000);
            await reports.assertDownload(dl, '.pdf', 5_000);

            prev = await recordStep(stepId, prev, wallStart, page, `PDF export for ${fx.displayName}`);
        }

        // ── Finalize ─────────────────────────────────────────────────────────
        const totalWallMs = Date.now() - testStart;
        const peakHeapMb  = Math.round(Math.max(...allHeapSamples) * 100) / 100;
        const peakNodes   = Math.max(...allNodeSamples);

        const report = {
            scenario:     'workflow-perf',
            runId,
            generatedAt:  new Date().toISOString(),
            totalWallMs,
            peakHeapMb,
            peakNodes,
            steps,
        };

        await mkdir(OUTPUT_DIR, { recursive: true });
        const outPath = path.join(OUTPUT_DIR, `workflow-${runId}.json`);
        await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

        console.log(`\n[perf] ─── Summary ───`);
        console.log(`  Peak heap:   ${peakHeapMb} MB`);
        console.log(`  Peak nodes:  ${peakNodes}`);
        console.log(`  Total wall:  ${(totalWallMs / 1000).toFixed(1)} s`);
        console.log(`  Output:      ${outPath}`);

        // Smoke-level assertions — generous bounds not to block baseline capture
        expect(peakHeapMb, 'Peak heap < 500 MB').toBeLessThan(500);
        expect(peakNodes,  'Peak DOM nodes < 30000').toBeLessThan(30_000);
    });
});
