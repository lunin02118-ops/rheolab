#!/usr/bin/env node
/**
 * db-sweep-compare.mjs — Sprint 1 / S1-5
 *
 * Compares two `bench_analysis_pipeline --all-experiments` JSON sidecars
 * (WITH-P10 vs NO-P10, or any A/B labelling) and emits a per-experiment
 * + corpus-aggregate delta report in markdown.
 *
 * Usage:
 *   node scripts/test/db-sweep-compare.mjs <baseline.json> <current.json> \
 *     [--label TEXT] [--out PATH]
 *
 * Conventions:
 *   - **Baseline** = first arg (typically NO-P10 or a previous build).
 *   - **Current**  = second arg (typically WITH-P10 or the change-under-test).
 *   - A **positive delta** means *current is faster* than baseline.
 *     Δ% = (baseline.mean − current.mean) / baseline.mean × 100.
 *
 * Output:
 *   - To stdout (always).
 *   - Optionally appended to `--out` file (overwrites).
 *
 * Exit codes:
 *   0  — compare ran cleanly.
 *   2  — argument or input-file error.
 *   3  — schema mismatch.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ── CLI parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { positional: [], label: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') {
      args.label = argv[++i];
    } else if (a === '--out') {
      args.out = argv[++i];
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a.startsWith('--')) {
      console.error(`unknown flag: ${a}`);
      printHelp();
      process.exit(2);
    } else {
      args.positional.push(a);
    }
  }
  if (args.positional.length !== 2) {
    console.error('expected exactly two positional arguments: <baseline.json> <current.json>');
    printHelp();
    process.exit(2);
  }
  return args;
}

function printHelp() {
  console.log('Usage: db-sweep-compare.mjs <baseline.json> <current.json> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --label TEXT  Free-form label written into the report header.');
  console.log('  --out PATH    Write the markdown report to PATH (also printed to stdout).');
  console.log('  --help, -h    Show this help.');
}

// ── JSON load + validate ────────────────────────────────────────────────

async function loadSweepJson(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    console.error(`failed to read ${filePath}: ${err.message}`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`failed to parse JSON in ${filePath}: ${err.message}`);
    process.exit(2);
  }
  if (parsed.schema !== 'rheolab.microbench.analysis_pipeline.v1') {
    console.error(
      `schema mismatch in ${filePath}: expected ` +
        `'rheolab.microbench.analysis_pipeline.v1', got '${parsed.schema}'`,
    );
    process.exit(3);
  }
  if (parsed.mode !== 'all_experiments') {
    console.error(
      `mode mismatch in ${filePath}: expected 'all_experiments', got '${parsed.mode}'`,
    );
    process.exit(3);
  }
  if (!Array.isArray(parsed.experiments)) {
    console.error(`malformed sidecar: missing experiments array in ${filePath}`);
    process.exit(3);
  }
  if (typeof parsed.corpus !== 'object' || parsed.corpus == null) {
    console.error(`malformed sidecar: missing corpus block in ${filePath}`);
    process.exit(3);
  }
  return parsed;
}

// ── Delta math ──────────────────────────────────────────────────────────

function pctDelta(baseline, current) {
  if (!isFinite(baseline) || baseline <= 0) return null;
  return ((baseline - current) / baseline) * 100;
}

function fmtPct(p, opts = {}) {
  const { signed = true, decimals = 1 } = opts;
  if (p == null || !isFinite(p)) return '—';
  const sign = signed ? (p >= 0 ? '+' : '') : '';
  return `${sign}${p.toFixed(decimals)}%`;
}

function fmtMs(v, decimals = 2) {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(decimals);
}

function classifyDelta(p) {
  // Within ±5% — call it noise.  Outside is a real win or regression.
  if (p == null || !isFinite(p)) return 'unknown';
  if (Math.abs(p) < 5) return 'flat';
  return p > 0 ? 'win' : 'regression';
}

// ── Report builder ──────────────────────────────────────────────────────

function buildReport({ baseline, current, label, basePath, currentPath }) {
  const lines = [];

  // Header
  lines.push('# bench_analysis_pipeline — DB-sweep compare');
  lines.push('');
  if (label) {
    lines.push(`**Label:** \`${label}\``);
    lines.push('');
  }
  lines.push(`**Baseline:** \`${path.basename(basePath)}\` (label: \`${baseline.label ?? '-'}\`)  `);
  lines.push(`**Current:**  \`${path.basename(currentPath)}\` (label: \`${current.label ?? '-'}\`)  `);
  lines.push(`**Fixture:** \`${current.fixture_path ?? '-'}\``);
  if (baseline.fixture_path && baseline.fixture_path !== current.fixture_path) {
    lines.push(`> ⚠ baseline fixture path differs: \`${baseline.fixture_path}\``);
  }
  lines.push(
    `**Iterations per experiment:** baseline=${baseline.iterations_per_experiment}, ` +
      `current=${current.iterations_per_experiment}`,
  );
  lines.push('');

  // Index by experiment_id for matching
  const byIdBaseline = new Map(
    (baseline.experiments ?? []).map((e) => [e.experiment_id, e]),
  );
  const byIdCurrent = new Map(
    (current.experiments ?? []).map((e) => [e.experiment_id, e]),
  );

  // Per-experiment table — drive by current's order so the table reads naturally
  lines.push('## Per-experiment delta');
  lines.push('');
  lines.push(
    '| idx | experiment | instr | points | cycles | base mean ms | curr mean ms | Δ mean | Δ p50 | Δ p95 | verdict |',
  );
  lines.push(
    '|----:|------------|-------|------:|-------:|-------------:|-------------:|-------:|------:|------:|---------|',
  );
  let wins = 0;
  let regressions = 0;
  let flats = 0;
  let missing = 0;
  for (const cur of current.experiments) {
    const base = byIdBaseline.get(cur.experiment_id);
    const nameShort = (cur.experiment_name ?? '').slice(0, 30);
    const instrShort = (cur.instrument_type ?? '').slice(0, 18);
    if (!base) {
      missing++;
      lines.push(
        `| ${cur.index} | ${nameShort} | ${instrShort} | ${cur.point_count} | ${cur.cycles_detected} | — | ${fmtMs(cur.wall_ms.mean)} | — | — | — | missing-from-baseline |`,
      );
      continue;
    }
    const dMean = pctDelta(base.wall_ms.mean, cur.wall_ms.mean);
    const dP50 = pctDelta(base.wall_ms.p50, cur.wall_ms.p50);
    const dP95 = pctDelta(base.wall_ms.p95, cur.wall_ms.p95);
    const cls = classifyDelta(dMean);
    if (cls === 'win') wins++;
    else if (cls === 'regression') regressions++;
    else if (cls === 'flat') flats++;
    lines.push(
      `| ${cur.index} | ${nameShort} | ${instrShort} | ${cur.point_count} | ${cur.cycles_detected} | ${fmtMs(base.wall_ms.mean)} | ${fmtMs(cur.wall_ms.mean)} | ${fmtPct(dMean)} | ${fmtPct(dP50)} | ${fmtPct(dP95)} | ${cls} |`,
    );
  }

  // Surface experiments that exist in baseline but not current (e.g. loader skipped them)
  const droppedFromCurrent = [];
  for (const base of baseline.experiments) {
    if (!byIdCurrent.has(base.experiment_id)) droppedFromCurrent.push(base);
  }
  if (droppedFromCurrent.length > 0) {
    lines.push('');
    lines.push('### Dropped from current (present in baseline, missing in current):');
    for (const b of droppedFromCurrent) {
      lines.push(`- idx=${b.index} \`${b.experiment_id}\` (${b.experiment_name})`);
    }
  }

  // Corpus aggregate
  lines.push('');
  lines.push('## Corpus aggregate');
  lines.push('');
  const bC = baseline.corpus;
  const cC = current.corpus;
  const dPooledP50 = pctDelta(bC.wall_ms_pooled_p50, cC.wall_ms_pooled_p50);
  const dPooledP95 = pctDelta(bC.wall_ms_pooled_p95, cC.wall_ms_pooled_p95);
  const dPooledMean = pctDelta(bC.wall_ms_pooled_mean, cC.wall_ms_pooled_mean);
  const dMedianMeans = pctDelta(
    bC.wall_ms_median_of_means,
    cC.wall_ms_median_of_means,
  );
  const dTotalPass = pctDelta(
    bC.wall_ms_total_per_iter_mean,
    cC.wall_ms_total_per_iter_mean,
  );
  lines.push('| Metric | Baseline | Current | Δ |');
  lines.push('|--------|---------:|--------:|--:|');
  lines.push(
    `| n_experiments               | ${bC.n_experiments} | ${cC.n_experiments} | — |`,
  );
  lines.push(
    `| total_samples               | ${bC.total_samples} | ${cC.total_samples} | — |`,
  );
  lines.push(
    `| pooled wall_ms p50          | ${fmtMs(bC.wall_ms_pooled_p50)} | ${fmtMs(cC.wall_ms_pooled_p50)} | ${fmtPct(dPooledP50)} |`,
  );
  lines.push(
    `| pooled wall_ms p95          | ${fmtMs(bC.wall_ms_pooled_p95)} | ${fmtMs(cC.wall_ms_pooled_p95)} | ${fmtPct(dPooledP95)} |`,
  );
  lines.push(
    `| pooled wall_ms mean         | ${fmtMs(bC.wall_ms_pooled_mean)} | ${fmtMs(cC.wall_ms_pooled_mean)} | ${fmtPct(dPooledMean)} |`,
  );
  lines.push(
    `| median of per-exp means     | ${fmtMs(bC.wall_ms_median_of_means)} | ${fmtMs(cC.wall_ms_median_of_means)} | ${fmtPct(dMedianMeans)} |`,
  );
  lines.push(
    `| total wall_ms per full pass | ${fmtMs(bC.wall_ms_total_per_iter_mean)} | ${fmtMs(cC.wall_ms_total_per_iter_mean)} | ${fmtPct(dTotalPass)} |`,
  );

  // Verdict counts
  lines.push('');
  lines.push('## Per-experiment verdict tally');
  lines.push('');
  lines.push('| Verdict     | Count | Threshold      |');
  lines.push('|-------------|------:|----------------|');
  lines.push(`| wins         | ${wins}      | mean ≥ +5 %    |`);
  lines.push(`| flat / noise | ${flats}      | \\|Δmean\\| < 5 %   |`);
  lines.push(`| regressions  | ${regressions}      | mean ≤ −5 %    |`);
  if (missing > 0) {
    lines.push(`| missing      | ${missing}      | not in baseline |`);
  }

  return lines.join('\n') + '\n';
}

// ── main ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [basePath, currentPath] = args.positional;
  const baseline = await loadSweepJson(basePath);
  const current = await loadSweepJson(currentPath);

  const report = buildReport({
    baseline,
    current,
    label: args.label,
    basePath,
    currentPath,
  });
  process.stdout.write(report);

  if (args.out) {
    try {
      await fs.mkdir(path.dirname(args.out), { recursive: true });
      await fs.writeFile(args.out, report, 'utf8');
      console.error(`[db-sweep-compare] wrote ${args.out}`);
    } catch (err) {
      console.error(`failed to write ${args.out}: ${err.message}`);
      process.exit(2);
    }
  }
}

main().catch((err) => {
  console.error('[db-sweep-compare] unexpected failure:', err);
  process.exit(1);
});
