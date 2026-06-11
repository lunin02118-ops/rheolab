#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  resolveReleaseChannel,
  shouldRequireSignedArtifacts,
  validateUpdaterConfig,
  formatUpdaterIssues,
} = require('./lib/release-policy');
const { patchTauriUpdaterConfig } = require('./lib/tauri-updater-config');
const { checkLicensePublicKey } = require('./check-license-key');

const repoRoot = path.resolve(__dirname, '../..');
const DEV_INTEGRITY_SENTINEL = 'rheolab-dev-integrity-key-32chars!';
const DEV_SECRET_SENTINELS = [
  DEV_INTEGRITY_SENTINEL,
  'rheolab-beta-channel-dev-key-000',
  'rheolab-alpha-channel-dev-key-00',
];
const args = process.argv.slice(2);
const skipQa = args.includes('--skip-qa');
const skipBuild = args.includes('--skip-build');
const skipReleaseGate = args.includes('--skip-release-gate')
  || process.env.RHEOLAB_SKIP_RELEASE_GATE === '1';
const dryRun = args.includes('--dry-run');
const allowUnsigned = args.includes('--allow-unsigned') || process.env.RHEOLAB_ALLOW_UNSIGNED_RELEASE === '1';

const releaseChannel = resolveReleaseChannel(args, process.env.RHEOLAB_RELEASE_CHANNEL);
const tempReleaseConfigDir = path.join(repoRoot, 'runtime', 'release', 'tmp');

function normalizeEnv(source) {
  const result = {};
  const seen = new Set();

  for (const [key, value] of Object.entries(source)) {
    if (!key || key.includes('=') || key.includes('\0')) {
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (seen.has(lowerKey)) {
      continue;
    }

    seen.add(lowerKey);
    result[key] = value;
  }

  return result;
}

const env = normalizeEnv({
  ...process.env,
  RHEOLAB_SKIP_VERSION_BUMP: '1',
});

// Load compile-time secrets from scripts/dev/.env.keys if not already in
// the environment. Each key is embedded into the Rust binary at compile
// time via option_env!(). A release binary compiled without any of them
// falls back to a dev sentinel and panics on startup (see the assertions
// in src-tauri/src/commands/licensing/types.rs).
//
// Loaded keys:
//   INTEGRITY_SECRET_KEY    — HMAC for local licence DB
//   BETA_CHANNEL_SECRET     — signs X-Update-Token for the beta channel
//   ALPHA_CHANNEL_SECRET    — signs X-Update-Token for the alpha channel
//
// LICENSE_ENCRYPTION_KEY is intentionally not auto-loaded here — it is
// not referenced by this script's verification path and stays out of the
// child-process env unless the caller exports it explicitly.
const _compileTimeSecretNames = [
  'INTEGRITY_SECRET_KEY',
  'BETA_CHANNEL_SECRET',
  'ALPHA_CHANNEL_SECRET',
];
const _loadedSecrets = (() => {
  const found = {};
  const missing = _compileTimeSecretNames.filter(
    (name) => !(env[name] || '').trim(),
  );
  if (missing.length === 0) {
    return found;
  }
  const keysFile = path.join(repoRoot, 'scripts', 'dev', '.env.keys');
  if (!fs.existsSync(keysFile)) {
    return found;
  }
  const lines = fs.readFileSync(keysFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.+)$/);
    if (!m) {
      continue;
    }
    const key = m[1].trim();
    if (missing.includes(key) && !(key in found)) {
      found[key] = m[2].trim();
    }
  }
  return found;
})();
for (const [name, value] of Object.entries(_loadedSecrets)) {
  if (value) {
    env[name] = value;
  }
}

