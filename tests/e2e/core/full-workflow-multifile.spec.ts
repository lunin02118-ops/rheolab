/**
 * E2E — Full Multi-File Workflow (REAL DATA)
 *
 * Group: Core
 *
 * Comprehensive end-to-end test exercising the complete user workflow
 * with multiple instrument file types:
 *
 * 1. Parse 4 different instrument files (Chandler CSV, Grace XLSX, Brookfield XLSX, Ofite DAT)
 * 2. Verify analysis for each (chart, cycles, tabs)
 * 3. Save each experiment with metadata
 * 4. Navigate to library — verify all 4 experiments appear
 * 5. Load each from library — verify dashboard restores correctly
 * 6. Recipe/water state resets between file loads
 * 7. Add experiments to comparison — verify chips & chart
 * 8. Generate PDF and Excel reports for multiple files
 * 9. Toggle report settings (raw data, calibration) and re-export
 *
 * Uses REAL WASM parsing — no mocks for file analysis.
 *
 * Naming: workflow_{scenario}
 */

import { test, expect, setupBeforeEach } from '../base-test';
import {
  CHANDLER_SST_63,
  GRACE_REPORT,
  BROOKFIELD_4,
  OFITE_1100,
  type TestFixture,
} from '../fixtures';

setupBeforeEach(test);

// ── Test data ──

interface ExperimentEntry {
  fixture: TestFixture;
  name: string;
  field: string;
  operator: string;
  well: string;
}

const RUN_ID = Date.now().toString();

const EXPERIMENTS: ExperimentEntry[] = [
  {
    fixture: CHANDLER_SST_63,
    name: `WF Chandler SST ${RUN_ID}`,
    field: `Мамонтовское ${RUN_ID}`,
    operator: `Оператор-А ${RUN_ID}`,
    well: `С-101-${RUN_ID}`,
  },
  {
    fixture: GRACE_REPORT,
    name: `WF Grace Report ${RUN_ID}`,
    field: `Приобское ${RUN_ID}`,
    operator: `Оператор-Б ${RUN_ID}`,
    well: `П-202-${RUN_ID}`,
  },
  {
    fixture: BROOKFIELD_4,
    name: `WF Brookfield ${RUN_ID}`,
    field: `Самотлорское ${RUN_ID}`,
    operator: `Оператор-В ${RUN_ID}`,
    well: `Б-303-${RUN_ID}`,
  },
  {
    fixture: OFITE_1100,
    name: `WF Ofite ${RUN_ID}`,
    field: `Фёдоровское ${RUN_ID}`,
    operator: `Оператор-Г ${RUN_ID}`,
    well: `О-404-${RUN_ID}`,
  },
];

// ═════════════════════════════════════════════════════════════════
// Main test
// ═════════════════════════════════════════════════════════════════

