/**
 * E2E — Comparison Report RELEASE-GATE Workflow (Tauri native, no mocks)
 *
 * Цель: сымитировать полный путь пользователя через новую Comparison Report
 * вкладку на РЕАЛЬНОМ Tauri-бинарнике и проверить, что фича работает
 * стабильно в нескольких комбинациях настроек. Если этот тест падает —
 * релиз в alpha / beta / stable блокируется.
 *
 *   ─────────────────────────────────────────────────────────────
 *   ОБЯЗАТЕЛЬНО прогонять:
 *     • перед каждым релизом (`npm run release:prepare`)
 *     • перед публикацией на VPS (`scripts/deploy/publish-update.js`)
 *     • после любых изменений в `src/components/comparison/reports/*`,
 *       `src/lib/reports/comparison-*`, `src-tauri/src/commands/reports/*`
 *   ─────────────────────────────────────────────────────────────
 *
 * Проверяет:
 *   1. Загрузку 4 разных фикстур (разные инструменты + форматы).
 *   2. Сохранение экспериментов в SQLite через real Rust IPC.
 *   3. Добавление всех 4 в Comparison (проверяет selector + lic lim).
 *   4. Рендер multi-series uPlot chart (CSS paint check).
 *   5. Открытие новой Report sub-tab (Phase 3 UI).
 *   6. 7 последовательных экспортов в 4 разных конфигах:
 *        Phase A  — defaults        → PDF + XLSX
 *        Phase B  — all sections ON → PDF + XLSX
 *        Phase C  — English + all   → PDF + XLSX
 *        Phase D  — minimal (all OFF) → PDF
 *   7. Memory stability — heap не должен расти > 20 MB за 7 экспортов.
 *   8. Size-invariants — B ≥ A (больше секций), D ≤ A (меньше секций).
 *   9. Magic bytes (%PDF / PK) и размер > 5 KB для каждого файла.
 *
 * Run:
 *   $env:FULL_EXPORT = "1"
 *   $env:TAURI_BINARY_PATH = "src-tauri\target\release\rheolab-enterprise.exe"
 *   $env:TAURI_E2E_SKIP_BUILD = "1"
 *   npx playwright test --config playwright.tauri.config.ts `
 *     tests/e2e/reports/comparison-workflow-release-gate.tauri.spec.ts
 *
 * Или через npm wrapper, который сам выставит env + проверит binary:
 *   npm run test:release-gate
 */

import { test, expect } from '../base-test.tauri';
import type { Page, Download } from '@playwright/test';
import { ComparisonReportsPage } from '../pages/comparison-reports.page';
import {
    CHANDLER_SST_63,
    GRACE_REPORT,
    BSL_REPORT,
    OFITE_1100,
    type TestFixture,
} from '../fixtures';
import { enableCdp, snap, fmtDelta, type CdpClient, type CdpSnap } from '../cdp-helpers';
import fs from 'fs';

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * Этот тест тяжёлый (4 анализа + 7 экспортов через real Rust+Typst). На release
 * Tauri занимает ~2–3 мин, на debug может легко перевалить за 10 мин. Поэтому
 * skip по умолчанию и включается через `FULL_EXPORT=1` (как остальные
 * real-native тесты) либо через `npm run test:release-gate`.
 */
test.skip(
    () => process.env.FULL_EXPORT !== '1',
    'FULL_EXPORT=1 required (or run `npm run test:release-gate`)',
);

// Одного глобального timeout достаточно — 10 минут с запасом под
// первый холодный прогон Typst на чистой кеш-директории.
test.setTimeout(600_000);

const FIXTURES: TestFixture[] = [CHANDLER_SST_63, GRACE_REPORT, BSL_REPORT, OFITE_1100];

// Жёсткие гейты — если упрутся, значит регрессия.
const MAX_HEAP_GROWTH_MB = 20;          // overall (initial → end)
const MIN_EXPORT_SIZE_BYTES = 5 * 1024; // all 7 artifacts must exceed this

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExportArtifact {
    phase: string;
    kind: 'pdf' | 'xlsx';
    size: number;
    filename: string;
    wallMs: number;
    heapDeltaMb: number;
}