// Load TAURI_SIGNING_PRIVATE_KEY from src-tauri/keys/updater.key if not already in environment.
// Also load TAURI_SIGNING_PRIVATE_KEY_PASSWORD from .env.keys.
// This mirrors what run-tauri-cli.js does so that prepare-production.js is self-contained.
if (!(env.TAURI_SIGNING_PRIVATE_KEY || '').trim()) {
  const updaterKeyFile = path.join(repoRoot, 'src-tauri', 'keys', 'updater.key');
  if (fs.existsSync(updaterKeyFile)) {
    env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(updaterKeyFile, 'utf8').trim();
    console.log('[release] updater signing key loaded from src-tauri/keys/updater.key');
  }
}
if (!(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '').trim()) {
  const keysFile = path.join(repoRoot, 'scripts', 'dev', '.env.keys');
  if (fs.existsSync(keysFile)) {
    const lines = fs.readFileSync(keysFile, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.+)$/);
      if (m && m[1].trim() === 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD') {
        env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = m[2].trim();
        break;
      }
    }
  }
}

function run(command, commandArgs = [], options = {}) {
  const display = `${command}${commandArgs.length ? ` ${commandArgs.join(' ')}` : ''}`;
  console.log(`\n[release] ${display}`);

  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${display}`);
  }
}

function cleanupTemporaryConfigs() {
  if (!fs.existsSync(tempReleaseConfigDir)) {
    return;
  }

  const files = fs
    .readdirSync(tempReleaseConfigDir)
    .filter((fileName) => /^tauri\.release\.\d+\.json$/i.test(fileName));

  for (const fileName of files) {
    try {
      fs.rmSync(path.join(tempReleaseConfigDir, fileName), { force: true });
    } catch (error) {
      console.warn(`[release] failed to cleanup stale temp config ${fileName}: ${String(error)}`);
    }
  }
}

function verifyIntegrityKey() {
  const key = (env.INTEGRITY_SECRET_KEY || '').trim();
  if (!key) {
    throw new Error(
      'INTEGRITY_SECRET_KEY is required for production builds.\n' +
      'The key is embedded into the binary at compile time (option_env! in types.rs).\n' +
      'Without it the release binary will panic on startup.\n' +
      '\n' +
      'Set it in scripts/dev/.env.keys:\n' +
      '  INTEGRITY_SECRET_KEY=your-production-secret-32chars+\n' +
      'Or export INTEGRITY_SECRET_KEY before running this script.',
    );
  }
  if (key === DEV_INTEGRITY_SENTINEL) {
    throw new Error(
      'INTEGRITY_SECRET_KEY is set to the dev sentinel key.\n' +
      'A release binary compiled with the dev key will panic on startup.\n' +
      'Set a unique production key in scripts/dev/.env.keys.',
    );
  }
}

function verifySigningEnvironment(channel) {
  if (!shouldRequireSignedArtifacts(channel) || allowUnsigned) {
    return;
  }

  const signingKey = (env.TAURI_SIGNING_PRIVATE_KEY || '').trim();
  if (!signingKey) {
    throw new Error(
      `Signed updater artifacts are required for "${channel}" channel. ` +
      'Set TAURI_SIGNING_PRIVATE_KEY (and optionally TAURI_SIGNING_PRIVATE_KEY_PASSWORD), ' +
      'or pass --allow-unsigned for explicit override.',
    );
  }
}

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(content);
}

function readText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
}

function extractCargoPackageVersion(cargoTomlRaw) {
  const packageBlockMatch = cargoTomlRaw.match(/\[package\][\s\S]*?(?:\n\[|$)/);
  const packageBlock = packageBlockMatch ? packageBlockMatch[0] : cargoTomlRaw;
  const versionMatch = packageBlock.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  if (!versionMatch) {
    throw new Error('Unable to find package version in src-tauri/Cargo.toml');
  }
  return versionMatch[1];
}

function extractTsAppVersion(versionTsRaw) {
  const match = versionTsRaw.match(/APP_VERSION\s*=\s*'([^']+)'/);
  if (!match) {
    throw new Error('Unable to find APP_VERSION in src/lib/version.ts');
  }
  return match[1];
}

function verifyVersionSync() {
  const packageJson = readJson('package.json');
  const tauriConfig = readJson('src-tauri/tauri.conf.json');
  const cargoToml = readText('src-tauri/Cargo.toml');
  const versionTs = readText('src/lib/version.ts');

  const versions = {
    packageJson: packageJson.version,
    tauriConfig: tauriConfig.version,
    cargoToml: extractCargoPackageVersion(cargoToml),
    appVersionTs: extractTsAppVersion(versionTs),
  };

  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) {
    throw new Error(
      `Version mismatch detected: ${JSON.stringify(versions, null, 2)}`,
    );
  }

  return {
    version: versions.packageJson,
    tauriConfig,
  };
}

function listInstallerArtifacts(version) {
  const nsisDir = path.join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  if (!fs.existsSync(nsisDir)) {
    throw new Error(`NSIS output directory not found: ${nsisDir}`);
  }

  const all = fs
    .readdirSync(nsisDir)
    .filter((name) => name.toLowerCase().endsWith('.exe') && !name.toLowerCase().includes('uninstall'));

  const exactVersionSegment = version ? `_${version}_` : null;
  const versioned = exactVersionSegment
    ? all.filter((name) => name.includes(exactVersionSegment))
    : all;
  if (versioned.length === 0) {
    throw new Error(
      `No installer matching version "${version}" found in:\n  ${nsisDir}\n` +
      `Found: ${all.length > 0 ? all.join(', ') : '(none)'}\n` +
      'Run the build without --skip-build to generate a fresh artifact.',
    );
  }

  const artifacts = versioned.map((name) => path.join(nsisDir, name));

  return artifacts;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const bytes = fs.readFileSync(filePath);
  hash.update(bytes);
  return hash.digest('hex');
}

function readSignatureFileIfPresent(artifactPath) {
  const signaturePath = `${artifactPath}.sig`;
  if (!fs.existsSync(signaturePath)) {
    return null;
  }

  return {
    signaturePath,
    signature: fs.readFileSync(signaturePath, 'utf8').trim(),
  };
}

function verifyReleaseBinaryDoesNotContainDevSecrets() {
  const binaryPath = path.join(repoRoot, 'src-tauri', 'target', 'release', 'rheolab-enterprise.exe');
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Release binary not found for dev-secret scan: ${binaryPath}`);
  }

  const bytes = fs.readFileSync(binaryPath);
  const leaked = DEV_SECRET_SENTINELS.filter((sentinel) => bytes.includes(Buffer.from(sentinel)));
  if (leaked.length > 0) {
    throw new Error(
      'Release binary contains development licensing sentinel(s):\n' +
      leaked.map((value) => `  - ${value}`).join('\n') +
      '\nRefusing to produce or publish a release manifest.',
    );
  }
  console.log('[release] dev-secret binary scan passed');
}

