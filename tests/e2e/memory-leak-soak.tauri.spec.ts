/**
 * Memory Leak Soak Test — Tauri native mode
 *
 * Два теста:
 *  1. memory_leak_upload_analyze — загружает один файл N раз, между итерациями
 *     принудительный GC через CDP HeapProfiler.collectGarbage().
 *     Failure: линейный slope heap > 2 MB/round (явная утечка JS-памяти).
 *
 *  2. memory_leak_comparison_open_close — открывает/закрывает страницу Comparison
 *     N раз и проверяет, что DOM-узлы возвращаются к baseline.
 *     Failure: nodes в последнем раунде > baseline × 2 (Comparison не размонтируется).
 *
 * Почему принудительный GC важен:
 *   Без collectGarbage() один раунд может выглядеть как утечка просто потому,
 *   что V8 не успел запустить GC. С принудительным GC heap показывает только
 *   реально retained объекты — те, на которые есть живые ссылки.
 *
 * Запуск:
 *   npm run perf:soak:tauri
 *   npx playwright test --config playwright.tauri-soak.config.ts
 *
 * Для ускорения (пропустить сборку):
 *   TAURI_E2E_SKIP_BUILD=1 npm run perf:soak:tauri
 */

import { test, expect, setupBeforeEach } from './base-test.tauri';
import { enableCdp, snap, linearSlope, type CdpSnap } from './cdp-helpers';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHANDLER_SST_63 } from './fixtures';

setupBeforeEach(test);

// ─── Config ─────────────────────────────────────────────────────────────────

/** Количество раундов upload+analyze для теста на утечку. */
const UPLOAD_ROUNDS = 8;
/** Количество раундов навигации Comparison. */
const COMPARISON_ROUNDS = 6;
/** Допустимый рост heap на раунд, MB. Выше → утечка памяти. */
const HEAP_SLOPE_THRESHOLD = 2.0;
/** Допустимый рост DOM-узлов к последнему раунду (baseline × N). */
const NODES_GROWTH_FACTOR = 2.0;

