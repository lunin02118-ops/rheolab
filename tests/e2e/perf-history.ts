/**
 * Perf history — append-only JSONL aggregator for benchmark results.
 *
 * Each run appends a single line to `outputs/e2e/perf/perf-history.jsonl`.
 * The file persists across runs and is NOT overwritten.
 *
 * Usage:
 *   import { appendPerfEntry, loadHistory, printComparison } from './perf-history';
 *   await appendPerfEntry({ ... });
 *   const prev = await loadHistory();
 *   printComparison(current, prev);
 */

import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const HISTORY_DIR = path.resolve('outputs', 'e2e', 'perf');
const HISTORY_FILE = path.join(HISTORY_DIR, 'perf-history.jsonl');

export interface PerfEntry {
    /** ISO timestamp */
    timestamp: string;
    /** App version from package.json */
    version: string;
    /** git short SHA */
    gitSha: string;
    /** Idle heap per route (MB) */
    idleHeap: Record<string, { heapMb: number; nodes: number }>;
    /** Analysis timing per fixture */
    analysis: Array<{
        fixture: string;
        analysisMs: number | null;
        uplotMs: number | null;
        heapDeltaMb: number;
    }>;
    /** Navigation leak detection */
    navLeak: {
        cycles: number;
        slopeMbPerCycle: number;
        peakHeapMb: number;
        nodesRatio: number;
        baselineHeapMb: number;
        finalHeapMb: number;
    };
}

/** Append a single entry as a JSON line. */
export async function appendPerfEntry(entry: PerfEntry): Promise<void> {
    await mkdir(HISTORY_DIR, { recursive: true });
    await appendFile(HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

/** Load all previous entries from history file. */
export async function loadHistory(): Promise<PerfEntry[]> {
    if (!existsSync(HISTORY_FILE)) return [];
    const raw = await readFile(HISTORY_FILE, 'utf8');
    return raw
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => {
            try { return JSON.parse(line) as PerfEntry; }
            catch { return null; }
        })
        .filter((e): e is PerfEntry => e !== null);
}

/** Print comparison table between current run and last N entries. */
export function printComparison(current: PerfEntry, history: PerfEntry[]): void {
    if (history.length === 0) {
        console.log('\n╔══════════════════════════════════════════════╗');
        console.log('║  BASELINE RUN — no previous data to compare  ║');
        console.log('╚══════════════════════════════════════════════╝\n');
        return;
    }

    const prev = history[history.length - 1];
    const pad = (s: string, n: number) => s.padEnd(n);
    const num = (v: number | null, decimals = 1) =>
        v !== null ? v.toFixed(decimals) : 'N/A';
    const delta = (curr: number, old: number) => {
        const d = curr - old;
        const pct = old !== 0 ? ((d / old) * 100).toFixed(1) : '—';
        const sign = d >= 0 ? '+' : '';
        return `${sign}${d.toFixed(2)} (${sign}${pct}%)`;
    };

    console.log('\n┌──────────────────────────────────────────────────────────────┐');
    console.log(`│  PERF COMPARISON: ${prev.version} (${prev.gitSha}) → ${current.version} (${current.gitSha})`);
    console.log(`│  Previous: ${prev.timestamp}`);
    console.log(`│  Current:  ${current.timestamp}`);
    console.log('├──────────────────────────────────────────────────────────────┤');

    // Idle heap
    console.log('│  IDLE HEAP PER ROUTE:');
    console.log(`│  ${pad('Route', 14)} ${pad('Heap MB', 10)} ${pad('Prev', 10)} ${pad('Delta', 20)} ${pad('Nodes', 8)} ${pad('Prev', 8)}`);
    for (const route of Object.keys(current.idleHeap)) {
        const c = current.idleHeap[route];
        const p = prev.idleHeap[route];
        if (c && p) {
            console.log(
                `│  ${pad(route, 14)} ${pad(num(c.heapMb), 10)} ${pad(num(p.heapMb), 10)} ${pad(delta(c.heapMb, p.heapMb), 20)} ${pad(String(c.nodes), 8)} ${pad(String(p.nodes), 8)}`
            );
        } else {
            console.log(`│  ${pad(route, 14)} ${pad(num(c?.heapMb ?? 0), 10)} (new route)`);
        }
    }

    // Analysis
    console.log('│');
    console.log('│  ANALYSIS TIMING:');
    console.log(`│  ${pad('Fixture', 20)} ${pad('ms', 8)} ${pad('Prev', 8)} ${pad('Delta', 20)}`);
    for (const ca of current.analysis) {
        const pa = prev.analysis.find(a => a.fixture === ca.fixture);
        if (ca.analysisMs !== null && pa?.analysisMs !== null && pa) {
            console.log(
                `│  ${pad(ca.fixture, 20)} ${pad(num(ca.analysisMs, 0), 8)} ${pad(num(pa.analysisMs, 0), 8)} ${pad(delta(ca.analysisMs, pa.analysisMs!), 20)}`
            );
        } else {
            console.log(`│  ${pad(ca.fixture, 20)} ${pad(num(ca.analysisMs, 0), 8)} (no prev)`);
        }
    }

    // Nav leak
    console.log('│');
    console.log('│  NAV LEAK DETECTION:');
    const cn = current.navLeak;
    const pn = prev.navLeak;
    console.log(`│  Slope:      ${num(cn.slopeMbPerCycle, 3)} MB/cycle  (prev: ${num(pn.slopeMbPerCycle, 3)})  ${delta(cn.slopeMbPerCycle, pn.slopeMbPerCycle)}`);
    console.log(`│  Peak heap:  ${num(cn.peakHeapMb)} MB  (prev: ${num(pn.peakHeapMb)} MB)  ${delta(cn.peakHeapMb, pn.peakHeapMb)}`);
    console.log(`│  Nodes ratio: ${num(cn.nodesRatio, 2)}×  (prev: ${num(pn.nodesRatio, 2)}×)`);

    // History trend (last 5)
    const last5 = history.slice(-5);
    if (last5.length > 1) {
        console.log('│');
        console.log('│  TREND (last 5 runs):');
        console.log(`│  ${pad('Version', 20)} ${pad('Slope', 10)} ${pad('Peak MB', 10)} ${pad('Chandler ms', 12)}`);
        for (const e of last5) {
            const chandler = e.analysis.find(a => a.fixture.includes('Chandler'));
            console.log(
                `│  ${pad(e.version, 20)} ${pad(num(e.navLeak.slopeMbPerCycle, 3), 10)} ${pad(num(e.navLeak.peakHeapMb), 10)} ${pad(num(chandler?.analysisMs ?? null, 0), 12)}`
            );
        }
    }

    console.log('└──────────────────────────────────────────────────────────────┘\n');
}

/** Read version + git SHA for the current entry. */
export async function getVersionInfo(): Promise<{ version: string; gitSha: string }> {
    let version = 'unknown';
    try {
        const pkg = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
        version = pkg.version ?? 'unknown';
    } catch { /* ignore */ }

    let gitSha = 'unknown';
    try {
        const { execSync } = await import('node:child_process');
        gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch { /* ignore */ }

    return { version, gitSha };
}