interface PerfStep {
    id: string;
    heapMb: number;
    heapDeltaMb: number;
    nodes: number;
    nodesDelta: number;
    wallMs: number;
    cpuDeltaMs: number;
    taskDeltaMs: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function recordStep(
    id: string,
    prev: CdpSnap | null,
    wallStart: number,
    cdp: CdpClient,
): Promise<{ snap: CdpSnap; step: PerfStep }> {
    const s = await snap(cdp);
    const step: PerfStep = {
        id,
        heapMb: s.heapUsedMb,
        heapDeltaMb: prev ? Math.round((s.heapUsedMb - prev.heapUsedMb) * 100) / 100 : 0,
        nodes: s.nodes,
        nodesDelta: prev ? s.nodes - prev.nodes : 0,
        wallMs: Date.now() - wallStart,
        cpuDeltaMs: prev ? Math.round((s.processCpuMs - prev.processCpuMs) * 10) / 10 : 0,
        taskDeltaMs: prev ? Math.round((s.taskDurationMs - prev.taskDurationMs) * 10) / 10 : 0,
    };
    console.log(
        `  [gate] ${id.padEnd(26)} heap=${step.heapMb.toFixed(2)} MB (${fmtDelta(step.heapDeltaMb, ' MB')}), ` +
        `nodes=${step.nodes} (${fmtDelta(step.nodesDelta)}), wall=${step.wallMs} ms`,
    );
    return { snap: s, step };
}

async function resetComparisonStore(page: Page): Promise<void> {
    await page.evaluate(() => {
        localStorage.removeItem('comparison-storage');
        const store = (window as any).__rheolab_comparison_store;
        if (store) store.setState({ experiments: [] });
    });
    await page.waitForTimeout(300);
}

async function saveDownload(download: Download, label: string): Promise<{ size: number; filename: string }> {
    const filePath = await download.path();
    expect(filePath, `download ${label} has no path`).toBeTruthy();
    const buffer = fs.readFileSync(filePath!);
    return { size: buffer.length, filename: download.suggestedFilename() };
}

function assertPdfMagic(bytes: Buffer, label: string): void {
    expect(bytes.slice(0, 4).toString('ascii'), `${label}: %PDF magic bytes missing`).toBe('%PDF');
}

function assertXlsxMagic(bytes: Buffer, label: string): void {
    expect(bytes.slice(0, 2).toString('ascii'), `${label}: PK magic bytes missing`).toBe('PK');
}

// ─── Base test setup (auth/licensing/dialog mocked; reports real) ───────────

test.beforeEach(async ({ page }) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        const url = page.url();
        if (url.includes('tauri.localhost') || url.includes('localhost:')) break;
        await page.waitForTimeout(500);
    }
    if (!page.url().includes('tauri.localhost') && !page.url().includes('localhost:')) {
        throw new Error(`[release-gate] Tauri app did not reach app origin within 60s (url=${page.url()})`);
    }
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate((token: string) => {
        try {
            localStorage.setItem('rheolab_session_token', token);
            localStorage.removeItem('comparison-storage');
            sessionStorage.setItem('__e2e_skip_dialogs', '1');
        } catch { /* storage may be unavailable pre-navigation */ }
    }, 'tauri-e2e-session-token');

