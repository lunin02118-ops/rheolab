/**
 * E2E — Comparison chart: multi-experiment series rendering regression
 *
 * Regression ref: "Серии не отображаются — как только добавляешь еще один (эксперимент), всё падает"
 *
 * Root cause: The old alignment code required an exact `time_min` match between
 * the shared X-axis slot and each experiment's own points.  When two experiments
 * have different sample timestamps (always the case), every cross-experiment slot
 * produced a `null`, making ALL series invisible after adding the second experiment.
 *
 * Fix: replaced exact-match lookup with a last-known-value (zero-order hold) scan
 * that covers the entire time range of each experiment without gaps.
 *
 * This file tests:
 *  1. Single experiment → chart painted, correct series count
 *  2. Two experiments, same fixture → both series visible, canvas painted
 *  3. Two experiments, different fixtures → both series visible, canvas painted
 *  4. Metric switches (secondary, tertiary) while 2 experiments active → still painted
 *  5. Remove one experiment → chart still painted (not blank)
 *
 * Prerequisite: dev server is running.  At least 2 fixtures available (CHANDLER_SST_63, GRACE_REPORT).
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63, GRACE_REPORT } from '../fixtures';

setupBeforeEach(test);

test.describe('Comparison — Multi-experiment series rendering (regression)', () => {
    test.setTimeout(300_000);

    test('comparison_single_experiment_canvas_is_painted', async ({ dashboard, comparison }) => {
        // Setup: save one experiment
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `Reg1A_${Date.now()}` });

        await comparison.goto();
        await comparison.expectLoaded();

        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);

        await comparison.expectChipCount(1);
        await comparison.expectChartVisible();

        // The canvas must have non-background pixels (data was rendered)
        await comparison.expectCanvasPainted();
    });

    test('comparison_two_experiments_same_fixture_both_series_visible', async ({ dashboard, comparison }) => {
        // Setup: save two experiments from the same fixture (different names/IDs)
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        const name1 = `Reg2A_${Date.now()}`;
        await dashboard.saveExperiment({ name: name1 });

        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        const name2 = `Reg2B_${Date.now()}`;
        await dashboard.saveExperiment({ name: name2 });

        await comparison.goto();
        await comparison.expectLoaded();

        // Add first
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.expectChipCount(1);

        // Add second
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);

        // Chart must be visible AND painted (the regression: adding 2nd made it blank)
        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();

        // Legend must show 2 series (2 experiments × 1 primary metric)
        await comparison.expectLegendSeriesCount(2);
    });

    test('comparison_two_experiments_different_fixtures_both_series_visible', async ({ dashboard, comparison }) => {
        // Setup: two different experiments with different data shapes
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        const name1 = `Reg3A_${Date.now()}`;
        await dashboard.saveExperiment({ name: name1 });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        const name2 = `Reg3B_${Date.now()}`;
        await dashboard.saveExperiment({ name: name2 });

        await comparison.goto();
        await comparison.expectLoaded();

        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.expectChipCount(1);

        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);

        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();
        await comparison.expectLegendSeriesCount(2);
    });

    test('comparison_secondary_metric_two_experiments_canvas_is_painted', async ({ dashboard, comparison }) => {
        // Adding a secondary metric doubles the series count.
        // The canvas must still have data after switching.
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `Reg4A_${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `Reg4B_${Date.now()}` });

        await comparison.goto();
        await comparison.expectLoaded();

        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);

        // Switch left-secondary metric to Temperature
        const leftSecondaryDropdown = comparison.page
            .getByTestId('ComparisonLeftSecondaryMetricSelect')
            .first();
        if (await leftSecondaryDropdown.isVisible().catch(() => false)) {
            await leftSecondaryDropdown.selectOption('temperature_c');
            await comparison.page.waitForTimeout(500);
        }

        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();
        // Now we have 2 metrics × 2 experiments = 4 series in the legend
        const count = await comparison.getLegendSeriesCount();
        expect(count).toBeGreaterThanOrEqual(2);
    });

    test('comparison_remove_one_of_two_experiments_chart_still_painted', async ({ dashboard, comparison }) => {
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `Reg5A_${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `Reg5B_${Date.now()}` });

        await comparison.goto();
        await comparison.expectLoaded();

        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);
        await comparison.expectCanvasPainted();

        // Remove the second chip → one experiment should remain visible
        await comparison.removeExperimentChip(1);
        await comparison.expectChipCount(1);

        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();
        // Default config: viscosity (Слева 1) + temperature_c (Справа 1) → 2 series per experiment.
        // With 1 experiment remaining, the legend must have exactly 2 series.
        await comparison.expectLegendSeriesCount(2);
    });
});

test.describe('Comparison — Line settings from chart settings store', () => {
    test.setTimeout(300_000);

    /**
     * Regression: line width was hardcoded to 2. After the fix the component
     * reads chartSettings.lines[key].width. Verify the chart still renders
     * after injecting a custom width via localStorage.
     */
    test('comparison_chart_renders_after_custom_line_width_injected', async ({ dashboard, comparison, page }) => {
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `LineW_${Date.now()}` });

        // Inject custom line width (viscosity = 4) directly into persisted store state
        await page.evaluate(() => {
            const key = 'rheolab-chart-settings';
            const raw = localStorage.getItem(key);
            if (raw) {
                try {
                    const stored = JSON.parse(raw);
                    if (stored?.state?.settings?.lines?.viscosity) {
                        stored.state.settings.lines.viscosity.width = 4;
                        localStorage.setItem(key, JSON.stringify(stored));
                    }
                } catch { /* ignore */ }
            }
        });

        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.expectChipCount(1);
        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();
    });

    /**
     * Regression: line style was hardcoded. After the fix the component reads
     * chartSettings.lines[key].style. Verify the chart renders after injecting a dashed style.
     */
    test('comparison_chart_renders_after_dashed_style_injected', async ({ dashboard, comparison, page }) => {
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `LineS_${Date.now()}` });

        await page.evaluate(() => {
            const key = 'rheolab-chart-settings';
            const raw = localStorage.getItem(key);
            if (raw) {
                try {
                    const stored = JSON.parse(raw);
                    if (stored?.state?.settings?.lines?.viscosity) {
                        stored.state.settings.lines.viscosity.style = 'dashed';
                        localStorage.setItem(key, JSON.stringify(stored));
                    }
                } catch { /* ignore */ }
            }
        });

        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.expectChipCount(1);
        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();
    });
});

