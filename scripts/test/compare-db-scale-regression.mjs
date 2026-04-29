#!/usr/bin/env node
/**
 * Compare DB-scale perf sidecars before/after a refactor.
 *
 * Default mode auto-discovers:
 * - baseline: latest db-scale files that do NOT contain libraryFilterSpans
 * - current: latest db-scale files that DO contain libraryFilterSpans
 *
 * This keeps the comparison honest for the library span work: old runner
 * sidecars have only coarse step wall_ms, while new sidecars also expose the
 * filter/search phase split.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const ROOT = resolve('.');
const PERF_DIR = join(ROOT, 'outputs', 'e2e', 'perf');
const DEFAULT_MARKDOWN = join(ROOT, 'docs', 'performance', 'LIBRARY-FILTER-REGRESSION-TRACKING.md');

const FILTER_ACTIONS = [
  'search_by_name',
  'filter_fluid_type',
  'filter_date_range',
  'filter_reset',
];

const SUMMARY_METRICS = [
  { key: 'totalWallMs', label: 'Scenario wall', unit: 'ms' },
  { key: 'peakHeapMb', label: 'Peak JS heap', unit: 'MB' },
  { key: 'peakNodes', label: 'Peak DOM nodes', unit: 'nodes' },
];

const STEP_METRICS = [
  { step: 'library_open', metric: 'wallMs', label: 'Library open', unit: 'ms' },
  { step: 'search_by_name', metric: 'wallMs', label: 'Search wall', unit: 'ms' },
  { step: 'filter_fluid_type', metric: 'wallMs', label: 'Fluid filter wall', unit: 'ms' },
  { step: 'filter_date_range', metric: 'wallMs', label: 'Date range wall', unit: 'ms' },
  { step: 'filter_reset', metric: 'wallMs', label: 'Filter reset wall', unit: 'ms' },
  { step: 'open_experiment_card', metric: 'wallMs', label: 'Detail card open', unit: 'ms' },
  { step: 'library_open', metric: 'heapUsedMb', label: 'Library open heap', unit: 'MB' },
];

function parseArgs(argv) {
  const opts = {
    scale: null,
    baseline: [],
    current: [],
    markdown: null,
    json: null,
    writeMarkdown: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--scale') {
      opts.scale = argv[++i];
    } else if (arg === '--baseline') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.baseline.push(argv[++i]);
    } else if (arg === '--current') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) opts.current.push(argv[++i]);
    } else if (arg === '--markdown') {
      opts.markdown = argv[++i];
      opts.writeMarkdown = true;
    } else if (arg === '--write-md') {
      opts.markdown = DEFAULT_MARKDOWN;
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

  return opts;
}

function usage() {
  console.log(`Usage:
  node scripts/test/compare-db-scale-regression.mjs
  node scripts/test/compare-db-scale-regression.mjs --write-md
  node scripts/test/compare-db-scale-regression.mjs --scale large
  node scripts/test/compare-db-scale-regression.mjs --baseline <a.json> <b.json> --current <c.json>

Options:
  --baseline <files...>  Explicit baseline db-scale sidecars.
  --current <files...>   Explicit current db-scale sidecars.
  --scale small|large    Limit comparison to one DB scale.
  --write-md             Write docs/performance/LIBRARY-FILTER-REGRESSION-TRACKING.md.
  --markdown <path>      Write markdown report to a custom path.
  --json <path>          Write machine-readable comparison JSON.
`);
}

function loadSidecar(file) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  return {
    file,
    name: basename(file),
    hasSpans: Boolean(doc.libraryFilterSpans),
    hasCompleteFilterSpans: FILTER_ACTIONS.every((action) =>
      Number.isFinite(doc.libraryFilterSpans?.[action]?.ipc_ms),
    ),
    doc,
  };
}

function discoverSidecars(scale, wantSpans) {
  if (!existsSync(PERF_DIR)) return [];
  return readdirSync(PERF_DIR)
    .filter((file) => file.startsWith('db-scale-') && file.endsWith('.json'))
    .map((file) => join(PERF_DIR, file))
    .map(loadSidecar)
    .filter((entry) => entry.doc.scale === scale)
    .filter((entry) => wantSpans ? entry.hasCompleteFilterSpans : !entry.hasSpans)
    .sort((a, b) => new Date(a.doc.generatedAt).getTime() - new Date(b.doc.generatedAt).getTime())
    .slice(-3);
}

function percentile(values, p) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  const idx = (nums.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return nums[lo];
  return nums[lo] + (nums[hi] - nums[lo]) * (idx - lo);
}

function stats(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  return {
    n: nums.length,
    p50: round(percentile(nums, 0.5)),
    p95: round(percentile(nums, 0.95)),
    min: round(nums.length ? Math.min(...nums) : null),
    max: round(nums.length ? Math.max(...nums) : null),
  };
}

function round(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function pctDelta(base, current) {
  if (!Number.isFinite(base) || !Number.isFinite(current) || base === 0) return null;
  return round(((current - base) / Math.abs(base)) * 100);
}

function verdict(deltaPct, threshold = 5) {
  if (deltaPct === null) return 'n/a';
  if (deltaPct <= -threshold) return 'progress';
  if (deltaPct >= threshold) return 'regress';
  return 'flat';
}

function valueAt(doc, metric) {
  if ('key' in metric) return doc[metric.key];
  return doc.steps?.[metric.step]?.[metric.metric] ?? null;
}

function aggregate(entries, metric) {
  return stats(entries.map((entry) => valueAt(entry.doc, metric)));
}

function aggregateSpan(entries, action, key) {
  return stats(entries.map((entry) => entry.doc.libraryFilterSpans?.[action]?.[key]));
}

function compareMetric(scale, metric, baseline, current) {
  const b = aggregate(baseline, metric);
  const c = aggregate(current, metric);
  const delta = pctDelta(b.p50, c.p50);
  return {
    scale,
    label: metric.label,
    unit: metric.unit,
    baseline: b,
    current: c,
    deltaPct: delta,
    verdict: verdict(delta),
  };
}

function compareSpan(scale, action, current) {
  return {
    scale,
    action,
    totalMs: aggregateSpan(current, action, 'total_ms'),
    ipcMs: aggregateSpan(current, action, 'ipc_ms'),
    renderMs: aggregateSpan(current, action, 'ipc_to_render_commit_ms'),
    debounceMs: aggregateSpan(current, action, 'filter_change_to_debounce_fire_ms'),
    settleMs: aggregateSpan(current, action, 'render_commit_to_settled_ms'),
  };
}

function formatValue(value, unit = '') {
  if (value === null || value === undefined) return 'n/a';
  const suffix = unit ? ` ${unit}` : '';
  return `${Number.isInteger(value) ? value : value.toFixed(2)}${suffix}`;
}

function formatPct(value) {
  if (value === null || value === undefined) return 'n/a';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function buildComparison(opts) {
  const scales = opts.scale ? [opts.scale] : ['small', 'large'];
  const explicitBaseline = opts.baseline.map((file) => loadSidecar(resolve(file)));
  const explicitCurrent = opts.current.map((file) => loadSidecar(resolve(file)));
  const comparisons = [];

  for (const scale of scales) {
    const baseline = explicitBaseline.length
      ? explicitBaseline.filter((entry) => entry.doc.scale === scale)
      : discoverSidecars(scale, false);
    const current = explicitCurrent.length
      ? explicitCurrent.filter((entry) => entry.doc.scale === scale)
      : discoverSidecars(scale, true);

    if (baseline.length === 0 || current.length === 0) {
      comparisons.push({
        scale,
        missing: true,
        baselineFiles: baseline.map((entry) => entry.file),
        currentFiles: current.map((entry) => entry.file),
      });
      continue;
    }

    const summary = SUMMARY_METRICS.map((metric) => compareMetric(scale, metric, baseline, current));
    const steps = STEP_METRICS.map((metric) => compareMetric(scale, metric, baseline, current));
    const spans = FILTER_ACTIONS.map((action) => compareSpan(scale, action, current));

    comparisons.push({
      scale,
      missing: false,
      baselineFiles: baseline.map((entry) => entry.file),
      currentFiles: current.map((entry) => entry.file),
      methodChanged: baseline.some((entry) => !entry.hasSpans) && current.some((entry) => entry.hasSpans),
      summary,
      steps,
      spans,
    });
  }

  return {
    schema: 'rheolab.perf.db_scale_regression.v1',
    generatedAt: new Date().toISOString(),
    comparisons,
  };
}

function markdownReport(report) {
  const lines = [];
  lines.push('# Library Filter Regression Tracking');
  lines.push('');
  lines.push(`**Generated:** ${report.generatedAt}.`);
  lines.push('');
  lines.push('This report compares DB-scale sidecars before and after the current');
  lines.push('library filter span instrumentation. It is meant to track progress and');
  lines.push('regression without overclaiming product wins from runner changes.');
  lines.push('');

  for (const comparison of report.comparisons) {
    lines.push(`## ${comparison.scale.toUpperCase()} DB`);
    lines.push('');

    if (comparison.missing) {
      lines.push('Missing baseline or current sidecars for this scale.');
      lines.push('');
      continue;
    }

    lines.push('Baseline files:');
    for (const file of comparison.baselineFiles) lines.push(`- \`${relative(file)}\``);
    lines.push('');
    lines.push('Current files:');
    for (const file of comparison.currentFiles) lines.push(`- \`${relative(file)}\``);
    lines.push('');

    if (comparison.methodChanged) {
      lines.push('> Note: current sidecars are span-aware while baseline sidecars are coarse');
      lines.push('> step wall measurements. Wall-time deltas are useful regression signals,');
      lines.push('> but should not be claimed as pure product latency wins.');
      lines.push('');
    }

    lines.push('### Summary');
    lines.push('');
    lines.push('| Metric | Baseline p50 | Current p50 | Delta | Status |');
    lines.push('| --- | ---: | ---: | ---: | --- |');
    for (const row of comparison.summary) {
      lines.push(`| ${row.label} | ${formatValue(row.baseline.p50, row.unit)} | ${formatValue(row.current.p50, row.unit)} | ${formatPct(row.deltaPct)} | ${row.verdict} |`);
    }
    lines.push('');

    lines.push('### Step Wall/Heap');
    lines.push('');
    lines.push('| Metric | Baseline p50 | Current p50 | Delta | Status |');
    lines.push('| --- | ---: | ---: | ---: | --- |');
    for (const row of comparison.steps) {
      lines.push(`| ${row.label} | ${formatValue(row.baseline.p50, row.unit)} | ${formatValue(row.current.p50, row.unit)} | ${formatPct(row.deltaPct)} | ${row.verdict} |`);
    }
    lines.push('');

    lines.push('### Current Filter Spans');
    lines.push('');
    lines.push('| Action | total p50 | debounce p50 | IPC p50 | render p50 | settle p50 |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const row of comparison.spans) {
      lines.push(`| ${row.action} | ${formatValue(row.totalMs.p50, 'ms')} | ${formatValue(row.debounceMs.p50, 'ms')} | ${formatValue(row.ipcMs.p50, 'ms')} | ${formatValue(row.renderMs.p50, 'ms')} | ${formatValue(row.settleMs.p50, 'ms')} |`);
    }
    lines.push('');
  }

  lines.push('## Readout');
  lines.push('');
  lines.push('- Treat `progress` / `regress` on wall times as runner-level signals when');
  lines.push('  baseline and current use different measurement methods.');
  lines.push('- Treat `ipc_ms` in current spans as the best available frontend-observed');
  lines.push('  proxy for DB/IPC cost.');
  lines.push('- If `ipc_ms` is small but wall time is high, optimize debounce/render/settle');
  lines.push('  before touching SQL.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function relative(file) {
  return file.startsWith(ROOT) ? file.slice(ROOT.length + 1).replaceAll('\\', '/') : file;
}

function consoleReport(report) {
  for (const comparison of report.comparisons) {
    console.log(`\n=== ${comparison.scale.toUpperCase()} DB ===`);
    if (comparison.missing) {
      console.log('Missing baseline or current files.');
      continue;
    }
    console.log('Summary');
    for (const row of comparison.summary) {
      console.log(`  ${row.label}: ${formatValue(row.baseline.p50, row.unit)} -> ${formatValue(row.current.p50, row.unit)} (${formatPct(row.deltaPct)}, ${row.verdict})`);
    }
    console.log('Filter spans');
    for (const row of comparison.spans) {
      console.log(`  ${row.action}: total=${formatValue(row.totalMs.p50, 'ms')}, ipc=${formatValue(row.ipcMs.p50, 'ms')}, render=${formatValue(row.renderMs.p50, 'ms')}, debounce=${formatValue(row.debounceMs.p50, 'ms')}`);
    }
  }
}

const opts = parseArgs(process.argv.slice(2));
const report = buildComparison(opts);
consoleReport(report);

if (opts.json) {
  const out = resolve(opts.json);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (opts.writeMarkdown) {
  const out = resolve(opts.markdown ?? DEFAULT_MARKDOWN);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, markdownReport(report), 'utf8');
  console.log(`\nMarkdown report: ${out}`);
}
