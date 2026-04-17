/**
 * Save Dialog — Tauri / SQLite Integration Tests
 *
 * Тесты против реального бинарника Tauri + SQLite:
 *   - experiments_save → реальный Rust-обработчик → реальная БД
 *   - experiments_list → реальный запрос к SQLite
 *   - parsing_parse_file → реальный Rust-парсер
 *
 * В отличие от save-dialog.spec.ts (mock IPC / sessionStorage), здесь:
 *   - Нет мока experiments_save/experiments_list/experiments_get/parsing_parse_file
 *   - Данные реально сохраняются в SQLite-файл приложения
 *   - После page.reload() эксперименты остаются в библиотеке
 *
 * Запуск (бинарник уже собран):
 *   npx cross-env TAURI_E2E_SKIP_BUILD=1 npx playwright test \
 *     --config playwright.tauri.config.ts \
 *     --grep save-dialog.tauri
 *
 * Prerequisite: globalSetup запустил rheolab-enterprise.exe с CDP на порту 9222.
 */

import { test, expect, setupBeforeEach } from '../base-test.tauri';
import {
    CHANDLER_SST_63,
    CHANDLER_SWB_96,
    GRACE_REPORT,
} from '../fixtures';

setupBeforeEach(test);

// Forward console errors for debugging
test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.text().includes('[E2E]')) {
            process.stdout.write(`[PAGE ${msg.type()}] ${msg.text()}\n`);
        }
    });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Unique run label — included in every saved experiment name to avoid conflicts */
function runLabel(): string {
    return `db-${Date.now()}`;
}

/** Assert that no "Invalid input" / "Ошибка" error banner is visible */
async function expectNoSaveError(page: import('@playwright/test').Page) {
    await expect(
        page.locator('[data-testid="ErrorBanner"], [role="alert"]').filter({ hasText: /Invalid input|Ошибка|Error/i }),
    ).toHaveCount(0, { timeout: 5_000 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('[SQLite] Save dialog — реальный бинарник', () => {
    test.setTimeout(300_000); // 5 мин на тест — нативный парсер быстрее WASM

    // ── 1. Базовый: SST → сохраняется без ошибок ─────────────────────────

    test('save_sst_to_sqlite_no_error', async ({ page, dashboard }) => {
        const label = runLabel();

        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis(120_000);

        const { name } = await dashboard.saveExperiment({ name: `SST-sqlite-${label}` });

        // Save dialog closed → no error shown
        await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 5_000 });
        await expectNoSaveError(page);
        console.log(`[E2E] SST saved as "${name}"`);
    });

    // ── 2. После сохранения эксперимент появляется в библиотеке  ─────────

    test('save_appears_in_library_after_save', async ({ page, dashboard, library }) => {
        const label = runLabel();
        const experimentName = `LibVerify-${label}`;

        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis(120_000);
        await dashboard.saveExperiment({ name: experimentName });
        await expectNoSaveError(page);

        // Navigate to library
        await library.goto();
        await library.expectLoaded();

        // Search for the saved experiment by name
        await library.search(experimentName);
        await library.expectExperimentVisible(experimentName);
        console.log(`[E2E] "${experimentName}" found in library`);
    });

    // ── 3. Метаданные (поле, оператор, скважина) видны в карточке ────────

    test('save_metadata_preserved_in_library_card', async ({ page, dashboard, library }) => {
        const label = runLabel();
        const experimentName = `Meta-${label}`;
        const field    = `Самотлор-${label}`;
        const operator = `Иванов-${label}`;
        const well     = `SklД-${label}`;

        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SWB_96);
        await dashboard.waitForAnalysis(120_000);
        await dashboard.saveExperiment({ name: experimentName, field, operator, well });
        await expectNoSaveError(page);

        await library.goto();
        await library.expectLoaded();
        await library.waitForListSettled();
        await library.search(experimentName);

        // Card/row shows: name, field, operator (well is stored in DB but not rendered)
        const card = page.locator(`[data-testid^="ExperimentCard_"]:has-text("${experimentName}"), [data-testid^="ExperimentRow_"]:has-text("${experimentName}")`).first();
        await expect(card).toBeVisible({ timeout: 20_000 });
        await expect(card).toContainText(field);
        await expect(card).toContainText(operator);
        // Note: wellNumber is stored in DB but not rendered on the card face
        console.log(`[E2E] Metadata preserved: field="${field}", operator="${operator}", well="${well}" (well stored in DB, not shown in card)`);
    });

    // ── 4. После reload() данные остаются в SQLite ────────────────────────

    test('save_persists_after_page_reload', async ({ page, dashboard, library }) => {
        const label = runLabel();
        const experimentName = `Persist-${label}`;

        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis(120_000);
        await dashboard.saveExperiment({ name: experimentName });
        await expectNoSaveError(page);

        // Reload the whole app — SQLite should retain the record
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2_000); // allow Tauri re-init

        await library.goto();
        await library.expectLoaded();
        await library.search(experimentName);
        await library.expectExperimentVisible(experimentName);
        console.log(`[E2E] "${experimentName}" survives page reload`);
    });

    // ── 5. Загрузка из библиотеки → чарт открывается на дашборде ─────────

    test('save_then_load_from_library_shows_chart', async ({ page, dashboard, library }) => {
        const label = runLabel();
        const experimentName = `LoadBack-${label}`;

        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis(120_000);
        await dashboard.saveExperiment({ name: experimentName });
        await expectNoSaveError(page);

        // Go to library → load the experiment back → chart should appear
        await library.goto();
        await library.expectLoaded();
        await library.waitForListSettled();
        await library.search(experimentName);
        await library.loadExperimentByName(experimentName);

        // After load, redirected to /dashboard — verify chart visible
        await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 });
        await dashboard.expectChartVisible();
        console.log(`[E2E] "${experimentName}" loaded from library, chart visible`);
    });

    // ── 6. Grace report сохраняется без ошибок ───────────────────────────

    test('save_grace_report_no_error', async ({ page, dashboard }) => {
        const label = runLabel();

        await dashboard.uploadFile(GRACE_REPORT);
        await dashboard.waitForAnalysis(120_000);

        const { name } = await dashboard.saveExperiment({ name: `Grace-sqlite-${label}` });

        await expect(dashboard.saveDialog).not.toBeVisible({ timeout: 5_000 });
        await expectNoSaveError(page);
        console.log(`[E2E] Grace report saved as "${name}"`);
    });

    // ── 7. Два сохранения подряд → оба появляются в библиотеке ───────────

    test('save_two_experiments_both_in_library', async ({ page, dashboard, library }) => {
        const label = runLabel();
        const name1 = `Pair1-${label}`;
        const name2 = `Pair2-${label}`;

        // First experiment: SST
        await dashboard.goto();
        await dashboard.uploadFile(CHANDLER_SST_63);
        await dashboard.waitForAnalysis(120_000);
        await dashboard.saveExperiment({ name: name1 });
        await expectNoSaveError(page);

        // Second experiment: SWB
        await dashboard.uploadFile(CHANDLER_SWB_96);
        await dashboard.waitForAnalysis(120_000);
        await dashboard.saveExperiment({ name: name2 });
        await expectNoSaveError(page);

        // Verify both appear in library
        await library.goto();
        await library.expectLoaded();

        for (const name of [name1, name2]) {
            await library.search(name);
            await library.expectExperimentVisible(name);
        }
        console.log(`[E2E] Both experiments found: "${name1}", "${name2}"`);
    });
});
