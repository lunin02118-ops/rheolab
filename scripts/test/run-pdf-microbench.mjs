#!/usr/bin/env node
/**
 * Sprint 1 / S1-1 — orchestrator for the comparison-PDF microbench.
 *
 * Runs `bench_comparison_pdf` (the cargo example built into
 * `src-tauri/target/release/examples/`) across a configurable sweep of
 * fixture sizes and writes the per-fixture JSON sidecars + an
 * aggregated index file to `outputs/perf/microbench/`.
 *
 * Two modes:
 *   1. **Sweep mode** (default) — runs every fixture in `--fixtures`
 *      with `--iterations` reps each, dumps one JSON per fixture, and
 *      writes a `microbench-sweep-<label>-<ts>.json` index.
 *   2. **Compare mode** — given two existing sweep indexes via
 *      `--compare WITH NO`, computes per-fixture deltas and renders a
 *      Markdown report (stdout, plus optionally `--output PATH`).
 *
 * Usage:
 *   node scripts/test/run-pdf-microbench.mjs               # default sweep
 *   node scripts/test/run-pdf-microbench.mjs --label NO-P10
 *   node scripts/test/run-pdf-microbench.mjs --compare \
 *     outputs/perf/microbench/microbench-sweep-WITH-P10-1234.json \
 *     outputs/perf/microbench/microbench-sweep-NO-P10-1235.json \
 *     --output docs/performance/P10-VALIDATION-REPORT.md
 *
 * Why a JS orchestrator and not a shell script: keeps Windows / macOS
 * symmetry, makes JSON aggregation typed and robust, and lets us
 * print a coloured terminal summary in a future iteration without
 * fighting PowerShell quoting.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLE_BIN = join(
    ROOT,
    'src-tauri',
    'target',
    'release',
    'examples',
    process.platform === 'win32' ? 'bench_comparison_pdf.exe' : 'bench_comparison_pdf',
);
const OUT_DIR = join(ROOT, 'outputs', 'perf', 'microbench');

// ── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const out = {
        fixtures: [
            { n: 3,  durationHours: 4 },
            { n: 5,  durationHours: 4 },
            { n: 10, durationHours: 4 },
        ],
        iterations: 5,
        label: null,
        outputReport: null,
        compare: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) {
                console.error(`${a} requires a value`);
                process.exit(2);
            }
            return argv[++i];
        };
        switch (a) {
            case '--iterations':
                out.iterations = parseInt(next(), 10);
                break;
            case '--label':
                out.label = next();
                break;
            case '--fixtures':
                out.fixtures = next()
                    .split(',')
                    .map((spec) => {
                        // spec format: "<n>" or "<n>x<hours>"  (hours optional)
                        const [nStr, hStr] = spec.trim().split('x');
                        const n = parseInt(nStr, 10);
                        const durationHours = hStr ? parseFloat(hStr) : 4;
                        if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(durationHours) || durationHours <= 0) {
                            console.error(`bad fixture spec: ${spec}`);
                            process.exit(2);
                        }
                        return { n, durationHours };
                    });
                break;
            case '--output':
                out.outputReport = resolve(next());
                break;
            case '--compare':
                out.compare = { with: resolve(next()), no: resolve(next()) };
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
            // eslint-disable-next-line no-fallthrough
            default:
                console.error(`unknown argument: ${a}`);
                printHelp();
                process.exit(2);
        }
    }
    return out;
}

function printHelp() {
    console.log(`Usage: node scripts/test/run-pdf-microbench.mjs [OPTIONS]

Sweep mode (default):
  --fixtures LIST       Comma-separated fixtures, e.g. "3,5,10" or "3x4,5x4,10x8"
                        (default: "3x4,5x4,10x4" — n experiments x duration hours)
  --iterations N        Iterations per fixture (default: 5)
  --label TEXT          Tag written into each JSON sidecar (e.g. "WITH-P10")

Compare mode:
  --compare WITH NO     Diff two sweep index files; print a Markdown delta report
  --output PATH         (compare mode) Write the Markdown report to PATH instead of stdout

  -h, --help            Show this help`);
}

// ── Sweep mode ──────────────────────────────────────────────────────────────

function runFixture({ n, durationHours }, iterations, label, ts) {
    if (!existsSync(EXAMPLE_BIN)) {
        throw new Error(
            `Example binary not found: ${EXAMPLE_BIN}\n` +
            `Build it with: cargo build --release --example bench_comparison_pdf --manifest-path src-tauri/Cargo.toml`,
        );
    }

    const sidecar = join(OUT_DIR, `microbench-pdf-n${n}-${ts}.json`);
    const args = [
        '--n', String(n),
        '--iterations', String(iterations),
        '--duration-hours', String(durationHours),
        '--json', sidecar,
    ];
    if (label) {
        args.push('--label', label);
    }

    process.stderr.write(`[microbench] n=${n} duration=${durationHours}h iters=${iterations}${label ? ` label=${label}` : ''}\n`);
    const t0 = Date.now();
    const proc = spawnSync(EXAMPLE_BIN, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    const wallSec = ((Date.now() - t0) / 1000).toFixed(1);
    if (proc.status !== 0) {
        throw new Error(`bench_comparison_pdf exited with code ${proc.status} (n=${n})`);
    }
    process.stderr.write(`[microbench] n=${n} done in ${wallSec}s — wrote ${sidecar}\n`);

    return JSON.parse(readFileSync(sidecar, 'utf8'));
}

function runSweep(opts) {
    mkdirSync(OUT_DIR, { recursive: true });
    const ts = Date.now();
    const labelSlug = opts.label ? opts.label.replace(/[^a-zA-Z0-9._-]/g, '_') : 'unlabeled';

    const results = opts.fixtures.map((fx) => runFixture(fx, opts.iterations, opts.label, ts));

    const indexPath = join(OUT_DIR, `microbench-sweep-${labelSlug}-${ts}.json`);
    const indexDoc = {
        schema: 'rheolab.microbench.pdf_comparison.sweep.v1',
        label: opts.label,
        timestamp: new Date(ts).toISOString(),
        platform: process.platform,
        node_version: process.version,
        fixtures: opts.fixtures,
        iterations_per_fixture: opts.iterations,
        results,
    };
    writeFileSync(indexPath, JSON.stringify(indexDoc, null, 2), 'utf8');
    process.stderr.write(`[microbench] sweep complete — index: ${indexPath}\n`);

    // Compact stdout summary so a CI log can copy-paste it.
    console.log('');
    console.log(`# microbench sweep — ${opts.label ?? '(unlabeled)'}`);
    console.log('');
    console.log('| n_experiments | total_points | iterations | wall_ms p50 | wall_ms p95 | wall_ms mean | pdf_bytes mean |');
    console.log('|--------------:|-------------:|-----------:|------------:|------------:|-------------:|---------------:|');
    for (const r of results) {
        console.log(
            `| ${r.n_experiments} | ${r.total_points} | ${r.iterations} | ${r.wall_ms.p50.toFixed(1)} | ${r.wall_ms.p95.toFixed(1)} | ${r.wall_ms.mean.toFixed(1)} | ${r.pdf_bytes_mean.toFixed(0)} |`,
        );
    }
    console.log('');
    console.log(`Index file: \`${indexPath}\``);
    return indexPath;
}

// ── Compare mode ────────────────────────────────────────────────────────────

function loadSweep(path) {
    if (!existsSync(path)) {
        throw new Error(`sweep index not found: ${path}`);
    }
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (doc.schema !== 'rheolab.microbench.pdf_comparison.sweep.v1') {
        throw new Error(`unexpected schema in ${path}: ${doc.schema}`);
    }
    return doc;
}

function pct(delta, base) {
    if (base === 0) return 0;
    return ((delta / base) * 100);
}

/**
 * Format a delta line.  We put the "fast direction" (smaller wall_ms,
 * larger pdf_bytes is neutral) into emoji-free signs so the report
 * stays grep-friendly.
 */
