/**
 * Page Object — Report tab (on Dashboard)
 *
 * After UI-018 refactoring the separate /dashboard/reports route was removed.
 * Reports are now generated via the "Report" tab inside DashboardContent.
 * This page object clicks the ReportTabButton on the dashboard to open the
 * report form, then interacts with its controls.
 */

import { type Page, type Locator, type Download, expect } from '@playwright/test';

export class ReportsPage {
  readonly page: Page;

  // — Tab button on the dashboard toolbar —
  readonly reportTabButton: Locator;

  // — Report controls inside ReportTab —
  readonly downloadButton: Locator;
  readonly calibrationToggle: Locator;
  readonly rawDataToggle: Locator;
  readonly formatPdfCheckbox: Locator;
  readonly formatExcelCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;
    this.reportTabButton = page.getByTestId('ReportTabButton');
    this.downloadButton = page.getByTestId('ReportDownloadButton');
    this.calibrationToggle = page.getByTestId('ReportCalibrationToggle');
    this.rawDataToggle = page.getByTestId('ReportRawDataToggle');
    this.formatPdfCheckbox = page.getByTestId('ReportFormatPdf');
    this.formatExcelCheckbox = page.getByTestId('ReportFormatExcel');
  }

  // ===================== Actions =====================

  /** Switch to the Report tab on the dashboard */
  async goto() {
    await this.reportTabButton.click();
    await expect(this.downloadButton).toBeVisible({ timeout: 10_000 });
  }

  /** Alias kept for backward compatibility with existing E2E tests */
  async navigateViaNav() {
    await this.goto();
  }

  /** Click the unified download button (generates PDF+Excel based on checkboxes). */
  async download(timeoutMs = 30_000): Promise<Download> {
    const downloadPromise = this.page.waitForEvent('download', { timeout: timeoutMs });
    await this.downloadButton.click();
    // When the rheology source is the program-calculated table (the default when
    // the instrument table is unavailable), a confirmation dialog must be
    // accepted before the export actually runs.
    await this.confirmProgramExportIfPresent();
    return downloadPromise;
  }

  /** Click download, accept the program-rheology confirmation if needed, and settle. */
  async clickDownloadAndSettle(timeoutMs = 30_000): Promise<Download | null> {
    const downloadPromise = this.page
      .waitForEvent('download', { timeout: timeoutMs })
      .catch(() => null);

    await this.downloadButton.click();
    await this.confirmProgramExportIfPresent();
    await expect(this.page.getByTestId('ProgramRheologyConfirmDialog')).not.toBeVisible({
      timeout: 5_000,
    }).catch(() => undefined);
    await expect(this.downloadButton).not.toBeDisabled({ timeout: timeoutMs });

    return downloadPromise;
  }

  /** Accept the program-rheology confirmation dialog if it is shown. */
  async confirmProgramExportIfPresent() {
    const dialog = this.page.getByTestId('ProgramRheologyConfirmDialog');
    if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // The footer renders Cancel first, then the confirm (OK) action last.
      await dialog.locator('button').last().click();
    }
  }

  /** Download PDF only: uncheck Excel, ensure PDF checked, click download. */
  async downloadPdf(timeoutMs = 30_000): Promise<Download> {
    if (!(await this.formatPdfCheckbox.isChecked())) await this.formatPdfCheckbox.click();
    if (await this.formatExcelCheckbox.isChecked()) await this.formatExcelCheckbox.click();
    return this.download(timeoutMs);
  }

  /** Download Excel only: uncheck PDF, ensure Excel checked, click download. */
  async downloadExcel(timeoutMs = 30_000): Promise<Download> {
    if (await this.formatPdfCheckbox.isChecked()) await this.formatPdfCheckbox.click();
    if (!(await this.formatExcelCheckbox.isChecked())) await this.formatExcelCheckbox.click();
    return this.download(timeoutMs);
  }

  /** Toggle calibration data in report */
  async toggleCalibration() {
    await this.calibrationToggle.click();
  }

  /** Toggle raw data in report */
  async toggleRawData() {
    await this.rawDataToggle.click();
  }

  // ===================== Assertions =====================

  /** Assert the download button is visible (report tab is active & data loaded) */
  async expectPdfButtonVisible() {
    await expect(this.downloadButton).toBeVisible({ timeout: 10_000 });
  }

  /** Alias — same button handles both formats now */
  async expectExcelButtonVisible() {
    await expect(this.downloadButton).toBeVisible({ timeout: 10_000 });
  }

  /** Assert a download has the right extension and minimum size */
  async assertDownload(download: Download, expectedExt: string, minSizeBytes = 1024) {
    const filename = download.suggestedFilename();
    expect(filename.toLowerCase()).toContain(expectedExt.toLowerCase());

    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    const fs = await import('fs');
    const stats = fs.statSync(filePath!);
    expect(stats.size).toBeGreaterThanOrEqual(minSizeBytes);

    return { filename, size: stats.size };
  }
}
