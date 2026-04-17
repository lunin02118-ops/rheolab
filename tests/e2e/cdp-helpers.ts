/**
 * Общие CDP-утилиты для Tauri E2E тестов.
 *
 * Переиспользуется в:
 *   - multi-fixture-perf.tauri.spec.ts  — workflow baseline
 *   - memory-leak-soak.tauri.spec.ts    — soak/leak detection
 */

import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

export type CdpClient = {
    send(cmd: 'Performance.enable'): Promise<void>;
    send(cmd: 'HeapProfiler.enable'): Promise<void>;
    send(cmd: 'HeapProfiler.collectGarbage'): Promise<void>;
    send(cmd: 'Performance.getMetrics'): Promise<{ metrics: Array<{ name: string; value: number }> }>;
};

export interface CdpSnap {
    heapUsedMb:        number;
    heapTotalMb:       number;
    nodes:             number;
    // Накопленные счётчики рендерера (для вычисления Δ между шагами)
    processCpuMs:      number;   // ProcessTime × 1000  — CPU рендер-процесса
    taskDurationMs:    number;   // TaskDuration × 1000 — блокировка main thread
    scriptDurationMs:  number;   // ScriptDuration × 1000 — выполнение JS
    layoutCount:       number;   // LayoutCount — количество layout-операций
    recalcStyleCount:  number;   // RecalcStyleCount — пересчёты стилей
}

// ---------------------------------------------------------------------------
// Инициализация CDP
// ---------------------------------------------------------------------------

/** Подключает CDP к странице, включает Performance и HeapProfiler домены. */
export async function enableCdp(page: Page): Promise<CdpClient> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');
    return cdp as unknown as CdpClient;
}

// ---------------------------------------------------------------------------
// Снапшот метрик
// ---------------------------------------------------------------------------

/**
 * Принудительно запускает GC через CDP, затем снимает все метрики производительности.
 *
 * Принудительный GC даёт точный retained heap (без "мусора" который ещё не собран),
 * что важно для обнаружения утечек — без него одна итерация может выглядеть как утечка
 * просто из-за незапущенного GC.
 */
export async function snap(cdp: CdpClient): Promise<CdpSnap> {
    // Принудительный GC → точный retained heap
    await cdp.send('HeapProfiler.collectGarbage');
    await new Promise(r => setTimeout(r, 150));   // дать GC завершиться

    const { metrics } = await cdp.send('Performance.getMetrics');
    const m  = new Map<string, number>(metrics.map(x => [x.name, x.value]));
    const mb = (key: string) => Math.round((m.get(key) ?? 0) / (1024 * 1024) * 100) / 100;
    const ms = (key: string) => Math.round((m.get(key) ?? 0) * 1000 * 10) / 10;  // сек→мс, 1 зн.

    return {
        heapUsedMb:       mb('JSHeapUsedSize'),
        heapTotalMb:      mb('JSHeapTotalSize'),
        nodes:            m.get('Nodes') ?? 0,
        processCpuMs:     ms('ProcessTime'),
        taskDurationMs:   ms('TaskDuration'),
        scriptDurationMs: ms('ScriptDuration'),
        layoutCount:      Math.round(m.get('LayoutCount') ?? 0),
        recalcStyleCount: Math.round(m.get('RecalcStyleCount') ?? 0),
    };
}

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------

/**
 * Линейная регрессия МНК: возвращает наклон прямой y = slope·x + c.
 * Используется для детектирования монотонного роста heap (slope > threshold → утечка).
 */
export function linearSlope(ys: number[]): number {
    const n = ys.length;
    if (n < 2) return 0;
    // Индексы x = 0, 1, ..., n-1
    const sumX  = (n * (n - 1)) / 2;
    const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;
    const sumY  = ys.reduce((a, b) => a + b, 0);
    const sumXY = ys.reduce((s, y, i) => s + i * y, 0);
    const denom = n * sumXX - sumX * sumX;
    return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

/**
 * Форматирует Δ с явным знаком для вывода в консоль.
 */
export function fmtDelta(v: number, unit = ''): string {
    return `${v > 0 ? '+' : ''}${v}${unit}`;
}
