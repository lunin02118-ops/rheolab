/**
 * DB-Scale Performance Spec — Tauri native mode
 *
 * Измеряет производительность UI при двух размерах базы данных:
 *   small — ~12 экспериментов (1 копия × все фикстуры)
 *   large — ~7000 экспериментов (588 копий × все фикстуры)
 *
 * Сценарий включает 9 шагов, охватывающих ключевые операции с библиотекой:
 *   1. library_open          — открытие страницы библиотеки
 *   2. library_scroll        — прокрутка списка до конца
 *   3. search_by_name        — поиск по имени (FTS5)
 *   4. filter_fluid_type     — фильтрация по типу жидкости
 *   5. filter_date_range     — фильтрация по диапазону дат
 *   6. filter_reset          — сброс всех фильтров
 *   7. open_experiment_card  — открытие карточки эксперимента
 *   8. navigate_dashboard    — переход на дашборд
 *   9. dashboard_back        — возврат в библиотеку
 *
 * Запуск:
 *   npm run perf:db:small          — small DB
 *   npm run perf:db:large          — large DB
 *   cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:db:small     — small DB, без пересборки
 *   cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:db:large     — large DB, без пересборки
 *   npm run perf:db:compare        — сравнение результатов
 *
 * Выходной JSON: outputs/e2e/perf/db-scale-<runId>.json
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import { enableCdp, snap, fmtDelta, type CdpSnap } from './cdp-helpers';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

setupBeforeEach(test);

const OUTPUT_DIR = path.resolve('outputs', 'e2e', 'perf');

// ─── StepData (совпадает с multi-fixture-perf.tauri.spec.ts) ─────────────────

interface StepData {
    heapUsedMb:          number;
    heapTotalMb:         number;
    nodes:               number;
    heapDeltaMb:         number;
    nodesDelta:          number;
    wallMs:              number;
    cpuDeltaMs:          number | null;
    taskDeltaMs:         number | null;
    scriptDeltaMs:       number | null;
    layoutCountDelta:    number | null;
    recalcStyleDelta:    number | null;
    note?:               string;
}

type StepMap = Record<string, StepData>;

// ─── Test ─────────────────────────────────────────────────────────────────────

const scale = (process.env.RHEOLAB_DB_SCALE || 'small').toLowerCase() as 'small' | 'large';

test.describe(`[DBScale/${scale.toUpperCase()}] Library performance with ${scale} DB`, () => {
    test.setTimeout(600_000); // 10 мин

    test(`db_scale_library_perf_${scale}`, async ({ page, library, dashboard }) => {
        const runId     = `${Date.now()}-${scale}-tauri`;
        const testStart = Date.now();
        const steps: StepMap = {};
        const allHeapSamples: number[] = [];
        const allNodeSamples: number[] = [];

        const cdp = await enableCdp(page);

        async function recordStep(
            id: string,
            prevSnap: CdpSnap,
            wallStart: number,
            note?: string,
        ): Promise<CdpSnap> {
            await page.waitForTimeout(300);
            const current = await snap(cdp);

            const r1 = (v: number) => Math.round(v * 10) / 10;
            const entry: StepData = {
                heapUsedMb:       current.heapUsedMb,
                heapTotalMb:      current.heapTotalMb,
                nodes:            current.nodes,
                heapDeltaMb:      Math.round((current.heapUsedMb - prevSnap.heapUsedMb) * 100) / 100,
                nodesDelta:       current.nodes - prevSnap.nodes,
                wallMs:           Date.now() - wallStart,
                cpuDeltaMs:       r1(current.processCpuMs     - prevSnap.processCpuMs),
                taskDeltaMs:      r1(current.taskDurationMs   - prevSnap.taskDurationMs),
                scriptDeltaMs:    r1(current.scriptDurationMs - prevSnap.scriptDurationMs),
                layoutCountDelta: current.layoutCount      - prevSnap.layoutCount,
                recalcStyleDelta: current.recalcStyleCount - prevSnap.recalcStyleCount,
                ...(note ? { note } : {}),
            };
            steps[id] = entry;
            allHeapSamples.push(current.heapUsedMb);
            allNodeSamples.push(current.nodes);

            const parts = [
                `heap=${current.heapUsedMb} MB (${fmtDelta(entry.heapDeltaMb, ' MB')})`,
                `nodes=${current.nodes} (${fmtDelta(entry.nodesDelta)})`,
                `cpu=${fmtDelta(entry.cpuDeltaMs!, ' ms')}`,
                `task=${fmtDelta(entry.taskDeltaMs!, ' ms')}`,
                `wall=${entry.wallMs} ms`,
            ].join(', ');
            console.log(`  [db-scale/${scale}] ${id}: ${parts}`);

            return current;
        }

        // ── Baseline ─────────────────────────────────────────────────────────
        let prev = await snap(cdp);
        steps['initial'] = {
            heapUsedMb:       prev.heapUsedMb,
            heapTotalMb:      prev.heapTotalMb,
            nodes:            prev.nodes,
            heapDeltaMb:      0,
            nodesDelta:       0,
            wallMs:           0,
            cpuDeltaMs:       null,
            taskDeltaMs:      null,
            scriptDeltaMs:    null,
            layoutCountDelta: null,
            recalcStyleDelta: null,
            note: `Baseline — scale=${scale}`,
        };
        allHeapSamples.push(prev.heapUsedMb);
        allNodeSamples.push(prev.nodes);
        console.log(`\n[db-scale/${scale}] initial: heap=${prev.heapUsedMb} MB, nodes=${prev.nodes}`);

        // ── Step 1: library_open ──────────────────────────────────────────────
        {
            console.log(`\n── Step 1: library_open ──`);
            const wallStart = Date.now();
            await library.goto();
            await library.expectLoaded();
            // Ждём появления хотя бы одного эксперимента (или пустого состояния)
            await page.waitForTimeout(1_000);
            prev = await recordStep('library_open', prev, wallStart, `Navigate to library (${scale})`);
        }

        // ── Step 2: library_scroll ────────────────────────────────────────────
        {
            console.log(`\n── Step 2: library_scroll ──`);
            const wallStart = Date.now();
            // Прокручиваем список экспериментов вниз, затем наверх
            const container = library.experimentListContainer;
            const isVisible = await container.isVisible({ timeout: 3_000 }).catch(() => false);
            if (isVisible) {
                await container.evaluate((el) => { el.scrollTop = el.scrollHeight; });
                await page.waitForTimeout(500);
                await container.evaluate((el) => { el.scrollTop = 0; });
                await page.waitForTimeout(300);
            }
            prev = await recordStep('library_scroll', prev, wallStart, 'Scroll to bottom and back');
        }

        // ── Step 3: search_by_name (FTS5) ─────────────────────────────────────
        {
            console.log(`\n── Step 3: search_by_name ──`);
            const wallStart = Date.now();
            // Ищем строку, которая точно есть в seed-данных
            await library.search('Chandler');
            // Ждём обновления списка
            await page.waitForTimeout(800);
            prev = await recordStep('search_by_name', prev, wallStart, 'FTS5 search: "Chandler"');
        }

        // ── Step 4: filter_fluid_type ────────────────────────────────────────
        {
            console.log(`\n── Step 4: filter_fluid_type ──`);
            await library.ensureFilterGroupOpen('Параметры теста', library.fluidTypeFilter);
            const wallStart = Date.now();
            // Очищаем поиск, устанавливаем фильтр по типу жидкости
            await library.search('');
            const isFilterVisible = await library.fluidTypeFilter.isVisible({ timeout: 2_000 }).catch(() => false);
            if (isFilterVisible) {
                await library.fluidTypeFilter.click();
                // Выбираем первое доступное значение из списка
                const option = page.locator('[role="option"]').first();
                const hasOption = await option.isVisible({ timeout: 2_000 }).catch(() => false);
                if (hasOption) {
                    await option.click();
                    await page.waitForTimeout(600);
                } else {
                    // Закрываем если нет опций
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(300);
                }
            }
            prev = await recordStep('filter_fluid_type', prev, wallStart, 'Filter by fluid type (first option)');
        }

        // ── Step 5: filter_date_range ────────────────────────────────────────
        {
            console.log(`\n── Step 5: filter_date_range ──`);
            // Пробуем найти date range фильтр через testid
            const dateFromInput = page.getByTestId('DateFromFilterInput');
            const dateToInput   = page.getByTestId('DateToFilterInput');
            await library.ensureFilterGroupOpen('Локация и объект', dateFromInput);
            const wallStart = Date.now();
            const hasDateFrom = await dateFromInput.isVisible({ timeout: 2_000 }).catch(() => false);
            if (hasDateFrom) {
                await dateFromInput.fill('2024-01-01');
                await page.waitForTimeout(300);
                await dateToInput.fill('2025-12-31');
                await page.waitForTimeout(600);
            }
            prev = await recordStep('filter_date_range', prev, wallStart, 'Filter by date range 2024–2025');
        }

        // ── Step 6: filter_reset ─────────────────────────────────────────────
        {
            console.log(`\n── Step 6: filter_reset ──`);
            const wallStart = Date.now();
            try {
                const btn = library.clearFiltersButton;
                // Wait up to 3 s for button to become enabled; if it never does, just skip
                await btn.waitFor({ state: 'visible', timeout: 3_000 });
                const enabled = await btn.isEnabled().catch(() => false);
                if (enabled) {
                    await btn.click();
                    await page.waitForTimeout(300);
                } else {
                    console.log('  [db-scale] ClearFiltersButton disabled — no active filters to reset, skipping');
                }
            } catch {
                console.log('  [db-scale] ClearFiltersButton not found — skipping filter_reset');
            }
            await page.waitForTimeout(600);
            prev = await recordStep('filter_reset', prev, wallStart, 'Clear all filters');
        }

        // ── Step 7: open_experiment_card ─────────────────────────────────────
        {
            console.log(`\n── Step 7: open_experiment_card ──`);
            const wallStart = Date.now();
            // Открываем первую карточку
            const firstCard = library.getExperimentCards().first();
            const hasCard = await firstCard.isVisible({ timeout: 5_000 }).catch(() => false);
            if (hasCard) {
                await firstCard.click();
                // Ждём открытия диалога/панели
                await page.waitForTimeout(800);
            }
            prev = await recordStep('open_experiment_card', prev, wallStart, 'Open first experiment card');
        }

        // ── Step 8: navigate_dashboard ───────────────────────────────────────
        {
            console.log(`\n── Step 8: navigate_dashboard ──`);
            const wallStart = Date.now();
            // Закрываем карточку и переходим на дашборд
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
            await dashboard.goto();
            await page.waitForTimeout(500);
            prev = await recordStep('navigate_dashboard', prev, wallStart, 'Navigate to dashboard');
        }

        // ── Step 9: dashboard_back ────────────────────────────────────────────
        {
            console.log(`\n── Step 9: dashboard_back ──`);
            const wallStart = Date.now();
            await library.goto();
            await library.expectLoaded();
            await page.waitForTimeout(600);
            prev = await recordStep('dashboard_back', prev, wallStart, 'Return to library from dashboard');
        }

        // ── Finalize ─────────────────────────────────────────────────────────
        const totalWallMs = Date.now() - testStart;
        const peakHeapMb  = Math.round(Math.max(...allHeapSamples) * 100) / 100;
        const peakNodes   = Math.max(...allNodeSamples);

        // Количество экспериментов из env или по умолчанию
        const experimentCount = scale === 'large' ? 7056 : (12);

        const report = {
            scenario:        'db-scale-perf',
            mode:            'tauri-native',
            scale,
            runId,
            experimentCount,
            generatedAt:     new Date().toISOString(),
            totalWallMs,
            peakHeapMb,
            peakNodes,
            steps,
        };

        await mkdir(OUTPUT_DIR, { recursive: true });
        const outPath = path.join(OUTPUT_DIR, `db-scale-${runId}.json`);
        await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

        console.log(`\n[db-scale/${scale}] ─── Summary ───`);
        console.log(`  Scale:         ${scale} (~${experimentCount} experiments)`);
        console.log(`  Peak heap:     ${peakHeapMb} MB`);
        console.log(`  Peak nodes:    ${peakNodes}`);
        console.log(`  Total wall:    ${(totalWallMs / 1000).toFixed(1)} s`);
        console.log(`  Output:        ${outPath}`);

        // Ограничения — у большой БД допустимее накладные расходы, но всё равно ограничиваем
        const heapLimit  = scale === 'large' ? 600 : 400;
        const nodeLimit  = scale === 'large' ? 50_000 : 30_000;
        expect(peakHeapMb, `Peak heap < ${heapLimit} MB`).toBeLessThan(heapLimit);
        expect(peakNodes,  `Peak DOM nodes < ${nodeLimit}`).toBeLessThan(nodeLimit);
    });
});
