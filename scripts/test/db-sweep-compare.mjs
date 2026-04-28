#!/usr/bin/env node
/**
 * db-sweep-compare.mjs — Sprint 1 / S1-5 + S1-6
 *
 * Compares two `bench_analysis_pipeline --all-experiments` JSON sidecars
 * (WITH-P10 vs NO-P10, or any A/B labelling) and emits a per-experiment
 * + corpus-aggregate delta report in markdown.
 *
 * **S1-6 (2026-04-29):** every per-experiment delta now carries a
 * Welch's t-test p-value and a basic-bootstrap 95 % confidence interval
 * on the relative mean delta.  The corpus aggregate carries the same
 * stats applied to all pooled samples.  Verdicts are significance-based:
 *
 *   - `win`         — Δmean ≥ +2 % **and** p < 0.05 (current is faster)
 *   - `regression`  — Δmean ≤ −2 % **and** p < 0.05 (current is slower)
 *   - `noise`       — anything else (insufficient evidence)
 *
 * A trailing `★` on the verdict marks experiments whose p-value also
 * survives Bonferroni correction at α = 0.05 / N (where N is the number
 * of experiments compared).
 *
 * Usage:
 *   node scripts/test/db-sweep-compare.mjs <baseline.json> <current.json> \
 *     [--label TEXT] [--out PATH] [--bootstrap-resamples R]
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
  const args = {
    positional: [],
    label: null,
    out: null,
    bootstrapResamples: 2000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label') {
      args.label = argv[++i];
    } else if (a === '--out') {
      args.out = argv[++i];
    } else if (a === '--bootstrap-resamples') {
      const r = parseInt(argv[++i], 10);
      if (!Number.isFinite(r) || r < 100) {
        console.error('--bootstrap-resamples requires an integer >= 100');
        process.exit(2);
      }
      args.bootstrapResamples = r;
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
  console.log('  --label TEXT             Free-form label written into the report header.');
  console.log('  --out PATH               Write the markdown report to PATH (also printed to stdout).');
  console.log('  --bootstrap-resamples R  Bootstrap iterations for 95 % CIs (default: 2000, min: 100).');
  console.log('  --help, -h               Show this help.');
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
  // Kept for back-compat with the magnitude-only verdict; S1-6 prefers
  // `classifyDeltaSig` below which combines magnitude + p-value.
  if (p == null || !isFinite(p)) return 'unknown';
  if (Math.abs(p) < 5) return 'flat';
  return p > 0 ? 'win' : 'regression';
}

// ── Statistics helpers (S1-6) ───────────────────────────────────────────
//
// Pure-JS, no deps.  Welch's t-test uses a normal-distribution p-value
// approximation — accurate when sample sizes are large (df > 30 or so),
// which is our regime (≥ 100 samples per arm in the bench output).
// The bootstrap is the basic percentile method on independent resamples
// with replacement.

function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function sampleVariance(arr, m) {
  if (!arr || arr.length < 2) return 0;
  const mu = m == null ? mean(arr) : m;
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mu;
    s += d * d;
  }
  return s / (arr.length - 1);
}

// Abramowitz & Stegun 7.1.26.  Max error ~1.5e-7 — far tighter than
// any realistic p-value precision we care about here.
function erf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + p * ax);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Welch's two-sample t-test, two-tailed.  Returns
 * { t, df, pTwoTailed, meanA, meanB, varA, varB } where `pTwoTailed`
 * uses the normal approximation (df > 30 in our use case).
 *
 * Convention: positive `t` ⇒ A > B ⇒ baseline slower than current
 * (because we plug in baseline as A and current as B).  The relative
 * Δ% reported elsewhere uses the same convention (positive = current
 * is faster), so signs line up.
 */
function welchTTest(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  const va = sampleVariance(a, ma);
  const vb = sampleVariance(b, mb);
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) {
    return { t: 0, df: 0, pTwoTailed: 1, meanA: ma, meanB: mb, varA: va, varB: vb };
  }
  const seSq = va / na + vb / nb;
  const se = Math.sqrt(seSq);
  if (!isFinite(se) || se <= 0) {
    return { t: 0, df: 0, pTwoTailed: 1, meanA: ma, meanB: mb, varA: va, varB: vb };
  }
  const t = (ma - mb) / se;
  const df =
    (seSq * seSq) /
    ((va * va) / (na * na * (na - 1)) + (vb * vb) / (nb * nb * (nb - 1)));
  // Normal approximation to the t-distribution.  At df ≥ 30 the error
  // is well under 1 % on |t| < 5; we don't claim p-values to more than
  // 3 sig figs anyway.
  const pTwoTailed = 2 * (1 - normalCdf(Math.abs(t)));
  return { t, df, pTwoTailed, meanA: ma, meanB: mb, varA: va, varB: vb };
}

