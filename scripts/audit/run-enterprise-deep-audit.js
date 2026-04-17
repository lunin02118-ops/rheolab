#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);

function getArgValue(flag) {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) {
    return inline.slice(flag.length + 1);
  }
  const index = args.indexOf(flag);
  if (index >= 0 && index < args.length - 1) {
    const value = args[index + 1];
    if (!value.startsWith('--')) {
      return value;
    }
  }
  return null;
}

const quick = args.includes('--quick');
const preflightOnly = args.includes('--preflight-only');
const runId =
  getArgValue('--run-id') ||
  `${new Date().toISOString().slice(0, 10)}-enterprise-deep-audit`;
const timeoutMs = Number(getArgValue('--timeout-ms')) || 20 * 60 * 1000;
const releaseChannel = getArgValue('--channel') || 'beta';

const outDir = path.join(repoRoot, 'runtime', 'audit', runId);
const logsDir = path.join(outDir, 'logs');
const summaryPath = path.join(outDir, 'dynamic-checks-summary.tsv');
const metricsPath = path.join(outDir, 'audit-metrics.json');
const findingsPath = path.join(outDir, 'audit-findings.json');
const readinessJsonPath = path.join(outDir, 'environment-readiness-matrix.json');
const readinessMdPath = path.join(outDir, 'environment-readiness-matrix.md');
const excerptsPath = path.join(outDir, 'dynamic-log-excerpts.txt');
const releaseGateJsonPath = path.join(outDir, 'release-gate-decision.json');
const releaseGateMdPath = path.join(outDir, 'release-gate-decision.md');
const manifestPath = path.join(repoRoot, 'scripts', 'audit', 'enterprise-audit-manifest.json');

const defaultE2EPort =
  process.env.RHEOLAB_AUDIT_E2E_PORT || process.env.RHEOLAB_E2E_PORT || '3100';
const defaultE2EHost = process.env.RHEOLAB_AUDIT_E2E_HOST || '127.0.0.1';

const isWindows = process.platform === 'win32';

function probeNative(command) {
  const probe = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return probe.status === 0;
}

