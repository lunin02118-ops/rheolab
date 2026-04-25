/**
 * Page Object — Library page
 *
 * Encapsulates interaction with the experiment library:
 * filtering, searching, view mode switching, experiment cards/rows,
 * loading experiments, and adding to comparison.
 */

import { type Page, type Locator, expect } from '@playwright/test';

export class LibraryPage {
  readonly page: Page;

  // — Root —
  readonly root: Locator;

  // — Tabs —
  readonly experimentsTab: Locator;
  readonly reagentsTab: Locator;

  // — View mode —
  readonly listViewButton: Locator;
  readonly gridViewButton: Locator;

  // — Filters —
  readonly filtersPanel: Locator;
  readonly clearFiltersButton: Locator;
  readonly searchInput: Locator;
  readonly nameFilter: Locator;
  readonly authorFilter: Locator;
  readonly labFilter: Locator;
  readonly fieldFilter: Locator;
  readonly operatorFilter: Locator;
  readonly wellFilter: Locator;
  readonly waterFilter: Locator;
  readonly batchFilter: Locator;
  readonly fluidTypeFilter: Locator;
  readonly instrumentTypeFilter: Locator;

  // — Touch-point filters —
  readonly touchPointSection: Locator;
  readonly viscosityThresholdSelector: Locator;
  readonly viscosityThresholdPresetOff: Locator;
  readonly viscosityThresholdPreset500: Locator;
  readonly viscosityThresholdPreset300: Locator;
  readonly viscosityThresholdCustomInput: Locator;
  readonly hasCrossingToggle: Locator;
  readonly crossingTimeMin: Locator;
  readonly crossingTimeMax: Locator;
  readonly viscosityAtTargetMin: Locator;
  readonly viscosityAtTargetMax: Locator;
  readonly clearTouchPointFiltersButton: Locator;
  readonly touchPointEmptyStateHint: Locator;

  // — Experiment list —
  readonly experimentListContainer: Locator;

  // — Reagents —
  readonly addReagentButton: Locator;
  readonly reagentsSearch: Locator;
  readonly reagentCategoryFilter: Locator;
  readonly clearReagentFilters: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('LibraryPageRoot');

    // Tabs
    this.experimentsTab = page.getByTestId('ExperimentsTabButton');
    this.reagentsTab = page.getByTestId('ReagentsTabButton');

    // View mode
    this.listViewButton = page.getByTestId('ListViewButton');
    this.gridViewButton = page.getByTestId('GridViewButton');

    // Filters
    this.filtersPanel = page.getByTestId('ExperimentFiltersPanel');
    this.clearFiltersButton = page.getByTestId('ClearFiltersButton');
    this.searchInput = page.getByTestId('ExperimentSearchInput');
    this.nameFilter = page.getByTestId('ExperimentNameFilterInput');
    this.authorFilter = page.getByTestId('ExperimentAuthorFilterInput');
    this.labFilter = page.getByTestId('ExperimentLaboratoryFilterInput');
    this.fieldFilter = page.getByTestId('ExperimentFieldFilterInput');
    this.operatorFilter = page.getByTestId('ExperimentOperatorFilterInput');
    this.wellFilter = page.getByTestId('ExperimentWellFilterInput');
    this.waterFilter = page.getByTestId('ExperimentWaterFilterInput');
    this.batchFilter = page.getByTestId('BatchNumberFilterInput');
    this.fluidTypeFilter = page.getByTestId('FluidTypeFilterSelect');
    this.instrumentTypeFilter = page.getByTestId('InstrumentTypeFilterSelect');

    // Touch-point filters — default fast path uses 50 cP precomputed
    // columns; dynamic threshold (via `ViscosityThresholdSelector` presets
    // or custom input) switches the backend to per-query recompute.
    this.touchPointSection = page.getByTestId('TouchPointFiltersSection');
    this.viscosityThresholdSelector = page.getByTestId('ViscosityThresholdSelector');
    this.viscosityThresholdPresetOff = page.getByTestId('ViscosityThresholdPreset-off');
    this.viscosityThresholdPreset500 = page.getByTestId('ViscosityThresholdPreset-500');
    this.viscosityThresholdPreset300 = page.getByTestId('ViscosityThresholdPreset-300');
    this.viscosityThresholdCustomInput = page.getByTestId('ViscosityThresholdCustomInput');
    this.hasCrossingToggle = page.getByTestId('HasCrossingFilterToggle');
    this.crossingTimeMin = page.getByTestId('CrossingTimeMinInput');
    this.crossingTimeMax = page.getByTestId('CrossingTimeMaxInput');
    this.viscosityAtTargetMin = page.getByTestId('ViscosityAtTargetMinInput');
    this.viscosityAtTargetMax = page.getByTestId('ViscosityAtTargetMaxInput');
    this.clearTouchPointFiltersButton = page.getByTestId('ClearTouchPointFiltersButton');
    this.touchPointEmptyStateHint = page.getByTestId('TouchPointEmptyStateHint');

    // Experiment list
    this.experimentListContainer = page.getByTestId('ExperimentListContainer');