const OUTPUT_DIR = path.resolve('outputs', 'e2e', 'perf');

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('[LeakSoak/Tauri] Memory leak detection', () => {
    test.setTimeout(600_000);  // 10 мин — достаточно для 8 раундов с реальным анализом

    // ── Test 1: Upload + Analyze × N ────────────────────────────────────────
    test('memory_leak_upload_analyze', async ({ page, dashboard }) => {
        const cdp = await enableCdp(page);

        const heapSamples: number[] = [];
        const nodeSamples: number[] = [];
        const snapshots:   CdpSnap[] = [];

        for (let round = 0; round < UPLOAD_ROUNDS; round++) {
            console.log(`\n[soak] upload round ${round + 1}/${UPLOAD_ROUNDS}`);

            // Перейти на dashboard — сбрасывает состояние React без перезагрузки страницы
            await dashboard.goto();
            await page.waitForTimeout(200);

            // Загрузить файл и дождаться завершения нативного Rust-анализа
            await dashboard.uploadFile(CHANDLER_SST_63);
            await dashboard.waitForAnalysis(60_000);

            // Принудительный GC → только retained heap
            const s = await snap(cdp);
            heapSamples.push(s.heapUsedMb);
            nodeSamples.push(s.nodes);
            snapshots.push(s);

            console.log(
                `  heap=${s.heapUsedMb} MB  nodes=${s.nodes}  ` +
                `cpu=${s.processCpuMs.toFixed(1)} ms  task=${s.taskDurationMs.toFixed(1)} ms  ` +
                `layouts=${s.layoutCount}  recalc=${s.recalcStyleCount}`,
            );
        }

        const slope      = linearSlope(heapSamples);
        const nodesRatio = nodeSamples[nodeSamples.length - 1] / (nodeSamples[0] || 1);

        logSummary('upload', heapSamples, nodeSamples, slope, nodesRatio);
        await saveResults('upload-analyze', { heapSamples, nodeSamples, snapshots, slope, nodesRatio });

        expect(slope,
            `Heap slope ${slope.toFixed(3)} MB/round (порог ${HEAP_SLOPE_THRESHOLD}) — ` +
            `возможна утечка памяти в React/store/analysis pipeline`
        ).toBeLessThan(HEAP_SLOPE_THRESHOLD);

        expect(nodesRatio,
            `DOM nodes выросли в ${nodesRatio.toFixed(2)}× (порог ${NODES_GROWTH_FACTOR}) — ` +
            `возможна утечка DOM-узлов`
        ).toBeLessThan(NODES_GROWTH_FACTOR);
    });

    // ── Test 2: Comparison open/close × N ───────────────────────────────────
    test('memory_leak_comparison_open_close', async ({ page, dashboard, comparison }) => {
        const cdp = await enableCdp(page);

        // Baseline — чистый dashboard без загруженных данных
        await dashboard.goto();
        await page.waitForTimeout(300);
        const baseline = await snap(cdp);

        console.log(
            `\n[soak] comparison baseline: heap=${baseline.heapUsedMb} MB, nodes=${baseline.nodes}`,
        );

        const heapSamples: number[] = [];
        const nodeSamples: number[] = [];

        for (let round = 0; round < COMPARISON_ROUNDS; round++) {
            console.log(`\n[soak] comparison round ${round + 1}/${COMPARISON_ROUNDS}`);

            // Открыть страницу Comparison (монтирование компонента)
            await comparison.goto();
            await page.waitForTimeout(400);

            // Вернуться на Dashboard (размонтирование Comparison)
            await dashboard.goto();
            await page.waitForTimeout(300);

            const s = await snap(cdp);
            heapSamples.push(s.heapUsedMb);
            nodeSamples.push(s.nodes);

            const dh = Math.round((s.heapUsedMb - baseline.heapUsedMb) * 100) / 100;
            const dn = s.nodes - baseline.nodes;
            console.log(
                `  heap=${s.heapUsedMb} MB (Δ${dh > 0 ? '+' : ''}${dh})  ` +
                `nodes=${s.nodes} (Δ${dn > 0 ? '+' : ''}${dn})`,
            );
        }

        const slope      = linearSlope(heapSamples);
        const nodesRatio = nodeSamples[nodeSamples.length - 1] / (nodeSamples[0] || 1);

        logSummary('comparison', heapSamples, nodeSamples, slope, nodesRatio);
        await saveResults('comparison-nav', {
            heapSamples, nodeSamples, slope, nodesRatio,
            baseline: { heapMb: baseline.heapUsedMb, nodes: baseline.nodes },
        });

        expect(slope,
            `Heap slope ${slope.toFixed(3)} MB/round — утечка при open/close Comparison`
        ).toBeLessThan(HEAP_SLOPE_THRESHOLD);

        expect(nodesRatio,
            `DOM nodes ×${nodesRatio.toFixed(2)} через ${COMPARISON_ROUNDS} раундов — ` +
            `Comparison-дерево не размонтируется полностью`
        ).toBeLessThan(NODES_GROWTH_FACTOR);
    });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function logSummary(
    label: string,
    heap: number[],
    nodes: number[],
    slope: number,
    nodesRatio: number,
): void {
    console.log(`\n[soak-${label}] ─── Summary ───────────────────────────────────`);
    console.log(`  Heap samples (MB): ${heap.join(', ')}`);
    console.log(`  Nodes samples:     ${nodes.join(', ')}`);
    console.log(`  Heap slope:        ${slope.toFixed(3)} MB/round (порог: ${HEAP_SLOPE_THRESHOLD})`);
    console.log(`  Nodes ratio:       ${nodesRatio.toFixed(2)}× (порог: ${NODES_GROWTH_FACTOR})`);
    const verdict = slope < HEAP_SLOPE_THRESHOLD && nodesRatio < NODES_GROWTH_FACTOR ? '✓ OK' : '✗ LEAK';
    console.log(`  Вердикт:           ${verdict}`);
}

async function saveResults(name: string, data: Record<string, unknown>): Promise<void> {
    const runId = Date.now();
    const report = {
        scenario:    `leak-soak-${name}`,
        mode:        'tauri-native',
        runId:       `${runId}-soak`,
        generatedAt: new Date().toISOString(),
        config: {
            uploadRounds:      UPLOAD_ROUNDS,
            comparisonRounds:  COMPARISON_ROUNDS,
            heapSlopeThreshold: HEAP_SLOPE_THRESHOLD,
            nodesGrowthFactor:  NODES_GROWTH_FACTOR,
        },
        ...data,
    };
    await mkdir(OUTPUT_DIR, { recursive: true });
    const outPath = path.join(OUTPUT_DIR, `soak-${name}-${runId}.json`);
    await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[soak] Output: ${outPath}`);
}
