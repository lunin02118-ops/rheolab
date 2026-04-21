/**
 * E2E — Report language toggle (RU ↔ EN)
 *
 * Group: Settings / Reports
 *
 * After UI-018 refactoring the language selector lives in
 * Settings → General → "Отчёты по умолчанию" card.
 * The chosen language is persisted in branding-store and
 * reflected in ReportTab labels on the dashboard.
 *
 * Verifies:
 * - Default language is Russian
 * - Switching to English updates ReportTab labels
 * - Switching back restores Russian labels
 * - Language persists across page reload (branding-store is in localStorage)
 *
 * Naming: reports_language_{action}_{expectedResult}
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63 } from '../fixtures';

setupBeforeEach(test);

test.describe('Reports — Language toggle', () => {
  test.setTimeout(90_000);

  /** Navigate to Settings → General tab where the language selector is. */
  async function openLanguageSettings(page: import('@playwright/test').Page) {
    await page.getByTestId('SettingsNavButton').click();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('ReportLanguageRu')).toBeVisible({ timeout: 15_000 });
  }

  /** Switch to Report tab on the dashboard (requires analysis data). */
  async function openReportTab(
    dashboard: import('../pages').DashboardPage,
    reports: import('../pages').ReportsPage,
    page: import('@playwright/test').Page,
  ) {
    await page.getByTestId('DashboardNavButton').click();
    await page.waitForLoadState('domcontentloaded');
    await reports.goto();
  }

  test('reports_language_default_is_russian', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Default language → Russian; verify ReportTab heading
    await reports.goto();
    await expect(page.getByText('Генерация отчёта')).toBeVisible({ timeout: 10_000 });
  });

  test('reports_language_switch_to_english_updates_labels', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Switch to English in Settings
    await openLanguageSettings(page);
    await page.getByTestId('ReportLanguageEn').click();

    // Go back to dashboard → Report tab
    await openReportTab(dashboard, reports, page);

    // ReportTab heading should now be English
    await expect(page.getByText('Generate Report')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Генерация отчёта')).not.toBeVisible();
  });

  test('reports_language_switch_back_to_russian_restores_labels', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Switch to English
    await openLanguageSettings(page);
    await page.getByTestId('ReportLanguageEn').click();

    // Then back to Russian
    await page.getByTestId('ReportLanguageRu').click();

    // Verify labels on Report tab
    await openReportTab(dashboard, reports, page);
    await expect(page.getByText('Генерация отчёта')).toBeVisible({ timeout: 10_000 });
  });

  test('reports_language_persists_after_page_reload', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Switch to English
    await openLanguageSettings(page);
    await page.getByTestId('ReportLanguageEn').click();

    // Reload the page — branding-store IS persisted in localStorage
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Re-upload to have analysis data
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Report tab should still use English
    await reports.goto();
    await expect(page.getByText('Generate Report')).toBeVisible({ timeout: 10_000 });
  });
});
