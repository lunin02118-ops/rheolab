#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const rawArgs = process.argv.slice(2);
const separatorIndex = rawArgs.indexOf('--');
const optionArgs = separatorIndex >= 0 ? rawArgs.slice(0, separatorIndex) : rawArgs;
const commandArgs = separatorIndex >= 0 ? rawArgs.slice(separatorIndex + 1) : [];

let intervalMs = 5000;
let timeoutMs = 30 * 60 * 1000;

for (const arg of optionArgs) {
  if (arg.startsWith('--interval-ms=')) {
    intervalMs = Number(arg.split('=')[1]) || intervalMs;
  } else if (arg.startsWith('--timeout-ms=')) {
    timeoutMs = Number(arg.split('=')[1]) || timeoutMs;
  }
}

const defaultCommand = [process.execPath, 'scripts/dev/run-tauri-cli.js', 'build', '--debug'];
const effectiveCommand = commandArgs.length > 0 ? commandArgs : defaultCommand;

if (effectiveCommand.length === 0) {
  console.error('[build-audit] no command specified');
  process.exit(1);
}

const logsDir = path.join(repoRoot, 'runtime', 'audit');
fs.mkdirSync(logsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const mainLogPath = path.join(logsDir, `build-audit-${stamp}.log`);
const procLogPath = path.join(logsDir, `build-audit-${stamp}.processes.log`);
const keywordPattern = /\b(tauri|cargo|rustc|node|npm|next|prisma|makensis|rheolab)\b/i;

function writeLine(filePath, line) {
  fs.appendFileSync(filePath, `${line}\n`);
}

function logMain(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  writeLine(mainLogPath, line);
}

function logProc(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  writeLine(procLogPath, line);
}

function hasCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'ignore',
    shell: false,
  });
  return !result.error;
}

function snapshotLinuxProcesses() {
  const result = spawnSync('ps', ['-eo', 'pid,ppid,%cpu,%mem,etime,cmd'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });

  if (result.error || result.status !== 0) {
    return;
  }

  const lines = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => keywordPattern.test(line))
    .filter((line) => !line.includes('run-build-audit.js'));

  if (lines.length === 0) {
    return;
  }

  logProc('--- linux process snapshot ---');
  for (const line of lines) {
    logProc(line);
  }
}

function snapshotWindowsProcesses() {
  if (!hasCommand('cmd.exe', ['/c', 'ver'])) {
    return;
  }

  const result = spawnSync('cmd.exe', ['/c', 'tasklist /FO CSV /NH'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });

  if (result.error || result.status !== 0) {
    return;
  }

  const lines = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => keywordPattern.test(line));

  if (lines.length === 0) {
    return;
  }

  logProc('--- windows process snapshot ---');
  for (const line of lines) {
    logProc(line);
  }
}

function runProcessSnapshot() {
  logProc('===== process snapshot =====');
  snapshotLinuxProcesses();
  snapshotWindowsProcesses();
}

function forwardStream(stream, label, sink) {
  let buffered = '';

  stream.on('data', (chunk) => {
    const text = chunk.toString();
    sink.write(text);
    buffered += text;

    let newlineIndex = buffered.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffered.slice(0, newlineIndex).replace(/\r$/, '');
      logMain(`[${label}] ${line}`);
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf('\n');
    }
  });

  stream.on('end', () => {
    if (buffered.length > 0) {
      logMain(`[${label}] ${buffered.replace(/\r$/, '')}`);
      buffered = '';
    }
  });
}

const command = effectiveCommand[0];
const commandParams = effectiveCommand.slice(1);

console.log(`[build-audit] log: ${path.relative(repoRoot, mainLogPath).replace(/\\/g, '/')}`);
console.log(`[build-audit] processes: ${path.relative(repoRoot, procLogPath).replace(/\\/g, '/')}`);
console.log(`[build-audit] command: ${effectiveCommand.join(' ')}`);

logMain(`command: ${effectiveCommand.join(' ')}`);
logMain(`cwd: ${repoRoot}`);
logMain(`intervalMs=${intervalMs} timeoutMs=${timeoutMs}`);

const child = spawn(command, commandParams, {
  cwd: repoRoot,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
});

const startedAt = Date.now();
let timedOut = false;
let snapshotBusy = false;

const snapshotTimer = setInterval(() => {
  if (snapshotBusy) {
    return;
  }
  snapshotBusy = true;
  try {
    runProcessSnapshot();
  } finally {
    snapshotBusy = false;
  }
}, intervalMs);

runProcessSnapshot();

const timeoutTimer = setTimeout(() => {
  timedOut = true;
  logMain(`timeout reached after ${timeoutMs}ms, terminating child`);
  logProc(`timeout reached after ${timeoutMs}ms, terminating child`);
  child.kill('SIGTERM');
}, timeoutMs);

if (child.stdout) {
  forwardStream(child.stdout, 'stdout', process.stdout);
}
if (child.stderr) {
  forwardStream(child.stderr, 'stderr', process.stderr);
}

child.on('error', (error) => {
  clearInterval(snapshotTimer);
  clearTimeout(timeoutTimer);
  logMain(`failed to start child process: ${error.message}`);
  console.error(`[build-audit] failed to start command: ${error.message}`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  clearInterval(snapshotTimer);
  clearTimeout(timeoutTimer);

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  logMain(`child closed: code=${code ?? 'null'} signal=${signal ?? 'null'} elapsed=${elapsedSec}s`);
  runProcessSnapshot();

  if (timedOut) {
    console.error('[build-audit] timeout exceeded');
    process.exit(124);
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
