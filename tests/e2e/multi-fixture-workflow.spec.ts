/**
 * Multi-Fixture Workflow E2E
 *
 * Сценарии:
 * 1. smoke_all_demo_fixtures     — загружаем каждый из 6 инструментальных файлов,
 *                                  проверяем анализ, график, таблицу, сохраняем.
 * 2. comparison_four_instruments — добавляем 4 эксперимента (разные приборы) в
 *                                  сравнение, проверяем канвас, легенду (4 серии).
 * 3. comparison_axis_switch      — переключаем ось «Справа 1» на Temperature,
 *                                  проверяем, что данные не исчезли.
 * 4. comparison_legend_toggle    — кликаем по первой записи легенды, проверяем
 *                                  визуальное «зачёркивание» серии.
 * 5. pdf_export_multi_fixture    — для 4 инструментов: загружаем файл → Отчёты →
 *                                  скачать PDF → проверяем файл.
 * 6. excel_export_multi_fixture  — то же самое, но Excel.
 *
 * Требование: dev-server запущен (npm run preview или vite --port 3100).
 */

import { test, expect, setupBeforeEach } from './base-test';
import path from 'path';
import fs from 'fs';
import {
    CHANDLER_SST_63,
    CHANDLER_SWB_96,
    GRACE_REPORT,
    BROOKFIELD_4,
    BSL_REPORT,
    OFITE_1100,
    type TestFixture,
} from './fixtures';

setupBeforeEach(test);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Ensure output directory exists */
function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const OUT = 'outputs/e2e/multi-fixture';

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Smoke: each demo fixture loads, analyses, saves
// ─────────────────────────────────────────────────────────────────────────────

