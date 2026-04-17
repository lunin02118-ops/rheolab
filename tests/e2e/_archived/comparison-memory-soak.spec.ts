import { test, expect, setupBeforeEach } from './base-test';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHANDLER_SST_63, GRACE_REPORT } from './fixtures';

const CYCLES = Number(process.env.RHEOLAB_E2E_COMPARISON_CYCLES ?? 10);
const FINAL_HEAP_DELTA_LIMIT_MB = Number(process.env.RHEOLAB_E2E_COMPARISON_HEAP_DELTA_MB ?? 80);
const PEAK_HEAP_DELTA_LIMIT_MB = Number(process.env.RHEOLAB_E2E_COMPARISON_HEAP_PEAK_DELTA_MB ?? 120);
const NODE_DELTA_LIMIT = Number(process.env.RHEOLAB_E2E_COMPARISON_NODE_DELTA ?? 15000);

type PerfSnapshot = {
    cycle: number;
    heapUsedBytes: number;
    nodes: number;
    timestamp: number;
};

type PerfMetric = {
    name: string;
    value: number;
};

type PerfCdpClient = {
    send: (command: 'Performance.enable' | 'Performance.getMetrics') => Promise<{ metrics?: PerfMetric[] }>;
};

async function dismissBlockingDialogs(page: Page) {
    // StartupCheck may open warning dialog(s) that intercept pointer events.
    for (let i = 0; i < 3; i += 1) {
        const acknowledge = page.getByRole('button', { name: /Понятно|OK|Close/i }).first();
        if (await acknowledge.isVisible({ timeout: 500 }).catch(() => false)) {
            try {
                await acknowledge.click({ timeout: 5000, force: true });
            } catch {
                await page.keyboard.press('Escape').catch(() => undefined);
            }
            await page.waitForTimeout(150);
            continue;
        }
        break;
    }
}

async function openTopNav(page: Page, automationId: string, expectedUrl: RegExp) {
    await dismissBlockingDialogs(page);
    const navLink = page.getByTestId(automationId).first();
    await expect(navLink).toBeVisible({ timeout: 10000 });
    await navLink.click();
    await expect(page).toHaveURL(expectedUrl, { timeout: 15000 });
}

async function saveCurrentExperiment(page: Page, experimentName: string) {
    await page.getByTestId('SaveExperimentButton').first().click();
    const dialog = page.getByTestId('SaveExperimentDialogWindow');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await dialog.getByTestId('SaveDialogNameTextBox').fill(experimentName);
    await dialog.getByTestId('SaveDialogFieldTextBox').fill(`MemField_${experimentName}`);
    await dialog.getByTestId('SaveDialogOperatorTextBox').fill('MemOperator');
    await dialog.getByTestId('SaveDialogWellTextBox').fill(`MemWell_${experimentName.slice(-6)}`);
    await dialog.getByTestId('SaveDialogWaterSourceTextBox').fill('Memory Water Source');

    const saveButton = dialog.getByTestId('SaveDialogSaveButton');
    await expect(saveButton).toBeEnabled({ timeout: 10000 });
    await saveButton.click();

    const overwriteButton = page.getByRole('button', { name: /Перезаписать/i });
    if (await overwriteButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await overwriteButton.click();
    }

    await expect(dialog).toBeHidden({ timeout: 15000 });
}

async function prepareComparisonData(page: Page, dashboard: { uploadFile: (fixture: unknown) => Promise<void>; waitForAnalysis: (timeoutMs?: number) => Promise<void> }, runId: string) {
    await openTopNav(page, 'DashboardNavButton', /\/dashboard$/);
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();
    await saveCurrentExperiment(page, `E2E_Mem_A_${runId}`);

    await dashboard.uploadFile(GRACE_REPORT);
    await dashboard.waitForAnalysis();
    await saveCurrentExperiment(page, `E2E_Mem_B_${runId}`);
}

async function addTwoExperimentsToComparison(page: Page) {
    await openTopNav(page, 'ComparisonNavButton', /\/dashboard\/comparison/);
    await expect(page.getByTestId('ComparisonChartContainer')).toBeVisible({ timeout: 10000 });

    const openSelector = page.getByTestId('OpenExperimentSelectorButton').first();
    await openSelector.click();
    await expect(page.getByTestId('ComparisonSelectorDialog')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('ComparisonSelectorExperimentButton').first()).toBeVisible({ timeout: 15000 });
    await page.getByTestId('ComparisonSelectorExperimentButton').first().click();

    await openSelector.click();
    await expect(page.getByTestId('ComparisonSelectorDialog')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('ComparisonSelectorExperimentButton').nth(1)).toBeVisible({ timeout: 15000 });
    await page.getByTestId('ComparisonSelectorExperimentButton').nth(1).click();

    await expect(page.getByTestId('ComparisonExperimentChip')).toHaveCount(2, { timeout: 15000 });
    await expect(page.getByTestId('ComparisonChart')).toBeVisible({ timeout: 10000 });
}

