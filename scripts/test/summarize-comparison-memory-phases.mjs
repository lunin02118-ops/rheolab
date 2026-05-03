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
  ['rust_series_decode_cache_entries', 'Rust series entries', 'count'],
  ['rust_series_decode_cache_bytes', 'Rust series cache', 'bytes'],
  ['rust_series_decode_cache_hits', 'Rust series hits', 'count'],
  ['rust_series_decode_cache_misses', 'Rust series misses', 'count'],
  ['comparison_store_raw_count', 'Cmp raw', 'count'],
  ['comparison_store_columnar_count', 'Cmp columnar', 'count'],
  ['parse_cache_entries', 'Parse cache entries', 'count'],
  ['parse_cache_point_count', 'Parse cache points', 'count'],
  ['dom_nodes', 'DOM nodes', 'count'],
  ['canvas_count', 'Canvas count', 'count'],
  ['canvas_pixel_bytes', 'Canvas pixels', 'bytes'],
  ['uplot_count', 'uPlot count', 'count'],
  ['comparison_page_root_count', 'Cmp page root', 'count'],
  ['comparison_chart_root_count', 'Cmp chart root', 'count'],
  ['comparison_chart_uplot_count', 'Cmp chart uPlot', 'count'],
  ['comparison_chart_canvas_count', 'Cmp chart canvas', 'count'],
  ['comparison_report_root_count', 'Cmp report root', 'count'],
  ['dashboard_chart_root_count', 'Dash chart root', 'count'],
  ['dashboard_chart_uplot_count', 'Dash chart uPlot', 'count'],
  ['dashboard_chart_canvas_count', 'Dash chart canvas', 'count'],
  ['uplot_init_total_ms', 'uPlot init total', 'ms'],
  ['device_pixel_ratio', 'DPR', 'count'],
  ['comparison_header_height', 'Cmp header height', 'px'],
  ['comparison_chips_width', 'Cmp chips width', 'px'],
  ['comparison_chips_height', 'Cmp chips height', 'px'],
  ['comparison_chips_area', 'Cmp chips area', 'px2'],
  ['comparison_chart_container_width', 'Cmp chart shell width', 'px'],
  ['comparison_chart_container_height', 'Cmp chart shell height', 'px'],
  ['comparison_chart_container_area', 'Cmp chart shell area', 'px2'],
  ['comparison_chart_width', 'Cmp chart width', 'px'],
  ['comparison_chart_height', 'Cmp chart height', 'px'],
  ['comparison_chart_area', 'Cmp chart area', 'px2'],
  ['comparison_chart_canvas_css_width', 'Cmp canvas CSS width', 'px'],
  ['comparison_chart_canvas_css_height', 'Cmp canvas CSS height', 'px'],
  ['comparison_chart_canvas_backing_width', 'Cmp canvas backing width', 'px'],
  ['comparison_chart_canvas_backing_height', 'Cmp canvas backing height', 'px'],
  ['comparison_header_rect_change_count', 'Cmp header rect changes', 'count'],
  ['comparison_chips_rect_change_count', 'Cmp chips rect changes', 'count'],
  ['comparison_chart_container_rect_change_count', 'Cmp chart shell rect changes', 'count'],
  ['comparison_chart_rect_change_count', 'Cmp chart rect changes', 'count'],
  ['comparison_canvas_rect_change_count', 'Cmp canvas rect changes', 'count'],
  ['comparison_uplot_lifecycle_active_instances', 'Cmp lifecycle active', 'count'],
  ['comparison_uplot_lifecycle_max_active_instances', 'Cmp lifecycle max active', 'count'],
  ['comparison_uplot_lifecycle_create_count', 'Cmp lifecycle creates', 'count'],
  ['comparison_uplot_lifecycle_destroy_count', 'Cmp lifecycle destroys', 'count'],
  ['comparison_uplot_lifecycle_set_data_count', 'Cmp lifecycle setData', 'count'],
  ['comparison_uplot_lifecycle_size_count', 'Cmp lifecycle setSize', 'count'],
  ['comparison_uplot_lifecycle_redraw_count', 'Cmp lifecycle redraws', 'count'],
  ['comparison_uplot_lifecycle_first_paint_count', 'Cmp lifecycle first paints', 'count'],
  ['comparison_uplot_lifecycle_event_count', 'Cmp lifecycle events', 'count'],
];