test.describe('Full multi-file workflow', () => {
  // 10 min total — 4 files × (upload + analysis + save + library + reports)
  test.setTimeout(600_000);

  test('workflow_parse_save_library_comparison_reports', async ({
    dashboard,
    library,
    comparison,
    reports,
    page,
  }) => {
    // ─────────────────────────────────────────────────────
    // PHASE 1: Parse & Save all 4 experiments
    // ─────────────────────────────────────────────────────

    for (let i = 0; i < EXPERIMENTS.length; i++) {
      const exp = EXPERIMENTS[i];

      await test.step(`[${i + 1}/4] Upload & analyse ${exp.fixture.displayName}`, async () => {
        // Always navigate to a fresh dashboard to ensure clean file input
        await dashboard.goto();
        await page.waitForTimeout(1_000);

        // Upload real fixture file
        await dashboard.uploadFile(exp.fixture);

        // Wait for WASM analysis to complete
        await dashboard.waitForAnalysis(90_000);

        // Verify chart rendered
        await dashboard.expectChartVisible();
        await dashboard.expectNoAnalysisError();

        // Verify at least 1 cycle detected
        if (exp.fixture.minCycles > 0) {
          const result = await dashboard.waitForCycles(exp.fixture.minCycles, 60_000);
          expect(result.count).toBeGreaterThanOrEqual(exp.fixture.minCycles);
        }
      });

      await test.step(`[${i + 1}/4] Verify tabs for ${exp.fixture.displayName}`, async () => {
        // Table tab — should show data points
        await dashboard.switchTab('table');
        await expect(page.getByText(/Сырые данные/)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/\d+\s*точек/)).toBeVisible({ timeout: 5_000 });

        // Recipe tab — should be empty (no recipe in these files)
        await dashboard.switchTab('recipe');
        await page.waitForTimeout(500);

        // Back to chart
        await dashboard.switchTab('chart');
        await dashboard.expectChartVisible();
      });

      await test.step(`[${i + 1}/4] Save ${exp.fixture.displayName}`, async () => {
        await dashboard.saveExperiment({
          name: exp.name,
          field: exp.field,
          operator: exp.operator,
          well: exp.well,
        });
      });
    }

    // ─────────────────────────────────────────────────────
    // PHASE 2: Verify all experiments in library
    // ─────────────────────────────────────────────────────

    await test.step('Library — verify all 4 experiments saved', async () => {
      await library.goto();
      await library.expectLoaded();

      // Verify each experiment by name (proven pattern from critical-workflow)
      for (const exp of EXPERIMENTS) {
        await library.search(exp.name);
        await library.expectExperimentVisible(exp.name);
      }

      // Clear search
      await library.clearAllFilters();
    });

    // ─────────────────────────────────────────────────────
    // PHASE 3: Load each experiment from library & verify dashboard
    // ─────────────────────────────────────────────────────

    for (let i = 0; i < EXPERIMENTS.length; i++) {
      const exp = EXPERIMENTS[i];

      await test.step(`Load ${exp.fixture.displayName} from library`, async () => {
        await library.goto();
        await library.expectLoaded();
        await library.search(exp.name);
        await library.expectExperimentVisible(exp.name);

        // Load experiment
        await library.loadExperimentByName(exp.name);
        await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 15_000 });

        // Wait for analysis to restore
        await dashboard.waitForAnalysis(60_000);
        await dashboard.expectChartVisible();
        await dashboard.expectNoAnalysisError();
      });
    }

    // ─────────────────────────────────────────────────────
    // PHASE 4: Recipe state reset between files
    // ─────────────────────────────────────────────────────

    await test.step('Recipe resets when loading new file', async () => {
      // Load first experiment from library (may have recipe from saveExperiment metadata)
      await library.goto();
      await library.search(EXPERIMENTS[0].name);
      await library.loadExperimentByName(EXPERIMENTS[0].name);
      await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 15_000 });
      await dashboard.waitForAnalysis(60_000);

      // Navigate to fresh dashboard and upload a new file — recipe should reset
      await dashboard.goto();
      await page.waitForTimeout(1_000);

      await dashboard.uploadFile(BROOKFIELD_4);
      await dashboard.waitForAnalysis(90_000);

      // Switch to recipe tab — should show empty recipe state
      await dashboard.switchTab('recipe');
      await page.waitForTimeout(1_000);

      // The recipe panel should show "Нет данных о рецептуре" or "0 компонентов"
      // (no reagent rows should exist from the previous experiment)
      const _recipeRows = page.locator('[data-testid="RecipeRow"]');
      const reagentSelectors = page.locator('select, [role="combobox"]').filter({ hasText: /Гуар|Сода|Полимер/ });
      const staleReagentCount = await reagentSelectors.count();
      expect(staleReagentCount).toBe(0);
    });

    // ─────────────────────────────────────────────────────
    // PHASE 5: Comparison — add multiple experiments
    // ─────────────────────────────────────────────────────

    await test.step('Add experiments to comparison from library', async () => {
      // Add first 3 experiments to comparison
      for (let i = 0; i < 3; i++) {
        await library.goto();
        await library.expectLoaded();
        await library.search(EXPERIMENTS[i].name);
        await library.expectExperimentVisible(EXPERIMENTS[i].name);
        await library.addToComparisonByName(EXPERIMENTS[i].name);
      }
    });

    await test.step('Verify comparison page with 3 experiments', async () => {
      await comparison.goto();
      await comparison.expectLoaded();

      // Should have 3 experiment chips
      const chips = comparison.getExperimentChips();
      const chipCount = await chips.count();
      expect(chipCount).toBeGreaterThanOrEqual(3);

      // Comparison chart should render
      await comparison.expectChartVisible();
    });

    await test.step('Remove one experiment from comparison', async () => {
      await comparison.removeExperimentChip(0);
      const chipsAfter = comparison.getExperimentChips();
      const countAfter = await chipsAfter.count();
      expect(countAfter).toBeGreaterThanOrEqual(2);
    });

    // ─────────────────────────────────────────────────────
    // PHASE 6: Reports — PDF & Excel for different files
    // ─────────────────────────────────────────────────────

    // Report from Chandler file
    await test.step('Generate PDF report — Chandler SST', async () => {
      // Load Chandler experiment
      await library.goto();
      await library.search(EXPERIMENTS[0].name);
      await library.loadExperimentByName(EXPERIMENTS[0].name);
      await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 15_000 });
      await dashboard.waitForAnalysis(60_000);

      // Navigate to Reports
      await reports.goto();
      await reports.expectPdfButtonVisible();

      // Download PDF
      const pdfDownload = await reports.downloadPdf(60_000);
      const { filename, size } = await reports.assertDownload(pdfDownload, '.pdf', 1024);
      console.log(`[Chandler PDF] ${filename}, ${size} bytes`);
    });

    await test.step('Generate Excel report — Chandler SST', async () => {
      const excelDownload = await reports.downloadExcel(60_000);
      const { filename, size } = await reports.assertDownload(excelDownload, '.xlsx', 1024);
      console.log(`[Chandler Excel] ${filename}, ${size} bytes`);
    });

    // Report from Grace file with toggled settings
    await test.step('Generate PDF report — Grace with raw data', async () => {
      // Load Grace experiment
      await library.goto();
      await library.search(EXPERIMENTS[1].name);
      await library.loadExperimentByName(EXPERIMENTS[1].name);
      await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 15_000 });
      await dashboard.waitForAnalysis(60_000);

      // Navigate to Reports
      await reports.goto();
      await reports.expectPdfButtonVisible();

      // Toggle raw data ON
      const rawDataToggle = reports.rawDataToggle;
      if (await rawDataToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await rawDataToggle.click();
      }

      // Download PDF with raw data
      const pdfDownload = await reports.downloadPdf(60_000);
      const { filename, size } = await reports.assertDownload(pdfDownload, '.pdf', 1024);
      console.log(`[Grace PDF+RawData] ${filename}, ${size} bytes`);
    });

    await test.step('Generate Excel report — Grace', async () => {
      const excelDownload = await reports.downloadExcel(60_000);
      const { filename, size } = await reports.assertDownload(excelDownload, '.xlsx', 1024);
      console.log(`[Grace Excel] ${filename}, ${size} bytes`);
    });

    // Report from Brookfield
    await test.step('Generate PDF report — Brookfield', async () => {
      await library.goto();
      await library.search(EXPERIMENTS[2].name);
      await library.loadExperimentByName(EXPERIMENTS[2].name);
      await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 15_000 });
      await dashboard.waitForAnalysis(60_000);

      await reports.goto();
      await reports.expectPdfButtonVisible();

      // Toggle calibration ON if visible
      const calToggle = reports.calibrationToggle;
      if (await calToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await calToggle.click();
      }

      const pdfDownload = await reports.downloadPdf(60_000);
      const { filename, size } = await reports.assertDownload(pdfDownload, '.pdf', 1024);
      console.log(`[Brookfield PDF+Calibration] ${filename}, ${size} bytes`);
    });

    // Report from Ofite
    await test.step('Generate Excel report — Ofite', async () => {
      await library.goto();
      await library.search(EXPERIMENTS[3].name);
      await library.loadExperimentByName(EXPERIMENTS[3].name);
      await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 15_000 });
      await dashboard.waitForAnalysis(60_000);

      await reports.goto();
      await reports.expectExcelButtonVisible();

      const excelDownload = await reports.downloadExcel(60_000);
      const { filename, size } = await reports.assertDownload(excelDownload, '.xlsx', 1024);
      console.log(`[Ofite Excel] ${filename}, ${size} bytes`);
    });

    // ─────────────────────────────────────────────────────
    // PHASE 7: Final verification — library still consistent
    // ─────────────────────────────────────────────────────

    await test.step('Final check — all experiments still in library', async () => {
      await library.goto();
      await library.expectLoaded();

      // Verify each experiment still present
      for (const exp of EXPERIMENTS) {
        await library.search(exp.name);
        await library.expectExperimentVisible(exp.name);
      }
    });
  });
});