function tryGetGitCommit() {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'ignore'],
    env,
  });

  if (result.error || result.status !== 0) {
    return 'unknown';
  }

  return String(result.stdout).trim() || 'unknown';
}

function writeReleaseManifest(version, artifacts, updaterValidation, updaterPatch) {
  const releaseDir = path.join(repoRoot, 'runtime', 'release');
  fs.mkdirSync(releaseDir, { recursive: true });

  const generatedAt = new Date();
  const generatedAtIso = generatedAt.toISOString();
  const stamp = generatedAtIso.replace(/[:.]/g, '-');
  const commit = tryGetGitCommit();

  const artifactEntries = artifacts.map((artifactPath) => {
    const stat = fs.statSync(artifactPath);
    const sha256 = sha256File(artifactPath);
    const signatureRecord = readSignatureFileIfPresent(artifactPath);

    if (shouldRequireSignedArtifacts(releaseChannel) && !allowUnsigned && !signatureRecord) {
      throw new Error(
        `Missing updater signature for artifact "${path.basename(artifactPath)}". ` +
        'Expected file: ' + `${artifactPath}.sig`,
      );
    }

    return {
      fileName: path.basename(artifactPath),
      absolutePath: artifactPath,
      relativePath: path.relative(repoRoot, artifactPath).replace(/\\/g, '/'),
      sizeBytes: stat.size,
      sha256,
      signature: signatureRecord?.signature ?? null,
      signatureRelativePath: signatureRecord
        ? path.relative(repoRoot, signatureRecord.signaturePath).replace(/\\/g, '/')
        : null,
    };
  });

  const manifest = {
    generatedAt: generatedAtIso,
    version,
    commit,
    channel: releaseChannel,
    qaFastExecuted: !skipQa,
    releaseGateExecuted: !skipReleaseGate,
    signedArtifactsRequired: shouldRequireSignedArtifacts(releaseChannel),
    allowUnsignedOverride: allowUnsigned,
    updater: {
      configured: updaterValidation.summary.configured,
      endpointCount: updaterValidation.summary.endpointCount,
      endpoints: updaterValidation.summary.endpoints,
      pubkeyConfigured: updaterValidation.summary.pubkeyConfigured,
      validationIssues: updaterValidation.issues,
      tauriConfigTemporarilyPatched: updaterPatch.mutated,
      envPubkeyApplied: updaterPatch.usedEnvPubkey,
      envEndpointsApplied: updaterPatch.usedEnvEndpoints,
      channelEndpointAdjusted: updaterPatch.endpointsChanged,
    },
    artifacts: artifactEntries,
  };

  const manifestName = `release-manifest-v${version}-${stamp}.json`;
  const manifestPath = path.join(releaseDir, manifestName);
  const latestPath = path.join(releaseDir, 'latest-manifest.json');
  const checksumsPath = path.join(releaseDir, `checksums-v${version}-${stamp}.txt`);
  const channelDir = path.join(releaseDir, 'channels', releaseChannel);
  const channelManifestPath = path.join(channelDir, manifestName);
  const channelLatestPath = path.join(channelDir, 'latest-manifest.json');

  fs.mkdirSync(channelDir, { recursive: true });

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(channelManifestPath, JSON.stringify(manifest, null, 2));
  fs.writeFileSync(channelLatestPath, JSON.stringify(manifest, null, 2));

  const checksumLines = artifactEntries.map((entry) => `${entry.sha256}  ${entry.fileName}`).join('\n');
  fs.writeFileSync(checksumsPath, `${checksumLines}\n`);

  return {
    manifestPath,
    latestPath,
    checksumsPath,
    channelManifestPath,
    channelLatestPath,
    manifest,
  };
}

