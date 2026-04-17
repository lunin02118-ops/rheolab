#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const pythonScript = path.join(repoRoot, 'scripts', 'test', 'run-memory-perf-report.py');
const passthroughArgs = process.argv.slice(2);

const candidates = [
  ['python3'],
  ['python'],
  ['py', '-3'],
];

function canRun(candidate) {
  const probe = spawnSync(candidate[0], [...candidate.slice(1), '--version'], {
    cwd: repoRoot,
    stdio: 'ignore',
    shell: false,
  });
  return !probe.error && probe.status === 0;
}

const selected = candidates.find(canRun);
if (!selected) {
  console.error('[memory-perf] Python runtime not found (python3/python/py -3).');
  process.exit(1);
}

const args = [...selected.slice(1), pythonScript, ...passthroughArgs];
const result = spawnSync(selected[0], args, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: false,
  env: process.env,
});

if (result.error) {
  console.error(`[memory-perf] failed to execute: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
