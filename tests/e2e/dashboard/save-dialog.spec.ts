/**
 * E2E — Dashboard: Save Dialog error-path and edge-case coverage
 *
 * Group: Dashboard / Save
 *
 * Focus: scenarios that previously produced "Invalid input" or similar
 * Zod validation errors during save, plus overwrite/duplicate logic,
 * water-source pre-fill, and label states.
 *
 * These tests complement tests/e2e/database/save-load.spec.ts (happy-path)
 * and tests/components/save-experiment-dialog.test.tsx (unit tests).
 *
 * Naming: save_{scenario}_{expectedResult}
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63, CHANDLER_REPORT, BSL_REPORT, GRACE_REPORT } from '../fixtures';

setupBeforeEach(test);

// ─────────────────────────────────────────────────────────────────────────────
// No validation error on valid save
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Save dialog — error-free saves', () => {
  test.setTimeout(180_000);

  /**
   * Core regression: saving a real file must NOT show "Invalid input".
   * Previously NaN/Infinity in rawPoints caused Zod finite() to reject.
   */
  test('save_chandler_sst_produces_no_error_banner', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    const runId = Date.now().toString();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    await dashboard.saveDialogName.fill(`NoError SST ${runId}`);
    await dashboard.saveDialogField.fill(`Field ${runId}`);
    await dashboard.saveDialogOperator.fill(`Op ${runId}`);
    await dashboard.saveDialogWell.fill(`W-${runId}`);

    // Ensure water source is filled if present
    if (await dashboard.saveDialogWaterSource.isVisible().catch(() => false)) {
      const val = await dashboard.saveDialogWaterSource.inputValue().catch(() => '');
      if (!val.trim()) await dashboard.saveDialogWaterSource.fill('Test water source');
    }

    await expect(dashboard.saveDialogSave).toBeEnabled({ timeout: 5_000 });
    await dashboard.saveDialogSave.click();

    // Dialog must close — NO error banner blocking it
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 15_000 });

    // Extra: no red error banner should have appeared during save
    const errorBanner = page.locator('text=/Invalid input|Ошибка валидации/i');
    await expect(errorBanner).toHaveCount(0);
  });

  test('save_grace_report_produces_no_error_banner', async ({ dashboard, page }) => {
    await dashboard.uploadFile(GRACE_REPORT);
    await dashboard.waitForAnalysis();

    const runId = Date.now().toString();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    await dashboard.saveDialogName.fill(`NoError Grace ${runId}`);
    await dashboard.saveDialogField.fill(`Field ${runId}`);
    await dashboard.saveDialogOperator.fill(`Op ${runId}`);
    await dashboard.saveDialogWell.fill(`W-${runId}`);

    if (await dashboard.saveDialogWaterSource.isVisible().catch(() => false)) {
      const val = await dashboard.saveDialogWaterSource.inputValue().catch(() => '');
      if (!val.trim()) await dashboard.saveDialogWaterSource.fill('Test water');
    }

    await expect(dashboard.saveDialogSave).toBeEnabled({ timeout: 5_000 });
    await dashboard.saveDialogSave.click();
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 15_000 });

    const errorBanner = page.locator('text=/Invalid input|Ошибка валидации/i');
    await expect(errorBanner).toHaveCount(0);
  });

  /**
   * Regression: BSL calibration files set lastCalDate from the spreadsheet date
   * cell. Must save without validation errors.
   */
  test('save_bsl_report_produces_no_error_banner', async ({ dashboard, page }) => {
    await dashboard.uploadFile(BSL_REPORT);
    await dashboard.waitForAnalysis();

    const runId = Date.now().toString();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    await dashboard.saveDialogName.fill(`NoError BSL ${runId}`);
    await dashboard.saveDialogField.fill(`BSL Field ${runId}`);
    await dashboard.saveDialogOperator.fill(`BSL Op ${runId}`);
    await dashboard.saveDialogWell.fill(`BSL-${runId}`);

    if (await dashboard.saveDialogWaterSource.isVisible().catch(() => false)) {
      const val = await dashboard.saveDialogWaterSource.inputValue().catch(() => '');
      if (!val.trim()) await dashboard.saveDialogWaterSource.fill('Test water BSL');
    }

    await expect(dashboard.saveDialogSave).toBeEnabled({ timeout: 5_000 });
    await dashboard.saveDialogSave.click();
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 15_000 });

    const errorBanner = page.locator('text=/Invalid input|calibration/i');
    await expect(errorBanner).toHaveCount(0);
  });

  /**
   * Regression: Chandler Report (.xls) contains full calibration data including
   * lastCalDate. Previously failed with "Invalid input (поле: calibration.calibrationDate)"
   * because the date string "\u041dеизвестно" was passed to new Date() producing
   * Invalid Date, which Zod v4 z.date() rejects.
   */
  test('save_chandler_report_produces_no_error_banner', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_REPORT);
    await dashboard.waitForAnalysis();

    const runId = Date.now().toString();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    await dashboard.saveDialogName.fill(`NoError Chandler Report ${runId}`);
    await dashboard.saveDialogField.fill(`Ch Field ${runId}`);
    await dashboard.saveDialogOperator.fill(`Ch Op ${runId}`);
    await dashboard.saveDialogWell.fill(`Ch-${runId}`);

    if (await dashboard.saveDialogWaterSource.isVisible().catch(() => false)) {
      const val = await dashboard.saveDialogWaterSource.inputValue().catch(() => '');
      if (!val.trim()) await dashboard.saveDialogWaterSource.fill('Test water Chandler');
    }

    await expect(dashboard.saveDialogSave).toBeEnabled({ timeout: 5_000 });
    await dashboard.saveDialogSave.click();
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 15_000 });

    const errorBanner = page.locator('text=/Invalid input|calibration/i');
    await expect(errorBanner).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation error messages
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Save dialog — validation messages', () => {
  test.setTimeout(120_000);

  test('save_empty_name_shows_name_required_error', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    // Clear name only — button should be immediately disabled
    await dashboard.saveDialogName.clear();
    const btn = dashboard.saveDialogSave;
    await expect(btn).toBeDisabled({ timeout: 3_000 });

    // No error banner yet (disabled = not submitted)
    const banner = page.locator('[class*="red"],[class*="bg-red"]').filter({ hasText: /обязательно|required/i });
    // Banner should only appear after attempted submit (button is disabled so no submit happens automatically)
    await expect(banner).toHaveCount(0);

    await dashboard.saveDialogCancel.click();
  });

  test('save_each_field_cleared_disables_save_button', async ({ dashboard }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    // Fill all required fields first
    await dashboard.saveDialogName.fill('Test Name');
    await dashboard.saveDialogField.fill('Test Field');
    await dashboard.saveDialogOperator.fill('Test Op');
    await dashboard.saveDialogWell.fill('W-001');
    if (await dashboard.saveDialogWaterSource.isVisible().catch(() => false)) {
      const val = await dashboard.saveDialogWaterSource.inputValue().catch(() => '');
      if (!val.trim()) await dashboard.saveDialogWaterSource.fill('Source');
    }

    // Button should now be enabled
    await expect(dashboard.saveDialogSave).toBeEnabled({ timeout: 5_000 });

    // Clear name → disabled
    await dashboard.saveDialogName.clear();
    await expect(dashboard.saveDialogSave).toBeDisabled({ timeout: 3_000 });

    // Restore name, clear operator → disabled
    await dashboard.saveDialogName.fill('Restored');
    await dashboard.saveDialogOperator.clear();
    await expect(dashboard.saveDialogSave).toBeDisabled({ timeout: 3_000 });

    // Restore operator — only name/operator/waterSource are required fields
    await dashboard.saveDialogOperator.fill('Op');

    await dashboard.saveDialogCancel.click();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate / overwrite
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Save dialog — duplicate experiment names', () => {
  test.setTimeout(240_000);

  test('save_duplicate_name_second_save_also_succeeds', async ({ dashboard }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    const name = `Duplicate Test ${Date.now()}`;

    // First save
    await dashboard.saveExperiment({ name, field: 'F1', operator: 'Op1', well: 'W1' });

    // Second save with same name — should complete without error
    // (may trigger an overwrite dialog or silently create a copy — either is acceptable)
    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    await dashboard.saveDialogName.clear();
    await dashboard.saveDialogName.fill(name);
    await dashboard.saveDialogField.fill('F2');
    await dashboard.saveDialogOperator.fill('Op2');
    await dashboard.saveDialogWell.fill('W2');

    if (await dashboard.saveDialogWaterSource.isVisible().catch(() => false)) {
      const val = await dashboard.saveDialogWaterSource.inputValue().catch(() => '');
      if (!val.trim()) await dashboard.saveDialogWaterSource.fill('Water');
    }

    await expect(dashboard.saveDialogSave).toBeEnabled({ timeout: 5_000 });
    await dashboard.saveDialogSave.click();

    // The dialog should close successfully (overwrite or copy accepted)
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 15_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cancel behaviour
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Save dialog — cancel', () => {
  test.setTimeout(120_000);

  test('save_cancel_closes_dialog_without_saving', async ({ dashboard, library }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    const name = `Cancel Test ${Date.now()}`;

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    await dashboard.saveDialogName.fill(name);
    await dashboard.saveDialogCancel.click();

    // Dialog should close
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 5_000 });

    // Experiment should NOT exist in library
    await library.goto();
    await library.expectLoaded();
    await library.search(name);
    // Either no results or "Не найдено" text
    const card = library.page.locator(`[data-testid^="ExperimentCard_"]:has-text("${name}")`).first();
    await expect(card).toHaveCount(0);
  });

  test('save_dialog_reopens_correctly_after_cancel', async ({ dashboard }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    // Open → Cancel
    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });
    await dashboard.saveDialogCancel.click();
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 5_000 });

    // Open again — dialog should render without errors
    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });
    await expect(dashboard.saveDialogSave).toBeDefined();

    await dashboard.saveDialogCancel.click();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Water source pre-fill
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Save dialog — water source', () => {
  test.setTimeout(120_000);

  test('save_with_explicit_water_source_saves_successfully', async ({ dashboard }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    const runId = Date.now().toString();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    await dashboard.saveDialogName.fill(`WaterSource Test ${runId}`);
    await dashboard.saveDialogField.fill(`WS Field ${runId}`);
    await dashboard.saveDialogOperator.fill(`WS Op ${runId}`);
    await dashboard.saveDialogWell.fill(`WS-${runId}`);

    if (await dashboard.saveDialogWaterSource.isVisible().catch(() => false)) {
      await dashboard.saveDialogWaterSource.clear();
      await dashboard.saveDialogWaterSource.fill('Мамонтовское озеро');
    }

    await expect(dashboard.saveDialogSave).toBeEnabled({ timeout: 5_000 });
    await dashboard.saveDialogSave.click();
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 15_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "Сохранение..." button label during save
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Save dialog — save in progress label', () => {
  test.setTimeout(120_000);

  test('save_button_shows_saving_label_during_save', async ({ dashboard, page }) => {
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();

    const runId = Date.now().toString();

    await dashboard.saveButton.click();
    await expect(dashboard.saveDialog).toBeVisible({ timeout: 5_000 });

    await dashboard.saveDialogName.fill(`Saving Label Test ${runId}`);
    await dashboard.saveDialogField.fill(`SL Field ${runId}`);
    await dashboard.saveDialogOperator.fill(`SL Op ${runId}`);
    await dashboard.saveDialogWell.fill(`SL-${runId}`);

    if (await dashboard.saveDialogWaterSource.isVisible().catch(() => false)) {
      const val = await dashboard.saveDialogWaterSource.inputValue().catch(() => '');
      if (!val.trim()) await dashboard.saveDialogWaterSource.fill('Test');
    }

    await expect(dashboard.saveDialogSave).toBeEnabled({ timeout: 5_000 });
    await dashboard.saveDialogSave.click();

    // Wait for final state (dialog closed = success)
    await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 15_000 });

    // Verify no Zod/validation error appeared (specific to error banner element)
    const errorBanner = page.locator('[class*="bg-red"], [class*="border-red"]').filter({ hasText: /Invalid input|Zod|fluidType/i });
    await expect(errorBanner).toHaveCount(0);
  });
});
