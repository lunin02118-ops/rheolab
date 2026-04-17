/**
 * E2E — Reports: PDF & Excel Export
 *
 * Group: Reports (mirrors WPF RheoLab.Tests/Reports/)
 *
 * Tests report generation after loading a demo file:
 * - PDF download with correct filename and minimum size
 * - Excel download with correct filename and minimum size
 * - Calibration toggle
 * - Report settings link
 *
 * Naming: reports_{action}_{expectedResult}
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63, GRACE_REPORT } from '../fixtures';

setupBeforeEach(test);

test.describe('Reports — PDF generation', () => {
  test.setTimeout(120_000);

  test('reports_pdf_download_chandler_valid_file', async ({ dashboard, reports, page }) => {
    // Upload a real fixture file
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Navigate to Reports
    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');
    await reports.expectPdfButtonVisible();

    // Download PDF
    const download = await reports.downloadPdf();
    const { filename, size } = await reports.assertDownload(download, '.pdf', 1024);
    console.log(`PDF: ${filename}, ${size} bytes`);
  });

  test('reports_pdf_download_grace_valid_file', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(GRACE_REPORT);
    await dashboard.waitForAnalysis();

    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');
    await reports.expectPdfButtonVisible();

    const download = await reports.downloadPdf();
    const { filename, size } = await reports.assertDownload(download, '.pdf', 1024);
    console.log(`PDF: ${filename}, ${size} bytes`);
  });
});

test.describe('Reports — Excel generation', () => {
  test.setTimeout(120_000);

  test('reports_excel_download_chandler_valid_file', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');
    await reports.expectExcelButtonVisible();

    const download = await reports.downloadExcel();
    const { filename, size } = await reports.assertDownload(download, '.xlsx', 1024);
    console.log(`Excel: ${filename}, ${size} bytes`);
  });
});

test.describe('Reports — UI controls', () => {
  test.setTimeout(120_000);

  test('reports_pdf_and_excel_buttons_visible_after_analysis', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');

    await reports.expectPdfButtonVisible();
    await reports.expectExcelButtonVisible();
  });

  test('reports_calibration_toggle_exists', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');

    await expect(reports.calibrationToggle).toBeVisible({ timeout: 10_000 });
  });

  test('reports_raw_data_toggle_exists', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');

    await expect(reports.rawDataToggle).toBeVisible({ timeout: 10_000 });
  });

  test('reports_raw_data_toggle_changes_state', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');

    // Initially off – check toggle visual state (bg-slate-800 = off)
    const toggle = reports.rawDataToggle;
    await expect(toggle).toBeVisible({ timeout: 10_000 });

    // Click to enable
    await toggle.click();
    // The button should now have blue styling
    await expect(toggle).toHaveClass(/bg-blue-500/, { timeout: 5_000 });

    // Click to disable
    await toggle.click();
    // Should revert to default (off) styling
    await expect(toggle).toHaveClass(/bg-background/, { timeout: 5_000 });
  });

  test('reports_pdf_with_raw_data_enabled_downloads_valid_file', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');

    // Enable raw data toggle before downloading
    await expect(reports.rawDataToggle).toBeVisible({ timeout: 10_000 });
    await reports.toggleRawData();

    // Download PDF with raw data — should produce a valid PDF with extra data page
    const download = await reports.downloadPdf(60_000);
    const { filename, size } = await reports.assertDownload(download, '.pdf', 1024);

    console.log(`PDF with raw data: ${filename}, ${size} bytes`);
  });

  test('reports_settings_link_navigates_to_settings', async ({ dashboard, reports, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await page.getByTestId('ReportsNavButton').click();
    await page.waitForLoadState('domcontentloaded');

    await expect(reports.settingsLink).toBeVisible({ timeout: 10_000 });
    await reports.openSettings();

    await expect(page.getByTestId('SettingsViewRoot')).toBeVisible({ timeout: 10_000 });
  });
});
