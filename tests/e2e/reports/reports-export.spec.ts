/**
 * E2E — Reports: PDF & Excel Export
 *
 * Group: Reports (mirrors WPF RheoLab.Tests/Reports/)
 *
 * After UI-018 refactoring, reports are generated from the "Report" tab
 * inside the Dashboard (no separate /dashboard/reports route).
 *
 * Tests report generation after loading a demo file:
 * - PDF download with correct filename and minimum size
 * - Excel download with correct filename and minimum size
 * - Calibration / raw-data toggles
 *
 * Naming: reports_{action}_{expectedResult}
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63, GRACE_REPORT } from '../fixtures';

setupBeforeEach(test);

test.describe('Reports — PDF generation', () => {
  test.setTimeout(120_000);

  test('reports_pdf_download_chandler_valid_file', async ({ dashboard, reports }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Switch to Report tab on the dashboard
    await reports.goto();
    await reports.expectPdfButtonVisible();

    const download = await reports.downloadPdf();
    const { filename, size } = await reports.assertDownload(download, '.pdf', 1024);
    console.log(`PDF: ${filename}, ${size} bytes`);
  });

  test('reports_pdf_download_grace_valid_file', async ({ dashboard, reports }) => {
    await dashboard.uploadFile(GRACE_REPORT);
    await dashboard.waitForAnalysis();

    await reports.goto();
    await reports.expectPdfButtonVisible();

    const download = await reports.downloadPdf();
    const { filename, size } = await reports.assertDownload(download, '.pdf', 1024);
    console.log(`PDF: ${filename}, ${size} bytes`);
  });
});

test.describe('Reports — Excel generation', () => {
  test.setTimeout(120_000);

  test('reports_excel_download_chandler_valid_file', async ({ dashboard, reports }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await reports.goto();
    await reports.expectExcelButtonVisible();

    const download = await reports.downloadExcel();
    const { filename, size } = await reports.assertDownload(download, '.xlsx', 1024);
    console.log(`Excel: ${filename}, ${size} bytes`);
  });
});

test.describe('Reports — UI controls', () => {
  test.setTimeout(120_000);

  test('reports_download_button_visible_after_analysis', async ({ dashboard, reports }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await reports.goto();

    await reports.expectPdfButtonVisible();
    await reports.expectExcelButtonVisible();
  });

  test('reports_calibration_toggle_exists', async ({ dashboard, reports }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await reports.goto();

    await expect(reports.calibrationToggle).toBeVisible({ timeout: 10_000 });
  });

  test('reports_raw_data_toggle_exists', async ({ dashboard, reports }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await reports.goto();

    await expect(reports.rawDataToggle).toBeVisible({ timeout: 10_000 });
  });

  test('reports_raw_data_toggle_changes_state', async ({ dashboard, reports }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await reports.goto();

    // Raw data toggle is a checkbox in the new ReportTab
    const toggle = reports.rawDataToggle;
    await expect(toggle).toBeVisible({ timeout: 10_000 });

    // Toggle on/off — checkbox checked state
    const wasBefore = await toggle.isChecked();
    await toggle.click();
    const isAfter = await toggle.isChecked();
    expect(isAfter).toBe(!wasBefore);

    // Toggle back
    await toggle.click();
    expect(await toggle.isChecked()).toBe(wasBefore);
  });

  test('reports_pdf_with_raw_data_enabled_downloads_valid_file', async ({ dashboard, reports }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await reports.goto();

    // Enable raw data toggle before downloading
    await expect(reports.rawDataToggle).toBeVisible({ timeout: 10_000 });
    if (!(await reports.rawDataToggle.isChecked())) {
      await reports.toggleRawData();
    }

    // Download PDF with raw data
    const download = await reports.downloadPdf(60_000);
    const { filename, size } = await reports.assertDownload(download, '.pdf', 1024);
    console.log(`PDF with raw data: ${filename}, ${size} bytes`);
  });
});
