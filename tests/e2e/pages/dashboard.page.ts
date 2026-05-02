/**
 * Page Object — Dashboard (Analysis) page
 *
 * Encapsulates interaction with the main analysis dashboard:
 * file upload, demo-file loading, tab switching, chart / table assertions,
 * and the save-experiment dialog.
 */

import { type Page, type Locator, expect } from '@playwright/test';
import path from 'path';
import type { TestFixture } from '../fixtures';

export class DashboardPage {
  readonly page: Page;

  // — Navigation —
  readonly navDashboard: Locator;
  readonly navLibrary: Locator;
  readonly navComparison: Locator;
  readonly navReportTab: Locator;

  // — File upload —
  readonly fileUploadCard: Locator;
  readonly fileInput: Locator;
  readonly uploadIdleState: Locator;
  readonly uploadLoadingState: Locator;
  readonly uploadSuccessState: Locator;
  readonly uploadErrorState: Locator;
  readonly uploadResetLink: Locator;

  // — Demo files —
  readonly demoFilesButton: Locator;
  readonly demoFilesDropdown: Locator;

  // — Content tabs —
  readonly chartTab: Locator;
  readonly tableTab: Locator;
  readonly recipeTab: Locator;
  readonly waterTab: Locator;
  readonly calibrationTab: Locator;

  // — Chart —
  readonly chartContainer: Locator;
  readonly chartSurface: Locator;

  // — Save dialog —
  readonly saveButton: Locator;
  readonly saveDialog: Locator;
  readonly saveDialogName: Locator;
  readonly saveDialogField: Locator;
  readonly saveDialogOperator: Locator;
  readonly saveDialogWell: Locator;
  readonly saveDialogDate: Locator;
  readonly saveDialogWaterSource: Locator;
  readonly saveDialogAddReagent: Locator;
  readonly saveDialogSave: Locator;
  readonly saveDialogCancel: Locator;
  readonly saveDialogClose: Locator;
  // Classification selects (new)
  readonly saveDialogFluidType: Locator;
  readonly saveDialogTestCategory: Locator;
  readonly saveDialogTestType: Locator;

  constructor(page: Page) {
    this.page = page;

    // Navigation
    this.navDashboard = page.getByTestId('DashboardNavButton');
    this.navLibrary = page.getByTestId('LibraryNavButton');
    this.navComparison = page.getByTestId('ComparisonNavButton');
    this.navReportTab = page.getByTestId('ReportTabButton');

    // File upload
    this.fileUploadCard = page.getByTestId('FileUploadCard');
    this.fileInput = page.locator('input[type="file"]');
    this.uploadIdleState = page.getByTestId('UploadCardIdleState');
    this.uploadLoadingState = page.getByTestId('UploadCardLoadingState');
    this.uploadSuccessState = page.getByTestId('UploadCardSuccessState');
    this.uploadErrorState = page.getByTestId('UploadCardErrorState');
    this.uploadResetLink = page.getByTestId('UploadCardResetLink');

    // Demo files
    this.demoFilesButton = page.getByTestId('DemoFilesButton').first();
    this.demoFilesDropdown = page.getByTestId('DemoFilesDropdown').first();

    // Content tabs
    this.chartTab = page.getByTestId('ChartTabButton');
    this.tableTab = page.getByTestId('TableTabButton');
    this.recipeTab = page.getByTestId('RecipeTabButton');
    this.waterTab = page.getByTestId('WaterTabButton');
    this.calibrationTab = page.getByTestId('CalibrationTabButton');

    // Chart
    this.chartContainer = page.getByTestId('DashboardChartContainer');
    this.chartSurface = page.locator('.uplot-container').first();

    // Save dialog
    this.saveButton = page.getByTestId('SaveExperimentButton');
    this.saveDialog = page.getByTestId('SaveExperimentDialogWindow');
    this.saveDialogName = page.getByTestId('SaveDialogNameTextBox');
    this.saveDialogField = page.getByTestId('SaveDialogFieldTextBox');
    this.saveDialogOperator = page.getByTestId('SaveDialogOperatorTextBox');
    this.saveDialogWell = page.getByTestId('SaveDialogWellTextBox');
    this.saveDialogDate = page.getByTestId('SaveDialogTestDatePicker');
    this.saveDialogWaterSource = page.getByTestId('SaveDialogWaterSourceTextBox');
    this.saveDialogAddReagent = page.getByTestId('SaveDialogAddReagentButton');
    this.saveDialogSave = page.getByTestId('SaveDialogSaveButton');
    this.saveDialogCancel = page.getByTestId('SaveDialogCancelButton');
    this.saveDialogClose = page.getByTestId('SaveDialogCloseButton');
    // Classification selects (new)
    this.saveDialogFluidType = page.getByTestId('SaveDialogFluidTypeSelect');
    this.saveDialogTestCategory = page.getByTestId('SaveDialogTestCategorySelect');
    this.saveDialogTestType = page.getByTestId('SaveDialogTestTypeSelect');
  }

  // ===================== Actions =====================

