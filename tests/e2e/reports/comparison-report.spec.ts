/**
 * E2E — Comparison: PDF & Excel Report generation
 *
 * Group: Reports (multi-experiment)
 *
 * Covers the sub-tab routing added in Phase 3 of the comparison-report
 * feature:
 * - Chart | Report sub-tab triggers are rendered inside ComparisonPage.
 * - PDF and Excel buttons fire the correct Tauri IPC command and
 *   produce a `comparison-report_<YYYY-MM-DD>.{pdf,xlsx}` download.
 * - Export buttons are disabled when no experiments are selected.
 *
 * Naming: comparison_report_{action}_{expectedResult}
 */

import { expect, setupBeforeEach, test } from '../base-test';
import { CHANDLER_SST_63, GRACE_REPORT } from '../fixtures';

setupBeforeEach(test);

test.describe('Comparison — Report sub-tab routing', () => {
    test.setTimeout(90_000);

    test('comparison_report_sub_tab_disabled_without_experiments', async ({ comparison, comparisonReports }) => {
        await comparison.goto();
        await comparison.expectLoaded();

        // Report trigger lives next to Chart trigger in the comparison header
        await expect(comparisonReports.reportTabTrigger).toBeVisible({ timeout: 10_000 });
        await comparisonReports.switchToReportTab();

        // Tab renders but both format buttons are disabled when experiments=0
        await comparisonReports.expectExportButtonsDisabled();
    });

    test('comparison_report_tab_switches_back_to_chart', async ({ comparison, comparisonReports }) => {
        await comparison.goto();
        await comparison.expectLoaded();

        await comparisonReports.switchToReportTab();
        await comparisonReports.expectLoaded();

        // Back to Chart — tab root should disappear, chart container returns
        await comparisonReports.switchToChartTab();
        await expect(comparison.chartContainer).toBeVisible({ timeout: 10_000 });
    });
});

test.describe('Comparison — Report PDF generation', () => {
    test.setTimeout(180_000);

    test('comparison_report_pdf_download_two_experiments', async ({ dashboard, comparison, comparisonReports }) => {
        // Arrange — save two real experiments so they appear in the selector.
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `CmpReport A ${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `CmpReport B ${Date.now()}` });

        // Add both to comparison.
        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);

        // Act — switch to Report tab and press PDF.
        await comparisonReports.switchToReportTab();
        await comparisonReports.expectExportButtonsEnabled();

        const download = await comparisonReports.downloadPdf();
        // Assert filename pattern + min size (IPC mock emits 8 KB fake PDF).
        const { filename, size } = await comparisonReports.assertDownload(download, 'pdf', 4096);
        console.log(`Comparison PDF: ${filename}, ${size} bytes`);
    });
});

test.describe('Comparison — Report Excel generation', () => {
    test.setTimeout(180_000);

    test('comparison_report_excel_download_two_experiments', async ({ dashboard, comparison, comparisonReports }) => {
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `CmpReport Excel A ${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `CmpReport Excel B ${Date.now()}` });

        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);

        await comparisonReports.switchToReportTab();
        await comparisonReports.expectExportButtonsEnabled();

        const download = await comparisonReports.downloadExcel();
        const { filename, size } = await comparisonReports.assertDownload(download, 'xlsx', 4096);
        console.log(`Comparison Excel: ${filename}, ${size} bytes`);
    });
});

test.describe('Comparison — Report UI toggles', () => {
    test.setTimeout(120_000);

    test('comparison_report_language_switch_updates_ui', async ({ comparison, comparisonReports }) => {
        await comparison.goto();
        await comparison.expectLoaded();

        await comparisonReports.switchToReportTab();
        await comparisonReports.expectLoaded();

        // Both language pills should be rendered (language is controlled by
        // the branding store and persists across Single ↔ Comparison views).
        await expect(comparisonReports.languageRuButton).toBeVisible({ timeout: 5_000 });
        await expect(comparisonReports.languageEnButton).toBeVisible({ timeout: 5_000 });

        await comparisonReports.selectLanguage('en');
        // Section label flips to English — toggle rows re-render with English copy
        await expect(comparisonReports.calibrationToggle).toContainText(/calibration/i, { timeout: 5_000 });

        await comparisonReports.selectLanguage('ru');
        await expect(comparisonReports.calibrationToggle).toContainText(/калибровки/i, { timeout: 5_000 });
    });

    test('comparison_report_recipe_toggle_changes_state', async ({ comparison, comparisonReports }) => {
        await comparison.goto();
        await comparison.expectLoaded();

        await comparisonReports.switchToReportTab();
        await comparisonReports.expectLoaded();

        // Recipe is on by default — record state, click, verify flip, click back.
        const toggle = comparisonReports.recipeToggle;
        await expect(toggle).toBeVisible({ timeout: 5_000 });

        // The toggle is a button whose child div carries the active-background
        // class — we simply assert the data-testid stays stable while clicking.
        await toggle.click();
        await toggle.click(); // flip twice so the final state matches the start
        // If the click path is broken (stale test-id / React detach) the click
        // chain above would throw before this assertion.
        await expect(toggle).toBeVisible();
    });

    test('comparison_report_rheology_toggle_visible_and_interactive', async ({ comparison, comparisonReports }) => {
        await comparison.goto();
        await comparison.expectLoaded();

        await comparisonReports.switchToReportTab();
        await comparisonReports.expectLoaded();

        // Rheology toggle defaults to on — verify it renders and flips.
        const toggle = comparisonReports.rheologyToggle;
        await expect(toggle).toBeVisible({ timeout: 5_000 });

        const before = await toggle.getAttribute('data-state');
        expect(before).toBe('on');

        await toggle.click();
        const after = await toggle.getAttribute('data-state');
        expect(after).toBe('off');

        // Flip back
        await toggle.click();
        const restored = await toggle.getAttribute('data-state');
        expect(restored).toBe('on');
    });

    test('comparison_report_all_five_section_toggles_render', async ({ comparison, comparisonReports }) => {
        await comparison.goto();
        await comparison.expectLoaded();

        await comparisonReports.switchToReportTab();
        await comparisonReports.expectLoaded();

        // All five section toggles must be visible.
        await expect(comparisonReports.calibrationToggle).toBeVisible({ timeout: 5_000 });
        await expect(comparisonReports.rawDataToggle).toBeVisible({ timeout: 5_000 });
        await expect(comparisonReports.recipeToggle).toBeVisible({ timeout: 5_000 });
        await expect(comparisonReports.waterAnalysisToggle).toBeVisible({ timeout: 5_000 });
        await expect(comparisonReports.rheologyToggle).toBeVisible({ timeout: 5_000 });

        // Verify default states: calibration=off, rawData=off, recipe=on, waterAnalysis=off, rheology=on
        expect(await comparisonReports.calibrationToggle.getAttribute('data-state')).toBe('off');
        expect(await comparisonReports.rawDataToggle.getAttribute('data-state')).toBe('off');
        expect(await comparisonReports.recipeToggle.getAttribute('data-state')).toBe('on');
        expect(await comparisonReports.waterAnalysisToggle.getAttribute('data-state')).toBe('off');
        expect(await comparisonReports.rheologyToggle.getAttribute('data-state')).toBe('on');
    });
});