    // Reagents
    this.addReagentButton = page.getByTestId('AddReagentButton');
    this.reagentsSearch = page.getByTestId('ReagentsSearchInput');
    this.reagentCategoryFilter = page.getByTestId('ReagentCategoryFilter');
    this.clearReagentFilters = page.getByTestId('ClearReagentFiltersButton');
  }

  // ===================== Actions =====================

  /** Navigate to the library page */
  async goto() {
    if (this.page.url().includes('/dashboard/library')) return;
    const navBtn = this.page.getByTestId('LibraryNavButton');
    if (await navBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await navBtn.click();
      await this.page.waitForURL('**/dashboard/library', { timeout: 10_000 });
    } else {
      const url = this.page.url();
      const target = url && !url.startsWith('about:')
        ? new URL('/dashboard/library', url).href
        : '/dashboard/library';
      await this.page.goto(target);
    }
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Switch to Experiments tab */
  async switchToExperiments() {
    await this.experimentsTab.click();
  }

  /** Switch to Reagents tab */
  async switchToReagents() {
    await this.reagentsTab.click();
  }

  /** Set list view mode */
  async setListView() {
    await this.listViewButton.click();
  }

  /** Set grid view mode */
  async setGridView() {
    await this.gridViewButton.click();
  }

  /** Type into the global search input and wait for results to render */
  async search(query: string) {
    await this.searchInput.fill(query);
    // Wait for debounce (200ms) + IPC round-trip + render
    await this.page.waitForTimeout(500);
    // Wait for experiment list to settle: cards/rows appear OR empty-state message
    await this.waitForListSettled();
  }

  /** Wait until the experiment list finishes loading — cards/rows or "no results" shown */
  async waitForListSettled(timeout = 15_000) {
    await expect(
      this.page.locator('[data-testid^="ExperimentCard_"], [data-testid^="ExperimentRow_"]').first()
        .or(this.page.getByText('Эксперименты не найдены'))
    ).toBeVisible({ timeout });
  }

  /** Fill a specific filter input */
  async setFilter(filter: 'name' | 'author' | 'lab' | 'field' | 'operator' | 'well' | 'water' | 'batch', value: string) {
    const map: Record<string, Locator> = {
      name: this.nameFilter,
      author: this.authorFilter,
      lab: this.labFilter,
      field: this.fieldFilter,
      operator: this.operatorFilter,
      well: this.wellFilter,
      water: this.waterFilter,
      batch: this.batchFilter,
    };
    const input = map[filter];
    await input.clear();
    await input.fill(value);
    await this.page.waitForTimeout(500);
  }

  /** Clear all filters */
  async clearAllFilters() {
    await this.clearFiltersButton.click();
    await this.page.waitForTimeout(300);
  }

  /** Get all visible experiment cards (grid view) */
  getExperimentCards() {
    return this.page.locator('[data-testid^="ExperimentCard_"]');
  }

  /** Get all visible experiment rows (list view) */
  getExperimentRows() {
    return this.page.locator('[data-testid^="ExperimentRow_"]');
  }

  /** Get experiment card by ID */
  getExperimentCard(id: string) {
    return this.page.getByTestId(`ExperimentCard_${id}`);
  }

  /** Get experiment row by ID */
  getExperimentRow(id: string) {
    return this.page.getByTestId(`ExperimentRow_${id}`);
  }

  /** Click "Load" button on the first experiment card matching the name */
  async loadExperimentByName(name: string) {
    const card = this.page.locator(`[data-testid^="ExperimentCard_"]:has-text("${name}"), [data-testid^="ExperimentRow_"]:has-text("${name}")`).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.hover();
    const loadBtn = card.getByTestId('LoadExperimentButton');
    await loadBtn.click();
    await this.page.waitForURL('**/dashboard', { timeout: 15_000 });
  }

  /** Click "Add to comparison" on the first experiment card/row matching the name */
  async addToComparisonByName(name: string) {
    const card = this.page.locator(`[data-testid^="ExperimentCard_"]:has-text("${name}"), [data-testid^="ExperimentRow_"]:has-text("${name}")`).first();
    await card.hover();
    const addBtn = card.getByTestId('AddExperimentButton');
    await addBtn.click();
  }

  // ===================== Assertions =====================

  /** Assert the library page is loaded */
  async expectLoaded() {
    await expect(this.root).toBeVisible({ timeout: 15_000 });
  }

  /** Assert experiment count in current view (retries until data loads) */
  async expectExperimentCount(count: number, viewMode: 'grid' | 'list' = 'grid') {
    const locator = viewMode === 'grid' ? this.getExperimentCards() : this.getExperimentRows();
    await expect(locator).toHaveCount(count, { timeout: 15_000 });
  }

  /** Assert experiment count is at least N (retries until data loads) */
  async expectMinExperimentCount(minCount: number, viewMode: 'grid' | 'list' = 'grid') {
    const locator = viewMode === 'grid' ? this.getExperimentCards() : this.getExperimentRows();
    await expect(async () => {
      const count = await locator.count();
      expect(count).toBeGreaterThanOrEqual(minCount);
    }).toPass({ timeout: 15_000 });
  }

  /** Assert that a specific experiment name appears in the list */
  async expectExperimentVisible(name: string) {
    await expect(this.page.locator(`[data-testid^="ExperimentCard_"]:has-text("${name}"), [data-testid^="ExperimentRow_"]:has-text("${name}")`).first()).toBeVisible({ timeout: 20_000 });
  }

  /** Assert that no experiments match current filters */
  async expectNoExperiments() {
    const cards = this.getExperimentCards();
    const rows = this.getExperimentRows();
    const total = (await cards.count()) + (await rows.count());
    expect(total).toBe(0);
  }

  /** Assert filters panel is visible */
  async expectFiltersVisible() {
    await expect(this.filtersPanel).toBeVisible({ timeout: 5_000 });
  }
}