    // IPC proxy — mocks auth/licensing/dialog only. Reports, experiments,
    // analysis, fixtures go through to real Rust.
    await page.evaluate(() => {
        const internals: any = (window as any).__TAURI_INTERNALS__;
        if (!internals || internals.__e2eProxy) return;

        const proxy = new Proxy(internals, {
            get(target: any, prop: string | symbol) {
                if (prop === '__e2eProxy') return true;
                if (prop !== 'invoke') return target[prop];

                return async function gateInvoke(...args: any[]) {
                    const [cmd] = args;
                    const user = {
                        id: 'tauri-e2e-admin', name: 'E2E Admin', email: 'admin',
                        role: 'admin', isActive: true, laboratoryId: null,
                    };
                    const devLicense = {
                        status: 'active', source: 'key',
                        features: {
                            maxExperiments: -1, maxComparisonExperiments: 10,
                            calibrationAnalysis: true, calibrationParsing: true,
                            comparison: true, exportPdf: true, exportExcel: true,
                            aiParsing: true, watermark: false,
                            chandler5550Support: true, bslR1Support: true,
                        },
                        key: 'e2e-key', licenseType: 'developer',
                        customerName: 'E2E',
                        expiresAt: new Date(Date.now() + 365 * 86400_000).toISOString(),
                        daysRemaining: 365, experimentsRemaining: -1,
                        message: null, showWarning: false,
                    };

                    if (cmd === 'auth_session') return { valid: true, user };
                    if (cmd === 'auth_sign_in') return { success: true, sessionToken: 'tauri-e2e-session-token', user };
                    if (cmd === 'auth_sign_out') return undefined;
                    if (cmd === 'licensing_check' || cmd === 'licensing_get_status') return devLicense;
                    if (cmd === 'licensing_activate_full') return { ...devLicense, message: 'Activated' };
                    if (cmd === 'licensing_can_save') return true;
                    if (cmd === 'licensing_register_experiment') return { ...devLicense, showWarning: false };
                    if (cmd === 'licensing_machine_id') return 'tauri-e2e-machine';
                    if (cmd === 'licensing_was_ever_licensed') return true;
                    if (cmd === 'api_keys_check_active') return { isValid: true, provider: 'groq', key: 'e2e-stub' };
                    if (cmd === 'api_keys_list') return [];
                    if (cmd === 'plugin:dialog|save' || cmd === 'plugin:dialog|open' ||
                        cmd === 'plugin:dialog|ask' || cmd === 'plugin:dialog|confirm') return null;

                    // Everything else → real Rust.
                    return target.invoke(...args);
                };
            },
        });

        try {
            Object.defineProperty(window, '__TAURI_INTERNALS__', {
                configurable: true, enumerable: true, writable: true, value: proxy,
            });
        } catch {
            // No fallback — real export requires proxy install.
        }
    });
});

// ─── The release-gate workflow ──────────────────────────────────────────────