function probeBash(command) {
  const probe = spawnSync('bash', ['-lc', command], {
    cwd: repoRoot,
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return probe.status === 0;
}

const forceBash = process.env.RHEOLAB_AUDIT_FORCE_BASH === '1';
// On Windows, only use bash fallback when the bash environment has the
// *full* toolchain.  Previous logic fell back to bash (WSL) when cargo/php
// were reachable via `bash -lc` but absent from the native PATH.  However
// WSL often lacks a C linker (`cc`) and PHP, which causes downstream
// compilation failures (e.g. `error: linker 'cc' not found`).  We now also
// probe for `cc` so that an incomplete WSL environment does not hijack the
// entire audit run.
const bashHasCargo = isWindows && probeBash('cargo --version') && !probeNative('cargo --version');
const bashHasLinker = bashHasCargo && probeBash('cc --version');
const bashHasPhp = isWindows && probeBash('php -v') && !probeNative('php -v');
const useBashFallbackOnWindows =
  isWindows && ((bashHasCargo && bashHasLinker) || bashHasPhp);
const hasPosixShell = !isWindows || forceBash || useBashFallbackOnWindows;

function loadAuditManifest() {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    if (!Array.isArray(manifest.environmentProfiles) || !manifest.releaseGatePolicy) {
      throw new Error('Manifest must define environmentProfiles[] and releaseGatePolicy');
    }
    return manifest;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load audit manifest at ${toRel(manifestPath)}: ${details}`);
  }
}

const auditManifest = loadAuditManifest();
const environmentProfiles = auditManifest.environmentProfiles;
const releaseGatePolicy = {
  blockingSeverities: Array.isArray(auditManifest.releaseGatePolicy.blockingSeverities)
    ? auditManifest.releaseGatePolicy.blockingSeverities
    : ['critical', 'high'],
};

const findingTemplates = {
  '00': {
    id: 'ENV-001',
    title: 'Git worktree metadata is not resolvable in current shell',
    domain: 'environment',
    severity: 'high',
    impact: 'Blocks traceability and commit-level audit evidence generation',
    fixStrategy: 'Normalize `.git` worktree pointer for target shell or run audit in canonical worktree',
  },
  '02': {
    id: 'ENV-004',
    title: 'Rust toolchain is unavailable in current shell context',
    domain: 'environment',
    severity: 'high',
    impact: 'Blocks Rust-side static/dynamic verification',
    fixStrategy: 'Install rustup toolchain for active shell context and verify PATH propagation',
  },
  '03': {
    id: 'ENV-005',
    title: 'PHP runtime is unavailable for license-server checks',
    domain: 'environment',
    severity: 'high',
    impact: 'Blocks syntax and API hardening checks for license-server',
    fixStrategy: 'Install PHP runtime in audit environment or run dedicated php-enabled CI job',
  },
  '04': {
    id: 'QG-TSC',
    title: 'TypeScript gate is red',
    domain: 'correctness',
    severity: 'high',
    impact: 'Static type guarantees are broken',
    fixStrategy: 'Resolve TypeScript errors before progressing to deep regression phases',
  },
  '05': {
    id: 'QG-ESLINT',
    title: 'ESLint gate is red',
    domain: 'code-quality',
    severity: 'high',
    impact: 'Lint policy enforcement is broken and CI signal is degraded',
    fixStrategy: 'Fix lint errors and keep warning debt tracked in remediation backlog',
  },
  '06': {
    id: 'QG-TEST',
    title: 'Unit/integration test gate is red',
    domain: 'correctness',
    severity: 'high',
    impact: 'Regression detection is unreliable',
    fixStrategy: 'Fix failing tests and restore deterministic test baseline',
  },
  '08': {
    id: 'QG-E2E-SMOKE',
    title: 'E2E smoke gate is red',
    domain: 'reliability',
    severity: 'high',
    impact: 'Critical user journeys are not release-safe',
    fixStrategy: 'Fix smoke failures and rerun with artifact capture for root-cause evidence',
  },
  '11': {
    id: 'QG-CARGO-CHECK',
    title: 'Rust cargo check gate is red',
    domain: 'correctness',
    severity: 'high',
    impact: 'Backend compile integrity is broken',
    fixStrategy: 'Fix compile errors and validate toolchain setup for active shell profile',
  },
  '12': {
    id: 'QG-CARGO-TEST',
    title: 'Rust cargo test gate is red',
    domain: 'reliability',
    severity: 'high',
    impact: 'Backend behavior regressions are not contained',
    fixStrategy: 'Fix failing Rust tests and stabilize affected modules',
  },
  '17': {
    id: 'REL-SIGNED-DRYRUN',
    title: 'Signed release dry-run failed',
    domain: 'release',
    severity: 'high',
    impact: 'Release-signing policy is not satisfied',
    fixStrategy: 'Configure signing secrets or explicitly run internal/allow-unsigned policy where permitted',
  },
  '18': {
    id: 'LIC-PHP-LINT',
    title: 'License-server PHP lint failed',
    domain: 'security',
    severity: 'high',
    impact: 'License API syntax/integrity cannot be validated',
    fixStrategy: 'Resolve PHP syntax/runtime issues and rerun php lint checks',
  },
  '19': {
    id: 'WEB-BUILD',
    title: 'Website build failed',
    domain: 'release',
    severity: 'high',
    impact: 'Marketing site bundle is not release-ready',
    fixStrategy: 'Fix Astro build issues and lock deterministic website dependencies',
  },
  '21': {
    id: 'ENV-006',
    title: 'Astro CLI is unavailable in website toolchain context',
    domain: 'environment',
    severity: 'medium',
    impact: 'Website preflight cannot validate static-site readiness',
    fixStrategy: 'Install website dependencies (`npm --prefix website ci`) before running audit',
  },
  '22': {
    id: 'SEC-NPM-AUDIT',
    title: 'npm audit reported high/critical vulnerabilities',
    domain: 'security',
    severity: 'high',
    impact: 'Known vulnerable JavaScript dependencies in release candidate',
    fixStrategy: 'Upgrade vulnerable packages or apply mitigations with documented exception',
  },
  '23': {
    id: 'SEC-CARGO-AUDIT',
    title: 'cargo audit failed or reported vulnerable crates',
    domain: 'security',
    severity: 'high',
    impact: 'Known vulnerable Rust crates in release candidate',
    fixStrategy: 'Install/use cargo-audit and remediate vulnerable Rust dependencies',
  },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toRel(absPath) {
  return path.relative(repoRoot, absPath).replace(/\\/g, '/');
}

function slugify(value) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120)
    .toLowerCase();
}

function escapeForBash(command) {
  return command.replace(/["\\$`]/g, '\\$&');
}

