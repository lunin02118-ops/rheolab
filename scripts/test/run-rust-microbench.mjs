#!/usr/bin/env node
/**
 * Sprint 1 / S1-1 + S1-2 — orchestrator for native Rust microbenches.
 *
 * Runs one of the cargo examples built into
 * `src-tauri/target/release/examples/` across a configurable sweep of
 * fixture sizes and writes the per-fixture JSON sidecars + an
 * aggregated index file to `outputs/perf/microbench/`.
 *
 * Supported targets (`--target`):
 *   - `pdf`       (default) — `bench_comparison_pdf`, S1-1
 *   - `analysis`            — `bench_analysis_pipeline`, S1-2
 *
 * Both targets share the same JSON sidecar shape (n_experiments,
 * duration_hours, total_points, iterations, wall_ms{p50,p95,...},
 * samples) and only differ in the `schema` slug — so compare mode is
 * target-agnostic and just refuses to mix sweeps from different
 * targets.
 *
 * Two modes:
 *   1. **Sweep mode** (default) — runs every fixture in `--fixtures`
 *      with `--iterations` reps each, dumps one JSON per fixture, and
 *      writes a `microbench-sweep-<target>-<label>-<ts>.json` index.
 *   2. **Compare mode** — given two existing sweep indexes via
 *      `--compare WITH NO`, computes per-fixture deltas and renders a
 *      Markdown report (stdout, plus optionally `--output PATH`).
 *
 * Usage:
 *   node scripts/test/run-rust-microbench.mjs --target pdf      # PDF sweep (default)
 *   node scripts/test/run-rust-microbench.mjs --target analysis # analysis sweep
 *   node scripts/test/run-rust-microbench.mjs --target pdf --label WITH-P10
 *   node scripts/test/run-rust-microbench.mjs --compare \
 *     outputs/perf/microbench/microbench-sweep-pdf-WITH-P10-1234.json \
 *     outputs/perf/microbench/microbench-sweep-pdf-NO-P10-1235.json \
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
const OUT_DIR = join(ROOT, 'outputs', 'perf', 'microbench');

/**
 * Target registry.  Each target points at a cargo example binary +
 * the schema slug its JSON sidecar advertises.  Keep keys lowercase;
 * they appear verbatim in CLI args, npm scripts, and JSON filenames.
 */
const TARGETS = {
    pdf: {
        binary: 'bench_comparison_pdf',
        schema: 'rheolab.microbench.pdf_comparison.v1',
        sweepSchema: 'rheolab.microbench.pdf_comparison.sweep.v1',
        defaultFixtures: [
            { n: 3, durationHours: 4 },
            { n: 5, durationHours: 4 },
            { n: 10, durationHours: 4 },
        ],
        humanName: 'comparison PDF',
    },
    analysis: {
        binary: 'bench_analysis_pipeline',
        schema: 'rheolab.microbench.analysis_pipeline.v1',
        sweepSchema: 'rheolab.microbench.analysis_pipeline.sweep.v1',
        defaultFixtures: [
            { n: 1, durationHours: 4 },
            { n: 1, durationHours: 12 },
            { n: 5, durationHours: 4 },
        ],
        humanName: 'analysis pipeline',
    },
};

function binaryPath(target) {
    const t = TARGETS[target];
    if (!t) {
        throw new Error(`unknown target: ${target} (expected: ${Object.keys(TARGETS).join(', ')})`);
    }
    return join(
        ROOT,
        'src-tauri',
        'target',
        'release',
        'examples',
        process.platform === 'win32' ? `${t.binary}.exe` : t.binary,
    );
}

// ── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const out = {
        target: 'pdf',
        fixtures: null,           // will be filled from TARGETS[target].defaultFixtures if not set
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
            case '--target':
                out.target = next();
                if (!TARGETS[out.target]) {
                    console.error(`unknown target '${out.target}' (expected: ${Object.keys(TARGETS).join(', ')})`);
                    process.exit(2);
                }
                break;
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
    if (out.fixtures === null) {
        out.fixtures = TARGETS[out.target].defaultFixtures;
    }
    return out;
}

function printHelp() {
    console.log(`Usage: node scripts/test/run-rust-microbench.mjs [OPTIONS]

Targets:
  --target NAME         pdf | analysis (default: pdf)
                        pdf      → bench_comparison_pdf       (S1-1)
                        analysis → bench_analysis_pipeline    (S1-2)

Sweep mode (default):
  --fixtures LIST       Comma-separated fixtures, e.g. "3,5,10" or "3x4,5x4,10x8"
                        (per-target defaults — see TARGETS table)
  --iterations N        Iterations per fixture (default: 5)
  --label TEXT          Tag written into each JSON sidecar (e.g. "WITH-P10")

Compare mode:
  --compare WITH NO     Diff two sweep index files; print a Markdown delta report.
                        Both indexes must come from the same target — cross-target
                        comparison is rejected (different fixtures, different schema).
  --output PATH         (compare mode) Write the Markdown report to PATH instead of stdout

  -h, --help            Show this help`);
}

