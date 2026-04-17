import { test, expect, Page, Locator } from '@playwright/test';
import { setupDashboard } from './utils';

async function openTopNav(page: Page, automationId: string, expectedUrl: RegExp) {
    const navLink = page.getByTestId(automationId).first();
    await expect(navLink).toBeVisible({ timeout: 10000 });
    await navLink.click();
    await expect(page).toHaveURL(expectedUrl, { timeout: 15000 });
}

async function loadDemoExperiment(page: Page) {
    const demoButton = page.getByTestId('DemoFilesButton').first();
    await expect(demoButton).toBeVisible({ timeout: 15000 });
    await demoButton.click();

    const dropdown = page.getByTestId('DemoFilesDropdown').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    const firstFixture = dropdown.locator('button').first();
    await expect(firstFixture).toBeVisible({ timeout: 5000 });
    await firstFixture.click();

    await expect(page.getByText('Реологический анализ')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.uplot-container canvas').first()).toBeVisible({ timeout: 20000 });
}

async function fillDialogInputIfExists(scope: Locator, testId: string, value: string) {
    const input = scope.getByTestId(testId).first();
    if (!(await input.count())) {
        return;
    }
    await input.clear();
    await input.fill(value);
}

async function fillDialogWaterParams(scope: Locator, params: Record<string, string>) {
    for (const [key, value] of Object.entries(params)) {
        const input = scope.getByTestId(`SaveDialogWaterParam-${key}`).first();
        if (!(await input.count())) {
            continue;
        }
        await input.clear();
        await input.fill(value);
    }
}

async function expectDialogWaterParams(scope: Locator, params: Record<string, string>) {
    for (const [key, value] of Object.entries(params)) {
        const input = scope.getByTestId(`SaveDialogWaterParam-${key}`).first();
        if (!(await input.count())) {
            continue;
        }
        await expect(input).toHaveValue(value);
    }
}

async function ensureAtLeastOneReagent(page: Page): Promise<string> {
    const result = await page.evaluate(async () => {
        const listResponse = await fetch('/api/reagents', { cache: 'no-store' });
        if (listResponse.ok) {
            const list = await listResponse.json();
            if (Array.isArray(list) && list.length > 0) {
                const first = list.find((item) => typeof item?.name === 'string');
                if (first) {
                    return { ok: true, reagentName: String(first.name) };
                }
            }
        }

        const reagentName = `E2E-Reagent-${Date.now()}`;
        const createResponse = await fetch('/api/reagents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: reagentName,
                category: 'Gelling Agent',
                manufacturer: 'E2E',
                country: 'Russia',
                form: 'Powder',
            }),
        });

        if (!createResponse.ok) {
            const body = await createResponse.text().catch(() => '');
            return {
                ok: false,
                reagentName: '',
                error: `Failed to seed reagent. status=${createResponse.status}, body=${body}`,
            };
        }

        return { ok: true, reagentName };
    });

    expect(result.ok, result.error || 'Failed to seed reagent catalog for parity E2E').toBeTruthy();
    return result.reagentName;
}

async function configureDashboardRecipe(
    page: Page,
    preferredReagentName: string,
    concentration: string,
    batchNumber: string
) {
    await page.getByTestId('RecipeTabButton').click();
    const addReagentButton = page.getByTestId('AddReagentButton').first();
    await expect(addReagentButton).toBeVisible({ timeout: 10000 });
    await addReagentButton.click();

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });

    const reagentSelect = firstRow.locator('td').nth(0).locator('select').first();
    await expect(reagentSelect).toBeVisible({ timeout: 10000 });
    const options = reagentSelect.locator('option');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(1);

    let selectedReagentValue = '';
    const preferredOption = options.filter({ hasText: preferredReagentName }).first();
    if (await preferredOption.count()) {
        selectedReagentValue = (await preferredOption.getAttribute('value')) || '';
    }
    if (!selectedReagentValue) {
        selectedReagentValue = (await options.nth(1).getAttribute('value')) || '';
    }

    expect(selectedReagentValue).toBeTruthy();
    await reagentSelect.selectOption(selectedReagentValue);

    const concentrationInput = firstRow.locator('td').nth(1).locator('input').first();
    await concentrationInput.fill(concentration);

    const unitSelect = firstRow.getByTestId('ReagentUnitComboBox').first();
    await unitSelect.selectOption('gpt');

    const batchInput = firstRow.locator('td').nth(3).locator('input').first();
    await batchInput.fill(batchNumber);

    return { selectedReagentValue };
}

