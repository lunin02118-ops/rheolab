/**
 * @fileoverview Page Object — Comparison → Report sub-tab.
 *
 * Encapsulates interaction with the ComparisonReportTab UI added in
 * Phase 3: switching between the Chart and Report sub-tabs, toggling
 * report sections, and triggering PDF / Excel downloads.
 *
 * Uses the data-testid attributes declared in:
 * - `src/app/dashboard/comparison/page.tsx` (sub-tab triggers)
 * - `src/components/comparison/reports/ComparisonReportSettings.tsx`
 * - `src/components/comparison/reports/ComparisonReportTab.tsx`
 */

import { type Page, type Locator, type Download, expect } from '@playwright/test';

export class ComparisonReportsPage {
    readonly page: Page;

    // — Sub-tab triggers (rendered inside the Comparison view) —
    readonly chartTabTrigger: Locator;
    readonly reportTabTrigger: Locator;

    // — Settings panel —
    readonly tabRoot: Locator;
    readonly languageRuButton: Locator;
    readonly languageEnButton: Locator;
    readonly calibrationToggle: Locator;
    readonly rawDataToggle: Locator;
    readonly recipeToggle: Locator;
    readonly waterAnalysisToggle: Locator;
    readonly rheologyToggle: Locator;

    // — Export buttons —
    readonly pdfButton: Locator;
    readonly excelButton: Locator;
    readonly errorAlert: Locator;

    constructor(page: Page) {
        this.page = page;

        this.chartTabTrigger = page.getByTestId('ComparisonChartTabTrigger');
        this.reportTabTrigger = page.getByTestId('ComparisonReportTabTrigger');

        this.tabRoot = page.getByTestId('ComparisonReportTabRoot');
        this.languageRuButton = page.getByTestId('ComparisonReportLanguageRu');
        this.languageEnButton = page.getByTestId('ComparisonReportLanguageEn');

        this.calibrationToggle = page.getByTestId('ComparisonReportCalibrationToggle');
        this.rawDataToggle = page.getByTestId('ComparisonReportRawDataToggle');
        this.recipeToggle = page.getByTestId('ComparisonReportRecipeToggle');
        this.waterAnalysisToggle = page.getByTestId('ComparisonReportWaterAnalysisToggle');
        this.rheologyToggle = page.getByTestId('ComparisonReportRheologyToggle');

        this.pdfButton = page.getByTestId('ComparisonReportPdfButton');
        this.excelButton = page.getByTestId('ComparisonReportExcelButton');
        this.errorAlert = page.getByTestId('ComparisonReportError');
    }

    // ── Actions ────────────────────────────────────────────────────────────

    /** Switch to the Report sub-tab and wait for its root to render. */
    async switchToReportTab() {
        await this.reportTabTrigger.click();
        await expect(this.tabRoot).toBeVisible({ timeout: 10_000 });
    }

    /** Switch back to the Chart sub-tab. */
    async switchToChartTab() {
        await this.chartTabTrigger.click();
    }

    async selectLanguage(lang: 'ru' | 'en') {
        await (lang === 'ru' ? this.languageRuButton : this.languageEnButton).click();
    }

    /**
     * Trigger PDF download and resolve with the `Download` event.  The
     * underlying IPC mock returns a 8 KB fake payload so the assertion
     * threshold in {@link assertDownload} should be >= 8 KB when running
     * against the browser E2E harness.
     */
    async downloadPdf(timeoutMs = 30_000): Promise<Download> {
        const downloadPromise = this.page.waitForEvent('download', { timeout: timeoutMs });
        await this.pdfButton.click();
        return downloadPromise;
    }

    async downloadExcel(timeoutMs = 30_000): Promise<Download> {
        const downloadPromise = this.page.waitForEvent('download', { timeout: timeoutMs });
        await this.excelButton.click();
        return downloadPromise;
    }

    // ── Assertions ────────────────────────────────────────────────────────

    /** Assert the Report sub-tab root is visible (we are inside Report tab). */
    async expectLoaded() {
        await expect(this.tabRoot).toBeVisible({ timeout: 10_000 });
    }

    /** Assert both export buttons are rendered and enabled. */
    async expectExportButtonsEnabled() {
        await expect(this.pdfButton).toBeVisible({ timeout: 10_000 });
        await expect(this.pdfButton).toBeEnabled();
        await expect(this.excelButton).toBeVisible({ timeout: 10_000 });
        await expect(this.excelButton).toBeEnabled();
    }

    /** Assert both export buttons are visible but disabled (empty state). */
    async expectExportButtonsDisabled() {
        await expect(this.pdfButton).toBeVisible({ timeout: 10_000 });
        await expect(this.pdfButton).toBeDisabled();
        await expect(this.excelButton).toBeVisible({ timeout: 10_000 });
        await expect(this.excelButton).toBeDisabled();
    }

    /**
     * Validate a download has the expected extension, starts with the
     * comparison-report filename prefix and meets a minimum byte size.
     */
    async assertDownload(download: Download, expectedExt: 'pdf' | 'xlsx', minSizeBytes = 4096) {
        const filename = download.suggestedFilename();
        expect(filename.toLowerCase().endsWith(`.${expectedExt}`)).toBe(true);
        expect(filename).toMatch(/^comparison-report_/i);

        const filePath = await download.path();
        expect(filePath).toBeTruthy();

        const fs = await import('fs');
        const stats = fs.statSync(filePath!);
        expect(stats.size).toBeGreaterThanOrEqual(minSizeBytes);

        return { filename, size: stats.size };
    }
}
