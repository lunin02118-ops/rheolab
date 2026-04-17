import { test, expect, Page, Download } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { setupDashboard, waitForAnalysisComplete } from './utils';

async function loadDemoFixture(page: Page, preferred: RegExp): Promise<void> {
    const demoButton = page.getByTestId('DemoFilesButton').first();
    await expect(demoButton).toBeVisible({ timeout: 15000 });
    await demoButton.click();

    const dropdown = page.getByTestId('DemoFilesDropdown').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    const preferredFixture = dropdown.locator('button').filter({ hasText: preferred }).first();
    if (await preferredFixture.count()) {
        await preferredFixture.click();
    } else {
        const fallbackFixture = dropdown.locator('button').first();
        await expect(fallbackFixture).toBeVisible({ timeout: 5000 });
        await fallbackFixture.click();
    }
}

async function persistDownload(download: Download, prefix: string): Promise<string> {
    const outputsDir = path.resolve('outputs');
    fs.mkdirSync(outputsDir, { recursive: true });
    const suggested = download.suggestedFilename();
    const filename = `${prefix}_${Date.now()}_${suggested}`;
    const fullPath = path.join(outputsDir, filename);
    await download.saveAs(fullPath);
    return fullPath;
}

test.describe('Report Generation', () => {
    test.setTimeout(180000);

    test('should generate PDF and Excel reports from demo workflow', async ({ page }) => {
        page.on('console', (msg) => console.log(`BROWSER: ${msg.text()}`));
        page.on('pageerror', (err) => console.log(`BROWSER ERROR: ${err.message}`));

        await setupDashboard(page);
        await loadDemoFixture(page, /Grace/i);

        await waitForAnalysisComplete(page, 90000);
        await expect(page.locator('.uplot-container canvas').first()).toBeVisible({ timeout: 30000 });

        const analysisErrorVisible = await page
            .getByText(/Ошибка анализа данных/i)
            .first()
            .isVisible({ timeout: 500 })
            .catch(() => false);
        expect(analysisErrorVisible).toBeFalsy();

        const reportsNav = page.getByTestId('ReportsNavButton').first();
        await expect(reportsNav).toBeVisible({ timeout: 10000 });
        await reportsNav.click();
        await expect(page).toHaveURL(/\/dashboard\/reports/, { timeout: 15000 });

        const noDataVisible = await page
            .getByText(/Нет данных для отч[её]та/i)
            .first()
            .isVisible({ timeout: 1000 })
            .catch(() => false);
        expect(noDataVisible).toBeFalsy();

        const pdfBtn = page.getByTestId('ReportsPdfButton').first();
        const excelBtn = page.getByTestId('ReportsExcelButton').first();

        await expect(pdfBtn).toBeVisible({ timeout: 15000 });
        await expect(excelBtn).toBeVisible({ timeout: 15000 });
        await expect(pdfBtn).toBeEnabled({ timeout: 15000 });
        await expect(excelBtn).toBeEnabled({ timeout: 15000 });

        const [pdfDownload] = await Promise.all([
            page.waitForEvent('download', { timeout: 90000 }),
            pdfBtn.click(),
        ]);
        const pdfPath = await persistDownload(pdfDownload, 'e2e_report_pdf');
        const pdfStats = fs.statSync(pdfPath);
        expect(pdfPath.toLowerCase().endsWith('.pdf')).toBeTruthy();
        expect(pdfStats.size).toBeGreaterThan(1000);

        const [excelDownload] = await Promise.all([
            page.waitForEvent('download', { timeout: 90000 }),
            excelBtn.click(),
        ]);
        const excelPath = await persistDownload(excelDownload, 'e2e_report_excel');
        const excelStats = fs.statSync(excelPath);
        expect(/\.(xlsx|xls)$/i.test(excelPath)).toBeTruthy();
        expect(excelStats.size).toBeGreaterThan(1000);
    });
});
