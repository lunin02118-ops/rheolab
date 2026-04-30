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
import type { Page } from '@playwright/test';
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

interface LibraryFilterPerfEvent {
    name: string;
    at_ms: number;
    request_id?: number;
    filter_keys?: string[];
    page?: number;
    limit?: number;
    view_mode?: 'grid' | 'list';
    result_count?: number;
    total_count?: number | null;
    duration_ms?: number;
}

interface LibraryFilterSpan {
    label: string;
    total_ms: number;
    input_to_filter_change_ms: number | null;
    filter_change_to_debounce_fire_ms: number | null;
    debounce_fire_to_ipc_start_ms: number | null;
    ipc_ms: number | null;
    ipc_to_render_commit_ms: number | null;
    render_commit_to_settled_ms: number | null;
    request_id?: number;
    filter_keys: string[];
    result_count?: number;
    total_count?: number | null;
    event_count: number;
    events: LibraryFilterPerfEvent[];
}

async function installLibraryFilterPerfHook(page: Page): Promise<void> {
    const install = () => {
        const eventName = 'rheolab:library-filter-perf';
        const storageKey = '__RHEOLAB_LIBRARY_FILTER_PERF_EVENTS__';
        const w = window as unknown as {
            __RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?: {
                events: unknown[];
                listenerInstalled?: boolean;
                record: (event: unknown) => void;
            };
        };
        const events = w.__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?.events ?? [];
        w.__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__ = {
            events,
            listenerInstalled: w.__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?.listenerInstalled,
            record(event) {
                w.__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?.events.push({ ...(event as Record<string, unknown>) });
            },
        };
        window.localStorage.setItem(storageKey, '1');
        if (!w.__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__.listenerInstalled) {
            window.addEventListener(eventName, (event) => {
                const detail = (event as CustomEvent).detail as Record<string, unknown> | undefined;
                if (detail) {
                    w.__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?.events.push({ ...detail });
                }
            });
            w.__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__.listenerInstalled = true;
        }
    };
    await page.addInitScript(install);
    await page.evaluate(install);
}

async function resetLibraryFilterEvents(page: Page): Promise<number> {
    return page.evaluate(() => {
        const w = window as unknown as {
            __RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?: {
                events?: unknown[];
            };
        };
        const events = w.__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?.events;
        if (events) events.length = 0;
        return performance.now();
    });
}

async function readLibraryFilterEvents(page: Page): Promise<LibraryFilterPerfEvent[]> {
    return page.evaluate(() => {
        const w = window as unknown as {
            __RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?: {
                events?: unknown[];
            };
        };
        return [...(w.__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?.events ?? [])] as LibraryFilterPerfEvent[];
    });
}

async function waitForLibraryFilterEvent(
    page: Page,
    eventName: string,
    timeout = 5_000,
): Promise<void> {
    await page.waitForFunction(
        (name) => {
            const w = window as unknown as {
                __RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?: {
                    events?: { name?: string }[];
                };
            };
            return (w.__RHEOLAB_LIBRARY_FILTER_PERF_HOOK__?.events ?? [])
                .some((event) => event.name === name);
        },
        eventName,
        { timeout },
    ).catch(() => undefined);
}

function roundMs(value: number): number {
    return Math.round(value * 10) / 10;
}

function eventDelta(
    from: LibraryFilterPerfEvent | { at_ms: number } | undefined,
    to: LibraryFilterPerfEvent | { at_ms: number } | undefined,
): number | null {
    if (!from || !to) return null;
    return roundMs(to.at_ms - from.at_ms);
}

function lastEvent(
    events: LibraryFilterPerfEvent[],
    name: string,
    requestId?: number,
): LibraryFilterPerfEvent | undefined {
    return [...events]
        .reverse()
        .find((event) => event.name === name && (requestId === undefined || event.request_id === requestId));
}

function buildLibraryFilterSpan(
    label: string,
    actionStartMs: number,
    actionSettledMs: number,
    events: LibraryFilterPerfEvent[],
): LibraryFilterSpan {
    const ipcEnd = lastEvent(events, 'ipc_end');
    const requestId = ipcEnd?.request_id;
    const debounceScheduled = lastEvent(events, 'debounce_scheduled', requestId);
    const debounceFired = lastEvent(events, 'debounce_fired', requestId);
    const ipcStart = lastEvent(events, 'ipc_start', requestId);
    const renderCommit = lastEvent(events, 'render_commit', requestId);
    const filtersChanged = [...events]
        .reverse()
        .find((event) => event.name === 'filters_changed' && (!debounceScheduled || event.at_ms <= debounceScheduled.at_ms));

    return {
        label,
        total_ms: roundMs(actionSettledMs - actionStartMs),
        input_to_filter_change_ms: eventDelta({ at_ms: actionStartMs }, filtersChanged),
        filter_change_to_debounce_fire_ms: eventDelta(filtersChanged, debounceFired),
        debounce_fire_to_ipc_start_ms: eventDelta(debounceFired, ipcStart),
        ipc_ms: ipcEnd?.duration_ms ?? eventDelta(ipcStart, ipcEnd),
        ipc_to_render_commit_ms: eventDelta(ipcEnd, renderCommit),
        render_commit_to_settled_ms: eventDelta(renderCommit, { at_ms: actionSettledMs }),
        ...(requestId !== undefined ? { request_id: requestId } : {}),
        filter_keys: ipcEnd?.filter_keys ?? debounceScheduled?.filter_keys ?? filtersChanged?.filter_keys ?? [],
        ...(ipcEnd?.result_count !== undefined ? { result_count: ipcEnd.result_count } : {}),
        ...(ipcEnd?.total_count !== undefined ? { total_count: ipcEnd.total_count } : {}),
        event_count: events.length,
        events,
    };
}