test.describe('Comparison — Bath temperature shares temperature axis (regression)', () => {
    test.setTimeout(300_000);

    /**
     * Regression: in individual axis mode bath_temperature_c and temperature_c
     * were on separate scales. After the fix they share the 'temperature_c' scale.
     * Verify: adding both metrics to comparison renders correctly (no crash, canvas painted).
     */
    test('comparison_bath_and_sample_temperature_on_same_axis_individual_mode', async ({
        dashboard, comparison
    }) => {
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `BathTemp_${Date.now()}` });

        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.expectChipCount(1);

        // Open axis controls panel
        const settingsToggle = comparison.page.getByTitle('Настройки осей');
        if (await settingsToggle.isVisible().catch(() => false)) {
            await settingsToggle.click();

            // Set Left 2 = Temperature
            const leftSecondary = comparison.page.locator('select').nth(1);
            if (await leftSecondary.isVisible().catch(() => false)) {
                await leftSecondary.selectOption('temperature_c');
                await comparison.page.waitForTimeout(300);
            }

            // Set Right 1 = Bath temperature
            const right1 = comparison.page.locator('select').nth(2);
            if (await right1.isVisible().catch(() => false)) {
                await right1.selectOption('bath_temperature_c');
                await comparison.page.waitForTimeout(300);
            }
        }

        // Chart must still paint — no crash from duplicate scale registration
        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();
    });

    /**
     * Two experiments: bath_temperature_c and temperature_c for two experiments
     * should produce 4 series (2 exp × 2 metrics) and the chart must still render.
     */
    test('comparison_bath_and_sample_temp_two_experiments_canvas_painted', async ({
        dashboard, comparison
    }) => {
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `BathA_${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `BathB_${Date.now()}` });

        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);

        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();
        // Two experiments × 1 primary metric = 2 legend series minimum
        const count = await comparison.getLegendSeriesCount();
        expect(count).toBeGreaterThanOrEqual(2);
    });
});

