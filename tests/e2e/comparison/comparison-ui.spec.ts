/**
 * E2E — Comparison: Multi-experiment comparison
 *
 * Group: Comparison (mirrors WPF RheoLab.Tests/UI/ comparison tests)
 *
 * Tests the comparison page:
 * - Opening / closing the experiment selector
 * - Adding experiments to comparison
 * - Removing experiments from comparison
 * - Chart rendering with multiple experiments
 * - Comparison from library cards
 *
 * Prerequisite: At least 2 experiments saved in the DB.
 *
 * Naming: comparison_{action}_{expectedResult}
 */

import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63, GRACE_REPORT } from '../fixtures';

setupBeforeEach(test);

test.describe('Comparison — Selector dialog', () => {
  test.setTimeout(90_000);

  test('comparison_selector_opens_and_closes', async ({ comparison }) => {
    await comparison.goto();
    await comparison.expectLoaded();

    // Open selector
    await comparison.openSelector();
    await comparison.expectSelectorVisible();

    // Close selector
    await comparison.closeSelector();
    await comparison.expectSelectorHidden();
  });

  test('comparison_selector_search_filters_list', async ({ comparison }) => {
    await comparison.goto();
    await comparison.expectLoaded();

    await comparison.openSelector();
    await comparison.searchExperiment('ZZZ_NONEXISTENT');
    await comparison.page.waitForTimeout(500);

    // No experiment buttons should match
    const buttons = comparison.page.getByTestId('ComparisonSelectorExperimentButton');
    const count = await buttons.count();
    expect(count).toBe(0);

    await comparison.closeSelector();
  });
});

test.describe('Comparison — Add & remove experiments', () => {
  test.setTimeout(180_000);

  test('comparison_add_experiment_shows_chip_and_chart', async ({ dashboard, comparison }) => {
    // First, save 2 experiments so they're available
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();
    const _meta1 = await dashboard.saveExperiment({ name: `Comp A ${Date.now()}` });

    await dashboard.goto();
    await dashboard.uploadFile(GRACE_REPORT);
    await dashboard.waitForAnalysis();
    const _meta2 = await dashboard.saveExperiment({ name: `Comp B ${Date.now()}` });

    // Go to comparison
    await comparison.goto();
    await comparison.expectLoaded();

    // Add first experiment
    await comparison.openSelector();
    await comparison.addExperimentByIndex(0);
    await comparison.closeSelector();
    await comparison.expectChipCount(1);

    // Add second experiment (use index 1 to avoid duplicate)
    await comparison.openSelector();
    await comparison.addExperimentByIndex(1);
    await comparison.closeSelector();
    await comparison.expectChipCount(2);

    // Chart should render with both experiments
    await comparison.expectChartVisible();
  });

  test('comparison_remove_experiment_chip', async ({ dashboard, comparison }) => {
    // Save an experiment first
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();
    await dashboard.saveExperiment({ name: `Comp Remove ${Date.now()}` });

    // Go to comparison, add one experiment
    await comparison.goto();
    await comparison.expectLoaded();
    await comparison.openSelector();
    await comparison.addExperimentByIndex(0);
    await comparison.closeSelector();
    await comparison.expectChipCount(1);

    // Remove it
    await comparison.removeExperimentChip(0);
    await comparison.expectChipCount(0);
  });
});

test.describe('Comparison — From library', () => {
  test.setTimeout(180_000);

  test('comparison_add_from_library_card_navigates_to_comparison', async ({
    dashboard,
    library,
    comparison,
    page,
  }) => {
    // Save an experiment
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();
    const name = `Lib2Comp ${Date.now()}`;
    await dashboard.saveExperiment({ name });

    // Go to library
    await library.goto();
    await library.expectLoaded();
    await library.search(name);
    await library.expectExperimentVisible(name);

    // Click "Add to comparison" on the card
    await library.addToComparisonByName(name);

    // Should navigate to comparison page or show a success indicator
    await page.waitForTimeout(2_000);

    // Navigate to comparison to verify the chip is there
    await comparison.goto();
    await comparison.expectLoaded();
    // There should be at least 1 chip
    const chips = comparison.getExperimentChips();
    const count = await chips.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