test.describe('Comparison Report — RELEASE GATE (full user workflow)', () => {
    test('full user workflow: 4 fixtures → 4 settings phases → 7 exports', async ({
        page, dashboard, comparison,
    }) => {
        const cdp = await enableCdp(page);
        const steps: PerfStep[] = [];
        const artifacts: ExportArtifact[] = [];
        let prev: CdpSnap | null = null;

        const testStart = Date.now();

        // ─── Phase 0 — Baseline ──────────────────────────────────────────
        console.log('\n════════════════════════════════════════════════════════');
        console.log('  RELEASE GATE — Comparison Report full user workflow');
        console.log('════════════════════════════════════════════════════════\n');

        await dashboard.goto();
        {
            const { snap: s, step } = await recordStep('initial_dashboard', prev, Date.now(), cdp);
            prev = s; steps.push(step);
        }
        const initialHeap = prev!.heapUsedMb;

        // ─── Phase 1 — Load + save 4 fixtures ────────────────────────────
        console.log('\n── Phase 1: loading 4 fixtures via real Rust pipeline ──');
        const savedNames: string[] = [];
        for (let i = 0; i < FIXTURES.length; i++) {
            const fx = FIXTURES[i];
            const id = `load_${fx.displayName.replace(/\s+/g, '_').toLowerCase()}`;

            await dashboard.goto();
            const t0 = Date.now();
            await dashboard.uploadFile(fx);
            await dashboard.waitForAnalysis();
            const saved = await dashboard.saveExperiment({
                name: `GATE-${i + 1}-${fx.displayName} ${Date.now()}`,
            });
            savedNames.push(saved.name);

            const { snap: s, step } = await recordStep(id, prev, t0, cdp);
            prev = s; steps.push(step);
        }

        // ─── Phase 2 — Comparison view + add all 4 ───────────────────────
        console.log('\n── Phase 2: opening Comparison + adding 4 experiments ──');
        await comparison.goto();
        await resetComparisonStore(page);
        await comparison.expectLoaded();
        {
            const t0 = Date.now();
            for (const name of savedNames) {
                await comparison.addExperimentByName(name);
            }
            await comparison.expectChipCount(FIXTURES.length);
            await comparison.expectChartVisible();
            await comparison.expectCanvasPainted();
            const { snap: s, step } = await recordStep('comparison_4_chart_ready', prev, t0, cdp);
            prev = s; steps.push(step);
        }

        const legend = await comparison.getLegendSeriesCount();
        expect(legend, 'comparison legend did not reflect 4 experiments').toBeGreaterThanOrEqual(
            FIXTURES.length,
        );
        console.log(`  ✓ Legend shows ${legend} series for ${FIXTURES.length} experiments`);

        // ─── Phase 3 — Open new Report sub-tab ───────────────────────────
        console.log('\n── Phase 3: switching to new Report sub-tab ──');
        const reports = new ComparisonReportsPage(page);
        {
            const t0 = Date.now();
            await reports.switchToReportTab();
            await reports.expectLoaded();
            await reports.expectExportButtonsEnabled();
            const { snap: s, step } = await recordStep('report_sub_tab_opened', prev, t0, cdp);
            prev = s; steps.push(step);
        }

        // ─── Phase A — default settings → PDF + XLSX ─────────────────────
        console.log('\n── Phase A: defaults (recipe ON, rest OFF, language RU) ──');
        artifacts.push(await exportAndRecord('A_defaults', 'pdf', reports, cdp, prev!));
        prev = await snap(cdp);
        artifacts.push(await exportAndRecord('A_defaults', 'xlsx', reports, cdp, prev!));
        prev = await snap(cdp);

        // ─── Phase B — enable all sections → PDF + XLSX (expect LARGER) ─
        console.log('\n── Phase B: all sections ON (calibration + raw + recipe + water) ──');
        await flipOn(reports.calibrationToggle, 'calibration');
        await flipOn(reports.rawDataToggle, 'rawData');
        await flipOn(reports.waterAnalysisToggle, 'waterAnalysis');
        // recipe should already be ON by default; verify
        await ensureOn(reports.recipeToggle, 'recipe');

        artifacts.push(await exportAndRecord('B_all_sections', 'pdf', reports, cdp, prev!));
        prev = await snap(cdp);
        artifacts.push(await exportAndRecord('B_all_sections', 'xlsx', reports, cdp, prev!));
        prev = await snap(cdp);

        // ─── Phase C — switch language to EN → PDF + XLSX ────────────────
        console.log('\n── Phase C: language EN, keep all sections ON ──');
        await reports.selectLanguage('en');
        await page.waitForTimeout(300);

        artifacts.push(await exportAndRecord('C_english', 'pdf', reports, cdp, prev!));
        prev = await snap(cdp);
        artifacts.push(await exportAndRecord('C_english', 'xlsx', reports, cdp, prev!));
        prev = await snap(cdp);

        // ─── Phase D — minimal (everything OFF) + switch back to RU → PDF ─
        console.log('\n── Phase D: minimal (all sections OFF) ──');
        await reports.selectLanguage('ru');
        await page.waitForTimeout(200);
        await flipOff(reports.calibrationToggle, 'calibration');
        await flipOff(reports.rawDataToggle, 'rawData');
        await flipOff(reports.recipeToggle, 'recipe');
        await flipOff(reports.waterAnalysisToggle, 'waterAnalysis');

        artifacts.push(await exportAndRecord('D_minimal', 'pdf', reports, cdp, prev!));
        prev = await snap(cdp);

        // ─── Final invariants ────────────────────────────────────────────
        console.log('\n════════════════════════════════════════════════════════');
        console.log('  Export artifacts summary');
        console.log('════════════════════════════════════════════════════════');
        console.table(artifacts);

        console.log('\n── Perf steps ──');
        console.table(steps.map(s => ({
            id: s.id,
            heapMb: s.heapMb,
            deltaMb: s.heapDeltaMb,
            nodes: s.nodes,
            wall: s.wallMs,
        })));

        // — All artifacts must be valid PDFs or XLSXs above threshold —
        for (const a of artifacts) {
            expect(a.size, `${a.phase}/${a.kind} too small (${a.size} bytes)`).toBeGreaterThan(MIN_EXPORT_SIZE_BYTES);
        }

        // — Size invariants: more sections → bigger file —
        const pdfA = artifacts.find(a => a.phase === 'A_defaults' && a.kind === 'pdf')!;
        const pdfB = artifacts.find(a => a.phase === 'B_all_sections' && a.kind === 'pdf')!;
        const pdfD = artifacts.find(a => a.phase === 'D_minimal' && a.kind === 'pdf')!;
        expect(pdfB.size, 'Phase B PDF (all sections) must be ≥ Phase A PDF (defaults)')
            .toBeGreaterThanOrEqual(pdfA.size);
        expect(pdfD.size, 'Phase D PDF (minimal) must be ≤ Phase A PDF (defaults)')
            .toBeLessThanOrEqual(pdfA.size);

        const xlsxA = artifacts.find(a => a.phase === 'A_defaults' && a.kind === 'xlsx')!;
        const xlsxB = artifacts.find(a => a.phase === 'B_all_sections' && a.kind === 'xlsx')!;
        expect(xlsxB.size, 'Phase B XLSX (all sections) must be ≥ Phase A XLSX (defaults)')
            .toBeGreaterThanOrEqual(xlsxA.size);

        // — Memory stability —
        const finalSnap = await snap(cdp);
        const heapGrowthMb = Math.round((finalSnap.heapUsedMb - initialHeap) * 100) / 100;
        console.log(`\n── Memory stability ──`);
        console.log(`  initial heap: ${initialHeap.toFixed(2)} MB`);
        console.log(`  final heap:   ${finalSnap.heapUsedMb.toFixed(2)} MB`);
        console.log(`  growth:       ${fmtDelta(heapGrowthMb, ' MB')} (budget: ${MAX_HEAP_GROWTH_MB} MB)`);
        expect(heapGrowthMb, `heap grew > ${MAX_HEAP_GROWTH_MB} MB over 7 exports — likely leak`)
            .toBeLessThan(MAX_HEAP_GROWTH_MB);

        const totalSec = Math.round((Date.now() - testStart) / 1000);
        console.log(`\n✅ RELEASE GATE PASSED in ${totalSec}s (7 exports, 4 fixtures, 4 settings phases)\n`);
    });
});

