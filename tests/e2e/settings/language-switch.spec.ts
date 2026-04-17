/**
 * E2E — Reports: Report language toggle (RU ↔ EN)
 *
 * Group: Reports
 *
 * Verifies that the Русский/English language buttons in the Reports panel:
 * - Default to Russian on first load
 * - Update reactive labels when switching to English
 * - Revert to Russian when switching back
 * - Reset to Russian after a page reload (state is transient, not persisted)
 *
 * Naming: reports_language_{action}_{expectedResult}
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63 } from '../fixtures';

setupBeforeEach(test);

test.describe('Reports — Language toggle', () => {
  test.setTimeout(90_000);

  /**
   * Helper: navigate to the Reports page after uploading a fixture
   * and wait for the panel to be interactive.
   */
  async function loadReportsPanel(
    dashboard: import('../pages').DashboardPage,
    page: import('@playwright/test').Page,
  ) {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();
    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');
    // Wait for the language buttons to be visible
    await expect(page.getByRole('button', { name: 'Русский' })).toBeVisible({ timeout: 15_000 });
  }

  test('reports_language_default_is_russian', async ({ dashboard, page }) => {
    await loadReportsPanel(dashboard, page);

    // The "Русский" button should be styled as active (has border-blue-500 class via selected state)
    // We verify by checking the Unit System label which is language-conditional
    await expect(page.getByText("Система единиц (K')")).toBeVisible();

    // "English" button should be visible but not active (label remains Russian)
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  });

  test('reports_language_switch_to_english_updates_labels', async ({ dashboard, page }) => {
    await loadReportsPanel(dashboard, page);

    // Switch to English
    await page.getByRole('button', { name: 'English' }).click();

    // The unit system label should now appear in English
    await expect(page.getByText("Unit System (K')")).toBeVisible({ timeout: 5_000 });

    // Russian label should no longer be visible
    await expect(page.getByText("Система единиц (K')")).not.toBeVisible();
  });

  test('reports_language_switch_back_to_russian_restores_labels', async ({ dashboard, page }) => {
    await loadReportsPanel(dashboard, page);

    // Switch to English then back to Russian
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByText("Unit System (K')")).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Русский' }).click();
    await expect(page.getByText("Система единиц (K')")).toBeVisible({ timeout: 5_000 });
  });

  test('reports_language_resets_to_russian_after_page_reload', async ({ dashboard, page }) => {
    await loadReportsPanel(dashboard, page);

    // Switch to English
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByText("Unit System (K')")).toBeVisible({ timeout: 5_000 });

    // Reload the page — component state is not persisted to localStorage
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // After reload the Reports page re-initialises with Russian
    // (we navigate back since the app might redirect to dashboard on reload)
    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: 'Русский' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Система единиц (K')")).toBeVisible({ timeout: 5_000 });
  });
});
