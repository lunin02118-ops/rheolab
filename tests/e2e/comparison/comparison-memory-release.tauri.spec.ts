import { test, expect, setupBeforeEach } from '../base-test.tauri';
import type { Page } from '@playwright/test';
import { CHANDLER_SST_63, GRACE_REPORT } from '../fixtures';

setupBeforeEach(test);

type ComparisonStoreSnapshot = Array<{
    id: string;
    hasColumnar: boolean;
    columnarLen: number;
    rawPointsLen: number;
}>;

async function resetComparisonStore(page: Page) {
    await page.evaluate(() => {
        localStorage.removeItem('comparison-storage');
        const store = (window as any).__rheolab_comparison_store;
        if (store) {
            store.setState({ experiments: [] });
        }
    });
}

async function readComparisonStore(page: Page): Promise<ComparisonStoreSnapshot> {
    return page.evaluate(() => {
        const store = (window as any).__rheolab_comparison_store;
        const experiments = store?.getState?.().experiments ?? [];
        return experiments.map((exp: any) => ({
            id: exp.id,
            hasColumnar: Boolean(exp.columnarData?.timeSec?.length),
            columnarLen: exp.columnarData?.timeSec?.length ?? 0,
            rawPointsLen: Array.isArray(exp.rawPoints) ? exp.rawPoints.length : 0,
        }));
    });
}

async function addExperimentFromSelector(page: Page, comparisonName: string) {
    await page.getByTestId('OpenExperimentSelectorButton').first().click();
    const dialog = page.getByTestId('ComparisonSelectorDialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const searchInput = page.getByTestId('ComparisonSelectorSearchInput');
    await searchInput.fill(comparisonName);
    await page.waitForTimeout(800);

    const matchButton = page.getByTestId('ComparisonSelectorExperimentButton').filter({ hasText: comparisonName }).first();
    await expect(matchButton).toBeVisible({ timeout: 15_000 });
    await matchButton.click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Let the comparison store settle before the next addExperimentFromSelector
    // call. Under load (full perf workflow) the previous chip needs time to
    // render and the selector state to refresh before we reopen it.
    await page.waitForTimeout(400);
}

test.describe('[Comparison/Tauri] Memory release', () => {
    test.setTimeout(240_000);

    test('comparison_releases_heavy_data_on_unmount_and_rehydrates_on_return', async ({
        page,
        dashboard,
        comparison,
    }) => {
        const runId = Date.now();
        const experimentA = `MemRelease_A_${runId}`;
        const experimentB = `MemRelease_B_${runId}`;

        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis(90_000);
        await dashboard.saveExperiment({ name: experimentA });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis(90_000);
        await dashboard.saveExperiment({ name: experimentB });

        // Wait for save-success toast to auto-dismiss (4 s default) so it
        // doesn't intercept pointer events on the comparison page buttons.
        await page.waitForTimeout(5_000);

        // Reset comparison store BEFORE navigating so the page's useEffect
        // sees experiments=[] and skips rehydrateIfNeeded (avoids async race).
        await resetComparisonStore(page);

        await comparison.goto();
        await comparison.expectLoaded();
        // Verify the reset stuck — no stale chips from previous tests/sessions
        await comparison.expectChipCount(0);

        await addExperimentFromSelector(page, experimentA);
        await addExperimentFromSelector(page, experimentB);
        await comparison.expectChipCount(2);
        await comparison.expectChartVisible();

        const beforeLeave = await readComparisonStore(page);
        expect(beforeLeave).toHaveLength(2);
        expect(beforeLeave.every((exp) => exp.hasColumnar && exp.columnarLen > 0)).toBe(true);

        await dashboard.goto();
        await page.waitForTimeout(600);

        await expect.poll(async () => {
            const snapshot = await readComparisonStore(page);
            return snapshot.length === 2 &&
                snapshot.every((exp) => !exp.hasColumnar && exp.columnarLen === 0 && exp.rawPointsLen === 0);
        }, { timeout: 10_000 }).toBe(true);

        await comparison.goto();
        await comparison.expectLoaded();
        await expect.poll(async () => {
            const snapshot = await readComparisonStore(page);
            return snapshot.filter((exp) => exp.hasColumnar && exp.columnarLen > 0).length;
        }, { timeout: 15_000 }).toBe(2);
        await comparison.expectChartVisible();
    });
});
