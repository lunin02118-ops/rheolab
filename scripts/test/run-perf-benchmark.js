#!/usr/bin/env node
/**
 * run-perf-benchmark.js
 *
 * Performance benchmark runner. Does two things:
 *
 *   Mode A — browser benchmarks (default):
 *     Builds the Vite bundle and runs the Playwright perf-benchmark.spec.ts
 *     suite. Results in outputs/e2e/perf/benchmark-*.json.
 *
 *   Mode B — process resource monitor (--process):
 *     Starts poll-process-resources.ps1 to track CPU/RAM of the running
 *     Tauri process for a given duration. No Playwright required.
 *     Use after starting the app with:  npm run tauri:build:debug && <exe>
 *
 *   Mode C — combined (--combined):
 *     Starts process poller in background, then runs Playwright benchmarks.
 *
 * Usage:
 *   node scripts/test/run-perf-benchmark.js
 *   node scripts/test/run-perf-benchmark.js --process --duration 120
 *   node scripts/test/run-perf-benchmark.js --combined --duration 300
 *   npm run perf:benchmark
 *   npm run perf:benchmark -- --process
 *   npm run perf:benchmark -- --process --duration 60
 */

const { spawn, spawnSync } = require('node:child_process');
const path  = require('node:path');
const fs    = require('node:fs');

const repoRoot   = path.resolve(__dirname, '..', '..');
const outputDir  = path.join(repoRoot, 'outputs', 'e2e', 'perf');
const pollerPath = path.join(repoRoot, 'scripts', 'test', 'poll-process-resources.ps1');

// ─── CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const modeProcess  = args.includes('--process');
const modeCombined = args.includes('--combined');
const modeBrowser  = !modeProcess && !modeCombined;

const durationArg  = (() => {
    const idx = args.indexOf('--duration');
    return idx !== -1 ? Number(args[idx + 1]) || 120 : 120;
})();

const runId = Date.now().toString();
fs.mkdirSync(outputDir, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────
function log(msg) { console.log(`[perf-benchmark] ${msg}`); }
function err(msg) { console.error(`[perf-benchmark] ERROR: ${msg}`); }

function findPowerShell() {
    const candidates = ['pwsh', 'powershell'];
    for (const cmd of candidates) {
        const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: false });
        if (!r.error && r.status === 0) return cmd;
    }
    return null;
}

function startProcessPoller(durationSec = 0) {
    const ps = findPowerShell();
    if (!ps) { log('PowerShell not found — process monitoring unavailable'); return null; }

    const csvPath  = path.join(outputDir, `process-resources-${runId}.csv`);
    const jsonPath = path.join(outputDir, `process-resources-${runId}.json`);

    log(`Starting process poller (pid-sampling every 1 s, duration=${durationSec || '∞'} s)`);
    log(`  CSV  → ${csvPath}`);
    log(`  JSON → ${jsonPath}`);

    const pollerArgs = [
        '-ExecutionPolicy', 'Bypass',
        '-File', pollerPath,
        '-PollIntervalMs', '1000',
        '-OutputCsv',  csvPath,
        '-OutputJson', jsonPath,
    ];
    if (durationSec > 0) pollerArgs.push('-DurationSeconds', String(durationSec));

    const proc = spawn(ps, pollerArgs, {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: false,
        windowsHide: false,
    });

    proc.on('error', e => err(`Poller failed: ${e.message}`));
    return proc;
}

function runPlaywrightBenchmark() {
    log('Running Playwright benchmark suite...');
    log('  Config: playwright.benchmark.config.ts');
    log('  Output: outputs/e2e/perf/benchmark-*.json');

    const result = spawnSync(
        'npx',
        ['playwright', 'test', '--config', 'playwright.benchmark.config.ts'],
        {
            cwd:   repoRoot,
            stdio: 'inherit',
            shell: process.platform === 'win32',
            env:   {
                ...process.env,
                RHEOLAB_BENCH_RUN_ID:   runId,
                RHEOLAB_BENCH_NAV_CYCLES: process.env.RHEOLAB_BENCH_NAV_CYCLES || '10',
            },
        },
    );

    if (result.error) { err(`Playwright failed: ${result.error.message}`); return 1; }
    return result.status ?? 0;
}

// ─── Modes ────────────────────────────────────────────────────────────────

async function main() {
    if (modeProcess) {
        // Mode B: only process monitor (blocking until duration elapses or Ctrl+C)
        log('Mode: process resource monitor only');
        log('Make sure Tauri app is already running (npm run tauri:build:debug → launch exe)');
        const poller = startProcessPoller(durationArg);
        if (!poller) { process.exit(1); return; }

        await new Promise(resolve => {
            poller.on('exit', resolve);
            process.on('SIGINT', () => { poller.kill(); resolve(); });
        });

    } else if (modeCombined) {
        // Mode C: start poller + run Playwright, then stop poller
        log('Mode: combined (process monitor + Playwright benchmarks)');
        log(`Process poller will run for ${durationArg} s`);

        const poller = startProcessPoller(durationArg);
        // Give the poller 2 s to start and find the process
        await new Promise(r => setTimeout(r, 2000));

        const exitCode = runPlaywrightBenchmark();

        if (poller && !poller.killed) poller.kill();

        printOutputPaths();
        process.exit(exitCode);

    } else {
        // Mode A: browser benchmarks only
        log('Mode: Playwright benchmark (browser JS heap + timing)');
        const exitCode = runPlaywrightBenchmark();
        printOutputPaths();
        process.exit(exitCode);
    }
}

function printOutputPaths() {
    const files = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.json') && f.includes(runId))
        .map(f => path.join(outputDir, f));

    if (files.length) {
        log('Results:');
        files.forEach(f => log(`  ${f}`));
    } else {
        log(`No result files found in ${outputDir} for runId ${runId}`);
    }
}

main().catch(e => { err(e.message || e); process.exit(1); });
