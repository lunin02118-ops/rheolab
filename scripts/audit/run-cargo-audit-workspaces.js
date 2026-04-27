#!/usr/bin/env node

const fs = require('node:fs');
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
  getArgValue('--out-dir') || path.join('runtime', 'audit', 'cargo-audit-gate'),
);

const targets = [
  { name: 'src-tauri', dir: path.join(repoRoot, 'src-tauri') },
  { name: 'rheolab-core', dir: path.join(repoRoot, 'src', 'rust', 'rheolab-core') },
  { name: 'fixture-seed', dir: path.join(repoRoot, 'tools', 'fixture_seed') },
];

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

function ensureCargoAudit() {
  const probe = run('cargo', ['audit', '--version'], { capture: true });
  if (probe.status === 0) return;

  console.log('[cargo-audit] cargo-audit not found; installing with `cargo install cargo-audit --locked`...');
  const install = run('cargo', ['install', 'cargo-audit', '--locked']);
  if (install.status !== 0) {
    process.exit(install.status || 1);
  }
}

function runAudit(target, format, outputPath) {
  const cargoLock = path.join(target.dir, 'Cargo.lock');
  if (!fs.existsSync(cargoLock)) {
    console.error(`[cargo-audit] missing Cargo.lock for ${target.name}: ${cargoLock}`);
    return 1;
  }

  const args = ['audit'];
  if (format === 'json') {
    args.push('--json');
  }

  const result = run('cargo', args, { cwd: target.dir, capture: true });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  fs.writeFileSync(outputPath, output);

  if (output.trim()) {
    console.log(output.trim());
  }

  return result.status || 0;
}

function main() {
  ensureDir(outDir);
  ensureCargoAudit();

  const summary = [];
  let exitCode = 0;

  for (const target of targets) {
    console.log(`[cargo-audit] ${target.name}`);
    const safeName = target.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    const textPath = path.join(outDir, `cargo-audit-${safeName}.txt`);
    const jsonPath = path.join(outDir, `cargo-audit-${safeName}.json`);

    const textExit = runAudit(target, 'text', textPath);
    const jsonExit = runAudit(target, 'json', jsonPath);
    const targetExit = textExit || jsonExit;
    if (targetExit !== 0) exitCode = targetExit;

    summary.push({
      name: target.name,
      dir: path.relative(repoRoot, target.dir).replace(/\\/g, '/'),
      textExit,
      jsonExit,
      text: path.relative(repoRoot, textPath).replace(/\\/g, '/'),
      json: path.relative(repoRoot, jsonPath).replace(/\\/g, '/'),
    });
  }

  fs.writeFileSync(path.join(outDir, 'cargo-audit-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.exit(exitCode);
}

main();
