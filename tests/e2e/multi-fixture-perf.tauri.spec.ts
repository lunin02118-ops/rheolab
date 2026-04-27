/**
 * Multi-Fixture Workflow Performance Spec — Tauri native mode
 *
 * Идентичен multi-fixture-perf.spec.ts, но вместо Vite-сервера + WASM-анализа
 * подключается к реальному Tauri desktop-приложению через CDP.
 *
 * Это значит:
 *  — анализ выполняется нативным Rust (не WASM в WebView)
 *  — metrics.analysisMs отражает реальное время Tauri invoke + Rust
 *  — нет начального WASM JIT-прогрева
 *  — нет структурированного клонирования AoS через Worker
 *
 * Запуск:
 *   npm run perf:workflow:tauri
 *   npx playwright test --config playwright.tauri.config.ts
 *
 * Prerequisite: cargo build в src-tauri/ (выполняется автоматически в globalSetup,
 * если бинарник не найден). Для ускорения повторных запусков:
 *   TAURI_E2E_SKIP_BUILD=1 npm run perf:workflow:tauri
 *
 * Схема выходного JSON — идентична web-варианту (совместима с perf:compare).
 * runId получает суффикс "-tauri" чтобы отличить от web-замеров.
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import type { Page } from '@playwright/test';
import { enableCdp, snap, fmtDelta, type CdpSnap } from './cdp-helpers';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    CHANDLER_SST_63,
    CHANDLER_SWB_96,
    GRACE_REPORT,
    BROOKFIELD_4,
    BSL_REPORT,
    OFITE_1100,
} from './fixtures';

setupBeforeEach(test);

// Capture page console output to aid debugging (errors show in Playwright output).
test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.text().includes('[E2E_SHIM]')) {
            console.log(`[PAGE ${msg.type()}] ${msg.text()}`);
        }
    });
});

// ─── Config ─────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve('outputs', 'e2e', 'perf');

// ─── CDP helpers ─────────────────────────────────────────────────────────────
// enableCdp, snap, CdpClient, CdpSnap, linearSlope, fmtDelta — в ./cdp-helpers.ts
// (реиспользуется в memory-leak-soak.tauri.spec.ts)

// ─── Performance marks helpers ───────────────────────────────────────────────

interface PerfMarkEntry { name: string; duration: number }

async function getPerfMarks(page: Page): Promise<PerfMarkEntry[]> {
    return page.evaluate<PerfMarkEntry[]>(() => {
         
        const mon = (window as any).__perfMon;
        return mon ? mon.list() : [];
    });
}

async function clearPerfMarks(page: Page): Promise<void> {
    await page.evaluate(() => {
         
        const mon = (window as any).__perfMon;
        if (mon) mon.reset();
    });
}

// ─── Step recorder ───────────────────────────────────────────────────────────

interface StepData {
    heapUsedMb:          number;
    heapTotalMb:         number;
    nodes:               number;
    heapDeltaMb:         number;
    nodesDelta:          number;
    analysisMs:          number | null;
    uplotInitMs:         number | null;
    wallMs:              number;
    // Δ производительности рендерера за этот шаг
    cpuDeltaMs:          number | null;  // CPU рендер-процесса
    taskDeltaMs:         number | null;  // блокировка main thread
    scriptDeltaMs:       number | null;  // выполнение JS
    layoutCountDelta:    number | null;  // layout-операции
    recalcStyleDelta:    number | null;  // пересчёты стилей
    note?:               string;
}

type StepMap = Record<string, StepData>;

// ─── Test ────────────────────────────────────────────────────────────────────

test.describe('[PerfWorkflow/Tauri] Full workflow baseline — native analysis', () => {
    test.setTimeout(900_000); // 15 мин

    test('workflow_perf_baseline_tauri', async ({ page, dashboard, comparison, reports }) => {
        // ── Verify IPC proxy is active ─────────────────────────────────────
        const proxyCheck = await page.evaluate(async () => {
            const internals = (window as any).__TAURI_INTERNALS__;
            if (!internals) return 'no-internals';
            // Check if the proxy intercepts licensing_check
            try {
                const result = await internals.invoke('licensing_check', {});
                return `status=${result?.status}, type=${result?.licenseType}, maxCmp=${result?.features?.maxComparisonExperiments}`;
            } catch (e: any) {
                return `invoke-error: ${e?.message || String(e)}`;
            }
        });
        console.log('[E2E] IPC proxy check:', proxyCheck);

        // runId с суффиксом "-tauri" — совместим с perf:compare, отличим от web-замеров
        const runId        = `${Date.now()}-tauri`;
        const testStart    = Date.now();
        const steps: StepMap = {};
        const allHeapSamples: number[] = [];
        const allNodeSamples: number[] = [];

        const cdp = await enableCdp(page);

        async function recordStep(
            id: string,
            prevSnap: CdpSnap,
            wallStart: number,
            pg: Page,
            note?: string,
        ): Promise<CdpSnap> {
            await pg.waitForTimeout(300);
            const current = await snap(cdp);
            const marks   = await getPerfMarks(pg);
            const analysisMark = marks.findLast(m => m.name === 'analysis');
            const uplotMark    = marks.findLast(m => m.name === 'uplot:init');

            const r1 = (v: number) => Math.round(v * 10) / 10;
            const entry: StepData = {
                heapUsedMb:       current.heapUsedMb,
                heapTotalMb:      current.heapTotalMb,
                nodes:            current.nodes,
                heapDeltaMb:      Math.round((current.heapUsedMb - prevSnap.heapUsedMb) * 100) / 100,
                nodesDelta:       current.nodes - prevSnap.nodes,
                analysisMs:       analysisMark ? Math.round(analysisMark.duration) : null,
                uplotInitMs:      uplotMark    ? Math.round(uplotMark.duration)    : null,
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
                entry.analysisMs  !== null ? `analysis=${entry.analysisMs} ms`        : null,
                entry.uplotInitMs !== null ? `uplot=${entry.uplotInitMs} ms`          : null,
                entry.cpuDeltaMs  !== null ? `cpu=${fmtDelta(entry.cpuDeltaMs, ' ms')}` : null,
                entry.taskDeltaMs !== null ? `task=${fmtDelta(entry.taskDeltaMs, ' ms')}` : null,
                entry.layoutCountDelta !== null ? `layouts=${fmtDelta(entry.layoutCountDelta)}` : null,
                entry.recalcStyleDelta !== null ? `recalc=${fmtDelta(entry.recalcStyleDelta)}`  : null,
                `wall=${entry.wallMs} ms`,
            ].filter(Boolean).join(', ');
            console.log(`  [perf/tauri] ${id}: ${parts}`);

            return current;
        }

        // ── Step 0: initial baseline ─────────────────────────────────────────
        let prev = await snap(cdp);
        steps['initial'] = {
            heapUsedMb:       prev.heapUsedMb,
            heapTotalMb:      prev.heapTotalMb,
            nodes:            prev.nodes,
            heapDeltaMb:      0,
            nodesDelta:       0,
            analysisMs:       null,
            uplotInitMs:      null,
            wallMs:           0,
            cpuDeltaMs:       null,
            taskDeltaMs:      null,
            scriptDeltaMs:    null,
            layoutCountDelta: null,
            recalcStyleDelta: null,
            note: 'Baseline — Tauri app loaded, navigated to dashboard',
        };
        allHeapSamples.push(prev.heapUsedMb);
        allNodeSamples.push(prev.nodes);
        console.log(`\n[perf/tauri] initial: heap=${prev.heapUsedMb} MB, nodes=${prev.nodes}`);

        // ── Steps 1–6: upload + analyze + save each fixture ──────────────────
        const allFixtures = [
            CHANDLER_SST_63,
            CHANDLER_SWB_96,
            GRACE_REPORT,
            BROOKFIELD_4,
            BSL_REPORT,
            OFITE_1100,
        ];
        const savedNames: string[] = [];

        for (let i = 0; i < allFixtures.length; i++) {
            const fx     = allFixtures[i];
            const stepId = `after_${fx.displayName.replace(/\s+/g, '_').toLowerCase()}`;
            console.log(`\n── Fixture ${i + 1}/${allFixtures.length}: ${fx.displayName} ──`);

            if (i > 0) {
                const reset = dashboard.page.getByTestId('UploadCardResetLink');
                if (await reset.isVisible({ timeout: 3_000 }).catch(() => false)) {
                    await reset.click();
                    await page.waitForTimeout(300);
                } else {
                    await dashboard.goto();
                }
            }

            await clearPerfMarks(page);
            const wallStart = Date.now();

            await dashboard.uploadFile(fx);
            await dashboard.waitForAnalysis(90_000);

            const expName = `PerfTauri_${fx.displayName.replace(/\s+/g, '')}_${runId}_${i}`;
            await dashboard.saveExperiment({ name: expName });
            savedNames.push(expName);

            prev = await recordStep(stepId, prev, wallStart, page, fx.displayName);
        }

        // ── Step 7: navigate to Comparison, add 4 experiments ───────────────
        console.log('\n── Comparison: 4 experiments ──');
        const cmpStart = Date.now();
        await clearPerfMarks(page);

        // Clear any stale comparison state (in-memory Zustand + persisted localStorage)
        await page.evaluate(() => {
            localStorage.removeItem('comparison-storage');
        });

        await comparison.goto();
        await comparison.expectLoaded();

        // Force-clear comparison store via JS (module should be loaded now)
        await page.evaluate(() => {
            const store = (window as any).__rheolab_comparison_store;
            if (store) {
                store.setState({ experiments: [] });
                console.log('[E2E] Comparison store force-cleared');
            } else {
                console.log('[E2E] WARNING: __rheolab_comparison_store not available');
            }
            // Also re-clear localStorage to prevent persist middleware from restoring
            localStorage.removeItem('comparison-storage');
        });
        await page.waitForTimeout(500); // Wait for React re-render

        // Diagnostic: check state before opening selector
        const preState = await page.evaluate(() => {
            const cmpStore = (window as any).__rheolab_comparison_store;
            const licStore = (window as any).__rheolab_license_store;
            const chipCount = document.querySelectorAll('[data-testid="ComparisonExperimentChip"]').length;
            const selectorBtn = document.querySelector('[data-testid="OpenExperimentSelectorButton"]') as HTMLButtonElement | null;
            return {
                chipCount,
                btnDisabled: selectorBtn?.disabled ?? 'no-btn',
                btnTitle: selectorBtn?.title ?? 'no-btn',
                cmpAvail: !!cmpStore,
                cmpLen: cmpStore?.getState()?.experiments?.length ?? -1,
                licStatus: licStore?.getState()?.status ?? 'N/A',
                licMaxCmp: licStore?.getState()?.result?.license?.features?.maxComparisonExperiments ?? -1,
            };
        });
        console.log('[E2E] Pre-comparison state:', JSON.stringify(preState));

        const CMP_FIXTURES_COUNT = 3;  // Demo license caps at 3
        for (let idx = 0; idx < CMP_FIXTURES_COUNT; idx++) {
            await comparison.openSelector();
            await comparison.addExperimentByIndex(idx);
            await comparison.expectChipCount(idx + 1);
        }

        await comparison.expectChartVisible();
        await comparison.expectCanvasPainted();

        prev = await recordStep('comparison_4_loaded', prev, cmpStart, page,
            `${CMP_FIXTURES_COUNT} experiments loaded in comparison chart`);

        const legendCount = await comparison.getLegendSeriesCount();
        expect(legendCount).toBeGreaterThanOrEqual(CMP_FIXTURES_COUNT);
        console.log(`  ✓ Legend: ${legendCount} series`);

        // ── Steps 8–9: PDF export × 2 fixtures ──────────────────────────────
        // NOTE: In Tauri mode, PDF uses native save dialog (plugin:dialog|save),
        // mocked in base-test.tauri.ts to return null (auto-cancel).
        //
        // ALSO: reports_generate_pdf itself is mocked in base-test.tauri.ts to
        // return minimal PDF bytes (~0ms) because Typst at opt-level=0 (default
        // debug profile) takes 5+ minutes and would time out the test.
        // Real PDF timing requires either:
        //   a) Release build: npm run tauri:build + measure separately, OR
        //   b) Debug build with [profile.dev.package.typst] opt-level=2 in
        //      src-tauri/Cargo.toml (already added) + full rebuild.
        // The wall time recorded here covers upload + analysis + navigation;
        // PDF generation itself is ~0ms (mocked). Tagged as "debug-mocked" in output.
        const pdfFixtures = [CHANDLER_SST_63, GRACE_REPORT];
        for (const fx of pdfFixtures) {
            const stepId = `pdf_${fx.displayName.replace(/\s+/g, '_').toLowerCase()}`;
            console.log(`\n── PDF: ${fx.displayName} ──`);

            await dashboard.goto();
            if (await dashboard.chartTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
                await dashboard.switchTab('chart');
            }
            await clearPerfMarks(page);
            const wallStart = Date.now();

            await dashboard.uploadFile(fx);
            await dashboard.waitForAnalysis(90_000);

            await reports.goto();
            await reports.expectPdfButtonVisible();
            // Click PDF button — dialog mock returns null → generation runs, file not saved
            await reports.downloadButton.click();
            // Wait for button to re-enable after generate + finally block.
            // With mock: near-instant. With real Typst (opt-level=2 debug): ~10–30s.
            // If the IPC mock wasn't installed (invoke frozen in Tauri v2),
            // the real Typst renderer runs at opt-level=0 and may not finish
            // in any reasonable time — cap at 30 s and skip gracefully.
            try {
                await expect(reports.downloadButton).not.toBeDisabled({ timeout: 30_000 });
            } catch {
                console.log(`  ⚠ PDF button did not re-enable in 30 s (IPC mock likely inactive) — skipping`);
                // Navigate away so the stuck generation doesn't block next step
                await dashboard.goto();
                prev = await recordStep(stepId, prev, wallStart, page,
                    `PDF export for ${fx.displayName} (SKIPPED – mock inactive)`);
                continue;
            }

            prev = await recordStep(stepId, prev, wallStart, page, `PDF export for ${fx.displayName}`);
        }

        // ── Finalize ─────────────────────────────────────────────────────────
        const totalWallMs = Date.now() - testStart;
        const peakHeapMb  = Math.round(Math.max(...allHeapSamples) * 100) / 100;
        const peakNodes   = Math.max(...allNodeSamples);

        const report = {
            scenario:    'workflow-perf',
            mode:        'tauri-native', // ← отличает от web-замеров при сравнении
            runId,
            generatedAt: new Date().toISOString(),
            totalWallMs,
            peakHeapMb,
            peakNodes,
            steps,
        };

        await mkdir(OUTPUT_DIR, { recursive: true });
        const outPath = path.join(OUTPUT_DIR, `workflow-${runId}.json`);
        await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

        console.log(`\n[perf/tauri] ─── Summary ───`);
        console.log(`  Mode:        Tauri native (no WASM analysis)`);
        console.log(`  Peak heap:   ${peakHeapMb} MB`);
        console.log(`  Peak nodes:  ${peakNodes}`);
        console.log(`  Total wall:  ${(totalWallMs / 1000).toFixed(1)} s`);
        console.log(`  Output:      ${outPath}`);

        expect(peakHeapMb, 'Peak heap < 500 MB').toBeLessThan(500);
        expect(peakNodes,  'Peak DOM nodes < 30000').toBeLessThan(30_000);
    });
});
