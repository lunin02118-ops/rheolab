#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);

function getArgValue(flag) {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);

  const index = args.indexOf(flag);
  if (index >= 0 && index < args.length - 1) {
    const value = args[index + 1];
    if (!value.startsWith('--')) return value;
  }

  return null;
}

const outDir = path.resolve(
  repoRoot,
  getArgValue('--out-dir') || path.join('runtime', 'audit', 'gitleaks-gate'),
);
const configPath = path.join(repoRoot, '.gitleaks.toml');
const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rheolab-gitleaks-'));
const snapshotDir = path.join(snapshotRoot, 'head-source-snapshot');
const snapshotArchive = path.join(snapshotRoot, 'head-source-snapshot.tar');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}

function runCaptured(name, command, commandArgs, reportPath) {
  const result = run(command, commandArgs, { capture: true });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const logPath = path.join(outDir, `${name}.log`);
  fs.writeFileSync(logPath, output);

  if (output.trim()) {
    console.log(output.trim());
  }

  return {
    name,
    exitCode: result.status || 0,
    report: path.relative(repoRoot, reportPath).replace(/\\/g, '/'),
    log: path.relative(repoRoot, logPath).replace(/\\/g, '/'),
  };
}

function ensureGitleaks() {
  const probe = run('gitleaks', ['version'], { capture: true });
  if (probe.status !== 0) {
    console.error('[gitleaks] gitleaks executable is not available on PATH');
    process.exit(probe.status || 1);
  }
}

function createHeadSnapshot() {
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.rmSync(snapshotArchive, { force: true });
  ensureDir(snapshotDir);

  const archive = run('git', ['archive', '--format=tar', '-o', snapshotArchive, 'HEAD'], { capture: true });
  if (archive.status !== 0) {
    console.error(`${archive.stdout || ''}${archive.stderr || ''}`.trim());
    process.exit(archive.status || 1);
  }

  const extract = run('tar', ['-xf', snapshotArchive, '-C', snapshotDir], { capture: true });
  if (extract.status !== 0) {
    console.error(`${extract.stdout || ''}${extract.stderr || ''}`.trim());
    process.exit(extract.status || 1);
  }
}

function main() {
  try {
    ensureDir(outDir);
    ensureGitleaks();
    createHeadSnapshot();

    const sourceReport = path.join(outDir, 'gitleaks-head-source-dir.json');
    const historyReport = path.join(outDir, 'gitleaks-git-history.json');

    const source = runCaptured('gitleaks-head-source-dir', 'gitleaks', [
      'dir',
      snapshotDir,
      '--config',
      configPath,
      '--report-format',
      'json',
      '--report-path',
      sourceReport,
      '--redact',
      '--no-banner',
      '--no-color',
    ], sourceReport);

    const history = runCaptured('gitleaks-git-history', 'gitleaks', [
      'git',
      repoRoot,
      '--config',
      configPath,
      '--report-format',
      'json',
      '--report-path',
      historyReport,
      '--redact',
      '--no-banner',
      '--no-color',
    ], historyReport);

    const summary = [source, history];
    fs.writeFileSync(path.join(outDir, 'gitleaks-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

    process.exit(source.exitCode || history.exitCode);
  } finally {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
  }
}

main();