async function samplePerf(cdp: PerfCdpClient, cycle: number): Promise<PerfSnapshot> {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const metricByName = new Map<string, number>((metrics ?? []).map((metric: PerfMetric) => [metric.name, metric.value]));
    return {
        cycle,
        heapUsedBytes: metricByName.get('JSHeapUsedSize') ?? 0,
        nodes: metricByName.get('Nodes') ?? 0,
        timestamp: Date.now(),
    };
}

async function hoverChartSurface(page: Page) {
    const chart = page.getByTestId('ComparisonChartContainer');
    await expect(chart).toBeVisible({ timeout: 10000 });

    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
        return;
    }

    const left = box.x + Math.min(20, box.width * 0.1);
    const right = box.x + box.width - Math.min(20, box.width * 0.1);
    const centerY = box.y + box.height * 0.5;

    await page.mouse.move(left, centerY);
    for (let step = 0; step < 40; step += 1) {
        const progress = step / 39;
        const x = left + (right - left) * progress;
        const y = centerY + Math.sin(progress * Math.PI * 2) * Math.min(36, box.height * 0.2);
        await page.mouse.move(x, y);
    }
}

setupBeforeEach(test);

test.describe('Comparison memory soak parity', () => {
    test.setTimeout(420000);

    test('comparison hover + navigation does not show critical memory growth', async ({ page, dashboard }) => {
        const runId = Date.now().toString();
        await dismissBlockingDialogs(page);
        await prepareComparisonData(page, dashboard as any, runId);
        await addTwoExperimentsToComparison(page);

        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable');

        const snapshots: PerfSnapshot[] = [];
        snapshots.push(await samplePerf(cdp, 0));

        for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
            await hoverChartSurface(page);
            await openTopNav(page, 'DashboardNavButton', /\/dashboard$/);
            await openTopNav(page, 'ComparisonNavButton', /\/dashboard\/comparison/);
            await expect(page.getByTestId('ComparisonChart')).toBeVisible({ timeout: 10000 });
            snapshots.push(await samplePerf(cdp, cycle));
        }

        const baseline = snapshots[0];
        const finalSample = snapshots[snapshots.length - 1];
        const peakHeap = Math.max(...snapshots.map((sample) => sample.heapUsedBytes));
        const peakNodes = Math.max(...snapshots.map((sample) => sample.nodes));

        const finalHeapDeltaMb = (finalSample.heapUsedBytes - baseline.heapUsedBytes) / (1024 * 1024);
        const peakHeapDeltaMb = (peakHeap - baseline.heapUsedBytes) / (1024 * 1024);
        const finalNodeDelta = finalSample.nodes - baseline.nodes;
        const peakNodeDelta = peakNodes - baseline.nodes;

        const report = {
            generatedAt: new Date().toISOString(),
            cycles: CYCLES,
            limits: {
                finalHeapDeltaMb: FINAL_HEAP_DELTA_LIMIT_MB,
                peakHeapDeltaMb: PEAK_HEAP_DELTA_LIMIT_MB,
                nodeDelta: NODE_DELTA_LIMIT,
            },
            summary: {
                baselineHeapMb: baseline.heapUsedBytes / (1024 * 1024),
                finalHeapMb: finalSample.heapUsedBytes / (1024 * 1024),
                peakHeapMb: peakHeap / (1024 * 1024),
                finalHeapDeltaMb,
                peakHeapDeltaMb,
                baselineNodes: baseline.nodes,
                finalNodes: finalSample.nodes,
                peakNodes,
                finalNodeDelta,
                peakNodeDelta,
            },
            samples: snapshots,
        };

        const outputDir = path.resolve('outputs', 'e2e', 'perf');
        await mkdir(outputDir, { recursive: true });
        await writeFile(
            path.join(outputDir, `comparison-memory-soak-${runId}.json`),
            JSON.stringify(report, null, 2),
            'utf8',
        );

        expect(finalHeapDeltaMb).toBeLessThan(FINAL_HEAP_DELTA_LIMIT_MB);
        expect(peakHeapDeltaMb).toBeLessThan(PEAK_HEAP_DELTA_LIMIT_MB);
        expect(peakNodeDelta).toBeLessThan(NODE_DELTA_LIMIT);
    });
});