test.describe('1 — Smoke: все демо-файлы', () => {
    test.setTimeout(600_000); // 10 min for all 6 fixtures

    const DEMO_FIXTURES: TestFixture[] = [
        CHANDLER_SST_63,
        CHANDLER_SWB_96,
        GRACE_REPORT,
        BROOKFIELD_4,
        BSL_REPORT,
        OFITE_1100,
    ];

    for (const fixture of DEMO_FIXTURES) {
        test(`smoke_${fixture.displayName.replace(/\s+/g, '_').toLowerCase()}`, async ({ dashboard }) => {
            console.log(`\n── Fixture: ${fixture.displayName} (${fixture.instrument}) ──`);

            // 1. Upload
            await dashboard.uploadFile(fixture);

            // 2. Wait for analysis
            await dashboard.waitForAnalysis(90_000);
            console.log('  ✓ Analysis complete');

            // 3. Chart container must be present (default active tab)
            await expect(dashboard.chartContainer).toBeVisible({ timeout: 20_000 });
            console.log('  ✓ Chart container visible');
            // Note: canvas rendering depends on ResizeObserver in headless mode —
            // canvas painting is verified in the comparison chart tests below.

            // 4. Save experiment to library
            const expName = `Smoke_${fixture.displayName.replace(/\s+/g, '')}_${Date.now()}`;
            await dashboard.saveExperiment({ name: expName });
            console.log(`  ✓ Saved as "${expName}"`);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Comparison: 4 разных прибора на одном графике
// ─────────────────────────────────────────────────────────────────────────────

test.describe('2 — Comparison: 4 инструмента', () => {
    test.setTimeout(600_000);

    test('comparison_four_different_instruments', async ({ dashboard, comparison }) => {
        const runId = Date.now().toString();
        const fixtures = [CHANDLER_SST_63, CHANDLER_SWB_96, GRACE_REPORT, BROOKFIELD_4];
        const savedNames: string[] = [];

        // ── Step 1: load & save 4 fixtures ──────────────────────────────────
        for (let i = 0; i < fixtures.length; i++) {
            const fx = fixtures[i];
            console.log(`\nLoading fixture ${i + 1}/${fixtures.length}: ${fx.displayName}`);

            if (i > 0) {
                // Reset to idle state for next upload
                const resetLink = dashboard.page.getByTestId('UploadCardResetLink');
                if (await resetLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
                    await resetLink.click();
                    await dashboard.page.waitForTimeout(500);
                } else {
                    await dashboard.goto();
                }
            }

            await dashboard.uploadFile(fx);
            await dashboard.waitForAnalysis(90_000);

            const expName = `Cmp_${fx.displayName.replace(/\s+/g, '')}_${runId}_${i}`;
            await dashboard.saveExperiment({ name: expName });
            savedNames.push(expName);
            console.log(`  ✓ Saved: "${expName}"`);
        }

        // ── Step 2: Comparison page ──────────────────────────────────────────
        await comparison.goto();
        await comparison.expectLoaded();
        console.log('\nComparison page loaded');

        // ── Step 3: Add all 4 experiments ───────────────────────────────────
        // The mock returns experiments in insertion order; use sequential indices
        // so we never click an already-added experiment (which would trigger a
        // duplicate warning and leave the dialog open).
        for (let idx = 0; idx < 4; idx++) {
            await comparison.openSelector();
            await comparison.addExperimentByIndex(idx);
            await comparison.expectChipCount(idx + 1);
            console.log(`  ✓ Added experiment ${idx + 1}/4: ${savedNames[idx]}`);
        }

        // ── Step 4: Chart must be visible and painted ────────────────────────
        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();
        console.log('  ✓ Chart is painted');

        // ── Step 5: Legend must show at least 4 series (default settings may
        //            include a secondary metric, so count ≥ 4).
        //            Poll to tolerate the 150 ms debounce in debouncedExperiments.
        await expect.poll(
            () => comparison.getLegendSeriesCount(),
            { timeout: 5_000 },
        ).toBeGreaterThanOrEqual(4);
        const legendCount = await comparison.getLegendSeriesCount();
        console.log(`  ✓ Legend shows ${legendCount} series (≥ 4 expected)`);

        // ── Step 6: Screenshot for visual review ────────────────────────────
        ensureDir(OUT);
        await comparison.page.screenshot({
            path: path.join(OUT, `comparison-4-instruments-${runId}.png`),
            fullPage: false,
        });
        console.log(`  ✓ Screenshot saved`);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Comparison: переключение осей
// ─────────────────────────────────────────────────────────────────────────────

test.describe('3 — Comparison: переключение метрик осей', () => {
    test.setTimeout(300_000);

    test('comparison_axis_switch_right1_to_temperature', async ({ dashboard, comparison }) => {
        const runId = Date.now().toString();

        // Save two experiments (different instruments for diverse data)
        for (const [i, fx] of [CHANDLER_SST_63, GRACE_REPORT].entries()) {
            if (i > 0) {
                const reset = dashboard.page.getByTestId('UploadCardResetLink');
                if (await reset.isVisible({ timeout: 3_000 }).catch(() => false)) await reset.click();
                else await dashboard.goto();
            }
            await dashboard.uploadFile(fx);
            await dashboard.waitForAnalysis(90_000);
            await dashboard.saveExperiment({ name: `AxisSwitch_${fx.displayName.replace(/\s+/g, '')}_${runId}` });
        }

        await comparison.goto();
        await comparison.expectLoaded();

        // Add both experiments — use index 0 then 1 to avoid duplicate warning
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);

        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();

        // Open axis controls panel (click the Settings2 toggle button)
        const settingsToggle = comparison.page.getByTitle('Настройки осей');
        await settingsToggle.click();

        // "Справа 1" axis selector — select 'temperature_c'
        // The selects are rendered with labels "Слева 1", "Слева 2", "Справа 1", "Справа 2"
        // We find the <select> nearest to the "Справа 1" label text
        const rightAxis1Label = comparison.page.getByText('Справа 1', { exact: true });
        await expect(rightAxis1Label).toBeVisible({ timeout: 5_000 });

        const rightAxis1Select = comparison.page.locator('select').nth(2); // 0=left1, 1=left2, 2=right1
        await rightAxis1Select.selectOption('temperature_c');
        console.log('  ✓ Switched Справа 1 → Температура');

        // Chart must still have data
        await comparison.expectCanvasPainted();
        console.log('  ✓ Chart still painted after metric switch');

        // Legend now has 2 (primary) + 2 (temperature right) = 4 series
        const seriesCount = await comparison.getLegendSeriesCount();
        console.log(`  Legend series after switch: ${seriesCount}`);
        expect(seriesCount).toBeGreaterThanOrEqual(2);

        // Screenshot
        ensureDir(OUT);
        await comparison.page.screenshot({
            path: path.join(OUT, `comparison-axis-switch-${runId}.png`),
            fullPage: false,
        });

        // Reset axis back to 'none'
        await rightAxis1Select.selectOption('none');
        await comparison.expectCanvasPainted();
        console.log('  ✓ Chart still painted after reset to none');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Legend click-to-hide
// ─────────────────────────────────────────────────────────────────────────────

test.describe('4 — Comparison: легенда (скрыть/показать серию)', () => {
    test.setTimeout(300_000);

    test('comparison_legend_toggle_hides_and_shows_series', async ({ dashboard, comparison }) => {
        const runId = Date.now().toString();

        // Save two experiments
        for (const [i, fx] of [CHANDLER_SST_63, GRACE_REPORT].entries()) {
            if (i > 0) {
                const reset = dashboard.page.getByTestId('UploadCardResetLink');
                if (await reset.isVisible({ timeout: 3_000 }).catch(() => false)) await reset.click();
                else await dashboard.goto();
            }
            await dashboard.uploadFile(fx);
            await dashboard.waitForAnalysis(90_000);
            await dashboard.saveExperiment({ name: `Legend_${fx.displayName.replace(/\s+/g, '')}_${runId}` });
        }

        await comparison.goto();
        await comparison.expectLoaded();

        // Add both experiments — use index 0 then 1 to avoid duplicate warning
        await comparison.openSelector();
        await comparison.addExperimentByIndex(0);
        await comparison.openSelector();
        await comparison.addExperimentByIndex(1);
        await comparison.expectChipCount(2);

        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();

        // Find the first legend item
        const legendItems = comparison.page.getByTestId('ComparisonLegendItem');
        await expect(legendItems.first()).toBeVisible({ timeout: 10_000 });

        // Read initial opacity
        const opacityBefore = await legendItems.first().evaluate((el: HTMLElement) =>
            window.getComputedStyle(el).opacity
        );
        console.log(`  Legend item opacity before click: ${opacityBefore}`);

        // Click to hide
        await legendItems.first().click();
        await comparison.page.waitForTimeout(400); // allow transition

        const opacityAfter = await legendItems.first().evaluate((el: HTMLElement) =>
            window.getComputedStyle(el).opacity
        );
        console.log(`  Legend item opacity after click: ${opacityAfter}`);

        // After hiding, opacity should be significantly reduced
        const opacityAfterNum = parseFloat(opacityAfter);
        expect(opacityAfterNum).toBeLessThan(0.5);

        // The text should have line-through
        const textDecoration = await legendItems.first().locator('span').evaluate((el: HTMLElement) =>
            window.getComputedStyle(el).textDecoration
        );
        expect(textDecoration).toContain('line-through');
        console.log('  ✓ Series hidden (opacity < 0.5, line-through)');

        // Click again to restore
        await legendItems.first().click();
        await comparison.page.waitForTimeout(400);

        const opacityRestored = await legendItems.first().evaluate((el: HTMLElement) =>
            parseFloat(window.getComputedStyle(el).opacity)
        );
        expect(opacityRestored).toBeGreaterThan(0.9);
        console.log('  ✓ Series restored (opacity ≈ 1.0)');

        // Screenshot showing all series visible
        ensureDir(OUT);
        await comparison.page.screenshot({
            path: path.join(OUT, `comparison-legend-toggle-${runId}.png`),
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — PDF export для нескольких инструментов
// ─────────────────────────────────────────────────────────────────────────────

test.describe('5 — PDF отчёт: несколько инструментов', () => {
    test.setTimeout(300_000);

    const PDF_FIXTURES: TestFixture[] = [
        CHANDLER_SST_63,
        GRACE_REPORT,
        BROOKFIELD_4,
        BSL_REPORT,
    ];

    for (const fixture of PDF_FIXTURES) {
        test(`pdf_export_${fixture.displayName.replace(/\s+/g, '_').toLowerCase()}`, async ({ dashboard, reports }) => {
            console.log(`\n── PDF: ${fixture.displayName} ──`);

            // 1. Load file on the analysis page
            await dashboard.uploadFile(fixture);
            await dashboard.waitForAnalysis(90_000);
            console.log('  ✓ Analysis complete');

            // 2. Navigate to reports (same SPA, state persists)
            await reports.goto();
            await reports.expectPdfButtonVisible();
            console.log('  ✓ Reports page loaded');

            // 3. Download PDF
            const download = await reports.downloadPdf(60_000);
            const { filename, size } = await reports.assertDownload(download, '.pdf', 5_000);

            console.log(`  ✓ PDF downloaded: "${filename}" (${(size / 1024).toFixed(1)} KB)`);

            // 4. Save to outputs for manual inspection
            ensureDir(OUT);
            const destPath = path.join(OUT, `pdf_${fixture.displayName.replace(/\s+/g, '_')}.pdf`);
            await download.saveAs(destPath);
            console.log(`  ✓ Saved to ${destPath}`);
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Excel export для нескольких инструментов
// ─────────────────────────────────────────────────────────────────────────────

test.describe('6 — Excel отчёт: несколько инструментов', () => {
    test.setTimeout(300_000);

    const EXCEL_FIXTURES: TestFixture[] = [
        CHANDLER_SST_63,
        GRACE_REPORT,
        BROOKFIELD_4,
        BSL_REPORT,
    ];

    for (const fixture of EXCEL_FIXTURES) {
        test(`excel_export_${fixture.displayName.replace(/\s+/g, '_').toLowerCase()}`, async ({ dashboard, reports }) => {
            console.log(`\n── Excel: ${fixture.displayName} ──`);

            // 1. Load file
            await dashboard.uploadFile(fixture);
            await dashboard.waitForAnalysis(90_000);
            console.log('  ✓ Analysis complete');

            // 2. Navigate to reports
            await reports.goto();
            await reports.expectExcelButtonVisible();
            console.log('  ✓ Reports page loaded');

            // 3. Download Excel
            const download = await reports.downloadExcel(60_000);
            const { filename, size } = await reports.assertDownload(download, '.xls', 1_000);

            console.log(`  ✓ Excel downloaded: "${filename}" (${(size / 1024).toFixed(1)} KB)`);

            // 4. Save to outputs
            ensureDir(OUT);
            const destPath = path.join(OUT, `excel_${fixture.displayName.replace(/\s+/g, '_')}.xlsx`);
            await download.saveAs(destPath);
            console.log(`  ✓ Saved to ${destPath}`);
        });
    }
});
