/**
 * Page Object — Comparison page
 *
 * Encapsulates interaction with the experiment comparison view:
 * adding / removing experiments, chart assertions, axis selection.
 */

import { type Page, type Locator, expect } from '@playwright/test';

export class ComparisonPage {
  readonly page: Page;

  // — Root —
  readonly root: Locator;

  // — Selected experiments —
  readonly chipsContainer: Locator;
  readonly openSelectorButton: Locator;

  // — Selector dialog —
  readonly selectorOverlay: Locator;
  readonly selectorDialog: Locator;
  readonly selectorClose: Locator;
  readonly selectorSearch: Locator;

  // — Chart —
  readonly chartContainer: Locator;
  readonly chart: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('ComparisonPageRoot');

    // Selected experiments
    this.chipsContainer = page.getByTestId('SelectedExperimentsChips');
    this.openSelectorButton = page.getByTestId('OpenExperimentSelectorButton').first();

    // Selector dialog
    this.selectorOverlay = page.getByTestId('ComparisonSelectorOverlay');
    this.selectorDialog = page.getByTestId('ComparisonSelectorDialog');
    this.selectorClose = page.getByTestId('ComparisonSelectorCloseButton');
    this.selectorSearch = page.getByTestId('ComparisonSelectorSearchInput');

    // Chart
    this.chartContainer = page.getByTestId('ComparisonChartContainer');
    this.chart = page.getByTestId('ComparisonChart');
  }

  // ===================== Actions =====================

  /** Navigate to the comparison page */
  async goto() {
    // Already there?
    if (this.page.url().includes('/dashboard/comparison')) return;
    // Prefer in-app navigation (no full-page reload) — works in both browser and Tauri CDP mode
    const navBtn = this.page.getByTestId('ComparisonNavButton');
    if (await navBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await navBtn.click();
      await this.page.waitForURL('**/dashboard/comparison', { timeout: 10_000 });
    } else {
      const url = this.page.url();
      const target = url && !url.startsWith('about:')
        ? new URL('/dashboard/comparison', url).href
        : '/dashboard/comparison';
      await this.page.goto(target);
    }
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Open the experiment selector dialog (no-op if already open) */
  async openSelector() {
    if (await this.selectorDialog.isVisible().catch(() => false)) return;
    await this.openSelectorButton.click();
    await expect(this.selectorDialog).toBeVisible({ timeout: 5_000 });
  }

  /** Close the experiment selector dialog (handles auto-close case) */
  async closeSelector() {
    if (await this.selectorDialog.isVisible().catch(() => false)) {
      await this.selectorClose.click();
    }
    await expect(this.selectorDialog).not.toBeVisible({ timeout: 5_000 });
  }

  /** Search for an experiment in the selector dialog */
  async searchExperiment(query: string) {
    await this.selectorSearch.clear();
    await this.selectorSearch.fill(query);
    await this.page.waitForTimeout(500);
  }

  /** Add an experiment to comparison by clicking its button in the selector.
   *  The dialog may or may not auto-close — callers should use closeSelector() afterwards. */
  async addExperimentByIndex(index = 0) {
    const btn = this.page.getByTestId('ComparisonSelectorExperimentButton').nth(index);
    await expect(btn).toBeVisible({ timeout: 5_000 });
    await btn.click();
    // Give React a tick to process the add
    await this.page.waitForTimeout(300);
  }

  /** Add an experiment to comparison by name — opens selector, searches, clicks */
  async addExperimentByName(name: string) {
    await this.openSelector();
    await this.searchExperiment(name);
    const btn = this.page
      .getByTestId('ComparisonSelectorExperimentButton')
      .filter({ hasText: name })
      .first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click();
    await this.page.waitForTimeout(300);
    await this.closeSelector();
  }

  /** Remove an experiment chip by index */
  async removeExperimentChip(index = 0) {
    const chip = this.getExperimentChips().nth(index);
    const removeBtn = chip.getByTestId('ComparisonExperimentChipRemoveButton');
    await removeBtn.click();
  }

  /** Get all experiment chips */
  getExperimentChips() {
    return this.page.getByTestId('ComparisonExperimentChip');
  }

  // ===================== Assertions =====================

  /** Assert the comparison page is loaded */
  async expectLoaded() {
    await expect(this.root).toBeVisible({ timeout: 15_000 });
  }

  /** Assert number of selected experiment chips */
  async expectChipCount(count: number) {
    await expect(this.getExperimentChips()).toHaveCount(count, { timeout: 10_000 });
  }

  /** Assert the comparison chart is visible */
  async expectChartVisible() {
    await expect(this.chart).toBeVisible({ timeout: 15_000 });
    const surface = this.chart.locator('.uplot canvas').first();
    await expect(surface).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Assert that the uPlot canvas has actually painted data (i.e. is not
   * blank / all-black).  Reads the canvas pixel data via JS evaluation and
   * checks that at least one non-(0,0,0,0) or non-background pixel exists
   * outside the very dark background colour (#0f172a ≈ rgb 15,23,42).
   *
   * This is the key assertion for the multi-experiment regression:
   * if alignment is broken every series is null and uPlot draws nothing.
   */
  async expectCanvasPainted() {
    const canvas = this.chart.locator('.uplot canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    const hasPaintedPixels = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d');
      if (!ctx) return false;
      const { width, height } = el;
      if (width < 2 || height < 2) return false;
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = imageData.data;
      // Count pixels that differ from the dark background (#0f172a = 15,23,42)
      // or that are non-transparent
      let coloured = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        const isBackground = r <= 20 && g <= 30 && b <= 50;
        const isTransparent = a === 0;
        if (!isBackground && !isTransparent) coloured++;
      }
      return coloured > 50; // at least 50 non-background pixels
    });

    expect(hasPaintedPixels, 'uPlot canvas is blank — series data was not rendered').toBe(true);
  }

  /**
   * Returns the number of series entries shown in the chart legend.
   * Each entry corresponds to one (experiment × metric) combination.
   */
  async getLegendSeriesCount(): Promise<number> {
    // uPlot renders its built-in legend as <table class="u-legend"> rows,
    // but we use a custom React legend rendered outside the uPlot element
    // (it's a sibling div after ComparisonChart, not inside it).
    // Search the whole page, not this.chart.
    const customLegend = this.page.locator('[data-testid="ComparisonLegendItem"]');
    const customCount = await customLegend.count();
    if (customCount > 0) return customCount;

    // Fallback: uPlot built-in legend rows (skip the header row)
    const rows = this.chart.locator('.u-legend .u-series');
    return rows.count();
  }

  /**
   * Assert that the legend shows exactly N series (1 per experiment×metric).
   */
  async expectLegendSeriesCount(n: number) {
    // Poll because the legend re-renders after chart initialization
    await expect
      .poll(() => this.getLegendSeriesCount(), { timeout: 10_000 })
      .toBe(n);
  }

  /** Assert the selector dialog is visible */
  async expectSelectorVisible() {
    await expect(this.selectorDialog).toBeVisible({ timeout: 5_000 });
  }

  /** Assert the selector dialog is hidden */
  async expectSelectorHidden() {
    await expect(this.selectorDialog).not.toBeVisible({ timeout: 5_000 });
  }

  /** Assert experiment chip text contains a string */
  async expectChipText(index: number, text: string) {
    const chip = this.getExperimentChips().nth(index);
    await expect(chip).toContainText(text, { timeout: 5_000 });
  }
}