function fmtDelta(withV, noV, lowerIsBetter = true) {
    const delta = withV - noV;
    const p = pct(delta, noV);
    const sign = delta > 0 ? '+' : '';
    const verdict = lowerIsBetter
        ? (delta < 0 ? 'faster' : delta > 0 ? 'slower' : 'equal')
        : (delta > 0 ? 'larger' : delta < 0 ? 'smaller' : 'equal');
    return `${sign}${delta.toFixed(1)} (${sign}${p.toFixed(1)}%, ${verdict})`;
}

function runCompare(opts) {
    const withDoc = loadSweep(opts.compare.with);
    const noDoc = loadSweep(opts.compare.no);

    // Match fixtures by (n, durationHours) — same shape only.
    const fixtureKey = (r) => `${r.n_experiments}x${r.duration_hours}`;
    const noByKey = new Map(noDoc.results.map((r) => [fixtureKey(r), r]));

    let md = '';
    md += '# P10 Validation Report — comparison-PDF microbench delta\n\n';
    md += `**WITH-P10 sweep:** \`${opts.compare.with}\`  \n`;
    md += `**NO-P10 sweep:** \`${opts.compare.no}\`  \n`;
    md += `**WITH-P10 timestamp:** ${withDoc.timestamp}  \n`;
    md += `**NO-P10 timestamp:** ${noDoc.timestamp}  \n`;
    md += `**WITH-P10 label:** ${withDoc.label ?? '(none)'}  \n`;
    md += `**NO-P10 label:** ${noDoc.label ?? '(none)'}  \n\n`;

    md += '## Per-fixture delta\n\n';
    md += '| Fixture | iterations | WITH-P10 p50 ms | NO-P10 p50 ms | Δ p50 | WITH-P10 p95 ms | NO-P10 p95 ms | Δ p95 |\n';
    md += '|---|---:|---:|---:|---|---:|---:|---|\n';
    let unmatched = 0;
    for (const w of withDoc.results) {
        const k = fixtureKey(w);
        const n = noByKey.get(k);
        if (!n) {
            md += `| ${k} | ${w.iterations} | ${w.wall_ms.p50.toFixed(1)} | (no NO-P10 sample) | — | ${w.wall_ms.p95.toFixed(1)} | — | — |\n`;
            unmatched++;
            continue;
        }
        md += `| ${k} | ${w.iterations} | ${w.wall_ms.p50.toFixed(1)} | ${n.wall_ms.p50.toFixed(1)} | ${fmtDelta(w.wall_ms.p50, n.wall_ms.p50)} | ${w.wall_ms.p95.toFixed(1)} | ${n.wall_ms.p95.toFixed(1)} | ${fmtDelta(w.wall_ms.p95, n.wall_ms.p95)} |\n`;
    }
    if (unmatched > 0) {
        md += `\n> ⚠ ${unmatched} WITH-P10 fixture(s) had no matching NO-P10 entry — sweep shapes differ.\n`;
    }

    md += '\n## Summary\n\n';
    const matched = withDoc.results.filter((w) => noByKey.has(fixtureKey(w)));
    if (matched.length === 0) {
        md += '> No matched fixtures — cannot summarise.\n';
    } else {
        const p50DeltasPct = matched.map((w) => {
            const n = noByKey.get(fixtureKey(w));
            return pct(w.wall_ms.p50 - n.wall_ms.p50, n.wall_ms.p50);
        });
        const p95DeltasPct = matched.map((w) => {
            const n = noByKey.get(fixtureKey(w));
            return pct(w.wall_ms.p95 - n.wall_ms.p95, n.wall_ms.p95);
        });
        const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
        md += `- Mean p50 delta across ${matched.length} matched fixtures: **${avg(p50DeltasPct).toFixed(1)}%**\n`;
        md += `- Mean p95 delta across ${matched.length} matched fixtures: **${avg(p95DeltasPct).toFixed(1)}%**\n`;
        md += `- Negative % means WITH-P10 is **faster** (the goal).\n`;
    }

    md += '\n## Iteration spread (raw samples, ms)\n\n';
    for (const w of withDoc.results) {
        const k = fixtureKey(w);
        const n = noByKey.get(k);
        md += `### ${k}\n\n`;
        md += `WITH-P10: ${w.samples.map((s) => s.wall_ms.toFixed(1)).join(', ')} ms\n\n`;
        if (n) {
            md += `NO-P10:   ${n.samples.map((s) => s.wall_ms.toFixed(1)).join(', ')} ms\n\n`;
        } else {
            md += '_NO-P10: missing_\n\n';
        }
    }

    if (opts.outputReport) {
        mkdirSync(dirname(opts.outputReport), { recursive: true });
        writeFileSync(opts.outputReport, md, 'utf8');
        process.stderr.write(`[microbench] wrote report to ${opts.outputReport}\n`);
    } else {
        process.stdout.write(md);
    }
}

// ── Entry point ─────────────────────────────────────────────────────────────

function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.compare) {
        runCompare(opts);
    } else {
        runSweep(opts);
    }
}

try {
    main();
} catch (err) {
    console.error(`[microbench] error: ${err.message}`);
    process.exit(1);
}