// ─── Small internal helpers ──────────────────────────────────────────────────

async function exportAndRecord(
    phase: string,
    kind: 'pdf' | 'xlsx',
    reports: ComparisonReportsPage,
    cdp: CdpClient,
    prev: CdpSnap,
): Promise<ExportArtifact> {
    const label = `${phase}/${kind}`;
    const t0 = Date.now();
    const download = kind === 'pdf'
        ? await reports.downloadPdf(180_000)
        : await reports.downloadExcel(120_000);
    const { size, filename } = await saveDownload(download, label);

    const filePath = await download.path();
    const buffer = fs.readFileSync(filePath!);
    if (kind === 'pdf') assertPdfMagic(buffer, label); else assertXlsxMagic(buffer, label);

    const after = await snap(cdp);
    const heapDeltaMb = Math.round((after.heapUsedMb - prev.heapUsedMb) * 100) / 100;
    const wallMs = Date.now() - t0;
    console.log(`  [gate] ${label.padEnd(26)} size=${size.toString().padStart(7)} B  wall=${wallMs} ms  heapΔ=${fmtDelta(heapDeltaMb, ' MB')}`);
    return { phase, kind, size, filename, wallMs, heapDeltaMb };
}

async function readAriaChecked(locator: { getAttribute(a: string): Promise<string | null> }): Promise<boolean> {
    const v = await locator.getAttribute('aria-checked');
    return v === 'true';
}

async function flipOn(locator: any, label: string): Promise<void> {
    if (!(await readAriaChecked(locator))) {
        await locator.click();
        await locator.page().waitForTimeout(120);
    }
    expect(await readAriaChecked(locator), `toggle ${label} failed to turn ON`).toBe(true);
}

async function flipOff(locator: any, label: string): Promise<void> {
    if (await readAriaChecked(locator)) {
        await locator.click();
        await locator.page().waitForTimeout(120);
    }
    expect(await readAriaChecked(locator), `toggle ${label} failed to turn OFF`).toBe(false);
}

async function ensureOn(locator: any, label: string): Promise<void> {
    if (!(await readAriaChecked(locator))) {
        await locator.click();
        await locator.page().waitForTimeout(120);
    }
    expect(await readAriaChecked(locator), `toggle ${label} should have been ON by default`).toBe(true);
}
