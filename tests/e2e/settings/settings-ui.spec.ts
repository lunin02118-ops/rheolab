/**
 * E2E — Settings: Settings page tabs and navigation
 *
 * Group: Settings (mirrors WPF RheoLab.Tests/Services/ settings tests)
 *
 * Tests the settings page:
 * - All 6 tabs accessible
 * - Profile menu → settings navigation
 * - URL-driven tab opening (?tab=reports)
 *
 * Naming: settings_{action}_{expectedResult}
 */

import { test, expect, setupBeforeEach } from '../base-test';

setupBeforeEach(test);

test.describe('Settings — Tab navigation', () => {
  test.setTimeout(60_000);

  test('settings_all_tabs_present', async ({ settings }) => {
    await settings.goto();
    await settings.expectLoaded();
    await settings.expectAllTabsPresent();
  });

  test('settings_switch_between_tabs', async ({ settings, page }) => {
    await settings.goto();
    await settings.expectLoaded();

    // Try switching to each tab — verify no crash
    // "Анализ" tab is only visible in expert mode, so skip it in beginner mode
    const tabLabels = ['Данные', 'Графики', 'Отчёты', 'Система'];
    for (const label of tabLabels) {
      await settings.switchTab(label);
      await page.waitForTimeout(300);
      // No crash = pass
      await expect(page.getByTestId('SettingsViewRoot')).toBeVisible();
    }
  });

  test('settings_url_driven_tab', async ({ settings }) => {
    await settings.goto('reports');
    await settings.expectLoaded();
    // The reports tab should be active
    await settings.expectTabActive('Отчёты');
  });

  test('settings_accessible_from_nav_button', async ({ settings, page }) => {
    // Start on dashboard
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    await settings.navigateViaNavButton();
    await settings.expectLoaded();
  });
});
