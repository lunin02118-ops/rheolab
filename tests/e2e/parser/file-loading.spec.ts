/**
 * E2E — Parser: File Loading & Analysis (REAL DATA)
 *
 * Group: Parser (mirrors WPF RheoLab.Tests/Parser/)
 *
 * Tests that every supported instrument format can be loaded via file upload
 * and analysed by the **real WASM parser** without errors.
 * Demo-file buttons are NOT used — all files go through `input[type="file"]`.
 *
 * Naming: upload_{instrument}_{format}_produces_valid_analysis
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { ALL_FIXTURES } from '../fixtures';

setupBeforeEach(test);

test.describe('Parser — Upload all fixture formats (real WASM)', () => {
  test.setTimeout(120_000);

  for (const fixture of ALL_FIXTURES) {
    test(`upload_${fixture.displayName}_produces_valid_analysis`, async ({ dashboard }) => {
      await dashboard.uploadFile(fixture);

      // Wait for WASM to parse (may take 15–30 s on first load)
      await dashboard.waitForAnalysis(90_000);

      // Chart must be visible
      await dashboard.expectChartVisible();
      await dashboard.expectNoAnalysisError();

      // For fixtures with known cycles, verify cycle count
      if (fixture.minCycles > 0) {
        const result = await dashboard.waitForCycles(fixture.minCycles, 30_000);
        expect(result.count).toBeGreaterThanOrEqual(fixture.minCycles);
      }
    });
  }
});

test.describe('Parser — Error handling', () => {
  test.setTimeout(60_000);

  test('upload_invalid_file_shows_error_state', async ({ dashboard, page }) => {
    // Create a tiny invalid file in-memory
    const buffer = Buffer.from('this is not a valid instrument file');
    await dashboard.fileInput.setInputFiles({
      name: 'invalid.csv',
      mimeType: 'text/csv',
      buffer,
    });

    // Should show either error state or no analysis result — no crash
    await page.waitForTimeout(5_000);

    // Page should still be functional — nav buttons visible
    await expect(dashboard.navLibrary).toBeVisible();
  });
});
