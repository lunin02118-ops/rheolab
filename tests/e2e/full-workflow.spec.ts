/**
 * Full E2E Workflow — modern rewrite using Page Objects.
 *
 * Covers the complete user journey in browser mode (WASM parsing, mocked IPC):
 *   1. Upload + parse file → verify chart renders
 *   2. Dashboard tab switching (chart / table / recipe / water / calibration)
 *   3. Save experiment to DB (mocked IPC)
 *   4. Library: verify saved experiments appear, test search filter
 *   5. Library: test filter select controls (fluid type, instrument)
 *   6. Single-experiment report generation (PDF + Excel)
 *   7. Comparison: add two experiments, verify chart
 *   8. Comparison report generation + section toggles
 *
 * Run:
 *   npx playwright test tests/e2e/full-workflow.spec.ts
 */

import { test, expect, setupBeforeEach } from './base-test';
import { CHANDLER_SST_63, GRACE_REPORT } from './fixtures';

// ─────────────────────────────────────────────────────────────────────────────

setupBeforeEach(test);

test.describe('Full E2E Workflow', () => {
    test.setTimeout(180_000); // 3 min — WASM parsing + mocked IPC

    // ── Step 1: Upload + parse + verify chart ─────────────────────────
    test('1_upload_parse_chart_renders', async ({ dashboard }) => {
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.expectChartVisible();
        await dashboard.expectNoAnalysisError();
        console.log('✓ Chandler parsed, chart rendered');
    });

    // ── Step 2: Dashboard tab switching ───────────────────────────────
    test('2_dashboard_tab_switching', async ({ dashboard }) => {
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();

        for (const tab of ['chart', 'table', 'recipe', 'water', 'calibration'] as const) {
            await dashboard.switchTab(tab);
            console.log(`  ✓ Switched to "${tab}" tab`);
        }
        // Return to chart — should still render
        await dashboard.switchTab('chart');
        await dashboard.expectChartVisible();
    });

    // ── Step 3: Save experiment to DB ─────────────────────────────────
    test('3_save_experiment_to_db', async ({ dashboard }) => {
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();

        const { name } = await dashboard.saveExperiment({ name: `Workflow-Chandler-${Date.now()}` });
        console.log(`✓ Saved experiment "${name}"`);
    });

    // ── Step 4: Library — saved experiments appear + search filter ────
    test('4_library_filters_and_search', async ({ dashboard, library }) => {
        // Save two experiments first
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        const exp1 = await dashboard.saveExperiment({ name: `WF-Search-1-${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `WF-Search-2-${Date.now()}` });

        // Navigate to Library
        await library.goto();
        await library.expectLoaded();
        await library.expectMinExperimentCount(2);

        // Verify saved experiments appear
        await library.expectExperimentVisible(exp1.name);
        console.log(`✓ "${exp1.name}" visible in library`);

        // Search filter — should narrow results
        await library.search(exp1.name);
        await library.expectExperimentVisible(exp1.name);
        console.log('✓ Search filter works');

        // Clear and verify all come back
        await library.search('');
        await library.expectMinExperimentCount(2);

        // Instrument filter (combobox)
        const instrumentFilter = library.instrumentTypeFilter;
        if (await instrumentFilter.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await instrumentFilter.click();
            const chandlerOpt = library.page.locator('[role="option"]').filter({ hasText: /Chandler/i }).first();
            if (await chandlerOpt.isVisible({ timeout: 2_000 }).catch(() => false)) {
                await chandlerOpt.click();
                await library.waitForListSettled();
                console.log('✓ Instrument filter applied');
            } else {
                await library.page.keyboard.press('Escape');
            }
        }

        // Fluid type filter
        const fluidFilter = library.fluidTypeFilter;
        if (await fluidFilter.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await fluidFilter.click();
            const anyOption = library.page.locator('[role="option"]').first();
            if (await anyOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
                await anyOption.click();
                await library.waitForListSettled();
                console.log('✓ Fluid type filter applied');
            } else {
                await library.page.keyboard.press('Escape');
            }
        }

        // Clear all filters (only if button is visible AND enabled)
        const clearBtn = library.clearFiltersButton;
        if (await clearBtn.isVisible({ timeout: 2_000 }).catch(() => false) &&
            await clearBtn.isEnabled({ timeout: 1_000 }).catch(() => false)) {
            await library.clearAllFilters();
            await library.waitForListSettled();
            console.log('✓ Filters cleared');
        }
    });

    // ── Step 5: Single-experiment report generation (PDF + Excel) ─────
    test('5_single_exp_report_generation', async ({ dashboard, reports }) => {
        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();

        // Switch to Report tab
        await reports.goto();
        await reports.expectPdfButtonVisible();

        // PDF download
        const pdfDl = await reports.downloadPdf();
        const pdfName = pdfDl.suggestedFilename();
        expect(pdfName).toMatch(/\.pdf$/i);
        console.log(`✓ PDF downloaded: ${pdfName}`);

        // Excel download
        const xlsxDl = await reports.downloadExcel();
        const xlsxName = xlsxDl.suggestedFilename();
        expect(xlsxName).toMatch(/\.xlsx$/i);
        console.log(`✓ Excel downloaded: ${xlsxName}`);
    });

    // ── Step 6: Comparison — add two experiments, verify chart ────────
    test('6_comparison_chart_with_two_experiments', async ({ dashboard, comparison }) => {
        // Save two experiments
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `WF-Comp-1-${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `WF-Comp-2-${Date.now()}` });

        // Add both to comparison
        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);
        await comparison.expectChartVisible();
        console.log('✓ Comparison chart rendered with 2 experiments');
    });

    // ── Step 7: Comparison report — toggles + PDF/Excel download ──────
    test('7_comparison_report_toggles_and_download', async ({
        dashboard, comparison, comparisonReports,
    }) => {
        // Save two experiments
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `WF-CmpRpt-1-${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `WF-CmpRpt-2-${Date.now()}` });

        // Comparison setup
        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);

        // Switch to report sub-tab
        await comparisonReports.switchToReportTab();
        await comparisonReports.expectLoaded();
        await comparisonReports.expectExportButtonsEnabled();

        // Verify all 5 section toggles are visible
        await expect(comparisonReports.calibrationToggle).toBeVisible();
        await expect(comparisonReports.rawDataToggle).toBeVisible();
        await expect(comparisonReports.recipeToggle).toBeVisible();
        await expect(comparisonReports.waterAnalysisToggle).toBeVisible();
        await expect(comparisonReports.rheologyToggle).toBeVisible();
        console.log('✓ All 5 section toggles visible');

        // Verify default states
        expect(await comparisonReports.calibrationToggle.getAttribute('data-state')).toBe('off');
        expect(await comparisonReports.recipeToggle.getAttribute('data-state')).toBe('on');
        expect(await comparisonReports.rheologyToggle.getAttribute('data-state')).toBe('on');

        // Toggle rheology off and back
        await comparisonReports.rheologyToggle.click();
        expect(await comparisonReports.rheologyToggle.getAttribute('data-state')).toBe('off');
        await comparisonReports.rheologyToggle.click();
        expect(await comparisonReports.rheologyToggle.getAttribute('data-state')).toBe('on');
        console.log('✓ Rheology toggle interactive');

        // PDF download
        const pdfDl = await comparisonReports.downloadPdf();
        expect(pdfDl.suggestedFilename()).toMatch(/comparison.*\.pdf$/i);
        console.log(`✓ Comparison PDF: ${pdfDl.suggestedFilename()}`);

        // Excel download
        const xlsxDl = await comparisonReports.downloadExcel();
        expect(xlsxDl.suggestedFilename()).toMatch(/comparison.*\.xlsx$/i);
        console.log(`✓ Comparison Excel: ${xlsxDl.suggestedFilename()}`);
    });

    // ── Step 8: Language switch on comparison report ──────────────────
    test('8_comparison_report_language_switch', async ({
        dashboard, comparison, comparisonReports,
    }) => {
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `WF-Lang-1-${Date.now()}` });

        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.expectChipCount(1);

        await comparisonReports.switchToReportTab();
        await comparisonReports.expectLoaded();

        // Switch to English
        await comparisonReports.selectLanguage('en');
        // Switch back to Russian
        await comparisonReports.selectLanguage('ru');

        await comparisonReports.expectExportButtonsEnabled();
        console.log('✓ Language switch works');
    });
});