async function expectDashboardRecipe(
    page: Page,
    expected: { reagentValue: string; concentration: string; batchNumber: string }
) {
    await page.getByTestId('RecipeTabButton').click();
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 15000 });

    const reagentSelect = firstRow.locator('td').nth(0).locator('select').first();
    await expect(reagentSelect).toHaveValue(expected.reagentValue);

    const concentrationInput = firstRow.locator('td').nth(1).locator('input').first();
    await expect(concentrationInput).toHaveValue(expected.concentration);

    const unitSelect = firstRow.getByTestId('ReagentUnitComboBox').first();
    await expect(unitSelect).toHaveValue('gpt');

    const batchInput = firstRow.locator('td').nth(3).locator('input').first();
    await expect(batchInput).toHaveValue(expected.batchNumber);
}

async function waitForSavedExperimentId(page: Page, experimentName: string): Promise<string> {
    const startedAt = Date.now();
    const timeoutMs = 30000;

    while (Date.now() - startedAt < timeoutMs) {
        const id = await page.evaluate(async (targetName) => {
            const response = await fetch('/api/experiments?page=1&limit=50', { cache: 'no-store' });
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

async function saveCurrentExperiment(page: Page, experimentName: string) {
    const openSaveButton = page.getByTestId('SaveExperimentButton').first();
    await expect(openSaveButton).toBeVisible({ timeout: 10000 });
    await openSaveButton.click();

    const dialog = page.getByTestId('SaveExperimentDialogWindow');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await fillDialogInputIfExists(dialog, 'SaveDialogNameTextBox', experimentName);
    await fillDialogInputIfExists(dialog, 'SaveDialogFieldTextBox', 'Parity Field');
    await fillDialogInputIfExists(dialog, 'SaveDialogOperatorTextBox', 'Parity Operator');
    await fillDialogInputIfExists(dialog, 'SaveDialogWellTextBox', `Parity-Well-${Date.now()}`);
    await fillDialogInputIfExists(dialog, 'SaveDialogAuthorTextBox', 'Parity Author');
    await fillDialogInputIfExists(dialog, 'SaveDialogLaboratoryTextBox', 'Parity Lab');
    await fillDialogInputIfExists(dialog, 'SaveDialogWaterSourceTextBox', 'Parity Water');

    const saveButton = dialog.getByTestId('SaveDialogSaveButton');
    await expect(saveButton).toBeEnabled({ timeout: 10000 });
    await saveButton.click();

    const overwriteButton = page.getByRole('button', { name: /Перезаписать/i }).first();
    if (await overwriteButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await overwriteButton.click();
    }

    await expect(dialog).toBeHidden({ timeout: 20000 });
}

test.describe('CSharp UI parity scenarios', () => {
    test.setTimeout(240000);

    test('top navigation opens analysis/library/comparison/reports views', async ({ page }) => {
        await setupDashboard(page);

        await openTopNav(page, 'DashboardNavButton', /\/dashboard$/);
        await expect(page.getByText('Загрузка данных')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('FileUploadCard')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('DemoFilesButton').first()).toBeVisible({ timeout: 10000 });

        await openTopNav(page, 'LibraryNavButton', /\/dashboard\/library/);
        await expect(page.getByTestId('ExperimentsTabButton')).toBeVisible({ timeout: 10000 });

        await openTopNav(page, 'ComparisonNavButton', /\/dashboard\/comparison/);
        await expect(page.getByText('Сравнение экспериментов')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('OpenExperimentSelectorButton').first()).toBeVisible({
            timeout: 10000,
        });

        await openTopNav(page, 'ReportsNavButton', /\/dashboard\/reports/);
        await expect(page.getByText(/Генерация отч[её]та|Нет данных для отч[её]та/i).first()).toBeVisible({
            timeout: 10000,
        });
    });

    test('main window exposes stable automation id equivalent', async ({ page }) => {
        await setupDashboard(page);
        await expect(page.getByTestId('MainWindow')).toBeVisible({ timeout: 10000 });
    });

    test('settings opens from user menu', async ({ page }) => {
        await setupDashboard(page);

        const userMenuButton = page.getByTestId('UserProfileMenuButton').first();
        await expect(userMenuButton).toBeVisible({ timeout: 10000 });
        await userMenuButton.click();

        const settingsLink = page.getByTestId('UserProfileSettingsLink').first();
        await expect(settingsLink).toBeVisible({ timeout: 5000 });
        await settingsLink.click();

        await expect(page).toHaveURL(/\/dashboard\/settings/, { timeout: 15000 });
        await expect(page.getByTestId('SettingsViewRoot')).toBeVisible({ timeout: 10000 });
        await expect(page.getByRole('heading', { name: /Настройки/i })).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('SettingsMainTabs').getByRole('tab')).toHaveCount(6, { timeout: 10000 });
    });

    test('library exposes reagents controls and clear filters resets query', async ({ page }) => {
        await setupDashboard(page);
        await openTopNav(page, 'LibraryNavButton', /\/dashboard\/library/);

        const listViewButton = page.getByTestId('ListViewButton');
        const gridViewButton = page.getByTestId('GridViewButton');
        await expect(listViewButton).toBeVisible({ timeout: 10000 });
        await expect(gridViewButton).toBeVisible({ timeout: 10000 });
        await listViewButton.click();
        await gridViewButton.click();

        const reagentsTab = page.getByTestId('ReagentsTabButton');
        await expect(reagentsTab).toBeVisible({ timeout: 10000 });
        await reagentsTab.click();

        const reagentSearch = page.getByTestId('ReagentsSearchInput');
        const reagentCategory = page.getByTestId('ReagentCategoryFilter');
        const clearReagentFilters = page.getByTestId('ClearReagentFiltersButton');

        await expect(reagentSearch).toBeVisible({ timeout: 10000 });
        await expect(reagentCategory).toBeVisible({ timeout: 10000 });
        await expect(clearReagentFilters).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('AddReagentButton').first()).toBeVisible({ timeout: 10000 });

        await reagentSearch.fill('wg');
        await expect(clearReagentFilters).toBeEnabled({ timeout: 5000 });
        await clearReagentFilters.click();
        await expect(reagentSearch).toHaveValue('');

        const experimentsTab = page.getByTestId('ExperimentsTabButton');
        await experimentsTab.click();

        const searchInput = page.getByTestId('ExperimentSearchInput').first();
        await expect(searchInput).toBeVisible({ timeout: 10000 });
        await searchInput.fill('e2e-filter-check');
        await expect(searchInput).toHaveValue('e2e-filter-check');

        const clearFilters = page.getByTestId('ClearFiltersButton').first();
        await expect(clearFilters).toBeEnabled({ timeout: 5000 });
        await clearFilters.click();
        await expect(searchInput).toHaveValue('');
    });

    test('library exposes extended filter controls and list container', async ({ page }) => {
        await setupDashboard(page);
        await openTopNav(page, 'LibraryNavButton', /\/dashboard\/library/);

        const requiredFilters = [
            'ExperimentSearchInput',
            'ExperimentNameFilterInput',
            'ExperimentAuthorFilterInput',
            'ExperimentLaboratoryFilterInput',
            'ExperimentFieldFilterInput',
            'ExperimentOperatorFilterInput',
            'ExperimentWellFilterInput',
            'ExperimentWaterFilterInput',
            'BatchNumberFilterInput',
        ];

        for (const testId of requiredFilters) {
            await expect(page.getByTestId(testId).first()).toBeVisible({ timeout: 10000 });
        }

        await expect
            .poll(async () => {
                const hasList = await page.getByTestId('ExperimentListContainer').count();
                const hasEmpty = await page.getByText('Эксперименты не найдены').count();
                return hasList + hasEmpty;
            }, { timeout: 30000 })
            .toBeGreaterThan(0);
    });

    test('dashboard exposes recipe and save dialog controls parity', async ({ page }) => {
        await setupDashboard(page);
        await loadDemoExperiment(page);

        await expect
            .poll(async () => {
                const uploadSuccess = await page.getByTestId('UploadCardSuccessState').count();
                const saveButton = await page.getByTestId('SaveExperimentButton').count();
                const rawGrid = await page.getByTestId('RawDataGrid').count();
                return uploadSuccess + saveButton + rawGrid;
            }, { timeout: 20000 })
            .toBeGreaterThan(0);

        if (await page.getByTestId('UploadCardSuccessState').count()) {
            await expect(page.getByTestId('UploadCardSuccessFileName')).toHaveText(/\S+/, { timeout: 5000 });
        }

        await expect(page.getByTestId('ChartTabButton')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('DashboardChartContainer')).toBeVisible({ timeout: 10000 });
        await page.getByTestId('RecipeTabButton').click();

        const addReagent = page.getByTestId('AddReagentButton').first();
        await expect(addReagent).toBeVisible({ timeout: 10000 });
        await addReagent.click();

        await expect(page.getByTestId('ReagentUnitComboBox').first()).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('ReagentProductionDatePicker').first()).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('RemoveReagentButton').first()).toBeVisible({ timeout: 10000 });

        await page.getByTestId('SaveExperimentButton').first().click();
        await expect(page.getByTestId('SaveExperimentDialogWindow')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('SaveDialogCloseButton')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('SaveDialogTestDatePicker')).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('SaveDialogAddReagentButton')).toBeVisible({ timeout: 5000 });

        await page.getByTestId('SaveDialogAddReagentButton').click();
        await expect(page.getByTestId('SaveDialogReagentUnitComboBox').first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('SaveDialogReagentDatePicker').first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('SaveDialogRemoveReagentButton').first()).toBeVisible({ timeout: 5000 });

        await page.getByTestId('SaveDialogCloseButton').click();
        await expect(page.getByTestId('SaveExperimentDialogWindow')).toBeHidden({ timeout: 5000 });
    });

    test('save dialog keeps save disabled until required fields are filled', async ({ page }) => {
        await setupDashboard(page);
        await loadDemoExperiment(page);

        const openSaveButton = page.getByTestId('SaveExperimentButton').first();
        await expect(openSaveButton).toBeVisible({ timeout: 10000 });
        await openSaveButton.click();

        const dialog = page.getByTestId('SaveExperimentDialogWindow');
        await expect(dialog).toBeVisible({ timeout: 10000 });
        await expect(dialog.getByText('Сохранить эксперимент')).toBeVisible({ timeout: 5000 });

        const nameInput = dialog.getByTestId('SaveDialogNameTextBox');
        const fieldInput = dialog.getByTestId('SaveDialogFieldTextBox');
        const operatorInput = dialog.getByTestId('SaveDialogOperatorTextBox');
        const wellInput = dialog.getByTestId('SaveDialogWellTextBox');
        const waterSourceInput = dialog.getByTestId('SaveDialogWaterSourceTextBox');

        await nameInput.clear();
        await fieldInput.clear();
        await operatorInput.clear();
        await wellInput.clear();
        await waterSourceInput.clear();

        const dialogSaveButton = dialog.getByTestId('SaveDialogSaveButton');
        await expect(dialogSaveButton).toBeDisabled();

        await nameInput.fill(`E2E_CSharpParity_${Date.now()}`);
        await fieldInput.fill('Parity Field');
        await operatorInput.fill('Parity Operator');
        await wellInput.fill('Parity-001');
        await waterSourceInput.fill('Parity Water');

        await expect(dialogSaveButton).toBeEnabled({ timeout: 5000 });

        const cancelButton = dialog.getByTestId('SaveDialogCancelButton');
        await cancelButton.click();
        await expect(dialog).toBeHidden({ timeout: 5000 });
    });

    test('comparison opens and closes experiment selector', async ({ page }) => {
        await setupDashboard(page);
        await openTopNav(page, 'ComparisonNavButton', /\/dashboard\/comparison/);

        const openButton = page.getByTestId('OpenExperimentSelectorButton').first();
        await expect(openButton).toBeVisible({ timeout: 10000 });
        await openButton.click();

        const selectorDialog = page.getByTestId('ComparisonSelectorDialog');
        await expect(selectorDialog).toBeVisible({ timeout: 10000 });

        const closeButton = page.getByTestId('ComparisonSelectorCloseButton').first();
        await expect(closeButton).toBeVisible({ timeout: 5000 });
        await closeButton.click();

        await expect(selectorDialog).toBeHidden({ timeout: 5000 });
    });

    test('library compare action adds experiment to comparison and allows chip removal', async ({ page }) => {
        await setupDashboard(page);
        await loadDemoExperiment(page);

        const experimentName = `E2E_CSharpParity_Compare_${Date.now()}`;
        await saveCurrentExperiment(page, experimentName);

        await openTopNav(page, 'LibraryNavButton', /\/dashboard\/library/);
        await page.getByTestId('ExperimentsTabButton').click();

        await expect
            .poll(async () => await page.locator('[data-testid^="ExperimentCard_"]').count(), { timeout: 30000 })
            .toBeGreaterThan(0);

        const card = page.locator('[data-testid^="ExperimentCard_"]').first();
        await expect(card).toBeVisible({ timeout: 10000 });

        const cardName = (await card.locator('h3').first().textContent())?.trim() || experimentName;

        await card.getByTestId('AddExperimentButton').first().click();

        await openTopNav(page, 'ComparisonNavButton', /\/dashboard\/comparison/);

        const selectedChips = page.getByTestId('SelectedExperimentsChips');
        await expect(selectedChips).toContainText(cardName, { timeout: 15000 });

        const targetChip = page
            .getByTestId('ComparisonExperimentChip')
            .filter({ hasText: cardName })
            .first();
        await expect(targetChip).toBeVisible({ timeout: 10000 });
        await targetChip.hover();
        await targetChip.getByTestId('ComparisonExperimentChipRemoveButton').click();
        await expect(targetChip).toBeHidden({ timeout: 10000 });
    });

    test('reports exposes actions and settings shortcut opens reports settings tab', async ({ page }) => {
        await setupDashboard(page);
        await loadDemoExperiment(page);

        await openTopNav(page, 'ReportsNavButton', /\/dashboard\/reports/);

        await expect(page.getByTestId('ReportsPdfButton')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('ReportsExcelButton')).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('ReportCalibrationToggle')).toBeVisible({ timeout: 10000 });

        const settingsShortcut = page.getByTestId('ReportsSettingsLink');
        await expect(settingsShortcut).toBeVisible({ timeout: 10000 });
        await settingsShortcut.click();

        await expect(page).toHaveURL(/\/dashboard\/settings\?tab=reports/, { timeout: 15000 });
        await expect(page.getByRole('heading', { name: /^Настройки$/ })).toBeVisible({ timeout: 10000 });
        await expect(page.getByTestId('ReportLineSettingsHeading')).toBeVisible({ timeout: 10000 });
    });

    test('save -> load from library preserves metadata water and recipe fields', async ({ page }) => {
        await setupDashboard(page);
        const reagentName = await ensureAtLeastOneReagent(page);
        await loadDemoExperiment(page);

        const runId = Date.now();
        const experimentName = `E2E_CSharpParity_SaveLoad_${runId}`;
        const expectedField = `Parity-Field-${runId}`;
        const expectedOperator = `Parity-Operator-${runId}`;
        const expectedWell = `Parity-Well-${runId}`;
        const expectedWaterSource = `Parity-Water-${runId}`;
        const expectedBatch = `PARITY-BATCH-${runId}`;
        const expectedConcentration = '3.2';
        const expectedWaterParams: Record<string, string> = {
            ph: '7.4',
            fe: '1.1',
            ca: '22.5',
            mg: '8.2',
            cl: '31.6',
            so4: '16.8',
            hco3: '109.3',
        };

        const { selectedReagentValue } = await configureDashboardRecipe(
            page,
            reagentName,
            expectedConcentration,
            expectedBatch
        );

        const saveButton = page.getByTestId('SaveExperimentButton').first();
        await expect(saveButton).toBeVisible({ timeout: 10000 });
        await saveButton.click();

        const saveDialog = page.getByTestId('SaveExperimentDialogWindow');
        await expect(saveDialog).toBeVisible({ timeout: 10000 });
        await fillDialogInputIfExists(saveDialog, 'SaveDialogNameTextBox', experimentName);
        await fillDialogInputIfExists(saveDialog, 'SaveDialogFieldTextBox', expectedField);
        await fillDialogInputIfExists(saveDialog, 'SaveDialogOperatorTextBox', expectedOperator);
        await fillDialogInputIfExists(saveDialog, 'SaveDialogWellTextBox', expectedWell);
        await fillDialogInputIfExists(saveDialog, 'SaveDialogWaterSourceTextBox', expectedWaterSource);
        await fillDialogWaterParams(saveDialog, expectedWaterParams);

        const saveDialogSaveButton = saveDialog.getByTestId('SaveDialogSaveButton');
        await expect(saveDialogSaveButton).toBeEnabled({ timeout: 10000 });
        await saveDialogSaveButton.click();

        const overwriteButton = page.getByRole('button', { name: /Перезаписать/i }).first();
        if (await overwriteButton.isVisible({ timeout: 1000 }).catch(() => false)) {
            await overwriteButton.click();
        }
        await expect(saveDialog).toBeHidden({ timeout: 20000 });
        const savedExperimentId = await waitForSavedExperimentId(page, experimentName);

        await openTopNav(page, 'LibraryNavButton', /\/dashboard\/library/);
        await page.getByTestId('ExperimentsTabButton').click();

        const card = page.getByTestId(`ExperimentCard_${savedExperimentId}`).first();
        await expect(card).toBeVisible({ timeout: 30000 });
        await card.getByTestId('LoadExperimentButton').click();

        await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });
        await expect(page.getByTestId('SaveExperimentButton').first()).toBeVisible({ timeout: 30000 });

        await expectDashboardRecipe(page, {
            reagentValue: selectedReagentValue,
            concentration: expectedConcentration,
            batchNumber: expectedBatch,
        });

        await page.getByTestId('SaveExperimentButton').first().click();
        const loadedSaveDialog = page.getByTestId('SaveExperimentDialogWindow');
        await expect(loadedSaveDialog).toBeVisible({ timeout: 10000 });

        await expect(loadedSaveDialog.getByTestId('SaveDialogNameTextBox')).toHaveValue(experimentName);
        await expect(loadedSaveDialog.getByTestId('SaveDialogFieldTextBox')).toHaveValue(expectedField);
        await expect(loadedSaveDialog.getByTestId('SaveDialogOperatorTextBox')).toHaveValue(expectedOperator);
        await expect(loadedSaveDialog.getByTestId('SaveDialogWellTextBox')).toHaveValue(expectedWell);
        await expect(loadedSaveDialog.getByTestId('SaveDialogWaterSourceTextBox')).toHaveValue(expectedWaterSource);
        await expectDialogWaterParams(loadedSaveDialog, expectedWaterParams);

        await loadedSaveDialog.getByTestId('SaveDialogCancelButton').click();
        await expect(loadedSaveDialog).toBeHidden({ timeout: 5000 });
    });
});