/**
 * Independent two-sample bootstrap of the relative mean delta:
 *
 *     Δ% = (mean(A*) − mean(B*)) / mean(A*) × 100
 *
 * where A* and B* are sample-with-replacement draws from the original
 * samples.  Returns { lo, hi, median, deltaPoint } using the percentile
 * method at α = 0.05.  `deltaPoint` is the plug-in estimate (no
 * resampling) for cross-checking against the bootstrap median.
 */
function bootstrapDeltaPctCI(baselineSamples, currentSamples, nResamples) {
  const nA = baselineSamples.length;
  const nB = currentSamples.length;
  const ma = mean(baselineSamples);
  const mb = mean(currentSamples);
  const deltaPoint = ma > 0 ? ((ma - mb) / ma) * 100 : null;

  if (nA < 2 || nB < 2 || nResamples < 100 || ma <= 0) {
    return { lo: null, hi: null, median: null, deltaPoint };
  }

  const deltas = new Array(nResamples);
  for (let i = 0; i < nResamples; i++) {
    let sA = 0;
    let sB = 0;
    for (let k = 0; k < nA; k++) {
      sA += baselineSamples[(Math.random() * nA) | 0];
    }
    for (let k = 0; k < nB; k++) {
      sB += currentSamples[(Math.random() * nB) | 0];
    }
    const meanA = sA / nA;
    const meanB = sB / nB;
    deltas[i] = meanA > 0 ? ((meanA - meanB) / meanA) * 100 : 0;
  }
  deltas.sort((x, y) => x - y);
  const idxLo = Math.max(0, Math.floor(0.025 * nResamples));
  const idxHi = Math.min(nResamples - 1, Math.floor(0.975 * nResamples));
  const idxMid = Math.floor(0.5 * nResamples);
  return {
    lo: deltas[idxLo],
    hi: deltas[idxHi],
    median: deltas[idxMid],
    deltaPoint,
  };
}

/**
 * Significance-aware verdict.  Combines a magnitude floor (default
 * ±2 %) with a p-value cutoff (default 0.05).  Use the (raw) p-value
 * for unadjusted verdicts; pass `bonferroniN > 1` to require
 * `p < α / bonferroniN` instead.  Returns one of:
 *   `win`         current is faster, |Δ| ≥ floor, p < α
 *   `regression`  current is slower, |Δ| ≥ floor, p < α
 *   `noise`       anything else
 */
function classifyDeltaSig(deltaPct, p, opts = {}) {
  const { magnitudeFloor = 2, alpha = 0.05, bonferroniN = 1 } = opts;
  if (deltaPct == null || !isFinite(deltaPct) || p == null || !isFinite(p)) {
    return 'unknown';
  }
  const adjustedAlpha = alpha / Math.max(1, bonferroniN);
  if (p >= adjustedAlpha) return 'noise';
  if (Math.abs(deltaPct) < magnitudeFloor) return 'noise';
  return deltaPct > 0 ? 'win' : 'regression';
}

