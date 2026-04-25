/**
 * Full E2E Workflow — Tauri desktop version.
 *
 * Runs against a real compiled Tauri application via CDP (Chrome DevTools Protocol).
 * Unlike full-workflow.spec.ts (browser mode with mocked IPC), this test exercises
 * the real Rust backend — parsing, saving, and report generation.
 *
 * Prerequisites:
 *   - Built Tauri binary: src-tauri/target/debug/rheolab-enterprise.exe
 *   - Or run via: npx playwright test --config playwright.tauri.config.ts tests/e2e/full-workflow.tauri.spec.ts
 *
 * The globalSetup script launches the binary with --remote-debugging-port.
 */

import { test as base, expect } from './base-test.tauri';
import { ComparisonReportsPage } from './pages';
import { CHANDLER_SST_63, GRACE_REPORT } from './fixtures';

// Extend tauri fixtures with comparisonReports (not in base-test.tauri.ts)
const test = base.extend<{ comparisonReports: ComparisonReportsPage }>({
    comparisonReports: async ({ page }, use) => {
        await use(new ComparisonReportsPage(page));
    },
});

import { setupBeforeEach } from './base-test.tauri';
setupBeforeEach(test);

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Full E2E Workflow (Tauri)', () => {
    test.setTimeout(300_000); // 5 min — real Rust parsing + report generation

    // In Tauri mode all tests share one process — clean comparison state between tests
    test.beforeEach(async ({ page }) => {
        // Close any lingering dialogs/overlays
        const overlay = page.locator('[data-testid="ComparisonSelectorOverlay"]');
        if (await overlay.isVisible({ timeout: 500 }).catch(() => false)) {
            await page.keyboard.press('Escape');
            await overlay.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
        }
        // Clear comparison store — remove persisted state and reload so
        // Zustand re-hydrates with empty experiments array.
        await page.evaluate(() => {
            localStorage.removeItem('comparison-storage');
        }).catch(() => {});
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1_500);
    });

    // ── Step 1: Upload + parse + verify chart ─────────────────────────
    test('1_upload_parse_chart_renders', async ({ dashboard }) => {
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.expectChartVisible();
        await dashboard.expectNoAnalysisError();
        console.log('✓ Chandler parsed (real Rust), chart rendered');
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
        await dashboard.switchTab('chart');
        await dashboard.expectChartVisible();
    });

    // ── Step 3: Save experiment to DB ─────────────────────────────────
    test('3_save_experiment_to_db', async ({ dashboard }) => {
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();

        const { name } = await dashboard.saveExperiment({ name: `Tauri-WF-${Date.now()}` });
        console.log(`✓ Saved experiment "${name}" to real SQLite`);
    });

    // ── Step 4: Library — saved experiments appear + search filter ────
    test('4_library_filters_and_search', async ({ dashboard, library }) => {
        // Save two experiments
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        const exp1 = await dashboard.saveExperiment({ name: `Tauri-Search-1-${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `Tauri-Search-2-${Date.now()}` });

        // Navigate to Library
        await library.goto();
        await library.expectLoaded();
        await library.expectMinExperimentCount(2);

        // Search
        await library.search(exp1.name);
        await library.expectExperimentVisible(exp1.name);
        console.log('✓ Search filter works on real DB');

        // Clear
        await library.search('');
        await library.expectMinExperimentCount(2);

        // Instrument filter
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

        // Clear all filters
        const clearBtn = library.clearFiltersButton;
        if (await clearBtn.isVisible({ timeout: 2_000 }).catch(() => false) &&
            await clearBtn.isEnabled({ timeout: 1_000 }).catch(() => false)) {
            await library.clearAllFilters();
            await library.waitForListSettled();
            console.log('✓ Filters cleared');
        }
    });

    // ── Step 5: Single-experiment report (PDF + Excel) ───────────────
    test('5_single_exp_report_generation', async ({ dashboard, reports }) => {
        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();

        await reports.goto();
        await reports.expectPdfButtonVisible();

        const pdfDl = await reports.downloadPdf();
        const pdfName = pdfDl.suggestedFilename();
        expect(pdfName).toMatch(/\.pdf$/i);
        console.log(`✓ PDF downloaded: ${pdfName}`);

        const xlsxDl = await reports.downloadExcel();
        const xlsxName = xlsxDl.suggestedFilename();
        expect(xlsxName).toMatch(/\.xlsx$/i);
        console.log(`✓ Excel downloaded: ${xlsxName}`);
    });

    // ── Step 6: Comparison — add two experiments, verify chart ────────
    test('6_comparison_chart_with_two_experiments', async ({ dashboard, comparison }) => {
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `Tauri-Comp-1-${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `Tauri-Comp-2-${Date.now()}` });

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

    // ── Step 7: Comparison report — toggles + PDF/Excel ──────────────
    test('7_comparison_report_toggles_and_download', async ({
        dashboard, comparison, comparisonReports,
    }) => {
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `Tauri-CmpRpt-1-${Date.now()}` });

        await dashboard.goto();
        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis();
        await dashboard.saveExperiment({ name: `Tauri-CmpRpt-2-${Date.now()}` });

        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);

        await comparisonReports.switchToReportTab();
        await comparisonReports.expectLoaded();
        await comparisonReports.expectExportButtonsEnabled();

        // All 5 section toggles
        await expect(comparisonReports.calibrationToggle).toBeVisible();
        await expect(comparisonReports.rawDataToggle).toBeVisible();
        await expect(comparisonReports.recipeToggle).toBeVisible();
        await expect(comparisonReports.waterAnalysisToggle).toBeVisible();
        await expect(comparisonReports.rheologyToggle).toBeVisible();
        console.log('✓ All 5 section toggles visible');

        // Default states
        expect(await comparisonReports.calibrationToggle.getAttribute('data-state')).toBe('off');
        expect(await comparisonReports.recipeToggle.getAttribute('data-state')).toBe('on');
        expect(await comparisonReports.rheologyToggle.getAttribute('data-state')).toBe('on');

        // Toggle rheology
        await comparisonReports.rheologyToggle.click();
        expect(await comparisonReports.rheologyToggle.getAttribute('data-state')).toBe('off');
        await comparisonReports.rheologyToggle.click();
        expect(await comparisonReports.rheologyToggle.getAttribute('data-state')).toBe('on');
        console.log('✓ Rheology toggle interactive');

        // PDF
        const pdfDl = await comparisonReports.downloadPdf();
        expect(pdfDl.suggestedFilename()).toMatch(/comparison.*\.pdf$/i);
        console.log(`✓ Comparison PDF: ${pdfDl.suggestedFilename()}`);

        // Excel
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
        await dashboard.saveExperiment({ name: `Tauri-Lang-1-${Date.now()}` });

        await comparison.goto();
        await comparison.expectLoaded();
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.expectChipCount(1);

        await comparisonReports.switchToReportTab();
        await comparisonReports.expectLoaded();

        await comparisonReports.selectLanguage('en');
        await comparisonReports.selectLanguage('ru');

        await comparisonReports.expectExportButtonsEnabled();
        console.log('✓ Language switch works');
    });
});
