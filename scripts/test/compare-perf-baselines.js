#!/usr/bin/env node
/**
 * compare-perf-baselines.js
 *
 * Сравнивает два JSON-файла performance baseline (workflow-<runId>.json)
 * и выводит таблицу с дельтами и процентами изменения.
 *
 * Использование:
 *   node scripts/test/compare-perf-baselines.js <baseline.json> <candidate.json>
 *   npm run perf:compare -- outputs/e2e/perf/workflow-AAA.json outputs/e2e/perf/workflow-BBB.json
 *
 * Цветовая маркировка:
 *   ✓  зелёный  — улучшение (снижение heap/nodes/time ≥ 5 %)
 *   ⚠  жёлтый   — нейтрально или незначительная разница (< 5 %)
 *   ✗  красный  — регрессия (рост ≥ 5 %)
 *   —  серый    — значение отсутствует в одном из файлов
 *
 * Ключевые метрики сверху:
 *   peakHeapMb, peakNodes, totalWallMs
 * Затем по каждому step:
 *   heapUsedMb, heapDeltaMb, nodes, nodesDelta, analysisMs, uplotInitMs, wallMs
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

// ─── Util ─────────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const GRAY   = '\x1b[90m';
const BOLD   = '\x1b[1m';

function color(str, code) { return `${code}${str}${RESET}`; }

/** Format number: if integer show as int, else 2 decimals */
function fmt(v) {
    if (v === null || v === undefined) return color('N/A', GRAY);
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(2);
}

/** Direction of "better": for heap/nodes/time lower is better */
const LOWER_IS_BETTER = new Set([
    'heapUsedMb', 'heapTotalMb', 'heapDeltaMb', 'nodes', 'nodesDelta',
    'analysisMs', 'uplotInitMs', 'wallMs',
    'peakHeapMb', 'peakNodes', 'totalWallMs',
]);

function deltaColor(metric, pctChange) {
    if (pctChange === null) return GRAY;
    const lowerIsBetter = LOWER_IS_BETTER.has(metric);
    const improved  = lowerIsBetter ? pctChange < -5 : pctChange > 5;
    const regressed = lowerIsBetter ? pctChange > 5  : pctChange < -5;
    if (improved)  return GREEN;
    if (regressed) return RED;
    return YELLOW;
}

function icons(metric, pctChange) {
    if (pctChange === null) return color('—', GRAY);
    const lowerIsBetter = LOWER_IS_BETTER.has(metric);
    const improved  = lowerIsBetter ? pctChange < -5 : pctChange > 5;
    const regressed = lowerIsBetter ? pctChange > 5  : pctChange < -5;
    if (improved)  return color('✓', GREEN);
    if (regressed) return color('✗', RED);
    return color('~', YELLOW);
}