// ─── Test ─────────────────────────────────────────────────────────────────────

const scale = (process.env.RHEOLAB_DB_SCALE || 'small').toLowerCase() as 'small' | 'large';

test.describe(`[DBScale/${scale.toUpperCase()}] Library performance with ${scale} DB`, () => {
    test.setTimeout(600_000); // 10 мин

    test(`db_scale_library_perf_${scale}`, async ({ page, library, dashboard }) => {
        const runId     = `${Date.now()}-${scale}-tauri`;
        const testStart = Date.now();
        const steps: StepMap = {};
        const libraryFilterSpans: Record<string, LibraryFilterSpan> = {};
        const allHeapSamples: number[] = [];
        const allNodeSamples: number[] = [];

        const cdp = await enableCdp(page);
        await installLibraryFilterPerfHook(page);

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

        async function measureLibraryFilterAction(
            id: string,
            label: string,
            action: () => Promise<void>,
        ): Promise<void> {
            const actionStartMs = await resetLibraryFilterEvents(page);
            await action();
            await waitForLibraryFilterEvent(page, 'ipc_end');
            await library.waitForListSettled(20_000);
            await waitForLibraryFilterEvent(page, 'render_commit');
            await page.waitForTimeout(100);
            const actionSettledMs = await page.evaluate(() => performance.now());
            const events = await readLibraryFilterEvents(page);
            const span = buildLibraryFilterSpan(label, actionStartMs, actionSettledMs, events);
            libraryFilterSpans[id] = span;

            const parts = [
                `total=${span.total_ms} ms`,
                `ipc=${span.ipc_ms ?? 'n/a'} ms`,
                `render=${span.ipc_to_render_commit_ms ?? 'n/a'} ms`,
                `settle=${span.render_commit_to_settled_ms ?? 'n/a'} ms`,
                `events=${span.event_count}`,
            ].join(', ');
            console.log(`  [db-scale/${scale}] ${id} spans: ${parts}`);
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
            await installLibraryFilterPerfHook(page);
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
            await measureLibraryFilterAction('search_by_name', 'FTS5 search: "Chandler"', async () => {
                await library.ensureFilterGroupOpen('Поиск', library.searchInput);
                await library.searchInput.fill('Chandler');
            });
            prev = await recordStep('search_by_name', prev, wallStart, 'FTS5 search: "Chandler"');
        }

        // ── Step 4: filter_fluid_type ────────────────────────────────────────
        {
            console.log(`\n── Step 4: filter_fluid_type ──`);
            await library.ensureFilterGroupOpen('Параметры теста', library.fluidTypeFilter);
            const wallStart = Date.now();
            await measureLibraryFilterAction('filter_fluid_type', 'Filter by fluid type (first option)', async () => {
                // Очищаем поиск, устанавливаем фильтр по типу жидкости
                await library.ensureFilterGroupOpen('Поиск', library.searchInput);
                await library.searchInput.fill('');
                const isFilterVisible = await library.fluidTypeFilter.isVisible({ timeout: 2_000 }).catch(() => false);
                if (isFilterVisible) {
                    await library.fluidTypeFilter.click();
                    // Выбираем первое доступное значение из списка
                    const option = page.locator('[role="option"]').first();
                    const hasOption = await option.isVisible({ timeout: 2_000 }).catch(() => false);
                    if (hasOption) {
                        await option.click();
                    } else {
                        // Закрываем если нет опций
                        await page.keyboard.press('Escape');
                    }
                }
            });
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
            await measureLibraryFilterAction('filter_date_range', 'Filter by date range 2024-2025', async () => {
                const hasDateFrom = await dateFromInput.isVisible({ timeout: 2_000 }).catch(() => false);
                if (hasDateFrom) {
                    await dateFromInput.fill('2024-01-01');
                    await dateToInput.fill('2025-12-31');
                }
            });
            prev = await recordStep('filter_date_range', prev, wallStart, 'Filter by date range 2024–2025');
        }

        // ── Step 6: filter_reset ─────────────────────────────────────────────
        {
            console.log(`\n── Step 6: filter_reset ──`);
            const wallStart = Date.now();
            await measureLibraryFilterAction('filter_reset', 'Clear all filters', async () => {
                try {
                    const btn = library.clearFiltersButton;
                    // Wait up to 3 s for button to become enabled; if it never does, just skip
                    await btn.waitFor({ state: 'visible', timeout: 3_000 });
                    const enabled = await btn.isEnabled().catch(() => false);
                    if (enabled) {
                        await btn.click();
                    } else {
                        console.log('  [db-scale] ClearFiltersButton disabled — no active filters to reset, skipping');
                    }
                } catch {
                    console.log('  [db-scale] ClearFiltersButton not found — skipping filter_reset');
                }
            });
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
            libraryFilterSpans,
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
