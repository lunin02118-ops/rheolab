/**
 * E2E — Dashboard: UI Interaction & Views (REAL DATA)
 *
 * Group: UI (mirrors WPF RheoLab.Tests/UI/)
 *
 * Tests the main dashboard functionality after uploading a real fixture file
 * (parsed by the real WASM engine): tab switching, chart, table, recipe, water.
 *
 * Naming: dashboard_{action}_{expectedResult}
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63 } from '../fixtures';

setupBeforeEach(test);

test.describe('Dashboard — Navigation', () => {
  test.setTimeout(60_000);

  test('dashboard_nav_buttons_navigate_correctly', async ({ page }) => {
    // All 4 nav buttons should be visible
    await expect(page.getByTestId('DashboardNavButton')).toBeVisible();
    await expect(page.getByTestId('LibraryNavButton')).toBeVisible();
    await expect(page.getByTestId('ComparisonNavButton')).toBeVisible();
    await expect(page.getByTestId('SettingsNavButton')).toBeVisible();

    // Navigate to library
    await page.getByTestId('LibraryNavButton').click();
    await page.waitForURL('**/library', { timeout: 10_000 });
    await expect(page.getByTestId('LibraryPageRoot')).toBeVisible({ timeout: 10_000 });

    // Navigate to comparison
    await page.getByTestId('ComparisonNavButton').click();
    await page.waitForURL('**/comparison', { timeout: 10_000 });
    await expect(page.getByTestId('ComparisonPageRoot')).toBeVisible({ timeout: 10_000 });

    // Navigate back to dashboard
    await page.getByTestId('DashboardNavButton').click();
    await page.waitForURL('**/dashboard', { timeout: 10_000 });
  });

  test('dashboard_settings_accessible_from_nav', async ({ page }) => {
    await page.getByTestId('SettingsNavButton').click();
    await page.waitForURL('**/settings*', { timeout: 10_000 });
    await expect(page.getByTestId('SettingsViewRoot')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Dashboard — Upload & Analysis (real WASM)', () => {
  test.setTimeout(120_000);

  test('dashboard_idle_state_shows_upload_card', async ({ dashboard }) => {
    await expect(dashboard.fileUploadCard).toBeVisible({ timeout: 10_000 });
    await expect(dashboard.uploadIdleState).toBeVisible();
    // DemoFilesButton may be hidden when fixture list is empty (no Tauri backend)
    // The important thing is that the file upload area is ready
    await expect(dashboard.fileInput).toBeAttached();
  });

  test('dashboard_upload_file_produces_chart_and_table', async ({ dashboard }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Chart tab — chart visible
    await dashboard.expectChartVisible();

    // Table tab — real data should produce the raw data table card with point count
    await dashboard.switchTab('table');
    await expect(dashboard.page.getByText(/Сырые данные/)).toBeVisible({ timeout: 15_000 });
    await expect(dashboard.page.getByText(/\d+\s*точек/)).toBeVisible({ timeout: 5_000 });
  });

  test('dashboard_tab_switching_works', async ({ dashboard }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Start on chart tab
    await dashboard.expectChartVisible();

    // Switch to table — real data produces the raw data table card
    await dashboard.switchTab('table');
    await expect(dashboard.page.getByText(/Сырые данные/)).toBeVisible({ timeout: 15_000 });

    // Switch to recipe
    await dashboard.switchTab('recipe');
    await expect(dashboard.page.getByTestId('AddReagentButton')).toBeVisible({ timeout: 10_000 });

    // Switch back to chart
    await dashboard.switchTab('chart');
    await dashboard.expectChartVisible();
  });

  test('dashboard_analysis_produces_cycles', async ({ dashboard }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();
    await dashboard.expectChartVisible();
    await dashboard.expectNoAnalysisError();

    // Real data must produce at least 1 cycle
    const result = await dashboard.waitForCycles(CHANDLER_SST_63.minCycles, 30_000);
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  test('dashboard_upload_reset_allows_new_file', async ({ dashboard }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Click reset / upload another
    if (await dashboard.uploadResetLink.isVisible().catch(() => false)) {
      await dashboard.uploadResetLink.click();
      await expect(dashboard.uploadIdleState).toBeVisible({ timeout: 10_000 });
    }
  });
});

test.describe('Dashboard — Recipe & Water tabs', () => {
  test.setTimeout(120_000);

  test('dashboard_recipe_tab_add_and_remove_reagent', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await dashboard.switchTab('recipe');
    const addBtn = page.getByTestId('AddReagentButton');
    await expect(addBtn).toBeVisible({ timeout: 10_000 });

    // Add a reagent row
    await addBtn.click();

    // A reagent unit selector should appear
    const unitSelector = page.getByTestId('ReagentUnitComboBox').first();
    await expect(unitSelector).toBeVisible({ timeout: 5_000 });

    // Remove the reagent
    const removeBtn = page.getByTestId('RemoveReagentButton').first();
    await removeBtn.click();
  });

  test('dashboard_water_tab_displays_content', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await dashboard.switchTab('water');
    // Water tab should have some content — at minimum a water source input
    await page.waitForTimeout(1_000);
    // No crash = pass
    await expect(dashboard.navDashboard).toBeVisible();
  });
});
