#!/usr/bin/env node
/**
 * Summarize comparison-smoke memory-step sidecars.
 *
 * This is a diagnostic helper, not a product latency gate. The source sidecars
 * must be generated with COMPARISON_SMOKE_MEMORY_STEPS=1.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const ROOT = resolve('.');
const PERF_DIR = join(ROOT, 'outputs', 'e2e', 'perf');
const DEFAULT_MARKDOWN = join(ROOT, 'docs', 'performance', 'COMPARISON-MEMORY-PHASE-READOUT.md');
const METRICS = [
  ['total_rss_mb', 'Total RSS'],
  ['renderer_rss_mb', 'Renderer RSS'],
  ['gpu_rss_mb', 'GPU RSS'],
  ['tauri_rss_mb', 'Tauri RSS'],
];
const APP_METRICS = [
  ['js_heap_mb', 'JS heap', 'MB'],
  ['series_cache_bytes', 'Series cache', 'bytes'],
  ['comparison_store_raw_count', 'Cmp raw', 'count'],
  ['comparison_store_columnar_count', 'Cmp columnar', 'count'],
  ['parse_cache_entries', 'Parse cache entries', 'count'],
  ['parse_cache_point_count', 'Parse cache points', 'count'],
  ['dom_nodes', 'DOM nodes', 'count'],
  ['canvas_count', 'Canvas count', 'count'],
];

function summaryPhases(n) {
  const fixturePhases = [];
  for (let i = 1; i <= n; i += 1) {
    fixturePhases.push(
      `before_fixture_${i}_upload`,
      `after_fixture_${i}_parse`,
      `after_fixture_${i}_save`,
      `after_fixture_${i}_cleanup`,
    );
  }
  const addPhases = [];
  for (let i = 1; i <= n; i += 1) {
    addPhases.push(`after_add_${i}`);
  }
  return [
    'app_start',
    'before_setup',
    ...fixturePhases,
    'after_setup',
    'before_comparison_open',
    'after_comparison_open',
    ...addPhases,
    'after_chart_visible',
    'after_chart_ready',
    'before_pdf',
    'after_pdf',
    'before_xlsx',
    'after_xlsx',
    'after_gc_hint',
    'after_export_gc_hint',
    'after_route_leave',
    'after_second_gc_hint',
  ];
}

function parseArgs(argv) {
  const opts = {
    n: 5,
    files: [],
    latest: 3,
    markdown: null,
    writeMarkdown: false,
    json: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--n') {
      opts.n = Number(argv[++i]);
    } else if (arg === '--files') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.files.push(argv[++i]);
    } else if (arg === '--latest') {
      opts.latest = Number(argv[++i]);
    } else if (arg === '--write-md') {
      opts.markdown = DEFAULT_MARKDOWN;
      opts.writeMarkdown = true;
    } else if (arg === '--markdown') {
      opts.markdown = argv[++i];
      opts.writeMarkdown = true;
    } else if (arg === '--json') {
      opts.json = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(opts.n) || opts.n <= 0) {
    throw new Error('--n must be a positive integer');
  }
  if (!Number.isInteger(opts.latest) || opts.latest <= 0) {
    throw new Error('--latest must be a positive integer');
  }
  return opts;
}

function usage() {
  console.log(`Usage:
  node scripts/test/summarize-comparison-memory-phases.mjs --write-md
  node scripts/test/summarize-comparison-memory-phases.mjs --n 5 --latest 3
  node scripts/test/summarize-comparison-memory-phases.mjs --files <a.json> <b.json> <c.json> --write-md

Options:
  --n <count>          Measurement N to summarize. Default: 5.
  --latest <count>     Auto-discover the latest matching sidecars. Default: 3.
  --files <files...>   Explicit comparison-smoke sidecars.
  --write-md           Write docs/performance/COMPARISON-MEMORY-PHASE-READOUT.md.
  --markdown <path>    Write markdown report to a custom path.
  --json <path>        Write machine-readable summary JSON.
`);
}

function round(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function percentile(values, p) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  const idx = (nums.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return nums[lo];
  return nums[lo] + (nums[hi] - nums[lo]) * (idx - lo);
}

function stats(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  return {
    n: nums.length,
    p50: round(percentile(nums, 0.5)),
    p95: round(percentile(nums, 0.95)),
    min: round(nums.length ? Math.min(...nums) : null),
    max: round(nums.length ? Math.max(...nums) : null),
    values: nums.map(round),
  };
}

function loadSidecar(file) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  return {
    file,
    name: basename(file),
    generatedAt: doc.generatedAt,
    mode: doc.mode,
    memoryStepsEnabled: Boolean(doc.memory_steps_enabled),
    doc,
  };
}

function measurementFor(entry, n) {
  return entry.doc.measurements?.find((measurement) => measurement.n === n);
}

function hasMemoryMeasurement(entry, n) {
  const measurement = measurementFor(entry, n);
  return Boolean(entry.memoryStepsEnabled && Array.isArray(measurement?.memory_steps));
}

function discoverSidecars(n, latest) {
  if (!existsSync(PERF_DIR)) return [];
  return readdirSync(PERF_DIR)
    .filter((file) => file.startsWith('comparison-smoke-') && file.endsWith('.json'))
    .map((file) => join(PERF_DIR, file))
    .map(loadSidecar)
    .filter((entry) => hasMemoryMeasurement(entry, n))
    .sort((a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime())
    .slice(-latest);
}

function phaseStep(entry, n, phase) {
  const measurement = measurementFor(entry, n);
  return measurement?.memory_steps?.find((step) => step.phase === `n${n}:${phase}`) ?? null;
}

function buildSummary(entries, n) {
  const rows = summaryPhases(n).map((phase) => {
    const row = { phase, metrics: {}, appMetrics: {} };
    for (const [key] of METRICS) {
      row.metrics[key] = stats(entries.map((entry) => phaseStep(entry, n, phase)?.[key]));
    }
    for (const [key] of APP_METRICS) {
      row.appMetrics[key] = stats(entries.map((entry) => phaseStep(entry, n, phase)?.[key]));
    }
    return row;
  });

  const byPhase = Object.fromEntries(rows.map((row) => [row.phase, row]));
  const p50 = (phase, key) => byPhase[phase]?.metrics[key]?.p50 ?? null;
  const delta = (from, to, key) => {
    const a = p50(from, key);
    const b = p50(to, key);
    return a === null || b === null ? null : round(a - b);
  };

  return {
    n,
    generatedAt: new Date().toISOString(),
    files: entries.map((entry) => entry.file),
    modes: [...new Set(entries.map((entry) => entry.mode).filter(Boolean))],
    rows,
    deltas: {
      after_xlsx_to_after_export_gc_hint: Object.fromEntries(
        METRICS.map(([key]) => [key, delta('after_xlsx', 'after_export_gc_hint', key)]),
      ),
      after_export_gc_hint_to_after_route_leave: Object.fromEntries(
        METRICS.map(([key]) => [key, delta('after_export_gc_hint', 'after_route_leave', key)]),
      ),
      after_chart_visible_to_after_route_leave: Object.fromEntries(
        METRICS.map(([key]) => [key, delta('after_route_leave', 'after_chart_visible', key)]),
      ),
    },
  };
}

function formatValue(value, unit = 'MB') {
  if (value === null || value === undefined) return 'n/a';
  return `${Number.isInteger(value) ? value : value.toFixed(2)} ${unit}`;
}

function formatBytes(value) {
  if (value === null || value === undefined) return 'n/a';
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = value;
  let unitIndex = 0;
  while (Math.abs(current) >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${Number.isInteger(current) ? current : current.toFixed(2)} ${units[unitIndex]}`;
}

function formatMetricValue(value, unit) {
  if (unit === 'bytes') return formatBytes(value);
  if (unit === 'MB') return formatValue(value, 'MB');
  if (value === null || value === undefined) return 'n/a';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push('# Comparison Memory Phase Readout');
  lines.push('');
  lines.push(`**Generated:** ${summary.generatedAt}.`);
  lines.push('');
  lines.push('Diagnostic comparison-smoke memory run summary. These runs use direct Win32');
  lines.push('RSS sampling and CDP GC hints, so use them for memory phase diagnosis, not');
  lines.push('for user-facing latency budgets.');
  lines.push('');
  lines.push(`- N: ${summary.n}`);
  lines.push(`- Runs: ${summary.files.length}`);
  lines.push(`- Modes: ${summary.modes.join(', ') || 'unknown'}`);
  lines.push('- Source sidecars:');
  for (const file of summary.files) {
    lines.push(`  - \`${file.replaceAll('\\', '/')}\``);
  }
  lines.push('');
  lines.push('## Phase RSS');
  lines.push('');
  lines.push('| Phase | Total p50 | Total p95 | Renderer p50 | Renderer p95 | GPU p50 | GPU p95 | Tauri p50 | Tauri p95 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of summary.rows) {
    lines.push(`| ${row.phase} | ${formatValue(row.metrics.total_rss_mb.p50)} | ${formatValue(row.metrics.total_rss_mb.p95)} | ${formatValue(row.metrics.renderer_rss_mb.p50)} | ${formatValue(row.metrics.renderer_rss_mb.p95)} | ${formatValue(row.metrics.gpu_rss_mb.p50)} | ${formatValue(row.metrics.gpu_rss_mb.p95)} | ${formatValue(row.metrics.tauri_rss_mb.p50)} | ${formatValue(row.metrics.tauri_rss_mb.p95)} |`);
  }
  lines.push('');
  lines.push('## App-Owned Renderer Stats');
  lines.push('');
  lines.push('| Phase | JS heap p50 | Series cache p50 | Cmp raw p50 | Cmp columnar p50 | Parse entries p50 | Parse points p50 | DOM p50 | Canvas p50 |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of summary.rows) {
    const value = (key) => row.appMetrics[key]?.p50 ?? null;
    lines.push(`| ${row.phase} | ${formatMetricValue(value('js_heap_mb'), 'MB')} | ${formatMetricValue(value('series_cache_bytes'), 'bytes')} | ${formatMetricValue(value('comparison_store_raw_count'), 'count')} | ${formatMetricValue(value('comparison_store_columnar_count'), 'count')} | ${formatMetricValue(value('parse_cache_entries'), 'count')} | ${formatMetricValue(value('parse_cache_point_count'), 'count')} | ${formatMetricValue(value('dom_nodes'), 'count')} | ${formatMetricValue(value('canvas_count'), 'count')} |`);
  }
  lines.push('');
  lines.push('## P50 Deltas');
  lines.push('');
  lines.push('| Delta | Total | Renderer | GPU | Tauri |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  lines.push(`| after_xlsx - after_export_gc_hint | ${formatValue(summary.deltas.after_xlsx_to_after_export_gc_hint.total_rss_mb)} | ${formatValue(summary.deltas.after_xlsx_to_after_export_gc_hint.renderer_rss_mb)} | ${formatValue(summary.deltas.after_xlsx_to_after_export_gc_hint.gpu_rss_mb)} | ${formatValue(summary.deltas.after_xlsx_to_after_export_gc_hint.tauri_rss_mb)} |`);
  lines.push(`| after_export_gc_hint - after_route_leave | ${formatValue(summary.deltas.after_export_gc_hint_to_after_route_leave.total_rss_mb)} | ${formatValue(summary.deltas.after_export_gc_hint_to_after_route_leave.renderer_rss_mb)} | ${formatValue(summary.deltas.after_export_gc_hint_to_after_route_leave.gpu_rss_mb)} | ${formatValue(summary.deltas.after_export_gc_hint_to_after_route_leave.tauri_rss_mb)} |`);
  lines.push(`| after_route_leave - after_chart_visible | ${formatValue(summary.deltas.after_chart_visible_to_after_route_leave.total_rss_mb)} | ${formatValue(summary.deltas.after_chart_visible_to_after_route_leave.renderer_rss_mb)} | ${formatValue(summary.deltas.after_chart_visible_to_after_route_leave.gpu_rss_mb)} | ${formatValue(summary.deltas.after_chart_visible_to_after_route_leave.tauri_rss_mb)} |`);
  lines.push('');
  lines.push('## Readout');
  lines.push('');
  lines.push('- `after_xlsx - after_export_gc_hint` estimates reclaimable post-export RSS');
  lines.push('  after product-side buffer cleanup plus a diagnostic GC hint.');
  lines.push('- `after_export_gc_hint - after_route_leave` shows whether navigation releases');
  lines.push('  additional app-controlled state. Near-zero renderer deltas here suggest the');
  lines.push('  remaining RSS is mostly WebView2/runtime retention.');
  lines.push('- `after_route_leave - after_chart_visible` should not be interpreted as a');
  lines.push('  leak by itself; WebView2/GPU memory may shift across phases and processes.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const entries = opts.files.length
    ? opts.files.map((file) => loadSidecar(resolve(file))).filter((entry) => hasMemoryMeasurement(entry, opts.n))
    : discoverSidecars(opts.n, opts.latest);

  if (entries.length === 0) {
    throw new Error(`No comparison memory sidecars found for N=${opts.n}`);
  }

  const summary = buildSummary(entries, opts.n);
  const markdown = buildMarkdown(summary);
  process.stdout.write(markdown);

  if (opts.json) {
    const jsonPath = resolve(opts.json);
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n');
  }

  if (opts.writeMarkdown) {
    const markdownPath = resolve(opts.markdown);
    mkdirSync(dirname(markdownPath), { recursive: true });
    writeFileSync(markdownPath, markdown);
    console.error(`Markdown report: ${markdownPath}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`[summarize-comparison-memory-phases] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