function summaryPhases(n) {
  const fixturePhases = [];
  for (let i = 1; i <= n; i += 1) {
    fixturePhases.push(
      `before_fixture_${i}_dashboard_goto`,
      `after_fixture_${i}_dashboard_goto`,
      `before_fixture_${i}_upload`,
      `after_fixture_${i}_upload`,
      `before_fixture_${i}_parse_wait`,
      `after_fixture_${i}_parse`,
      `before_fixture_${i}_save_dialog`,
      `after_fixture_${i}_save_dialog_open`,
      `before_fixture_${i}_save_commit`,
      `after_fixture_${i}_save_persist`,
      `after_fixture_${i}_save`,
      `after_fixture_${i}_post_save_settle`,
      `after_fixture_${i}_cleanup`,
    );
  }
  const addPhases = [];
  for (let i = 1; i <= n; i += 1) {
    addPhases.push(
      `before_add_${i}`,
      `after_add_${i}_selector_open`,
      `after_add_${i}_selector_search`,
      `before_add_${i}_click`,
      `after_add_${i}_click`,
      `after_add_${i}_click_before_chart_commit`,
      `after_add_${i}_react_commit`,
      `after_add_${i}_store_update`,
      `after_add_${i}_uplot_init`,
      `after_add_${i}_uplot_set_data`,
      `after_add_${i}_first_canvas_paint`,
      `after_add_${i}_series_ready`,
      `after_add_${i}_compositor_settle_100ms`,
      `after_add_${i}_compositor_settle_500ms`,
      `after_add_${i}_dom_settle`,
      `after_add_${i}`,
    );
  }
  const add5ExperimentPhases = n >= 5
    ? [
        'after_add_5_selector_close_only_selector_open',
        'after_add_5_selector_close_only_selector_search',
        'before_add_5_selector_close_only',
        'after_add_5_selector_close_only_click',
        'after_add_5_selector_close_only_settle_100ms',
        'after_add_5_selector_close_only_settle_500ms',
        'before_add_5_commit_without_close',
        'after_add_5_commit_without_close_click',
        'after_add_5_commit_without_close_store_update',
        'after_add_5_commit_without_close_chart_commit',
        'after_add_5_commit_without_close_settle_500ms',
        'after_add_5_commit_without_close_selector_closed',
        'after_add_5_selector_closed',
        'before_add_5_chart_commit',
        'after_add_5_chart_commit',
        'after_add_5_chart_settle_500ms',
      ]
    : [];
  return [
    'app_start',
    'before_setup',
    ...fixturePhases,
    'after_setup',
    'before_comparison_open',
    'after_comparison_open',
    ...addPhases,
    ...add5ExperimentPhases,
    'after_chart_canvas_painted',
    'after_chart_visible',
    'after_chart_ready',
    'before_report_tab',
    'after_report_tab_open',
    'before_pdf',
    'after_pdf',
    'before_xlsx',
    'after_xlsx',
    'after_gc_hint',
    'after_export_gc_hint',
    'before_route_leave',
    'after_comparison_store_clear',
    'after_route_leave',
    'after_chart_unmount_settle',
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
    exportSaveMode: null,
    add5Experiment: null,
    onlyOk: false,
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
    } else if (arg === '--export-save-mode') {
      opts.exportSaveMode = argv[++i];
    } else if (arg === '--add5-experiment') {
      opts.add5Experiment = argv[++i];
    } else if (arg === '--only-ok') {
      opts.onlyOk = true;
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
  if (opts.exportSaveMode && !['download', 'direct'].includes(opts.exportSaveMode)) {
    throw new Error('--export-save-mode must be "download" or "direct"');
  }
  if (opts.add5Experiment && !['baseline', 'selector-close-only', 'commit-without-close', 'defer-chart-commit'].includes(opts.add5Experiment)) {
    throw new Error('--add5-experiment must be one of baseline, selector-close-only, commit-without-close, defer-chart-commit');
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
  --export-save-mode <download|direct>
                       Filter sidecars by comparison export save path.
  --add5-experiment <mode>
                       Filter sidecars by COMPARISON_SMOKE_ADD5_EXPERIMENT.
  --only-ok            Exclude skipped/error measurements.
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
  const exportSaveModes = new Set();
  const add5Experiments = new Set();
  if (doc.export_save_mode) exportSaveModes.add(doc.export_save_mode);
  if (doc.add5_experiment) add5Experiments.add(doc.add5_experiment);
  for (const measurement of doc.measurements ?? []) {
    if (measurement.export_save_mode) exportSaveModes.add(measurement.export_save_mode);
    if (measurement.add5_experiment) add5Experiments.add(measurement.add5_experiment);
  }
  return {
    file,
    name: basename(file),
    generatedAt: doc.generatedAt,
    mode: doc.mode,
    exportSaveModes: [...exportSaveModes],
    add5Experiments: [...add5Experiments],
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

function measurementExportSaveMode(entry, n) {
  const measurement = measurementFor(entry, n);
  return measurement?.export_save_mode ?? entry.doc.export_save_mode ?? null;
}

function measurementAdd5Experiment(entry, n) {
  const measurement = measurementFor(entry, n);
  return measurement?.add5_experiment ?? entry.doc.add5_experiment ?? 'baseline';
}

function matchesFilters(entry, opts) {
  const measurement = measurementFor(entry, opts.n);
  if (!hasMemoryMeasurement(entry, opts.n)) return false;
  if (opts.exportSaveMode && measurementExportSaveMode(entry, opts.n) !== opts.exportSaveMode) return false;
  if (opts.add5Experiment && measurementAdd5Experiment(entry, opts.n) !== opts.add5Experiment) return false;
  if (opts.onlyOk && measurement?.skipped) return false;
  return true;
}

function discoverSidecars(opts) {
  if (!existsSync(PERF_DIR)) return [];
  return readdirSync(PERF_DIR)
    .filter((file) => file.startsWith('comparison-smoke-') && file.endsWith('.json'))
    .map((file) => join(PERF_DIR, file))
    .map(loadSidecar)
    .filter((entry) => matchesFilters(entry, opts))
    .sort((a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime())
    .slice(-opts.latest);
}

function phaseStep(entry, n, phase) {
  const measurement = measurementFor(entry, n);
  return measurement?.memory_steps?.find((step) => step.phase === `n${n}:${phase}`) ?? null;
}

function buildSummary(entries, n) {
  const add5ExperimentSet = new Set(entries.map((entry) => measurementAdd5Experiment(entry, n)));
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
  const experimentDelta = (mode, from, to, key) => (
    add5ExperimentSet.has(mode) ? delta(from, to, key) : null
  );

  return {
    n,
    generatedAt: new Date().toISOString(),
    files: entries.map((entry) => entry.file),
    modes: [...new Set(entries.map((entry) => entry.mode).filter(Boolean))],
    exportSaveModes: [...new Set(entries.flatMap((entry) => entry.exportSaveModes).filter(Boolean))],
    add5Experiments: [...add5ExperimentSet],
    rows,
    deltas: {
      after_add_selector_search_to_click: Object.fromEntries(
        METRICS.map(([key]) => [key, delta(`after_add_${n}_click`, `after_add_${n}_selector_search`, key)]),
      ),
      after_add_click_to_uplot_init: Object.fromEntries(
        METRICS.map(([key]) => [key, delta(`after_add_${n}_uplot_init`, `after_add_${n}_click`, key)]),
      ),
      after_uplot_init_to_first_canvas_paint: Object.fromEntries(
        METRICS.map(([key]) => [key, delta(`after_add_${n}_first_canvas_paint`, `after_add_${n}_uplot_init`, key)]),
      ),
      after_first_canvas_paint_to_compositor_settle_500ms: Object.fromEntries(
        METRICS.map(([key]) => [key, delta(`after_add_${n}_compositor_settle_500ms`, `after_add_${n}_first_canvas_paint`, key)]),
      ),
      after_fixture_cleanup_to_after_add: Object.fromEntries(
        METRICS.map(([key]) => [key, delta(`after_add_${n}`, `after_fixture_${n}_cleanup`, key)]),
      ),
      after_add_to_after_chart_canvas_painted: Object.fromEntries(
        METRICS.map(([key]) => [key, delta('after_chart_canvas_painted', `after_add_${n}`, key)]),
      ),
      after_xlsx_to_after_export_gc_hint: Object.fromEntries(
        METRICS.map(([key]) => [key, delta('after_xlsx', 'after_export_gc_hint', key)]),
      ),
      after_export_gc_hint_to_after_route_leave: Object.fromEntries(
        METRICS.map(([key]) => [key, delta('after_export_gc_hint', 'after_route_leave', key)]),
      ),
      after_chart_visible_to_after_route_leave: Object.fromEntries(
        METRICS.map(([key]) => [key, delta('after_route_leave', 'after_chart_visible', key)]),
      ),
      selector_close_only_click_delta: Object.fromEntries(
        METRICS.map(([key]) => [key, experimentDelta('selector-close-only', 'after_add_5_selector_close_only_click', 'before_add_5_selector_close_only', key)]),
      ),
      commit_without_close_click_delta: Object.fromEntries(
        METRICS.map(([key]) => [key, experimentDelta('commit-without-close', 'after_add_5_commit_without_close_click', 'before_add_5_commit_without_close', key)]),
      ),
      commit_without_close_chart_delta: Object.fromEntries(
        METRICS.map(([key]) => [key, experimentDelta('commit-without-close', 'after_add_5_commit_without_close_chart_commit', 'after_add_5_commit_without_close_click', key)]),
      ),
      defer_chart_commit_click_delta: Object.fromEntries(
        METRICS.map(([key]) => [key, experimentDelta('defer-chart-commit', 'after_add_5_click', `after_add_${n}_selector_search`, key)]),
      ),
      defer_chart_commit_chart_delta: Object.fromEntries(
        METRICS.map(([key]) => [key, experimentDelta('defer-chart-commit', 'after_add_5_chart_commit', 'before_add_5_chart_commit', key)]),
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
  if (unit === 'ms') return value === null || value === undefined
    ? 'n/a'
    : `${Number.isInteger(value) ? value : value.toFixed(2)} ms`;
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
  lines.push(`- Export save modes: ${summary.exportSaveModes.join(', ') || 'unknown'}`);
  lines.push(`- Add5 experiments: ${summary.add5Experiments.join(', ') || 'baseline'}`);
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
  lines.push(`| Phase | ${APP_METRICS.map(([, label]) => `${label} p50`).join(' | ')} |`);
  lines.push(`| --- | ${APP_METRICS.map(() => '---:').join(' | ')} |`);
  for (const row of summary.rows) {
    const value = (key) => row.appMetrics[key]?.p50 ?? null;
    const cells = APP_METRICS.map(([key, , unit]) => formatMetricValue(value(key), unit));
    lines.push(`| ${row.phase} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## P50 Deltas');
  lines.push('');
  lines.push('| Delta | Total | Renderer | GPU | Tauri |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  lines.push(`| after_add_${summary.n}_selector_search -> after_add_${summary.n}_click | ${formatValue(summary.deltas.after_add_selector_search_to_click.total_rss_mb)} | ${formatValue(summary.deltas.after_add_selector_search_to_click.renderer_rss_mb)} | ${formatValue(summary.deltas.after_add_selector_search_to_click.gpu_rss_mb)} | ${formatValue(summary.deltas.after_add_selector_search_to_click.tauri_rss_mb)} |`);
  lines.push(`| after_add_${summary.n}_click -> after_add_${summary.n}_uplot_init | ${formatValue(summary.deltas.after_add_click_to_uplot_init.total_rss_mb)} | ${formatValue(summary.deltas.after_add_click_to_uplot_init.renderer_rss_mb)} | ${formatValue(summary.deltas.after_add_click_to_uplot_init.gpu_rss_mb)} | ${formatValue(summary.deltas.after_add_click_to_uplot_init.tauri_rss_mb)} |`);
  lines.push(`| after_add_${summary.n}_uplot_init -> after_add_${summary.n}_first_canvas_paint | ${formatValue(summary.deltas.after_uplot_init_to_first_canvas_paint.total_rss_mb)} | ${formatValue(summary.deltas.after_uplot_init_to_first_canvas_paint.renderer_rss_mb)} | ${formatValue(summary.deltas.after_uplot_init_to_first_canvas_paint.gpu_rss_mb)} | ${formatValue(summary.deltas.after_uplot_init_to_first_canvas_paint.tauri_rss_mb)} |`);
  lines.push(`| after_add_${summary.n}_first_canvas_paint -> after_add_${summary.n}_compositor_settle_500ms | ${formatValue(summary.deltas.after_first_canvas_paint_to_compositor_settle_500ms.total_rss_mb)} | ${formatValue(summary.deltas.after_first_canvas_paint_to_compositor_settle_500ms.renderer_rss_mb)} | ${formatValue(summary.deltas.after_first_canvas_paint_to_compositor_settle_500ms.gpu_rss_mb)} | ${formatValue(summary.deltas.after_first_canvas_paint_to_compositor_settle_500ms.tauri_rss_mb)} |`);
  lines.push(`| after_fixture_${summary.n}_cleanup -> after_add_${summary.n} | ${formatValue(summary.deltas.after_fixture_cleanup_to_after_add.total_rss_mb)} | ${formatValue(summary.deltas.after_fixture_cleanup_to_after_add.renderer_rss_mb)} | ${formatValue(summary.deltas.after_fixture_cleanup_to_after_add.gpu_rss_mb)} | ${formatValue(summary.deltas.after_fixture_cleanup_to_after_add.tauri_rss_mb)} |`);
  lines.push(`| after_add_${summary.n} -> after_chart_canvas_painted | ${formatValue(summary.deltas.after_add_to_after_chart_canvas_painted.total_rss_mb)} | ${formatValue(summary.deltas.after_add_to_after_chart_canvas_painted.renderer_rss_mb)} | ${formatValue(summary.deltas.after_add_to_after_chart_canvas_painted.gpu_rss_mb)} | ${formatValue(summary.deltas.after_add_to_after_chart_canvas_painted.tauri_rss_mb)} |`);
  lines.push(`| after_xlsx - after_export_gc_hint | ${formatValue(summary.deltas.after_xlsx_to_after_export_gc_hint.total_rss_mb)} | ${formatValue(summary.deltas.after_xlsx_to_after_export_gc_hint.renderer_rss_mb)} | ${formatValue(summary.deltas.after_xlsx_to_after_export_gc_hint.gpu_rss_mb)} | ${formatValue(summary.deltas.after_xlsx_to_after_export_gc_hint.tauri_rss_mb)} |`);
  lines.push(`| after_export_gc_hint - after_route_leave | ${formatValue(summary.deltas.after_export_gc_hint_to_after_route_leave.total_rss_mb)} | ${formatValue(summary.deltas.after_export_gc_hint_to_after_route_leave.renderer_rss_mb)} | ${formatValue(summary.deltas.after_export_gc_hint_to_after_route_leave.gpu_rss_mb)} | ${formatValue(summary.deltas.after_export_gc_hint_to_after_route_leave.tauri_rss_mb)} |`);
  lines.push(`| after_route_leave - after_chart_visible | ${formatValue(summary.deltas.after_chart_visible_to_after_route_leave.total_rss_mb)} | ${formatValue(summary.deltas.after_chart_visible_to_after_route_leave.renderer_rss_mb)} | ${formatValue(summary.deltas.after_chart_visible_to_after_route_leave.gpu_rss_mb)} | ${formatValue(summary.deltas.after_chart_visible_to_after_route_leave.tauri_rss_mb)} |`);
  lines.push(`| selector-close-only before close -> close click | ${formatValue(summary.deltas.selector_close_only_click_delta.total_rss_mb)} | ${formatValue(summary.deltas.selector_close_only_click_delta.renderer_rss_mb)} | ${formatValue(summary.deltas.selector_close_only_click_delta.gpu_rss_mb)} | ${formatValue(summary.deltas.selector_close_only_click_delta.tauri_rss_mb)} |`);
  lines.push(`| commit-without-close before commit -> commit | ${formatValue(summary.deltas.commit_without_close_click_delta.total_rss_mb)} | ${formatValue(summary.deltas.commit_without_close_click_delta.renderer_rss_mb)} | ${formatValue(summary.deltas.commit_without_close_click_delta.gpu_rss_mb)} | ${formatValue(summary.deltas.commit_without_close_click_delta.tauri_rss_mb)} |`);
  lines.push(`| commit-without-close commit -> chart commit | ${formatValue(summary.deltas.commit_without_close_chart_delta.total_rss_mb)} | ${formatValue(summary.deltas.commit_without_close_chart_delta.renderer_rss_mb)} | ${formatValue(summary.deltas.commit_without_close_chart_delta.gpu_rss_mb)} | ${formatValue(summary.deltas.commit_without_close_chart_delta.tauri_rss_mb)} |`);
  lines.push(`| defer-chart-commit selector search -> click | ${formatValue(summary.deltas.defer_chart_commit_click_delta.total_rss_mb)} | ${formatValue(summary.deltas.defer_chart_commit_click_delta.renderer_rss_mb)} | ${formatValue(summary.deltas.defer_chart_commit_click_delta.gpu_rss_mb)} | ${formatValue(summary.deltas.defer_chart_commit_click_delta.tauri_rss_mb)} |`);
  lines.push(`| defer-chart-commit before chart -> chart commit | ${formatValue(summary.deltas.defer_chart_commit_chart_delta.total_rss_mb)} | ${formatValue(summary.deltas.defer_chart_commit_chart_delta.renderer_rss_mb)} | ${formatValue(summary.deltas.defer_chart_commit_chart_delta.gpu_rss_mb)} | ${formatValue(summary.deltas.defer_chart_commit_chart_delta.tauri_rss_mb)} |`);
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
    ? opts.files.map((file) => loadSidecar(resolve(file))).filter((entry) => matchesFilters(entry, opts))
    : discoverSidecars(opts);

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
