#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = path.resolve('outputs', 'e2e', 'perf');

const METRICS = [
  ['cmp_ready_ms', 'Comparison workflow ready'],
  ['comparison_open_ms', 'Comparison route/page ready'],
  ['selector_open_ms', 'Selector open, p50 within run'],
  ['selector_search_ms', 'Selector search result, p50 within run'],
  ['add_1_ready_ms', 'Add 1 click to line ready'],
  ['add_2_ready_ms', 'Add 2 click to line ready'],
  ['add_3_ready_ms', 'Add 3 click to line ready'],
  ['add_4_ready_ms', 'Add 4 click to line ready'],
  ['add_5_ready_ms', 'Add 5 click to line ready'],
  ['chart_first_visible_ms', 'Chart visible and canvas painted'],
  ['chart_ready_ms', 'Chart legend/ready settle'],
  ['report_tab_open_ms', 'Report tab loaded'],
  ['pdf_export_ms', 'PDF direct-save export'],
  ['xlsx_export_ms', 'XLSX direct-save export'],
  ['series_request_count', 'Series overview/window request count'],
  ['series_request_total_ms', 'Series request total duration'],
  ['series_request_total_bytes', 'Series response bytes'],
  ['long_tasks_count', 'Browser long task count'],
  ['long_tasks_total_ms', 'Browser long task total duration'],
];