function fmtCI(lo, hi, decimals = 1) {
  if (lo == null || hi == null || !isFinite(lo) || !isFinite(hi)) return '—';
  const fmt = (v) => {
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(decimals)}`;
  };
  return `[${fmt(lo)}%, ${fmt(hi)}%]`;
}

function fmtPValue(p) {
  if (p == null || !isFinite(p)) return '—';
  if (p < 0.001) return '<0.001';
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(2);
}

// ── Report builder ──────────────────────────────────────────────────────

function buildReport({
  baseline,
  current,
  label,
  basePath,
  currentPath,
  bootstrapResamples,
}) {
  const lines = [];

  // ── Header ──
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
  lines.push(
    `**Significance:** Welch's t-test (two-tailed, normal-approx p-value) ` +
      `+ basic-bootstrap 95 % CI on Δ% (R = ${bootstrapResamples} resamples).  ` +
      `Verdict: \`win\` / \`regression\` if |Δmean| ≥ 2 % **and** p < 0.05; ` +
      `\`noise\` otherwise.  \`★\` = also passes Bonferroni at α = 0.05 / N.`,
  );
  lines.push('');

  // ── Index by experiment_id ──
  const byIdBaseline = new Map(
    (baseline.experiments ?? []).map((e) => [e.experiment_id, e]),
  );
  const byIdCurrent = new Map(
    (current.experiments ?? []).map((e) => [e.experiment_id, e]),
  );

  // ── Pre-compute per-experiment statistics ──
  // Doing the bootstrap here also lets us build the tally consistently
  // with what the table shows (Bonferroni N = number of *paired* tests).
  const matched = [];
  const missingRows = [];
  for (const cur of current.experiments) {
    const base = byIdBaseline.get(cur.experiment_id);
    if (!base) {
      missingRows.push(cur);
      continue;
    }
    const baseSamples = base.samples_ms ?? [];
    const curSamples = cur.samples_ms ?? [];
    const welch = welchTTest(baseSamples, curSamples);
    const ci = bootstrapDeltaPctCI(baseSamples, curSamples, bootstrapResamples);
    matched.push({ cur, base, welch, ci });
  }
  const bonfN = Math.max(1, matched.length);
  const bonfAlpha = 0.05 / bonfN;

  // ── Per-experiment table ──
  lines.push('## Per-experiment delta');
  lines.push('');
  lines.push(
    '| idx | experiment | instr | points | cycles | base ms | curr ms | Δ mean | 95 % CI | p (Welch) | verdict |',
  );
  lines.push(
    '|----:|------------|-------|------:|-------:|--------:|--------:|-------:|---------|----------:|---------|',
  );
  let wins = 0;
  let regressions = 0;
  let noise = 0;
  let bonfHits = 0;
  for (const { cur, base, welch, ci } of matched) {
    const nameShort = (cur.experiment_name ?? '').slice(0, 30);
    const instrShort = (cur.instrument_type ?? '').slice(0, 18);
    const dMean = pctDelta(base.wall_ms.mean, cur.wall_ms.mean);
    const verdict = classifyDeltaSig(dMean, welch.pTwoTailed, {
      magnitudeFloor: 2,
      alpha: 0.05,
    });
    if (verdict === 'win') wins++;
    else if (verdict === 'regression') regressions++;
    else noise++;
    const survivesBonf =
      welch.pTwoTailed < bonfAlpha &&
      Math.abs(dMean ?? 0) >= 2 &&
      (verdict === 'win' || verdict === 'regression');
    if (survivesBonf) bonfHits++;
    const verdictCell = survivesBonf ? `${verdict}★` : verdict;
    lines.push(
      `| ${cur.index} | ${nameShort} | ${instrShort} | ${cur.point_count} | ${cur.cycles_detected} | ${fmtMs(base.wall_ms.mean)} | ${fmtMs(cur.wall_ms.mean)} | ${fmtPct(dMean)} | ${fmtCI(ci.lo, ci.hi)} | ${fmtPValue(welch.pTwoTailed)} | ${verdictCell} |`,
    );
  }
  for (const cur of missingRows) {
    const nameShort = (cur.experiment_name ?? '').slice(0, 30);
    const instrShort = (cur.instrument_type ?? '').slice(0, 18);
    lines.push(
      `| ${cur.index} | ${nameShort} | ${instrShort} | ${cur.point_count} | ${cur.cycles_detected} | — | ${fmtMs(cur.wall_ms.mean)} | — | — | — | missing |`,
    );
  }

  // ── Surface dropped-from-current rows ──
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

  // ── Corpus aggregate ──
  // Pooled samples are the union of every experiment's per-iter samples
  // (both arms).  We bootstrap and t-test on those to get a corpus-level
  // CI + p-value on the relative mean delta.  Tail percentiles (p50/p95)
  // and the median-of-means are reported as point estimates only.
  lines.push('');
  lines.push('## Corpus aggregate');
  lines.push('');
  const bC = baseline.corpus;
  const cC = current.corpus;

  const pooledBaseSamples = [];
  for (const e of baseline.experiments ?? []) {
    if (Array.isArray(e.samples_ms)) pooledBaseSamples.push(...e.samples_ms);
  }
  const pooledCurSamples = [];
  for (const e of current.experiments ?? []) {
    if (Array.isArray(e.samples_ms)) pooledCurSamples.push(...e.samples_ms);
  }
  const corpusWelch = welchTTest(pooledBaseSamples, pooledCurSamples);
  const corpusCI = bootstrapDeltaPctCI(
    pooledBaseSamples,
    pooledCurSamples,
    bootstrapResamples,
  );
  const dPooledMean = pctDelta(bC.wall_ms_pooled_mean, cC.wall_ms_pooled_mean);
  const dPooledP50 = pctDelta(bC.wall_ms_pooled_p50, cC.wall_ms_pooled_p50);
  const dPooledP95 = pctDelta(bC.wall_ms_pooled_p95, cC.wall_ms_pooled_p95);
  const dMedianMeans = pctDelta(bC.wall_ms_median_of_means, cC.wall_ms_median_of_means);
  const dTotalPass = pctDelta(
    bC.wall_ms_total_per_iter_mean,
    cC.wall_ms_total_per_iter_mean,
  );

  lines.push('| Metric | Baseline | Current | Δ | 95 % CI | p (Welch) |');
  lines.push('|--------|---------:|--------:|--:|---------|----------:|');
  lines.push(
    `| n_experiments               | ${bC.n_experiments} | ${cC.n_experiments} | — | — | — |`,
  );
  lines.push(
    `| total_samples               | ${bC.total_samples} | ${cC.total_samples} | — | — | — |`,
  );
  lines.push(
    `| pooled wall_ms **mean**     | ${fmtMs(bC.wall_ms_pooled_mean)} | ${fmtMs(cC.wall_ms_pooled_mean)} | ${fmtPct(dPooledMean)} | ${fmtCI(corpusCI.lo, corpusCI.hi)} | ${fmtPValue(corpusWelch.pTwoTailed)} |`,
  );
  lines.push(
    `| pooled wall_ms p50          | ${fmtMs(bC.wall_ms_pooled_p50)} | ${fmtMs(cC.wall_ms_pooled_p50)} | ${fmtPct(dPooledP50)} | (point estimate) | (—) |`,
  );
  lines.push(
    `| pooled wall_ms p95          | ${fmtMs(bC.wall_ms_pooled_p95)} | ${fmtMs(cC.wall_ms_pooled_p95)} | ${fmtPct(dPooledP95)} | (point estimate) | (—) |`,
  );
  lines.push(
    `| median of per-exp means     | ${fmtMs(bC.wall_ms_median_of_means)} | ${fmtMs(cC.wall_ms_median_of_means)} | ${fmtPct(dMedianMeans)} | (point estimate) | (—) |`,
  );
  lines.push(
    `| total wall_ms per full pass | ${fmtMs(bC.wall_ms_total_per_iter_mean)} | ${fmtMs(cC.wall_ms_total_per_iter_mean)} | ${fmtPct(dTotalPass)} | (sum of per-exp means) | (—) |`,
  );

  // ── Significance tally ──
  lines.push('');
  lines.push('## Per-experiment verdict tally');
  lines.push('');
  lines.push('| Verdict | Count | Threshold |');
  lines.push('|---------|------:|-----------|');
  lines.push(`| **wins** (current faster) | ${wins} | \\|Δmean\\| ≥ 2 % **and** p < 0.05 |`);
  lines.push(`| **regressions** (current slower) | ${regressions} | \\|Δmean\\| ≥ 2 % **and** p < 0.05 |`);
  lines.push(`| noise / indistinguishable | ${noise} | otherwise |`);
  if (missingRows.length > 0) {
    lines.push(`| missing | ${missingRows.length} | not in baseline |`);
  }
  lines.push(
    `| **★ Bonferroni-survivors** | ${bonfHits} | p < ${bonfAlpha.toExponential(2)} (α = 0.05 / ${bonfN}) |`,
  );

  // ── Headline corpus verdict ──
  lines.push('');
  lines.push('## Headline corpus verdict');
  lines.push('');
  const corpusVerdict = classifyDeltaSig(dPooledMean, corpusWelch.pTwoTailed, {
    magnitudeFloor: 2,
    alpha: 0.05,
  });
  if (corpusVerdict === 'win') {
    lines.push(
      `> ✅ **Current is significantly faster.**  Pooled mean Δ = ${fmtPct(dPooledMean)} ` +
        `(95 % CI ${fmtCI(corpusCI.lo, corpusCI.hi)}, p ${fmtPValue(corpusWelch.pTwoTailed)}).`,
    );
  } else if (corpusVerdict === 'regression') {
    lines.push(
      `> ❌ **Current is significantly slower.**  Pooled mean Δ = ${fmtPct(dPooledMean)} ` +
        `(95 % CI ${fmtCI(corpusCI.lo, corpusCI.hi)}, p ${fmtPValue(corpusWelch.pTwoTailed)}).`,
    );
  } else {
    lines.push(
      `> ⚪ **Inconclusive.**  Pooled mean Δ = ${fmtPct(dPooledMean)} ` +
        `(95 % CI ${fmtCI(corpusCI.lo, corpusCI.hi)}, p ${fmtPValue(corpusWelch.pTwoTailed)}).`,
    );
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
    bootstrapResamples: args.bootstrapResamples,
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
