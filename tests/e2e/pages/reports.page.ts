/**
 * Page Object — Reports page
 *
 * Encapsulates interaction with report generation:
 * PDF / Excel export, calibration toggle, settings link.
 */

import { type Page, type Locator, type Download, expect } from '@playwright/test';

export class ReportsPage {
  readonly page: Page;

  // — Report controls —
  readonly pdfButton: Locator;
  readonly excelButton: Locator;
  readonly calibrationToggle: Locator;
  readonly rawDataToggle: Locator;
  readonly settingsLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pdfButton = page.getByTestId('ReportsPdfButton');
    this.excelButton = page.getByTestId('ReportsExcelButton');
    this.calibrationToggle = page.getByTestId('ReportCalibrationToggle');
    this.rawDataToggle = page.getByTestId('ReportRawDataToggle');
    this.settingsLink = page.getByTestId('ReportsSettingsLink');
  }

  // ===================== Actions =====================

  /** Navigate to reports page */
  async goto() {
    if (this.page.url().includes('/dashboard/reports')) return;
    const navBtn = this.page.getByTestId('ReportsNavButton');
    if (await navBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await navBtn.click();
      await this.page.waitForURL('**/dashboard/reports', { timeout: 10_000 });
    } else {
      const url = this.page.url();
      const target = url && !url.startsWith('about:')
        ? new URL('/dashboard/reports', url).href
        : '/dashboard/reports';
      await this.page.goto(target);
    }
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Navigate to the Reports tab via nav button */
  async navigateViaNav() {
    await this.page.getByTestId('ReportsNavButton').click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Generate and download a PDF report. Returns the Download object. */
  async downloadPdf(timeoutMs = 30_000): Promise<Download> {
    const downloadPromise = this.page.waitForEvent('download', { timeout: timeoutMs });
    await this.pdfButton.click();
    return downloadPromise;
  }

  /** Generate and download an Excel report. Returns the Download object. */
  async downloadExcel(timeoutMs = 30_000): Promise<Download> {
    const downloadPromise = this.page.waitForEvent('download', { timeout: timeoutMs });
    await this.excelButton.click();
    return downloadPromise;
  }

  /** Toggle calibration data in report */
  async toggleCalibration() {
    await this.calibrationToggle.click();
  }

  /** Toggle raw data in report */
  async toggleRawData() {
    await this.rawDataToggle.click();
  }

  /** Open report settings (navigates to settings page) */
  async openSettings() {
    await this.settingsLink.click();
    await this.page.waitForURL('**/settings*', { timeout: 10_000 });
  }

  // ===================== Assertions =====================

  /** Assert PDF button is visible */
  async expectPdfButtonVisible() {
    await expect(this.pdfButton).toBeVisible({ timeout: 10_000 });
  }

  /** Assert Excel button is visible */
  async expectExcelButtonVisible() {
    await expect(this.excelButton).toBeVisible({ timeout: 10_000 });
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
