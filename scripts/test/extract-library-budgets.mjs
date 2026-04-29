#!/usr/bin/env node
/**
 * Sprint 2 / S2-L3 — extract budget-keyed numbers from db-scale sidecar JSONs.
 *
 * Reads existing `outputs/e2e/perf/db-scale-*-{small,large}-tauri.json` files
 * produced by `npm run perf:db:small` / `npm run perf:db:large` and maps the
 * step-level measurements to BUDGETS.md budget IDs.
 *
 * Mapping (step → budget):
 *   library_open   (small, ~12 exp)   → L-LIB-OPEN-1K  (proxy — 12 < 1k, lower bound)
 *   library_open   (large, ~7k exp)   → L-LIB-OPEN-10K (proxy — 7k ≈ 10k order-of-magnitude)
 *   filter_fluid_type (large)         → L-FILTER
 *   open_experiment_card (large)      → L-EXP-DETAIL
 *   library_open   (small)  [wallMs]  → DB-LIST   (upper bound: includes UI render + IPC)
 *   library_open   (large)  [wallMs]  → DB-LIST-LARGE
 *   open_experiment_card (small)      → DB-DETAIL (upper bound: includes UI render)
 *   library_open heapUsedMb (large)    → M-HEAP-LIB-10K
 *
 * These are **upper-bound proxies**: the Playwright wall_ms includes IPC + UI
 * render, not just the SQLite query. Pure DB-query timings require Rust-side
 * tracing (Sprint 3+). For now these proxies are useful: if the budget holds
 * at the UI level, the DB layer is certainly fine.
 *
 * Usage:
 *   node scripts/test/extract-library-budgets.mjs
 *     — auto-discovers latest small + large sidecars
 *
 *   node scripts/test/extract-library-budgets.mjs <small.json> <large.json>
 *     — explicit paths
 *
 *   node scripts/test/extract-library-budgets.mjs --json
 *     — machine-readable JSON to stdout
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const PERF_DIR = join(ROOT, 'outputs', 'e2e', 'perf');

// ── Auto-discovery ──────────────────────────────────────────────────────────

function findLatest(scale) {
    if (!existsSync(PERF_DIR)) return null;
    const files = readdirSync(PERF_DIR)
        .filter((f) => f.startsWith('db-scale-') && f.includes(`-${scale}-`) && f.endsWith('.json'))
        .sort()
        .reverse();
    return files.length > 0 ? join(PERF_DIR, files[0]) : null;
}

function loadSidecar(path) {
    if (!path || !existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter((a) => a !== '--json');
const jsonMode = process.argv.includes('--json');

let smallPath = args[0] || findLatest('small');
let largePath = args[1] || findLatest('large');

const small = loadSidecar(smallPath);
const large = loadSidecar(largePath);

if (!small && !large) {
    console.error(
        '[extract-library-budgets] No db-scale sidecar files found.\n' +
        'Run: npm run perf:db:small && npm run perf:db:large\n' +
        'Then re-run this script.',
    );
    process.exit(1);
}

// ── Extract step wallMs ─────────────────────────────────────────────────────

function stepWall(doc, stepId) {
    return doc?.steps?.[stepId]?.wallMs ?? null;
}

function stepHeap(doc, stepId) {
    return doc?.steps?.[stepId]?.heapUsedMb ?? null;
}

// ── Budget mapping ──────────────────────────────────────────────────────────

const budgets = [];

function add(id, value, unit, source, note) {
    budgets.push({ id, value, unit, source, note });
}

// Section B — Wall-clock latency
add('L-LIB-OPEN-1K',  stepWall(small, 'library_open'),         'ms', `perf:db:small (${small?.experimentCount ?? '?'} exp)`, 'UI wall_ms, upper bound (includes IPC + render)');
add('L-LIB-OPEN-10K', stepWall(large, 'library_open'),         'ms', `perf:db:large (${large?.experimentCount ?? '?'} exp)`, 'UI wall_ms, upper bound');
add('L-FILTER',        stepWall(large, 'filter_fluid_type'),    'ms', `perf:db:large filter_fluid_type step`,                 'Includes search-clear + filter-select + re-render');
add('L-EXP-DETAIL',   stepWall(large, 'open_experiment_card'),  'ms', `perf:db:large open_experiment_card step`,              'Click first card → wait for panel/dialog');

// Section A — Memory
add('M-HEAP-LIB-10K', stepHeap(large, 'library_open'),         'MB', `perf:db:large library_open heap`,                       'JS heap after library open with large seed');

// Section D — Database query budgets (upper-bound proxies)
add('DB-LIST',         stepWall(small, 'library_open'),         'ms', `perf:db:small library_open wall_ms`,                    'Upper bound — pure query < UI wall');
add('DB-LIST-LARGE',   stepWall(large, 'library_open'),         'ms', `perf:db:large library_open wall_ms`,                    'Upper bound — pure query < UI wall');
add('DB-DETAIL',       stepWall(small, 'open_experiment_card'), 'ms', `perf:db:small open_experiment_card wall_ms`,             'Upper bound — pure query < UI wall');

// ── Output ──────────────────────────────────────────────────────────────────

if (jsonMode) {
    const out = {
        schema: 'rheolab.perf.library_budgets.v1',
        generatedAt: new Date().toISOString(),
        smallSidecar: smallPath,
        largeSidecar: largePath,
        budgets,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else {
    console.log('# Library budget extraction\n');
    if (smallPath) console.log(`Small sidecar: ${smallPath}`);
    if (largePath) console.log(`Large sidecar: ${largePath}`);
    console.log('');
    console.log('| Budget ID | Measured | Unit | Budget p50 | Status | Source |');
    console.log('|---|---:|---|---:|---|---|');

    const BUDGET_LIMITS = {
        'L-LIB-OPEN-1K':  2000,
        'L-LIB-OPEN-10K': 2000,
        'L-FILTER':       1500,
        'L-EXP-DETAIL':   1800,
        'M-HEAP-LIB-10K': 128,
        'DB-LIST':        2000,
        'DB-LIST-LARGE':  2000,
        'DB-DETAIL':      1800,
    };

    for (const b of budgets) {
        const limit = BUDGET_LIMITS[b.id];
        const val = b.value !== null ? (Number.isInteger(b.value) ? b.value : b.value.toFixed(2)) : 'N/A';
        let status = '—';
        if (b.value !== null && limit !== undefined) {
            status = b.value <= limit ? '✅ within' : '⚠ exceeds';
        }
        console.log(`| **${b.id}** | ${val} | ${b.unit} | ≤ ${limit ?? '?'} | ${status} | ${b.source} |`);
    }

    console.log('\n> **Note:** wall_ms values are upper-bound proxies (UI render + IPC + DB query).');
    console.log('> Pure DB query timings require Rust-side tracing spans (Sprint 3+ deliverable).');
    console.log('> DB-LIST / DB-LIST-LARGE / DB-DETAIL will tighten once Rust spans isolate the query layer.');
}