function parseArgs(argv) {
  const opts = {
    dir: DEFAULT_DIR,
    n: 5,
    latest: null,
    json: null,
    markdown: null,
    exportSaveMode: null,
    add5Experiment: 'baseline',
    memorySteps: '0',
    onlyOk: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') opts.dir = argv[++i];
    else if (arg === '--n') opts.n = Number(argv[++i]);
    else if (arg === '--latest') opts.latest = Number(argv[++i]);
    else if (arg === '--json') opts.json = argv[++i];
    else if (arg === '--markdown') opts.markdown = argv[++i];
    else if (arg === '--export-save-mode') opts.exportSaveMode = argv[++i];
    else if (arg === '--add5-experiment') opts.add5Experiment = argv[++i];
    else if (arg === '--memory-steps') opts.memorySteps = argv[++i];
    else if (arg === '--only-ok') opts.onlyOk = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(opts.n) || opts.n <= 0) throw new Error('--n must be a positive integer');
  if (opts.latest !== null && (!Number.isInteger(opts.latest) || opts.latest <= 0)) {
    throw new Error('--latest must be a positive integer');
  }
  if (opts.exportSaveMode && !['download', 'direct'].includes(opts.exportSaveMode)) {
    throw new Error('--export-save-mode must be "download" or "direct"');
  }
  if (opts.add5Experiment && !['baseline', 'selector-close-only', 'commit-without-close', 'defer-chart-commit', 'any'].includes(opts.add5Experiment)) {
    throw new Error('--add5-experiment must be one of baseline, selector-close-only, commit-without-close, defer-chart-commit, any');
  }
  if (!['0', '1', 'any'].includes(String(opts.memorySteps))) {
    throw new Error('--memory-steps must be 0, 1, or any');
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node scripts/test/summarize-comparison-latency.mjs [options]

Options:
  --dir <path>         Directory with comparison-smoke-*-tauri.json sidecars.
  --n <number>         Fixture count to summarize. Default: 5.
  --latest <number>    Use latest N matching sidecars by mtime.
  --json <path>        Write machine-readable summary JSON.
  --markdown <path>    Write markdown summary.
  --export-save-mode <download|direct>
                       Filter by comparison export save path.
  --add5-experiment <mode|any>
                       Filter by COMPARISON_SMOKE_ADD5_EXPERIMENT. Default: baseline.
  --memory-steps <0|1|any>
                       Filter memory-step runs. Default: 0.
  --only-ok            Exclude skipped/error measurements.
`);
}

function percentile(values, pct) {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const rank = (pct / 100) * (finite.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return round(finite[lo]);
  const weight = rank - lo;
  return round(finite[lo] * (1 - weight) + finite[hi] * weight);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function readSidecars(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^comparison-smoke-.*-tauri\.json$/.test(name))
    .map((name) => {
      const file = path.join(dir, name);
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      return {
        file,
        mtimeMs: statSync(file).mtimeMs,
        doc,
      };
    });
}

function measurementFor(entry, n) {
  return (entry.doc.measurements ?? []).find((measurement) => measurement.n === n) ?? null;
}

function measurementExportSaveMode(entry, n) {
  const measurement = measurementFor(entry, n);
  return measurement?.export_save_mode ?? entry.doc.export_save_mode ?? null;
}

function measurementAdd5Experiment(entry, n) {
  const measurement = measurementFor(entry, n);
  return measurement?.add5_experiment ?? entry.doc.add5_experiment ?? 'baseline';
}

function measurementMemorySteps(entry) {
  return entry.doc.memory_steps_enabled ? '1' : '0';
}

function matchesFilters(entry, opts) {
  const measurement = measurementFor(entry, opts.n);
  if (!measurement) return false;
  if (opts.onlyOk && measurement.skipped) return false;
  if (opts.exportSaveMode && measurementExportSaveMode(entry, opts.n) !== opts.exportSaveMode) return false;
  if (opts.add5Experiment !== 'any' && measurementAdd5Experiment(entry, opts.n) !== opts.add5Experiment) return false;
  if (opts.memorySteps !== 'any' && measurementMemorySteps(entry) !== opts.memorySteps) return false;
  return true;
}

function p50(values) {
  return percentile(values, 50);
}

function metricValue(measurement, key) {
  const latency = measurement.latency ?? {};
  const addSteps = Array.isArray(latency.add_steps) ? latency.add_steps : [];
  const addMatch = /^add_(\d+)_ready_ms$/.exec(key);
  if (addMatch) {
    const target = Number(addMatch[1]);
    return finiteOrNull(addSteps.find((step) => step.target_count === target)?.add_ready_ms);
  }

  if (key === 'selector_open_ms') {
    return p50(addSteps.map((step) => finiteOrNull(step.selector_open_ms)));
  }
  if (key === 'selector_search_ms') {
    return p50(addSteps.map((step) => finiteOrNull(step.selector_search_ms)));
  }
  if (key === 'pdf_export_ms') return finiteOrNull(measurement.pdf_ms);
  if (key === 'xlsx_export_ms') return finiteOrNull(measurement.xlsx_ms);
  if (key === 'cmp_ready_ms') return finiteOrNull(measurement.cmp_ready_ms);
  return finiteOrNull(latency[key]);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildSummary(entries, opts) {
  const runs = entries.map((entry) => ({
    file: entry.file,
    mode: entry.doc.mode ?? null,
    generatedAt: entry.doc.generatedAt ?? null,
    exportSaveMode: measurementExportSaveMode(entry, opts.n),
    add5Experiment: measurementAdd5Experiment(entry, opts.n),
    memoryStepsEnabled: entry.doc.memory_steps_enabled === true,
    measurement: measurementFor(entry, opts.n),
  }));

  const metrics = METRICS.map(([key, label]) => {
    const values = runs.map((run) => metricValue(run.measurement, key)).filter((value) => value !== null);
    return {
      key,
      label,
      p50: percentile(values, 50),
      p95: percentile(values, 95),
      min: values.length > 0 ? round(Math.min(...values)) : null,
      max: values.length > 0 ? round(Math.max(...values)) : null,
      samples: values.length,
      values,
    };
  });

  const slowest = metrics
    .filter((metric) => metric.key.endsWith('_ms') && metric.p50 !== null)
    .sort((a, b) => b.p50 - a.p50)[0] ?? null;

  return {
    schema: 'rheolab.e2e.perf.comparison_latency_summary.v1',
    generatedAt: new Date().toISOString(),
    n: opts.n,
    runs: runs.map((run) => ({
      file: run.file,
      mode: run.mode,
      generatedAt: run.generatedAt,
      exportSaveMode: run.exportSaveMode,
      add5Experiment: run.add5Experiment,
      memoryStepsEnabled: run.memoryStepsEnabled,
    })),
    files: runs.map((run) => run.file),
    metrics,
    slowestMetric: slowest ? { key: slowest.key, label: slowest.label, p50: slowest.p50, p95: slowest.p95 } : null,
  };
}

function formatValue(value) {
  return value === null || value === undefined ? 'n/a' : String(value);
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push('# Comparison UX Latency Summary');
  lines.push('');
  lines.push(`- Generated: ${summary.generatedAt}`);
  lines.push(`- N: ${summary.n}`);
  lines.push(`- Runs: ${summary.runs.length}`);
  lines.push('- Source sidecars:');
  for (const file of summary.files) {
    lines.push(`  - \`${file.replaceAll('\\', '/')}\``);
  }
  lines.push('');
  lines.push('## P50/P95');
  lines.push('');
  lines.push('| Metric | Meaning | p50 | p95 | min | max | samples |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const metric of summary.metrics) {
    lines.push(`| \`${metric.key}\` | ${metric.label} | ${formatValue(metric.p50)} | ${formatValue(metric.p95)} | ${formatValue(metric.min)} | ${formatValue(metric.max)} | ${metric.samples} |`);
  }
  lines.push('');
  lines.push('## Readout');
  lines.push('');
  if (summary.slowestMetric) {
    lines.push(`- Slowest measured latency phase by p50: \`${summary.slowestMetric.key}\` (${summary.slowestMetric.p50} ms p50, ${formatValue(summary.slowestMetric.p95)} ms p95).`);
  } else {
    lines.push('- Slowest measured latency phase: n/a.');
  }
  return `${lines.join('\n')}\n`;
}

const opts = parseArgs(process.argv);
let entries = readSidecars(opts.dir).filter((entry) => matchesFilters(entry, opts));
entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
if (opts.latest !== null) entries = entries.slice(0, opts.latest);
entries.sort((a, b) => a.mtimeMs - b.mtimeMs);

if (entries.length === 0) {
  throw new Error('No matching comparison latency sidecars found.');
}

const summary = buildSummary(entries, opts);
const markdown = buildMarkdown(summary);

if (opts.json) {
  writeFileSync(opts.json, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}
if (opts.markdown) {
  writeFileSync(opts.markdown, markdown, 'utf8');
}
if (!opts.json && !opts.markdown) {
  process.stdout.write(markdown);
}
