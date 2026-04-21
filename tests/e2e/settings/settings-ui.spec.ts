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

    // Try switching to each tab — verify no crash.
    // Current semantic-group structure (see src/app/dashboard/settings/page.tsx):
    //   Интерфейс, Единицы, Профиль, Графики, [Анализ — expert only], Данные и система.
    // We skip "Анализ" so this test passes in both beginner and expert mode.
    const tabLabels = ['Интерфейс', 'Единицы', 'Графики', 'Данные и система'];
    for (const label of tabLabels) {
      await settings.switchTab(label);
      await page.waitForTimeout(300);
      // No crash = pass
      await expect(page.getByTestId('SettingsViewRoot')).toBeVisible();
    }
  });

  test('settings_url_driven_tab', async ({ settings }) => {
    // Legacy ?tab=reports is aliased to the modern "data" tab (Data & System)
    // by LEGACY_TAB_ALIASES in settings/page.tsx — old bookmarks keep working.
    await settings.goto('reports');
    await settings.expectLoaded();
    await settings.expectTabActive('Данные и система');
  });

  test('settings_accessible_from_nav_button', async ({ settings, page }) => {
    // Start on dashboard
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    await settings.navigateViaNavButton();
    await settings.expectLoaded();
  });
});
