import { test, expect, Page, Locator, Download } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { setupDashboard } from './utils';

async function openTopNav(page: Page, automationId: string, expectedUrl: RegExp) {
    const navLink = page.getByTestId(automationId).first();
    await expect(navLink).toBeVisible({ timeout: 10000 });
    await navLink.click();
    await expect(page).toHaveURL(expectedUrl, { timeout: 15000 });
}

async function loadDemoFixture(page: Page, fixtureName: RegExp) {
    const demoButton = page.getByTestId('DemoFilesButton').first();
    await expect(demoButton).toBeVisible({ timeout: 15000 });
    await demoButton.click();

    const dropdown = page.getByTestId('DemoFilesDropdown').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    const fixtureButton = dropdown.locator('button').filter({ hasText: fixtureName }).first();
    if (!(await fixtureButton.count())) {
        const available = await dropdown.locator('button').allTextContents();
        throw new Error(`Demo fixture not found for pattern ${fixtureName}. Available: ${available.join(', ')}`);
    }

    await fixtureButton.click();
}

async function waitForAnalysisReady(page: Page) {
    await expect(page.getByText('Реологический анализ')).toBeVisible({ timeout: 60000 });

    await expect
        .poll(
            async () => {
                const chartVisible = await page
                    .locator('.uplot-container canvas')
                    .first()
                    .isVisible({ timeout: 1000 })
                    .catch(() => false);
                const tableVisible = await page
                    .getByRole('table')
                    .first()
                    .isVisible({ timeout: 1000 })
                    .catch(() => false);
                return chartVisible || tableVisible;
            },
            { timeout: 30000 },
        )
        .toBe(true);

    const analysisErrorVisible = await page
        .getByText(/Ошибка анализа данных/i)
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
    expect(analysisErrorVisible).toBeFalsy();
}

async function fillDialogInputIfExists(scope: Locator, testId: string, value: string) {
    const input = scope.getByTestId(testId).first();
    if (!(await input.count())) {
        return;
    }
    await input.clear();
    await input.fill(value);
}

async function waitForSavedExperimentId(page: Page, experimentName: string): Promise<string> {
    const startedAt = Date.now();
    const timeoutMs = 30000;

    while (Date.now() - startedAt < timeoutMs) {
        const id = await page.evaluate(async (targetName) => {
            const response = await fetch('/api/experiments?page=1&limit=100', { cache: 'no-store' });
            if (!response.ok) {
                return '';
            }

            const data = await response.json();
            const experiments = Array.isArray(data?.experiments) ? data.experiments : [];
            const found = experiments.find((item: { id?: unknown; name?: unknown }) => item?.name === targetName);
            return typeof found?.id === 'string' ? found.id : '';
        }, experimentName);

        if (id) {
            return id;
        }

        await page.waitForTimeout(500);
    }

    throw new Error(`Saved experiment not found in API list: ${experimentName}`);
}

async function saveCurrentExperiment(page: Page, experimentName: string): Promise<string> {
    const openSaveButton = page.getByTestId('SaveExperimentButton').first();
    await expect(openSaveButton).toBeVisible({ timeout: 10000 });
    await openSaveButton.click();

    const dialog = page.getByTestId('SaveExperimentDialogWindow').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    const runId = Date.now();
    await fillDialogInputIfExists(dialog, 'SaveDialogNameTextBox', experimentName);
    await fillDialogInputIfExists(dialog, 'SaveDialogFieldTextBox', `E2E-Field-${runId}`);
    await fillDialogInputIfExists(dialog, 'SaveDialogOperatorTextBox', `E2E-Operator-${runId}`);
    await fillDialogInputIfExists(dialog, 'SaveDialogWellTextBox', `E2E-Well-${runId}`);
    await fillDialogInputIfExists(dialog, 'SaveDialogAuthorTextBox', `E2E-Author-${runId}`);
    await fillDialogInputIfExists(dialog, 'SaveDialogLaboratoryTextBox', `E2E-Lab-${runId}`);
    await fillDialogInputIfExists(dialog, 'SaveDialogWaterSourceTextBox', `E2E-Water-${runId}`);

    const saveButton = dialog.getByTestId('SaveDialogSaveButton').first();
    await expect(saveButton).toBeEnabled({ timeout: 10000 });
    await saveButton.click();

    const overwriteButton = page.getByRole('button', { name: /Перезаписать/i }).first();
    if (await overwriteButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await overwriteButton.click();
    }

    await expect(dialog).toBeHidden({ timeout: 20000 });
    return waitForSavedExperimentId(page, experimentName);
}