function main() {
  console.log('[release] prepare-production started');
  console.log(`[release] channel: ${releaseChannel}`);
  console.log(`[release] dry-run: ${dryRun ? 'yes' : 'no'}`);
  cleanupTemporaryConfigs();

  const { version, tauriConfig } = verifyVersionSync();
  console.log(`[release] version sync OK: ${version}`);
  checkLicensePublicKey();
  verifySigningEnvironment(releaseChannel);

  const updaterPatch = patchTauriUpdaterConfig({
    tauriConfig,
    channel: releaseChannel,
    env,
  });
  const effectiveTauriConfig = updaterPatch.config;

  const updaterValidation = validateUpdaterConfig({
    tauriConfig: effectiveTauriConfig,
    channel: releaseChannel,
  });

  if (!updaterValidation.valid && shouldRequireSignedArtifacts(releaseChannel)) {
    throw new Error(
      'Updater configuration is not production-ready:\n' +
      formatUpdaterIssues(updaterValidation.issues),
    );
  }

  if (!updaterValidation.valid) {
    console.warn('[release] updater configuration warnings:');
    for (const issue of updaterValidation.issues) {
      console.warn(`[release] - ${issue}`);
    }
  }

  let tempConfigPath = null;
  if (updaterPatch.mutated) {
    fs.mkdirSync(tempReleaseConfigDir, { recursive: true });
    tempConfigPath = path.join(tempReleaseConfigDir, `tauri.release.${Date.now()}.json`);
    fs.writeFileSync(tempConfigPath, `${JSON.stringify(effectiveTauriConfig, null, 2)}\n`);
    console.log(
      `[release] using temporary tauri config for channel=${releaseChannel}` +
      `${updaterPatch.usedEnvPubkey ? ' (env pubkey applied)' : ''}` +
      `${updaterPatch.usedEnvEndpoints ? ' (env endpoints applied)' : ''}` +
      `: ${path.relative(repoRoot, tempConfigPath).replace(/\\/g, '/')}`,
    );
  }

  try {
    if (dryRun) {
      console.log('[release] dry-run enabled: skipping QA, build and release artifact generation');
      return;
    }

    if (!skipQa) {
      run(process.execPath, ['scripts/dev/run-autonomous-cycle.js', '--fast']);
    } else {
      console.log('[release] QA preflight skipped (--skip-qa)');
    }

    if (skipBuild) {
      console.log('[release] tauri build skipped (--skip-build): using existing artifacts');
      verifyReleaseBinaryDoesNotContainDevSecrets();
    } else {
      verifyIntegrityKey();
      const tauriBuildArgs = ['scripts/dev/run-tauri-cli.js', 'build'];
      if (tempConfigPath) {
        tauriBuildArgs.push('--config', tempConfigPath);
      }
      run(process.execPath, tauriBuildArgs);
      verifyReleaseBinaryDoesNotContainDevSecrets();
    }

    // ── MANDATORY release gate ─────────────────────────────────────────
    // Exercises the full Comparison Report user workflow (4 fixtures →
    // 4 settings phases → 7 real Rust exports) against the freshly built
    // binary. If this fails, the release is structurally broken and we
    // must NOT generate the manifest / checksums.
    //
    // Can be bypassed ONLY via explicit `--skip-release-gate` flag or
    // `RHEOLAB_SKIP_RELEASE_GATE=1` env, and a loud warning is printed.
    // See docs/release/RELEASE_GATE.md for rationale.
    if (skipReleaseGate) {
      console.warn('[release] ⚠ WARNING: release gate SKIPPED (--skip-release-gate)');
      console.warn('[release] ⚠ The manifest you produce below has NOT been validated against');
      console.warn('[release] ⚠ the full user workflow. Use only for local debugging.');
    } else {
      console.log('\n[release] ── running mandatory release gate ──');
      run(process.execPath, ['scripts/test/run-release-gate.js']);
      console.log('[release] ✓ release gate passed\n');
    }

    const artifacts = listInstallerArtifacts(version);
    const {
      manifestPath,
      latestPath,
      checksumsPath,
      channelManifestPath,
      channelLatestPath,
      manifest,
    } = writeReleaseManifest(version, artifacts, updaterValidation, updaterPatch);

    console.log('\n[release] completed successfully');
    console.log(`[release] artifacts: ${manifest.artifacts.length}`);
    for (const artifact of manifest.artifacts) {
      console.log(
        `[release] ${artifact.fileName} | ${(artifact.sizeBytes / (1024 * 1024)).toFixed(2)} MB | sha256=${artifact.sha256}`,
      );
    }
    console.log(`[release] manifest: ${manifestPath}`);
    console.log(`[release] latest: ${latestPath}`);
    console.log(`[release] checksums: ${checksumsPath}`);
    console.log(`[release] channel manifest: ${channelManifestPath}`);
    console.log(`[release] channel latest: ${channelLatestPath}`);
    console.log('');
    console.log('[release] ──────────────────────────────────────────────');
    console.log('[release] Next step — publish the update to the VPS:');
    console.log('[release]   node scripts/deploy/publish-update.js');
    console.log('[release]   (or add --dry-run to preview without uploading)');
    console.log('[release] ──────────────────────────────────────────────');
  } finally {
    if (tempConfigPath) {
      try {
        fs.rmSync(tempConfigPath, { force: true });
      } catch (error) {
        console.warn(`[release] failed to remove temporary tauri config: ${String(error)}`);
      }
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[release] failed: ${message}`);
  process.exit(1);
}
