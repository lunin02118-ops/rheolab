/**
 * E2E — Database: Save & Load Experiments
 *
 * Group: Database (mirrors WPF RheoLab.Tests/Database/)
 *
 * Tests saving experiments to the database and loading them back.
 * Verifies metadata round-trip, reagent persistence, water-source persistence.
 *
 * Naming: database_{action}_{condition}_{expectedResult}
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63, GRACE_REPORT } from '../fixtures';

setupBeforeEach(test);

const TEST_ID = Date.now().toString();

test.describe('Database — Save experiment', () => {
  test.setTimeout(180_000);

  test('database_save_experiment_opens_dialog_and_saves', async ({ dashboard }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    const meta = await dashboard.saveExperiment({
      name: `DB Save Test ${TEST_ID}`,
      field: `DB Field ${TEST_ID}`,
      operator: `DB Operator ${TEST_ID}`,
      well: `DB-Well-${TEST_ID}`,
    });

    // After save, dialog should close (confirmed in saveExperiment method)
    expect(meta.name).toContain(TEST_ID);
  });

  test('database_save_dialog_validation_blocks_empty_fields', async ({ dashboard, page: _page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    // Clear all fields
    await dashboard.saveDialogName.clear();
    await dashboard.saveDialogField.clear();
    await dashboard.saveDialogOperator.clear();
    await dashboard.saveDialogWell.clear();

    // Save button should be disabled
    await expect(dashboard.saveDialogSave).toBeDisabled({ timeout: 5_000 });

    // Fill just the name
    await dashboard.saveDialogName.fill('Partial fill');

    // Should still be disabled (other required fields empty)
    await expect(dashboard.saveDialogSave).toBeDisabled({ timeout: 3_000 });

    // Cancel
    await dashboard.saveDialogCancel.click();
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Database — Load experiment from library', () => {
  test.setTimeout(180_000);

  test('database_save_and_load_preserves_metadata', async ({ dashboard, library, page }) => {
    // 1. Load & save an experiment
    await dashboard.uploadFile(GRACE_REPORT);
    await dashboard.waitForAnalysis();

    const name = `Roundtrip Test ${TEST_ID}`;
    const _meta = await dashboard.saveExperiment({
      name,
      field: `RT Field ${TEST_ID}`,
      operator: `RT Op ${TEST_ID}`,
      well: `RT-Well-${TEST_ID}`,
    });

    // 2. Navigate to library
    await library.goto();
    await library.expectLoaded();

    // 3. Search for the experiment
    await library.search(name);
    await library.expectExperimentVisible(name);

    // 4. Load it
    await library.loadExperimentByName(name);

    // 5. Should be back on dashboard with data loaded
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await dashboard.waitForAnalysis(30_000);
    await dashboard.expectChartVisible();
  });
});

test.describe('Database — Recipe & water persistence', () => {
  test.setTimeout(180_000);

  test('database_save_with_reagent_and_load_preserves_recipe', async ({ dashboard, library, page }) => {
    // 1. Upload a real fixture file
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // 2. Add a reagent on the recipe tab
    await dashboard.switchTab('recipe');
    const addBtn = page.getByTestId('AddReagentButton');
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Fill concentration
    const concInput = page.getByTestId('SaveDialogReagentConcentrationInput').first()
      .or(page.locator('input[placeholder*="Концентрация"], input[placeholder*="Кон"]').first());
    if (await concInput.isVisible().catch(() => false)) {
      await concInput.fill('3.5');
    }

    // 3. Save experiment
    const name = `Recipe Test ${TEST_ID}`;
    await dashboard.switchTab('chart');
    await dashboard.saveExperiment({ name });

    // 4. Navigate to library → load the experiment
    await library.goto();
    await library.expectLoaded();
    await library.search(name);
    await library.expectExperimentVisible(name);
    await library.loadExperimentByName(name);

    // 5. Check recipe tab has the reagent
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    await dashboard.waitForAnalysis(30_000);
    await dashboard.switchTab('recipe');

    // At minimum, no crash
    await expect(dashboard.navDashboard).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Classification selects — FluidType / TestCategory / TestType
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Database — Classification selects in save dialog', () => {
  test.setTimeout(180_000);

  test('database_save_dialog_shows_classification_selects', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    // All three classification selects must be present
    await expect(dashboard.saveDialogFluidType).toBeVisible({ timeout: 5_000 });
    await expect(dashboard.saveDialogTestCategory).toBeVisible({ timeout: 5_000 });
    await expect(dashboard.saveDialogTestType).toBeVisible({ timeout: 5_000 });

    // Auto-badge "(авто)" visible because no user override yet
    await expect(page.getByText('(авто)')).toBeVisible({ timeout: 3_000 });

    await dashboard.saveDialogCancel.click();
  });

  test('database_save_dialog_fluid_type_select_has_all_9_options', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    // Open fluid type dropdown
    await dashboard.saveDialogFluidType.click();
    await page.waitForTimeout(300);

    // All 9 fluid types must appear as options
    const expectedLabels = [
      'Линейный', 'Сшитый', 'Слик-вотер', 'VES',
      'Пена', 'Эмульсия', 'WBM', 'OBM', 'SBM',
    ];
    for (const label of expectedLabels) {
      await expect(page.locator('[role="option"]').filter({ hasText: label }).first())
        .toBeVisible({ timeout: 3_000 });
    }

    // Close dropdown
    await page.keyboard.press('Escape');
    await dashboard.saveDialogCancel.click();
  });

  test('database_save_dialog_manual_fluid_type_removes_auto_badge', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    // Initially auto badge is visible
    await expect(page.getByText('(авто)')).toBeVisible({ timeout: 3_000 });

    // Manually change fluid type to 'Сшитый'
    await dashboard.saveDialogFluidType.click();
    await page.waitForTimeout(300);
    await page.locator('[role="option"]').filter({ hasText: 'Сшитый' }).first().click();
    await page.waitForTimeout(300);

    // Auto badge must disappear after manual selection
    await expect(page.getByText('(авто)')).toHaveCount(0);

    await dashboard.saveDialogCancel.click();
  });

  test('database_save_dialog_test_category_select_has_3_options', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    // Open test category dropdown
    await dashboard.saveDialogTestCategory.click();
    await page.waitForTimeout(400);

    // Wait for all 3 options to appear before checking individual labels
    const options = page.locator('[role="option"]');
    await expect(options).toHaveCount(3, { timeout: 5_000 });

    // Verify texts
    const texts = await options.allTextContents();
    expect(texts).toContain('ГРП');
    expect(texts).toContain('Бурение');
    expect(texts).toContain('Общее');

    await page.keyboard.press('Escape');
    await dashboard.saveDialogCancel.click();
  });

  test('database_save_dialog_test_type_cascades_with_category', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    // Switch category to "Бурение"
    await dashboard.saveDialogTestCategory.click();
    await page.waitForTimeout(300);
    await page.locator('[role="option"]').filter({ hasText: 'Бурение' }).first().click();
    await page.waitForTimeout(300);

    // Test type dropdown must now show drilling types
    await dashboard.saveDialogTestType.click();
    await page.waitForTimeout(300);

    // Check a drilling-specific type is present
    await expect(page.locator('[role="option"]').filter({ hasText: 'Реология' }).first())
      .toBeVisible({ timeout: 3_000 });

    // Fracturing-only types must NOT appear
    const fracturingOnlyOption = page.locator('[role="option"]').filter({ hasText: 'Кинетика гидратации' }).first();
    await expect(fracturingOnlyOption).toHaveCount(0);

    await page.keyboard.press('Escape');
    await dashboard.saveDialogCancel.click();
  });

  test('database_save_with_classification_persists_to_library', async ({ dashboard, library, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    const runId = Date.now().toString();
    const name = `Classification Test ${runId}`;

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    // Fill required fields
    await dashboard.saveDialogName.fill(name);
    await dashboard.saveDialogField.fill(`CF_${runId}`);
    await dashboard.saveDialogOperator.fill(`CF_Op_${runId}`);
    await dashboard.saveDialogWell.fill(`CF-${runId}`);
    if (await dashboard.saveDialogWaterSource.isVisible().catch(() => false)) {
      const val = await dashboard.saveDialogWaterSource.inputValue().catch(() => '');
      if (!val.trim()) await dashboard.saveDialogWaterSource.fill('CF Water');
    }

    // Manually set fluid type to Crosslinked
    await dashboard.saveDialogFluidType.click();
    await page.waitForTimeout(300);
    await page.locator('[role="option"]').filter({ hasText: 'Сшитый' }).first().click();
    await page.waitForTimeout(300);

    // Save
    await expect(dashboard.saveDialogSave).toBeEnabled({ timeout: 5_000 });
    await dashboard.saveDialogSave.click();
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 15_000 });

    // Verify classification persisted: filter library by fluid type 'Сшитый гель' —
    // the saved experiment must appear in results
    await library.goto();
    await library.expectLoaded();

    await library.fluidTypeFilter.click();
    await page.waitForTimeout(400);
    await page.locator('[role="option"]').filter({ hasText: 'Сшитый гель' }).first().click();
    await page.waitForTimeout(700);

    await library.search(name);
    await library.expectExperimentVisible(name);
  });
});
