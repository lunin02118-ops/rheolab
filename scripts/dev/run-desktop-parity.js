#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const rustWorkspace = path.join(repoRoot, 'src', 'rust', 'rheolab-core');
const tauriWorkspaceManifest = path.join(repoRoot, 'src-tauri', 'Cargo.toml');

function runShell(command, cwd = repoRoot) {
  console.log(`\n[desktop-parity] ${command}`);
  const result = spawnSync(command, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  if (result.error) {
    console.error(`[desktop-parity] failed to start command: ${result.error.message}`);
    return false;
  }

  if (result.status !== 0) {
    console.error(`[desktop-parity] command failed with exit code ${result.status}`);
    return false;
  }

  return true;
}

function canRun(command, cwd = repoRoot) {
  const result = spawnSync(command, {
    cwd,
    stdio: 'ignore',
    shell: true,
    env: process.env,
  });
  return !result.error && result.status === 0;
}

function detectCargoCommand() {
  const candidates = [];

  if (process.env.CARGO && process.env.CARGO.trim()) {
    candidates.push(process.env.CARGO.trim());
  }

  candidates.push('cargo');

  if (process.env.USERPROFILE) {
    candidates.push(`"${path.join(process.env.USERPROFILE, '.cargo', 'bin', 'cargo.exe')}"`);
  }

  if (process.env.HOME) {
    candidates.push(`"${path.join(process.env.HOME, '.cargo', 'bin', 'cargo')}"`);
    candidates.push(`"${path.join(process.env.HOME, '.cargo', 'bin', 'cargo.exe')}"`);
  }

  const uniqueCandidates = [...new Set(candidates)];
  for (const candidate of uniqueCandidates) {
    if (canRun(`${candidate} --version`)) {
      return candidate;
    }
  }

  return null;
}

const mandatorySteps = [
  'npm run -s test:parsing',
  [
    'npx vitest run',
    'tests/fixtures/client.test.ts',
    'tests/auth/desktop-client.test.ts',
    'tests/admin-users/client.test.ts',
    'tests/api-keys/client.test.ts',
    'tests/experiments/client.test.ts',
    'tests/reagents/client.test.ts',
    'tests/water-sources/client.test.ts',
    'tests/reports/client.test.ts',
    'tests/app/dashboard-layout.test.tsx',
    'tests/wasm/runtime.test.ts',
    'tests/tauri/index.test.ts',
    'tests/tauri/bridge.test.ts',
  ].join(' '),
  // Parser golden gates are invoked below through cargo:
  //   - src/rust/rheolab-core/tests/golden_tests.rs      (cycle golden)
  //   - src/rust/rheolab-core/tests/gold_standard_test.rs (exact-value golden)
  //   - src-tauri/tests/ai_parsing.rs heuristic subset    (native parser regressions)
];

for (const step of mandatorySteps) {
  if (!runShell(step)) {
    process.exit(1);
  }
}

const cargo = detectCargoCommand();
if (!cargo) {
  console.error('\n[desktop-parity] cargo not found; parser golden gate cannot run.');
  process.exit(1);
}

const rustGoldenCommand = `${cargo} test --test golden_tests -- --nocapture`;
if (!runShell(rustGoldenCommand, rustWorkspace)) {
  process.exit(1);
}

const rustExactGoldCommand = `${cargo} test --test gold_standard_test -- --nocapture`;
if (!runShell(rustExactGoldCommand, rustWorkspace)) {
  process.exit(1);
}

const tauriStubParserCommand = `${cargo} test --manifest-path "${tauriWorkspaceManifest}" --test ai_parsing test_stub_ -- --nocapture`;
if (!runShell(tauriStubParserCommand, repoRoot)) {
  process.exit(1);
}

const tauriHeuristicParserCommand = `${cargo} test --manifest-path "${tauriWorkspaceManifest}" --test ai_parsing test_heuristic_ -- --nocapture`;
if (!runShell(tauriHeuristicParserCommand, repoRoot)) {
  process.exit(1);
}

const tauriReportsCommand = `${cargo} test --manifest-path "${tauriWorkspaceManifest}" reports_generate -- --nocapture`;
if (!runShell(tauriReportsCommand, repoRoot)) {
  process.exit(1);
}

console.log('\n[desktop-parity] all checks passed.');