function wrapBash(command) {
  const escaped = escapeForBash(command);

  // Prefer explicit bash wrapper when shell profile is POSIX-like.
  if (hasPosixShell || !isWindows) {
    return `bash -lc "${escaped}"`;
  }

  // Fallback for native Windows shell.
  const psEscaped = command.replace(/"/g, '\\"');
  return `powershell -NoProfile -NonInteractive -Command "${psEscaped}"`;
}

function wrapCargo(subdir, cargoArgs) {
  if (hasPosixShell || !isWindows) {
    return wrapBash(`cd ${subdir} && cargo ${cargoArgs}`);
  }

  const manifestPath = path.join(repoRoot, subdir, 'Cargo.toml').replace(/\\/g, '/');
  return `cargo ${cargoArgs} --manifest-path "${manifestPath}"`;
}

function readTail(logPath, lines = 12) {
  if (!logPath || !fs.existsSync(logPath)) {
    return [];
  }
  const stats = fs.statSync(logPath);
  if (!stats.isFile()) {
    return [];
  }
  return fs
    .readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-lines);
}

function findBaselineRef() {
  const auditRoot = path.join(repoRoot, 'runtime', 'audit');
  if (!fs.existsSync(auditRoot)) {
    return null;
  }

  const candidates = fs
    .readdirSync(auditRoot)
    .filter((name) => name !== runId)
    .map((name) => path.join(auditRoot, name, 'dynamic-checks-summary.tsv'))
    .filter((candidate) => fs.existsSync(candidate))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (candidates.length === 0) {
    return null;
  }
  return toRel(candidates[0]);
}