function pad(str, width, right = false) {
    const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
    const pad   = Math.max(0, width - plain.length);
    return right
        ? ' '.repeat(pad) + str
        : str + ' '.repeat(pad);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
    const [,, baselinePath, candidatePath] = process.argv;

    if (!baselinePath || !candidatePath) {
        console.error('Usage: node compare-perf-baselines.js <baseline.json> <candidate.json>');
        process.exit(1);
    }

    if (!fs.existsSync(baselinePath)) { console.error(`File not found: ${baselinePath}`); process.exit(1); }
    if (!fs.existsSync(candidatePath)) { console.error(`File not found: ${candidatePath}`); process.exit(1); }

    const base = JSON.parse(fs.readFileSync(baselinePath,  'utf8'));
    const cand = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));

    const bDate = new Date(base.generatedAt).toLocaleString('ru-RU');
    const cDate = new Date(cand.generatedAt).toLocaleString('ru-RU');

    console.log();
    console.log(color('═══ Performance Baseline Comparison ═══', BOLD + CYAN));
    console.log(`  ${color('Baseline:', GRAY)}   ${path.basename(baselinePath)}  (${bDate})`);
    console.log(`  ${color('Candidate:', GRAY)}  ${path.basename(candidatePath)}  (${cDate})`);
    console.log();

    // ── Top-level metrics ─────────────────────────────────────────────────────
    console.log(color('─── Top-level ───', BOLD));
    console.log();

    const topMetrics = ['peakHeapMb', 'peakNodes', 'totalWallMs'];
    const topLabels  = {
        peakHeapMb:   'Peak Heap (MB)',
        peakNodes:    'Peak DOM nodes',
        totalWallMs:  'Total wall time (ms)',
    };

    printTable(topMetrics.map(key => {
        const bv = base[key];
        const cv = cand[key];
        return makeRow(key, topLabels[key], bv, cv);
    }));

    // ── Per-step metrics ──────────────────────────────────────────────────────
    const stepKeys    = union(Object.keys(base.steps ?? {}), Object.keys(cand.steps ?? {}));
    const stepMetrics = ['heapUsedMb', 'heapDeltaMb', 'nodes', 'nodesDelta', 'analysisMs', 'uplotInitMs', 'wallMs'];
    const stepLabels  = {
        heapUsedMb:   'Heap used (MB)',
        heapDeltaMb:  'Heap delta (MB)',
        nodes:        'DOM nodes',
        nodesDelta:   'Nodes delta',
        analysisMs:   'WASM analysis (ms)',
        uplotInitMs:  'uPlot init (ms)',
        wallMs:       'Wall time (ms)',
    };

    for (const stepKey of stepKeys) {
        const bs = (base.steps ?? {})[stepKey];
        const cs = (cand.steps ?? {})[stepKey];
        if (!bs && !cs) continue;

        console.log();
        console.log(color(`─── ${stepKey} ───`, BOLD));
        if (bs?.note || cs?.note) {
            console.log(color(`    ${bs?.note ?? cs?.note}`, GRAY));
        }
        console.log();

        const rows = stepMetrics
            .map(metric => {
                const bv = bs?.[metric] ?? null;
                const cv = cs?.[metric] ?? null;
                if (bv === null && cv === null) return null;
                return makeRow(metric, stepLabels[metric], bv, cv);
            })
            .filter(Boolean);

        if (rows.length > 0) printTable(rows);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log();
    console.log(color('─── Legend ───', GRAY));
    console.log(`  ${color('✓ green', GREEN)}  Improvement ≥ 5%   ${color('✗ red', RED)}  Regression ≥ 5%   ${color('~ yellow', YELLOW)}  Within ±5%   ${color('— gray', GRAY)}  N/A`);
    console.log();
}

function makeRow(metric, label, bv, cv) {
    let delta = null;
    let pct   = null;

    if (bv !== null && cv !== null) {
        delta = Math.round((cv - bv) * 100) / 100;
        pct   = bv !== 0 ? Math.round((cv - bv) / Math.abs(bv) * 1000) / 10 : null;
    }

    const pctStr = pct !== null
        ? color(`${pct > 0 ? '+' : ''}${pct}%`, deltaColor(metric, pct))
        : color('—', GRAY);

    const deltaStr = delta !== null
        ? color(`${delta > 0 ? '+' : ''}${fmt(delta)}`, deltaColor(metric, pct))
        : color('—', GRAY);

    return {
        label,
        bv:      fmt(bv),
        cv:      fmt(cv),
        delta:   deltaStr,
        pct:     pctStr,
        icon:    icons(metric, pct),
        metric,
    };
}

function printTable(rows) {
    const COL_LABEL    = 28;
    const COL_BASELINE = 12;
    const COL_CAND     = 12;
    const COL_DELTA    = 12;
    const COL_PCT      = 8;

    const header =
        pad(color('Metric', BOLD), COL_LABEL) +
        pad(color('Baseline', BOLD), COL_BASELINE, true) + '  ' +
        pad(color('Candidate', BOLD), COL_CAND, true) + '  ' +
        pad(color('Delta', BOLD), COL_DELTA, true) + '  ' +
        pad(color('%', BOLD), COL_PCT, true) + '  ' + ' ';

    const sep = color('─'.repeat(COL_LABEL + COL_BASELINE + COL_CAND + COL_DELTA + COL_PCT + 8), GRAY);

    console.log(sep);
    console.log(header);
    console.log(sep);

    for (const row of rows) {
        const line =
            pad(row.label, COL_LABEL) +
            pad(row.bv,    COL_BASELINE, true) + '  ' +
            pad(row.cv,    COL_CAND,     true) + '  ' +
            pad(row.delta, COL_DELTA,    true) + '  ' +
            pad(row.pct,   COL_PCT,      true) + '  ' +
            row.icon;
        console.log(line);
    }

    console.log(sep);
}

function union(a, b) {
    const s = new Set([...a, ...b]);
    return [...s];
}

main();