async function persistDownload(download: Download, prefix: string): Promise<string> {
    const outputsDir = path.resolve('outputs');
    fs.mkdirSync(outputsDir, { recursive: true });
    const suggestedName = download.suggestedFilename();
    const fullPath = path.join(outputsDir, `${prefix}_${Date.now()}_${suggestedName}`);
    await download.saveAs(fullPath);
    return fullPath;
}

test.describe('Critical workflow parity', () => {
    test.setTimeout(240000);

    test('demo parse -> save/load -> report download -> comparison', async ({ page }) => {
        await setupDashboard(page);
        await loadDemoFixture(page, /Chandler/i);
        await waitForAnalysisReady(page);

        const experimentName = `E2E_CriticalWorkflow_${Date.now()}`;
        const experimentId = await saveCurrentExperiment(page, experimentName);

        await openTopNav(page, 'LibraryNavButton', /\/dashboard\/library/);
        await page.getByTestId('ExperimentsTabButton').first().click();

        const card = page.getByTestId(`ExperimentCard_${experimentId}`).first();
        await expect(card).toBeVisible({ timeout: 30000 });
        await card.getByTestId('LoadExperimentButton').first().click();

        await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30000 });
        await expect(page.getByTestId('SaveExperimentButton').first()).toBeVisible({ timeout: 30000 });
        await waitForAnalysisReady(page);

        await page.getByTestId('SaveExperimentButton').first().click();
        const loadedDialog = page.getByTestId('SaveExperimentDialogWindow').first();
        await expect(loadedDialog).toBeVisible({ timeout: 10000 });
        await expect(loadedDialog.getByTestId('SaveDialogNameTextBox').first()).toHaveValue(experimentName);
        await loadedDialog.getByTestId('SaveDialogCancelButton').first().click();
        await expect(loadedDialog).toBeHidden({ timeout: 5000 });

        await openTopNav(page, 'ReportsNavButton', /\/dashboard\/reports/);

        const noDataVisible = await page
            .getByText(/Нет данных для отч[её]та/i)
            .first()
            .isVisible({ timeout: 1000 })
            .catch(() => false);
        expect(noDataVisible).toBeFalsy();

        const pdfButton = page.getByTestId('ReportsPdfButton').first();
        const excelButton = page.getByTestId('ReportsExcelButton').first();

        await expect(pdfButton).toBeVisible({ timeout: 15000 });
        await expect(excelButton).toBeVisible({ timeout: 15000 });
        await expect(pdfButton).toBeEnabled({ timeout: 15000 });
        await expect(excelButton).toBeEnabled({ timeout: 15000 });

        const [pdfDownload] = await Promise.all([
            page.waitForEvent('download', { timeout: 90000 }),
            pdfButton.click(),
        ]);
        const pdfPath = await persistDownload(pdfDownload, 'e2e_critical_pdf');
        const pdfStats = fs.statSync(pdfPath);
        expect(pdfPath.toLowerCase().endsWith('.pdf')).toBeTruthy();
        expect(pdfStats.size).toBeGreaterThan(1000);

        const [excelDownload] = await Promise.all([
            page.waitForEvent('download', { timeout: 90000 }),
            excelButton.click(),
        ]);
        const excelPath = await persistDownload(excelDownload, 'e2e_critical_excel');
        const excelStats = fs.statSync(excelPath);
        expect(/\.(xlsx|xls)$/i.test(excelPath)).toBeTruthy();
        expect(excelStats.size).toBeGreaterThan(1000);

        await openTopNav(page, 'LibraryNavButton', /\/dashboard\/library/);
        await page.getByTestId('ExperimentsTabButton').first().click();
        const cardForComparison = page.getByTestId(`ExperimentCard_${experimentId}`).first();
        await expect(cardForComparison).toBeVisible({ timeout: 30000 });
        await cardForComparison.getByTestId('AddExperimentButton').first().click();

        await openTopNav(page, 'ComparisonNavButton', /\/dashboard\/comparison/);
        await expect(page.getByTestId('SelectedExperimentsChips')).toContainText(experimentName, { timeout: 15000 });
    });
});