function readExistingFindings() {
  if (!fs.existsSync(findingsPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(findingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeFindings(existingFindings, generatedFindings) {
  const byId = new Map();

  for (const finding of existingFindings) {
    if (finding && typeof finding.id === 'string') {
      byId.set(finding.id, finding);
    }
  }

  for (const finding of generatedFindings) {
    if (finding && typeof finding.id === 'string') {
      byId.set(finding.id, finding);
    }
  }

  return Array.from(byId.values()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function buildChecks(e2eEnv) {
  const cargoTargetDir = path.join(repoRoot, 'runtime', 'cargo-target');
  const maybeCargoAudit = hasPosixShell || !isWindows
    ? wrapBash('cd src-tauri && (cargo audit || (cargo install cargo-audit --quiet && cargo audit))')
    : 'cargo audit';

  return [
    {
      id: '00',
      name: 'Git worktree check',
      phase: 'phase0',
      scope: 'environment',
      tool: 'git',
      environments: ['linux', 'windows'],
      preflight: true,
      quick: true,
      blocking: true,
      command: 'git rev-parse --is-inside-work-tree',
    },
    {
      id: '01',
      name: 'Node/NPM versions',
      phase: 'phase0',
      scope: 'environment',
      tool: 'node',
      environments: ['linux', 'windows'],
      preflight: true,
      quick: true,
      blocking: true,
      command: 'node -v && npm -v',
    },
    {
      id: '02',
      name: 'Cargo version',
      phase: 'phase0',
      scope: 'environment',
      tool: 'cargo',
      environments: ['linux', 'windows'],
      preflight: true,
      quick: true,
      blocking: true,
      command: hasPosixShell || !isWindows ? wrapBash('cargo --version') : 'cargo --version',
    },
    {
      id: '03',
      name: 'PHP version',
      phase: 'phase0',
      scope: 'environment',
      tool: 'php',
      environments: ['php-enabled'],
      preflight: true,
      quick: true,
      blocking: true,
      command: hasPosixShell || !isWindows ? wrapBash('php -v') : 'php -v',
    },
    {
      id: '21',
      name: 'Astro CLI preflight',
      phase: 'phase0',
      scope: 'website',
      tool: 'astro',
      environments: ['website'],
      preflight: true,
      quick: true,
      blocking: true,
      command: 'npm --prefix website exec -- astro --version',
    },
    {
      id: '04',
      name: 'TypeScript gate',
      phase: 'phase0',
      scope: 'desktop-core',
      tool: 'tsc',
      environments: ['linux', 'windows'],
      preflight: true,
      quick: true,
      blocking: true,
      command: 'npx tsc --noEmit',
    },
    {
      id: '05',
      name: 'ESLint gate',
      phase: 'phase0',
      scope: 'desktop-core',
      tool: 'eslint',
      environments: ['linux', 'windows'],
      preflight: true,
      quick: true,
      blocking: true,
      command: 'npx eslint .',
    },
    {
      id: '06',
      name: 'Unit/Integration tests',
      phase: 'phase3',
      scope: 'desktop-core',
      tool: 'vitest',
      environments: ['linux', 'windows'],
      preflight: true,
      quick: true,
      blocking: true,
      command: 'npm test',
    },
    {
      id: '07',
      name: 'Coverage run',
      phase: 'phase3',
      scope: 'desktop-core',
      tool: 'vitest',
      environments: ['linux', 'windows'],
      preflight: false,
      quick: false,
      blocking: false,
      command: 'npm run test:coverage',
    },
    {
      id: '08',
      name: 'E2E smoke',
      phase: 'phase3',
      scope: 'e2e',
      tool: 'playwright',
      environments: ['windows'],
      preflight: false,
      quick: false,
      blocking: true,
      env: e2eEnv,
      command: 'npm run test:e2e:smoke',
    },
    {
      id: '09',
      name: 'E2E full',
      phase: 'phase3',
      scope: 'e2e',
      tool: 'playwright',
      environments: ['windows'],
      preflight: false,
      quick: false,
      blocking: false,
      env: e2eEnv,
      command: 'npm run test:e2e:full',
    },
    {
      id: '10',
      name: 'E2E slow',
      phase: 'phase3',
      scope: 'e2e',
      tool: 'playwright',
      environments: ['windows'],
      preflight: false,
      quick: false,
      blocking: false,
      env: e2eEnv,
      command: 'npm run test:e2e:slow',
    },
    {
      id: '11',
      name: 'Cargo check',
      phase: 'phase3',
      scope: 'src-tauri',
      tool: 'cargo',
      environments: ['linux', 'windows'],
      preflight: false,
      quick: true,
      blocking: true,
      env: { CARGO_TARGET_DIR: cargoTargetDir },
      command: wrapCargo('src-tauri', 'check'),
    },
    {
      id: '12',
      name: 'Cargo test',
      phase: 'phase3',
      scope: 'src-tauri',
      tool: 'cargo',
      environments: ['windows'],
      preflight: false,
      quick: false,
      blocking: true,
      env: { CARGO_TARGET_DIR: cargoTargetDir },
      command: wrapCargo('src-tauri', 'test'),
    },
    {
      id: '13',
      name: 'Cargo build',
      phase: 'phase3',
      scope: 'src-tauri',
      tool: 'cargo',
      environments: ['windows'],
      preflight: false,
      quick: false,
      blocking: false,
      env: { CARGO_TARGET_DIR: cargoTargetDir },
      command: wrapCargo('src-tauri', 'build'),
    },
    {
      id: '14',
      name: 'Perf benchmark',
      phase: 'phase4',
      scope: 'performance',
      tool: 'perf',
      environments: ['windows'],
      preflight: false,
      quick: false,
      blocking: false,
      env: e2eEnv,
      command: 'npm run perf:benchmark',
    },
    {
      id: '15',
      name: 'Perf workflow',
      phase: 'phase4',
      scope: 'performance',
      tool: 'perf',
      environments: ['windows'],
      preflight: false,
      quick: false,
      blocking: false,
      command: 'npm run perf:workflow',
    },
    {
      id: '16',
      name: 'Perf memory aggregate',
      phase: 'phase4',
      scope: 'performance',
      tool: 'perf',
      environments: ['windows'],
      preflight: false,
      quick: false,
      blocking: false,
      command: 'npm run perf:memory:aggregate',
    },
    {
      id: '17',
      name: 'Release dry-run (signed policy)',
      phase: 'phase5',
      scope: 'release',
      tool: 'release',
      environments: ['windows'],
      preflight: false,
      quick: false,
      blocking: true,
      command: `npm run release:prepare -- --channel ${releaseChannel} --dry-run`,
    },
    {
      id: '18',
      name: 'License-server PHP lint',
      phase: 'phase5',
      scope: 'license-server',
      tool: 'php',
      environments: ['php-enabled'],
      preflight: false,
      quick: true,
      blocking: true,
      command: 'node scripts/audit/php-lint-license-server.js',
    },
    {
      id: '19',
      name: 'Website build',
      phase: 'phase5',
      scope: 'website',
      tool: 'astro',
      environments: ['website'],
      preflight: false,
      quick: true,
      blocking: true,
      command: 'npm --prefix website ci && npm --prefix website run build',
    },
    {
      id: '20',
      name: 'Release dry-run (allow unsigned)',
      phase: 'phase5',
      scope: 'release',
      tool: 'release',
      environments: ['windows'],
      preflight: false,
      quick: true,
      blocking: false,
      command: `npm run release:prepare -- --channel ${releaseChannel} --dry-run --allow-unsigned --skip-qa`,
    },
    {
      id: '22',
      name: 'npm audit high',
      phase: 'phase5',
      scope: 'security',
      tool: 'npm-audit',
      environments: ['linux', 'windows'],
      preflight: false,
      quick: true,
      blocking: true,
      command: 'npm audit --audit-level=high',
    },
    {
      id: '23',
      name: 'cargo audit',
      phase: 'phase5',
      scope: 'security',
      tool: 'cargo-audit',
      environments: ['linux', 'windows'],
      preflight: false,
      quick: false,
      blocking: true,
      command: maybeCargoAudit,
    },
  ];
}

function validateManifestAlignment(checks) {
  const manifestChecks = new Map(
    (Array.isArray(auditManifest.checks) ? auditManifest.checks : []).map((check) => [check.id, check]),
  );

  const mismatches = [];
  for (const check of checks) {
    const meta = manifestChecks.get(check.id);
    if (!meta) {
      mismatches.push(`${check.id}: missing in manifest`);
      continue;
    }

    if (Boolean(meta.blocking) !== Boolean(check.blocking)) {
      mismatches.push(`${check.id}: blocking mismatch (manifest=${meta.blocking}, runtime=${check.blocking})`);
    }
    if (Boolean(meta.quick) !== Boolean(check.quick)) {
      mismatches.push(`${check.id}: quick mismatch (manifest=${meta.quick}, runtime=${check.quick})`);
    }
    if (Boolean(meta.preflight) !== Boolean(check.preflight)) {
      mismatches.push(`${check.id}: preflight mismatch (manifest=${meta.preflight}, runtime=${check.preflight})`);
    }
  }

  for (const id of manifestChecks.keys()) {
    if (!checks.some((check) => check.id === id)) {
      mismatches.push(`${id}: declared in manifest, missing in runtime checks`);
    }
  }

  if (mismatches.length > 0) {
    console.warn('[audit] manifest alignment warnings:');
    for (const mismatch of mismatches) {
      console.warn(`[audit]   - ${mismatch}`);
    }
  }
}

function selectRunList(checks) {
  if (preflightOnly) {
    return checks.filter((check) => check.preflight);
  }
  if (quick) {
    return checks.filter((check) => check.quick);
  }
  return checks;
}

function runCommand(item) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const logPath = path.join(logsDir, `${item.id}_${slugify(item.command)}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });

    logStream.write(`[${startedAt.toISOString()}] $ ${item.command}\n`);

    const child = spawn(item.command, {
      cwd: repoRoot,
      shell: true,
      env: {
        ...process.env,
        ...(item.env || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => logStream.write(chunk));
    child.stderr.on('data', (chunk) => logStream.write(chunk));

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const endedAt = new Date();
      const durationSec = Number(((endedAt.getTime() - startedAt.getTime()) / 1000).toFixed(2));
      const exitCode = typeof code === 'number' ? code : 1;

      logStream.write(
        `\n[${endedAt.toISOString()}] exit=${exitCode} signal=${signal ?? 'none'} timedOut=${timedOut}\n`,
      );
      logStream.end();

      resolve({
        id: item.id,
        name: item.name,
        phase: item.phase,
        scope: item.scope,
        tool: item.tool,
        command: item.command,
        environments: item.environments,
        blocking: item.blocking,
        quick: item.quick,
        preflight: item.preflight,
        status: exitCode === 0 ? 'pass' : 'fail',
        exitCode,
        timedOut,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSec,
        logFile: toRel(logPath),
      });
    });
  });
}

function buildEnvironmentMatrix(resultsById) {
  return environmentProfiles.map((profile) => {
    const checks = profile.requiredCheckIds.map((id) => resultsById.get(id)).filter(Boolean);
    const missing = profile.requiredCheckIds.filter((id) => !resultsById.get(id));

    let readiness = 'ready';
    if (missing.length > 0) {
      readiness = 'blocked';
    } else if (checks.some((check) => check.exitCode !== 0)) {
      readiness = 'partial';
    }

    const noteParts = [];
    if (missing.length > 0) {
      noteParts.push(`missing checks: ${missing.join(', ')}`);
    }

    for (const check of checks.filter((item) => item.exitCode !== 0).slice(0, 4)) {
      const tail = readTail(path.join(repoRoot, check.logFile), 3).join(' | ');
      noteParts.push(`${check.id}:${check.name} => ${tail}`);
    }

    return {
      environment: profile.id,
      readiness,
      description: profile.description,
      required_check_ids: profile.requiredCheckIds,
      notes: noteParts.length > 0 ? noteParts.join(' || ') : 'all required checks passed',
    };
  });
}

function buildFindings(resultsById, runList) {
  const findings = [];

  for (const check of runList) {
    const result = resultsById.get(check.id);
    if (!result || result.exitCode === 0) {
      continue;
    }

    const template = findingTemplates[check.id] || null;
    const severity = template?.severity || (check.blocking ? 'high' : 'medium');
    const findingId = template?.id || `CHK-${check.id}`;

    findings.push({
      id: findingId,
      domain: template?.domain || check.scope,
      severity,
      likelihood: check.blocking ? 'high' : 'medium',
      impact: template?.impact || `Audit check ${check.id} (${check.name}) failed`,
      evidence: {
        command: result.command,
        log_file: result.logFile,
        tail: readTail(path.join(repoRoot, result.logFile), 10),
      },
      repro_steps: [`Run \`${result.command}\``],
      owner: check.scope === 'license-server' ? 'License Server Team' : 'Platform Team',
      fix_strategy: template?.fixStrategy || 'Review logs, reproduce locally, and apply targeted remediation',
      effort: check.blocking ? 'M' : 'S',
      status: 'open',
      title: template?.title || `${check.name} failed`,
      check_id: check.id,
    });
  }

  return findings;
}

function writeReleaseGateDecision(results, findings, checks, baselineRef) {
  const blockingSeverities = new Set(
    releaseGatePolicy.blockingSeverities.map((severity) => String(severity).toLowerCase()),
  );
  const failedBlockingChecks = results.filter((result) => result.blocking && result.exitCode !== 0);
  const severityBlockers = findings.filter(
    (finding) => finding.status !== 'dismissed' && blockingSeverities.has(String(finding.severity || '').toLowerCase()),
  );
  const openMedium = findings.filter(
    (finding) => finding.status !== 'dismissed' && String(finding.severity || '').toLowerCase() === 'medium',
  );

  const decision =
    failedBlockingChecks.length > 0 || severityBlockers.length > 0
      ? 'NO-GO'
      : openMedium.length > 0
        ? 'GO WITH CONDITIONS'
        : 'GO';

  const payload = {
    decision,
    policy: {
      blocking_severities: releaseGatePolicy.blockingSeverities,
      blocker_on_failed_blocking_checks: true,
    },
    generated_at: new Date().toISOString(),
    mode: preflightOnly ? 'preflight-only' : quick ? 'quick' : 'full',
    baseline_ref: baselineRef,
    stats: {
      total_checks_executed: results.length,
      total_checks_passed: results.filter((result) => result.exitCode === 0).length,
      total_checks_failed: results.filter((result) => result.exitCode !== 0).length,
      total_blocking_checks: checks.filter((check) => check.blocking).length,
      failed_blocking_checks: failedBlockingChecks.length,
      severity_blockers: severityBlockers.length,
      open_medium_findings: openMedium.length,
    },
    failed_blocking_checks: failedBlockingChecks.map((item) => ({
      id: item.id,
      name: item.name,
      command: item.command,
      log_file: item.logFile,
      exit_code: item.exitCode,
    })),
    severity_blockers: severityBlockers.map((item) => ({
      id: item.id,
      title: item.title,
      severity: item.severity,
      status: item.status,
    })),
  };

  fs.writeFileSync(releaseGateJsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  const lines = [
    '# Release Gate Decision',
    '',
    `- Decision: **${decision}**`,
    `- Mode: \`${payload.mode}\``,
    `- Generated at: ${payload.generated_at}`,
    baselineRef ? `- Baseline ref: \`${baselineRef}\`` : '- Baseline ref: n/a',
    '',
    '## Gate Policy',
    '',
    '- Blocking severities: `critical`, `high`',
    '- Failed blocking checks are always blockers',
    '',
    '## Stats',
    '',
    `- Checks executed: ${payload.stats.total_checks_executed}`,
    `- Checks passed: ${payload.stats.total_checks_passed}`,
    `- Checks failed: ${payload.stats.total_checks_failed}`,
    `- Failed blocking checks: ${payload.stats.failed_blocking_checks}`,
    `- Severity blockers: ${payload.stats.severity_blockers}`,
    `- Open medium findings: ${payload.stats.open_medium_findings}`,
    '',
  ];

  if (payload.failed_blocking_checks.length > 0) {
    lines.push('## Failed Blocking Checks', '');
    lines.push('| Check | Name | Exit | Log |');
    lines.push('|---|---|---|---|');
    for (const blocker of payload.failed_blocking_checks) {
      lines.push(`| ${blocker.id} | ${blocker.name} | ${blocker.exit_code} | \`${blocker.log_file}\` |`);
    }
    lines.push('');
  }

  if (payload.severity_blockers.length > 0) {
    lines.push('## Severity Blockers', '');
    lines.push('| ID | Severity | Title |');
    lines.push('|---|---|---|');
    for (const blocker of payload.severity_blockers) {
      lines.push(`| ${blocker.id} | ${String(blocker.severity).toUpperCase()} | ${blocker.title} |`);
    }
    lines.push('');
  }

  fs.writeFileSync(releaseGateMdPath, `${lines.join('\n')}\n`);
}

async function main() {
  ensureDir(logsDir);

  const baselineRef = findBaselineRef();
  const e2eEnv = {
    RHEOLAB_E2E_PORT: defaultE2EPort,
    RHEOLAB_E2E_HOST: defaultE2EHost,
    PORT: defaultE2EPort,
  };

  const checks = buildChecks(e2eEnv);
  validateManifestAlignment(checks);
  const runList = selectRunList(checks);

  const results = [];
  for (const check of runList) {
    console.log(`[audit] ${check.id} ${check.name} :: ${check.command}`);
    // eslint-disable-next-line no-await-in-loop
    const result = await runCommand(check);
    console.log(`[audit] ${check.id} exit=${result.exitCode} duration=${result.durationSec}s`);
    results.push(result);
  }

  const summaryHeader = [
    'index',
    'name',
    'phase',
    'scope',
    'blocking',
    'environments',
    'command',
    'status',
    'exit_code',
    'started_at',
    'ended_at',
    'duration_sec',
    'log_file',
  ].join('\t');

  const summaryLines = results.map((result) =>
    [
      result.id,
      result.name,
      result.phase,
      result.scope,
      result.blocking ? 'yes' : 'no',
      (result.environments || []).join(','),
      result.command,
      result.status,
      String(result.exitCode),
      result.startedAt,
      result.endedAt,
      String(result.durationSec),
      result.logFile,
    ].join('\t'),
  );

  fs.writeFileSync(summaryPath, `${summaryHeader}\n${summaryLines.join('\n')}\n`);

  const metrics = results.map((result) => ({
    id: result.id,
    name: result.name,
    phase: result.phase,
    scope: result.scope,
    tool: result.tool,
    timestamp: result.endedAt,
    result: result.status,
    blocking: result.blocking,
    environments: result.environments,
    baseline_ref: baselineRef,
    delta: null,
    command: result.command,
    exit_code: result.exitCode,
    duration_sec: result.durationSec,
    log_file: result.logFile,
  }));
  fs.writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);

  const resultMap = new Map(results.map((result) => [result.id, result]));
  const matrix = buildEnvironmentMatrix(resultMap);
  fs.writeFileSync(readinessJsonPath, `${JSON.stringify(matrix, null, 2)}\n`);

  const readinessTable = [
    '# Environment Readiness Matrix',
    '',
    '| Environment | Readiness | Description | Required Checks | Notes |',
    '|---|---|---|---|---|',
    ...matrix.map((item) =>
      `| ${item.environment} | ${item.readiness.toUpperCase()} | ${item.description} | \`${item.required_check_ids.join(',')}\` | ${item.notes.replace(/\|/g, '\\\\|')} |`,
    ),
    '',
  ].join('\n');
  fs.writeFileSync(readinessMdPath, readinessTable);

  const failureExcerpts = results
    .filter((result) => result.exitCode !== 0)
    .map((result) => {
      const tail = readTail(path.join(repoRoot, result.logFile), 12);
      return [`## ${result.id} ${result.name}`, ...tail, ''].join('\n');
    })
    .join('\n');
  fs.writeFileSync(excerptsPath, failureExcerpts || 'No failing commands.\n');

  const generatedFindings = buildFindings(resultMap, runList);
  const mergedFindings = mergeFindings(readExistingFindings(), generatedFindings);
  fs.writeFileSync(findingsPath, `${JSON.stringify(mergedFindings, null, 2)}\n`);

  writeReleaseGateDecision(results, mergedFindings, runList, baselineRef);

  console.log(`[audit] mode: ${preflightOnly ? 'preflight-only' : quick ? 'quick' : 'full'}`);
  console.log(`[audit] output dir: ${toRel(outDir)}`);
  console.log(`[audit] summary: ${toRel(summaryPath)}`);
  console.log(`[audit] metrics: ${toRel(metricsPath)}`);
  console.log(`[audit] findings: ${toRel(findingsPath)}`);
  console.log(`[audit] release gate: ${toRel(releaseGateMdPath)}`);
}

main().catch((error) => {
  console.error(`[audit] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