// ── Sweep mode ──────────────────────────────────────────────────────────────

function runFixture(target, { n, durationHours }, iterations, label, ts) {
    const exe = binaryPath(target);
    const t = TARGETS[target];
    if (!existsSync(exe)) {
        throw new Error(
            `Example binary not found: ${exe}\n` +
            `Build it with: cargo build --release --example ${t.binary} --manifest-path src-tauri/Cargo.toml`,
        );
    }

    const sidecar = join(OUT_DIR, `microbench-${target}-n${n}-h${durationHours}-${ts}.json`);
    const args = [
        '--n', String(n),
        '--iterations', String(iterations),
        '--duration-hours', String(durationHours),
        '--json', sidecar,
    ];
    if (label) {
        args.push('--label', label);
    }

    process.stderr.write(`[microbench:${target}] n=${n} duration=${durationHours}h iters=${iterations}${label ? ` label=${label}` : ''}\n`);
    const t0 = Date.now();
    const proc = spawnSync(exe, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    const wallSec = ((Date.now() - t0) / 1000).toFixed(1);
    if (proc.status !== 0) {
        throw new Error(`${t.binary} exited with code ${proc.status} (n=${n})`);
    }
    process.stderr.write(`[microbench:${target}] n=${n} done in ${wallSec}s — wrote ${sidecar}\n`);

    const doc = JSON.parse(readFileSync(sidecar, 'utf8'));
    if (doc.schema !== t.schema) {
        throw new Error(
            `unexpected schema in ${sidecar}: got '${doc.schema}', expected '${t.schema}' (binary version mismatch?)`,
        );
    }
    return doc;
}

function runSweep(opts) {
    mkdirSync(OUT_DIR, { recursive: true });
    const ts = Date.now();
    const labelSlug = opts.label ? opts.label.replace(/[^a-zA-Z0-9._-]/g, '_') : 'unlabeled';
    const target = opts.target;
    const targetDef = TARGETS[target];

    const results = opts.fixtures.map((fx) => runFixture(target, fx, opts.iterations, opts.label, ts));

    const indexPath = join(OUT_DIR, `microbench-sweep-${target}-${labelSlug}-${ts}.json`);
    const indexDoc = {
        schema: targetDef.sweepSchema,
        target,
        label: opts.label,
        timestamp: new Date(ts).toISOString(),
        platform: process.platform,
        node_version: process.version,
        fixtures: opts.fixtures,
        iterations_per_fixture: opts.iterations,
        results,
    };
    writeFileSync(indexPath, JSON.stringify(indexDoc, null, 2), 'utf8');
    process.stderr.write(`[microbench:${target}] sweep complete — index: ${indexPath}\n`);

    // Compact stdout summary so a CI log can copy-paste it.  We pick
    // a target-appropriate trailing metric column: bytes for PDF,
    // detected cycles for analysis.
    const trailing = target === 'pdf'
        ? { header: 'pdf_bytes mean', value: (r) => r.pdf_bytes_mean.toFixed(0) }
        : { header: 'cycles/trace ', value: (r) => String(r.cycles_per_trace ?? '—') };
    console.log('');
    console.log(`# microbench:${target} sweep — ${opts.label ?? '(unlabeled)'} (${targetDef.humanName})`);
    console.log('');
    console.log(`| n | total_points | iterations | wall_ms p50 | wall_ms p95 | wall_ms mean | ${trailing.header} |`);
    console.log('|--:|-------------:|-----------:|------------:|------------:|-------------:|--------------:|');
    for (const r of results) {
        console.log(
            `| ${r.n_experiments} | ${r.total_points} | ${r.iterations} | ${r.wall_ms.p50.toFixed(1)} | ${r.wall_ms.p95.toFixed(1)} | ${r.wall_ms.mean.toFixed(1)} | ${trailing.value(r)} |`,
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
    const supportedSchemas = Object.values(TARGETS).map((t) => t.sweepSchema);
    if (!supportedSchemas.includes(doc.schema)) {
        throw new Error(
            `unexpected schema in ${path}: '${doc.schema}'\n` +
            `expected one of: ${supportedSchemas.join(', ')}`,
        );
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

    if (withDoc.schema !== noDoc.schema) {
        throw new Error(
            `cannot compare across targets: WITH-P10 schema='${withDoc.schema}', NO-P10 schema='${noDoc.schema}' — both must come from the same --target`,
        );
    }
    const target = withDoc.target ?? '(unknown)';
    const targetHuman = (TARGETS[target] && TARGETS[target].humanName) ?? target;

    // Match fixtures by (n, durationHours) — same shape only.
    const fixtureKey = (r) => `${r.n_experiments}x${r.duration_hours}`;
    const noByKey = new Map(noDoc.results.map((r) => [fixtureKey(r), r]));

    let md = '';
    md += `# P10 Validation Report — ${targetHuman} microbench delta\n\n`;
    md += `**Target:** \`${target}\` (${targetHuman})  \n`;
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
