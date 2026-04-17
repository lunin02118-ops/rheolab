#!/usr/bin/env node
/**
 * compare-db-scale.js
 *
 * Сравнивает результаты двух прогонов db-scale-perf:
 *   small (~12 экспериментов) vs large (~7000 экспериментов)
 *
 * Использование:
 *   node scripts/test/compare-db-scale.js
 *     — автоматически берёт последние small и large файлы из outputs/e2e/perf/
 *
 *   node scripts/test/compare-db-scale.js <small.json> <large.json>
 *     — явное указание файлов
 *
 * Выводит таблицу дельт по каждому шагу и итоговые "overhead" метрики.
 *
 * Цветовая маркировка:
 *   ✓  зелёный  — деградация < 50% (хорошо масштабируется)
 *   ⚠  жёлтый   — деградация 50–200%
 *   ✗  красный  — деградация > 200% (проблема масштабирования)
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const GRAY   = '\x1b[90m';
const BOLD   = '\x1b[1m';

function color(str, code) { return `${code}${str}${RESET}`; }

function fmt(v) {
    if (v === null || v === undefined) return color('N/A', GRAY);
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(2);
}

function degradationColor(pctChange) {
    if (pctChange === null) return GRAY;
    if (pctChange < 50)  return GREEN;
    if (pctChange < 200) return YELLOW;
    return RED;
}

function degradationIcon(pctChange) {
    if (pctChange === null) return color('—', GRAY);
    if (pctChange < 50)  return color('✓', GREEN);
    if (pctChange < 200) return color('~', YELLOW);
    return color('✗', RED);
}

function pad(str, width, right = false) {
    const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
    const p     = Math.max(0, width - plain.length);
    return right ? ' '.repeat(p) + str : str + ' '.repeat(p);
}

// ─── Find latest files ────────────────────────────────────────────────────────

function findLatestScaleFile(scale, dir) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
        .filter(f => f.startsWith(`db-scale-`) && f.includes(`-${scale}-`) && f.endsWith('.json'))
        .map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? path.join(dir, files[0].f) : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const PERF_DIR = path.resolve('outputs', 'e2e', 'perf');
const args = process.argv.slice(2);

let smallPath, largePath;
if (args.length >= 2) {
    [smallPath, largePath] = args;
} else {
    smallPath = findLatestScaleFile('small', PERF_DIR);
    largePath = findLatestScaleFile('large', PERF_DIR);
}

if (!smallPath || !fs.existsSync(smallPath)) {
    console.error(`[compare-db-scale] small JSON не найден: ${smallPath}`);
    console.error('Запустите: npm run perf:db:small');
    process.exit(1);
}
if (!largePath || !fs.existsSync(largePath)) {
    console.error(`[compare-db-scale] large JSON не найден: ${largePath}`);
    console.error('Запустите: npm run perf:db:large');
    process.exit(1);
}

const small = JSON.parse(fs.readFileSync(smallPath, 'utf8'));
const large = JSON.parse(fs.readFileSync(largePath, 'utf8'));

console.log();
console.log(color('═══ DB-Scale Performance Comparison ═══════════════════════════════', BOLD));
console.log();
console.log(`  ${color('small', CYAN)}  runId: ${small.runId}  |  experiments: ${small.experimentCount}`);
console.log(`         file: ${smallPath}`);
console.log(`  ${color('large', CYAN)}  runId: ${large.runId}  |  experiments: ${large.experimentCount}`);
console.log(`         file: ${largePath}`);
console.log();

// ─── Summary metrics ─────────────────────────────────────────────────────────

const summaryMetrics = [
    { key: 'totalWallMs', label: 'Total wall time (ms)' },
    { key: 'peakHeapMb',  label: 'Peak heap (MB)' },
    { key: 'peakNodes',   label: 'Peak DOM nodes' },
];

console.log(color('  Summary', BOLD));
console.log('  ' + '─'.repeat(72));

const H1 = 28, H2 = 12, H3 = 12, H4 = 12, H5 = 7, H6 = 5;
console.log(
    '  ' +
    pad(color('Metric', BOLD), H1) +
    pad(color('Small', BOLD), H2, true) +
    pad(color('Large', BOLD), H3, true) +
    pad(color('Δ%', BOLD), H4, true) +
    '  ' + pad(color('', BOLD), H5)
);
console.log('  ' + '─'.repeat(72));

for (const { key, label } of summaryMetrics) {
    const sv = small[key] ?? null;
    const lv = large[key] ?? null;
    const pct = (sv !== null && lv !== null && sv !== 0)
        ? ((lv - sv) / Math.abs(sv)) * 100
        : null;
    const icon = degradationIcon(pct);
    const pctStr = pct !== null
        ? color((pct >= 0 ? '+' : '') + pct.toFixed(1) + '%', degradationColor(pct))
        : color('—', GRAY);
    console.log(
        '  ' +
        pad(label, H1) +
        pad(fmt(sv), H2, true) +
        pad(fmt(lv), H3, true) +
        pad(pctStr, H4 + 12, true) +
        '  ' + icon
    );
}
console.log('  ' + '─'.repeat(72));
console.log();

// ─── Per-step table ───────────────────────────────────────────────────────────

const stepMetrics = [
    { key: 'wallMs',           label: 'wall (ms)' },
    { key: 'heapUsedMb',       label: 'heap (MB)' },
    { key: 'heapDeltaMb',      label: 'heapΔ (MB)' },
    { key: 'nodes',            label: 'nodes' },
    { key: 'taskDeltaMs',      label: 'taskΔ (ms)' },
    { key: 'layoutCountDelta', label: 'layoutsΔ' },
];

const allStepIds = [...new Set([
    ...Object.keys(small.steps || {}),
    ...Object.keys(large.steps || {}),
])].filter(k => k !== 'initial');
// Начинаем с initial
const orderedSteps = ['initial', ...allStepIds];

console.log(color('  Per-step breakdown', BOLD));

for (const stepId of orderedSteps) {
    const ss = (small.steps || {})[stepId];
    const ls = (large.steps || {})[stepId];
    if (!ss && !ls) continue;

    const note = (ss?.note || ls?.note) ? ` — ${ss?.note || ls?.note}` : '';
    console.log(`\n  ${color(stepId, CYAN)}${GRAY}${note}${RESET}`);
    console.log('  ' + '─'.repeat(72));
    console.log(
        '  ' +
        pad(color('Metric', BOLD), 20) +
        pad(color('Small', BOLD), 12, true) +
        pad(color('Large', BOLD), 12, true) +
        pad(color('Δ%', BOLD), 16, true) +
        '  Flag'
    );
    console.log('  ' + '─'.repeat(72));

    for (const { key, label } of stepMetrics) {
        const sv = ss?.[key] ?? null;
        const lv = ls?.[key] ?? null;
        if (sv === null && lv === null) continue;
        const pct = (sv !== null && lv !== null && sv !== 0)
            ? ((lv - sv) / Math.abs(sv)) * 100
            : null;
        const pctStr = pct !== null
            ? color((pct >= 0 ? '+' : '') + pct.toFixed(1) + '%', degradationColor(pct))
            : color('—', GRAY);
        const icon = degradationIcon(pct);
        console.log(
            '  ' +
            pad(label, 20) +
            pad(fmt(sv), 12, true) +
            pad(fmt(lv), 12, true) +
            pad(pctStr, 16 + 12, true) +
            '  ' + icon
        );
    }
}

console.log('\n  ' + '─'.repeat(72));
console.log();

// ─── Scaling score ────────────────────────────────────────────────────────────

const wallSmall = small.totalWallMs || 1;
const wallLarge = large.totalWallMs || 1;
const scaleFactor = large.experimentCount / Math.max(small.experimentCount, 1);
const wallRatio   = wallLarge / wallSmall;
const efficiency  = scaleFactor / wallRatio;

console.log(color('  Scaling Analysis', BOLD));
console.log(`  DB size factor:    ${large.experimentCount} / ${small.experimentCount} = ${scaleFactor.toFixed(0)}×`);
console.log(`  Wall time ratio:   ${wallLarge} / ${wallSmall} = ${wallRatio.toFixed(2)}×`);
const effColor = efficiency >= 2 ? GREEN : efficiency >= 0.5 ? YELLOW : RED;
console.log(`  Scaling efficiency: ${color(efficiency.toFixed(2), effColor)} (higher is better; ideal = ${scaleFactor.toFixed(0)})`);
console.log();
if (efficiency >= 5) {
    console.log(color('  ✓ Excellent scaling — wall time grows much slower than DB size', GREEN));
} else if (efficiency >= 1) {
    console.log(color('  ✓ Good scaling — wall time grows sub-linearly with DB size', GREEN));
} else if (efficiency >= 0.5) {
    console.log(color('  ~ Acceptable — wall time grows roughly proportional to DB size', YELLOW));
} else {
    console.log(color('  ✗ Poor scaling — wall time grows faster than DB size', RED));
}
console.log();
