/**
 * E2E — Critical Workflow: End-to-end smoke test (REAL DATA)
 *
 * Group: Core (mirrors WPF RheoLab.Tests/Core/)
 *
 * A single comprehensive test that exercises the critical user path
 * using a REAL fixture file parsed by the WASM engine:
 * 1. Upload real file → analysis by WASM
 * 2. Verify chart, table, cycle count
 * 3. Save experiment with metadata
 * 4. Navigate to Library → find experiment
 * 5. Load from library → verify chart
 * 6. Generate PDF & Excel reports
 * 7. Add to comparison → verify chip & chart
 *
 * Naming: critical_{scenario}
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63 } from '../fixtures';

setupBeforeEach(test);

test.describe('Critical workflow', () => {
  test.setTimeout(300_000);

  test('critical_full_user_journey', async ({ dashboard, library, comparison, reports, page }) => {
    const runId = Date.now().toString();
    const experimentName = `Critical E2E ${runId}`;

    // ── Step 1: Upload real file & verify analysis ──
    await test.step('Upload real file', async () => {
      await dashboard.uploadFile(CHANDLER_SST_63);
      await dashboard.waitForAnalysis();
      await dashboard.expectChartVisible();
      await dashboard.expectNoAnalysisError();
    });

    // ── Step 2: Verify cycle count ──
    await test.step('Verify cycle count', async () => {
      const result = await dashboard.waitForCycles(1);
      expect(result.count).toBeGreaterThanOrEqual(1);
    });

    // ── Step 3: Verify tab switching ──
    await test.step('Verify tab switching', async () => {
      await dashboard.switchTab('table');
      await expect(page.getByText(/Сырые данные/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/\d+\s*точек/)).toBeVisible({ timeout: 5_000 });

      await dashboard.switchTab('chart');
      await dashboard.expectChartVisible();
    });

    // ── Step 4: Save experiment with metadata ──
    let _savedMeta: { name: string; field: string; operator: string; well: string };
    await test.step('Save experiment', async () => {
      _savedMeta = await dashboard.saveExperiment({
        name: experimentName,
        field: `Critical Field ${runId}`,
        operator: `Critical Op ${runId}`,
        well: `CRT-${runId}`,
      });
    });

    // ── Step 5: Navigate to Library & find experiment ──
    await test.step('Find experiment in library', async () => {
      await library.goto();
      await library.expectLoaded();
      await library.search(experimentName);
      await library.expectExperimentVisible(experimentName);
    });

    // ── Step 6: Load from Library → verify chart ──
    await test.step('Load experiment from library', async () => {
      await library.loadExperimentByName(experimentName);
      await page.waitForURL(/\/dashboard(\?.*)?$/, { timeout: 15_000 });
      await dashboard.waitForAnalysis(30_000);
      await dashboard.expectChartVisible();
    });

    // ── Step 7: Generate PDF report ──
    await test.step('Generate PDF report', async () => {
      await reports.goto();
      await reports.expectPdfButtonVisible();

      const pdfDownload = await reports.downloadPdf(60_000);
      const { filename, size } = await reports.assertDownload(pdfDownload, '.pdf', 1024);
      console.log(`PDF: ${filename}, ${size} bytes`);
    });

    // ── Step 8: Generate Excel report ──
    await test.step('Generate Excel report', async () => {
      const excelDownload = await reports.downloadExcel(60_000);
      const { filename, size } = await reports.assertDownload(excelDownload, '.xlsx', 1024);
      console.log(`Excel: ${filename}, ${size} bytes`);
    });

    // ── Step 9: Add to comparison ──
    await test.step('Add to comparison from library', async () => {
      await library.goto();
      await library.expectLoaded();
      await library.search(experimentName);
      await library.expectExperimentVisible(experimentName);
      await library.addToComparisonByName(experimentName);
    });

    // ── Step 10: Verify comparison ──
    await test.step('Verify comparison page', async () => {
      await comparison.goto();
      await comparison.expectLoaded();

      const chips = comparison.getExperimentChips();
      const count = await chips.count();
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });
});