  /** Navigate to the dashboard page */
  async goto() {
    if (this.page.url().match(/\/dashboard($|\?)/)) return;
    const navBtn = this.page.getByTestId('DashboardNavButton');
    if (await navBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await navBtn.click();
      await this.page.waitForURL('**/dashboard', { timeout: 10_000 });
    } else {
      const url = this.page.url();
      const target = url && !url.startsWith('about:')
        ? new URL('/dashboard', url).href
        : '/dashboard';
      await this.page.goto(target);
    }
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Load a demo file from the dropdown */
  async loadDemoFile(fixture: TestFixture) {
    await expect(this.demoFilesButton).toBeVisible({ timeout: 15_000 });
    await this.demoFilesButton.click();
    await expect(this.demoFilesDropdown).toBeVisible({ timeout: 5_000 });
    const item = this.page.getByTestId(`DemoFileItem-${fixture.fileName}`).first();
    await expect(item).toBeVisible({ timeout: 5_000 });
    await item.click();
  }

  /** Upload a fixture file via file input */
  async uploadFile(fixture: TestFixture) {
    const fixturePath = path.resolve('tests/fixtures', fixture.fileName);
    await expect(this.fileInput).toBeAttached({ timeout: 15_000 });
    await this.fileInput.setInputFiles(fixturePath);
  }

  /** Wait for analysis to complete — chart or table becomes visible */
  async waitForAnalysis(timeoutMs = 90_000) {
    await Promise.race([
      this.chartSurface.waitFor({ state: 'visible', timeout: timeoutMs }),
      this.page.locator('table').first().waitFor({ state: 'visible', timeout: timeoutMs }),
    ]);
  }

  /** Wait for cycle count to appear in the UI: "(N циклов)" */
  async waitForCycles(minCycles = 1, timeoutMs = 90_000) {
    const result = await this.page.waitForFunction(
      (min) => {
        const text = document.body.innerText || '';
        const match = text.match(/\((\d+)\s+циклов\)/);
        if (match) {
          const n = Number(match[1]);
          if (n >= min) return { ok: true, count: n };
        }
        return false;
      },
      minCycles,
      { timeout: timeoutMs },
    );
    return (await result.jsonValue()) as { ok: true; count: number };
  }

  /** Switch to a content tab */
  async switchTab(tab: 'chart' | 'table' | 'recipe' | 'water' | 'calibration') {
    const map = {
      chart: this.chartTab,
      table: this.tableTab,
      recipe: this.recipeTab,
      water: this.waterTab,
      calibration: this.calibrationTab,
    };
    await map[tab].click();
  }

  private async dismissBlockingToasts() {
    const closeButtons = this.page.locator('[aria-live="polite"] button[aria-label="Закрыть"]');
    const count = await closeButtons.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i--) {
      await closeButtons.nth(i).click({ timeout: 1_000 }).catch(() => undefined);
    }
  }

  private async settleSaveUi() {
    await expect(this.saveDialog).not.toBeVisible({ timeout: 10_000 }).catch(() => undefined);
    await this.dismissBlockingToasts();
    await this.page.waitForTimeout(100);
  }

  /**
   * Open the save-experiment dialog, fill required fields, and click Save.
   * Returns the experiment name used.
   */
  async saveExperiment(overrides: {
    name?: string;
    field?: string;
    operator?: string;
    well?: string;
    waterSource?: string;
    onAfterDialogOpen?: () => Promise<void>;
    onBeforeCommit?: () => Promise<void>;
    onAfterCommit?: () => Promise<void>;
  } = {}) {
    const runId = Date.now().toString();
    const name = overrides.name ?? `E2E Test ${runId}`;
    const field = overrides.field ?? `E2E Field ${runId}`;
    const operator = overrides.operator ?? `E2E Operator ${runId}`;
    const well = overrides.well ?? `E2E-Well-${runId}`;
    const waterSource = overrides.waterSource ?? 'E2E Water Source';

    await this.settleSaveUi();
    if (!(await this.saveDialog.isVisible().catch(() => false))) {
      await expect(this.saveButton).toBeVisible({ timeout: 10_000 });
      await expect(this.saveButton).toBeEnabled({ timeout: 10_000 });
      await this.saveButton.scrollIntoViewIfNeeded();
      await this.saveButton.click();
    }
    await expect(this.saveDialog).toBeVisible({ timeout: 5_000 });
    await overrides.onAfterDialogOpen?.();

    // Fill all required fields
    await this.saveDialogName.clear();
    await this.saveDialogName.fill(name);
    await this.saveDialogField.clear();
    await this.saveDialogField.fill(field);
    await this.saveDialogOperator.clear();
    await this.saveDialogOperator.fill(operator);
    await this.saveDialogWell.clear();
    await this.saveDialogWell.fill(well);

    // Water source if visible
    if (await this.saveDialogWaterSource.isVisible().catch(() => false)) {
      const val = await this.saveDialogWaterSource.inputValue().catch(() => '');
      if (!val.trim()) {
        await this.saveDialogWaterSource.fill(waterSource);
      }
    }

    // Wait for Save button to become enabled (validation)
    await expect(this.saveDialogSave).toBeEnabled({ timeout: 10_000 });
    await overrides.onBeforeCommit?.();
    await this.saveDialogSave.click();

    // Wait for dialog to close (success)
    await expect(this.saveDialog).not.toBeVisible({ timeout: 10_000 });
    await overrides.onAfterCommit?.();
    await this.dismissBlockingToasts();

    return { name, field, operator, well };
  }

  // ===================== Assertions =====================

  /** Assert the chart is rendered */
  async expectChartVisible() {
    await expect(this.chartSurface).toBeVisible({ timeout: 10_000 });
  }

  /** Assert the raw-data table card is rendered (collapsed by default) */
  async expectTableVisible() {
    await this.switchTab('table');
    await expect(this.page.getByText(/Сырые данные/)).toBeVisible({ timeout: 10_000 });
    await expect(this.page.getByText(/\d+\s*точек/)).toBeVisible({ timeout: 5_000 });
  }

  /** Assert no analysis error toast is present */
  async expectNoAnalysisError() {
    await expect(this.page.getByText('Ошибка анализа данных')).toHaveCount(0);
  }
}
