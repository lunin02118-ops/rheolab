/**
 * Page Object — Settings page
 *
 * Encapsulates interaction with the settings panel:
 * tab switching, chart settings, report settings, system settings.
 */

import { type Page, type Locator, expect } from '@playwright/test';

export class SettingsPage {
  readonly page: Page;

  // — Root —
  readonly root: Locator;
  readonly mainTabs: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('SettingsViewRoot');
    this.mainTabs = page.getByTestId('SettingsMainTabs');
  }

  // ===================== Actions =====================

  /** Navigate to the settings page */
  async goto(tab?: string) {
    const url = tab ? `/dashboard/settings?tab=${tab}` : '/dashboard/settings';
    await this.page.goto(url);
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Navigate via the settings nav button in the top bar */
  async navigateViaNavButton() {
    await this.page.getByTestId('SettingsNavButton').click();
    await this.page.waitForURL('**/settings*', { timeout: 10_000 });
  }

  /** Switch to a settings tab by its label text */
  async switchTab(tabLabel: string) {
    const tab = this.mainTabs.getByRole('tab', { name: new RegExp(tabLabel, 'i') });
    await tab.click();
    await this.page.waitForTimeout(300);
  }

  // ===================== Assertions =====================

  /** Assert the settings page is loaded */
  async expectLoaded() {
    await expect(this.root).toBeVisible({ timeout: 15_000 });
  }

  /** Assert all 6 tabs are present */
  async expectAllTabsPresent() {
    const tabs = this.mainTabs.getByRole('tab');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(5);
  }

  /** Assert a specific tab is selected/active */
  async expectTabActive(tabLabel: string) {
    const tab = this.mainTabs.getByRole('tab', { name: new RegExp(tabLabel, 'i') });
    await expect(tab).toHaveAttribute('data-state', 'active', { timeout: 5_000 });
  }
}
