const fs = require('node:fs');
const path = require('node:path');
const { shouldRequireSignedArtifacts } = require('./release-policy');

const DEFAULT_PLATFORM = 'windows-x86_64';
const DEFAULT_ARCH_LABEL = 'x64';
const DEFAULT_PRODUCT_NAME = 'RheoLab Enterprise';
const SECRET_MIN_LENGTH = 8;

const RELEASE_SECRET_ENV_NAMES = [
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  'INTEGRITY_SECRET_KEY',
  'BETA_CHANNEL_SECRET',
  'ALPHA_CHANNEL_SECRET',
  'LICENSE_ENCRYPTION_KEY',
];

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function listReleaseSecretNames(env = {}) {
  const names = new Set(RELEASE_SECRET_ENV_NAMES);

  for (const name of Object.keys(env)) {
    if (/(SECRET|TOKEN|PASSWORD|PRIVATE)/i.test(name)) {
      names.add(name);
    }
  }

  return Array.from(names).filter((name) => !/PUBKEY|PUBLIC/i.test(name));
}

function collectReleaseSecretValues(env = {}, names = listReleaseSecretNames(env)) {
  const values = new Set();

  for (const name of names) {
    const value = env[name];
    if (typeof value !== 'string') {
      continue;
    }

    const variants = [value, value.trim()].filter(
      (entry) => entry.length >= SECRET_MIN_LENGTH,
    );
    for (const entry of variants) {
      values.add(entry);
    }
  }

  return Array.from(values).sort((a, b) => b.length - a.length);
}

function redactReleaseSecrets(value, env = {}) {
  let result = String(value);
  for (const secret of collectReleaseSecretValues(env)) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

function findLeakedReleaseSecretNames(payload, env = {}) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const leaked = [];

  for (const name of listReleaseSecretNames(env)) {
    const value = env[name];
    if (typeof value !== 'string') {
      continue;
    }

    const candidates = [value, value.trim()].filter(
      (entry) => entry.length >= SECRET_MIN_LENGTH,
    );
    if (candidates.some((candidate) => text.includes(candidate))) {
      leaked.push(name);
    }
  }

  return Array.from(new Set(leaked));
}

function assertNoReleaseSecretLeak(payload, env = {}) {
  const leakedNames = findLeakedReleaseSecretNames(payload, env);
  if (leakedNames.length > 0) {
    throw new Error(
      `Release dry-run proof contains secret values from: ${leakedNames.join(', ')}`,
    );
  }
}

function createExpectedReleaseArtifacts({
  productName = DEFAULT_PRODUCT_NAME,
  version,
  channel,
  platform = DEFAULT_PLATFORM,
  archLabel = DEFAULT_ARCH_LABEL,
}) {
  if (!version || typeof version !== 'string') {
    throw new Error('version is required for release artifact naming proof');
  }
  if (!channel || typeof channel !== 'string') {
    throw new Error('channel is required for release artifact naming proof');
  }

  const installerFileName = `${productName}_${version}_${archLabel}-setup.exe`;
  const encodedInstallerFileName = installerFileName.replace(/ /g, '%20');

  return {
    installerFileName,
    signatureFileName: `${installerFileName}.sig`,
    nsisDirectory: 'src-tauri/target/release/bundle/nsis',
    releaseManifestPattern: `release-manifest-v${version}-<timestamp>.json`,
    checksumsPattern: `checksums-v${version}-<timestamp>.txt`,
    releaseChannelLatestManifest: `runtime/release/channels/${channel}/latest-manifest.json`,
    updaterPlatform: platform,
    updaterManifestFileName: `${channel}.json`,
    updaterArtifactUrl:
      `https://license.vizbuka.ru/releases/artifacts/${version}/${encodedInstallerFileName}`,
    dryRunProofFileName: `signing-dry-run-proof-${channel}-v${version}.json`,
  };
}

function createSigningDryRunProof({
  version,
  channel,
  tauriConfig,
  updaterValidation,
  updaterPatch,
  env = {},
  allowUnsigned = false,
}) {
  const productName = tauriConfig?.productName || DEFAULT_PRODUCT_NAME;
  const signedArtifactsRequired = shouldRequireSignedArtifacts(channel);
  const signingPrivateKeyConfigured = hasValue(env.TAURI_SIGNING_PRIVATE_KEY);
  const signingPasswordConfigured = hasValue(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD);
  const allowUnsignedOverride = Boolean(allowUnsigned);
  const signingEnvironmentValidated = signedArtifactsRequired
    ? signingPrivateKeyConfigured && !allowUnsignedOverride
    : true;

  const proof = {
    schemaVersion: 1,
    kind: 'release-signing-dry-run-proof',
    version,
    channel,
    dryRun: true,
    publishingSkipped: true,
    buildSkipped: true,
    policy: {
      signedArtifactsRequired,
      allowUnsignedOverride,
      signingEnvironmentValidated,
      updaterConfigValidated: Boolean(updaterValidation?.valid),
      versionSyncValidated: true,
    },
    signing: {
      privateKeyConfigured: signingPrivateKeyConfigured,
      privateKeyPasswordConfigured: signingPasswordConfigured,
      strictSignedDryRun: signedArtifactsRequired
        ? signingEnvironmentValidated
        : !allowUnsignedOverride,
    },
    compileTimeSecrets: {
      integrityKeyConfigured: hasValue(env.INTEGRITY_SECRET_KEY),
      betaChannelSecretConfigured: hasValue(env.BETA_CHANNEL_SECRET),
      alphaChannelSecretConfigured: hasValue(env.ALPHA_CHANNEL_SECRET),
    },
    updater: {
      configured: Boolean(updaterValidation?.summary?.configured),
      endpointCount: updaterValidation?.summary?.endpointCount ?? 0,
      endpoints: (updaterValidation?.summary?.endpoints ?? []).map((endpoint) =>
        redactReleaseSecrets(endpoint, env),
      ),
      pubkeyConfigured: Boolean(updaterValidation?.summary?.pubkeyConfigured),
      validationIssues: (updaterValidation?.issues ?? []).map((issue) =>
        redactReleaseSecrets(issue, env),
      ),
      tauriConfigTemporarilyPatched: Boolean(updaterPatch?.mutated),
      envPubkeyApplied: Boolean(updaterPatch?.usedEnvPubkey),
      envEndpointsApplied: Boolean(updaterPatch?.usedEnvEndpoints),
      channelEndpointAdjusted: Boolean(updaterPatch?.endpointsChanged),
    },
    artifactNaming: createExpectedReleaseArtifacts({
      productName,
      version,
      channel,
    }),
  };

  assertNoReleaseSecretLeak(proof, env);
  return proof;
}

function writeSigningDryRunProof({ repoRoot, proof, env = {} }) {
  if (!repoRoot) {
    throw new Error('repoRoot is required to write signing dry-run proof');
  }
  if (!proof || typeof proof !== 'object') {
    throw new Error('proof object is required');
  }

  assertNoReleaseSecretLeak(proof, env);

  const dryRunDir = path.join(repoRoot, 'runtime', 'release', 'dry-run');
  const fileName = proof.artifactNaming?.dryRunProofFileName;
  if (!fileName) {
    throw new Error('proof.artifactNaming.dryRunProofFileName is required');
  }

  fs.mkdirSync(dryRunDir, { recursive: true });
  const proofPath = path.join(dryRunDir, fileName);
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);

  return proofPath;
}

module.exports = {
  RELEASE_SECRET_ENV_NAMES,
  collectReleaseSecretValues,
  redactReleaseSecrets,
  findLeakedReleaseSecretNames,
  assertNoReleaseSecretLeak,
  createExpectedReleaseArtifacts,
  createSigningDryRunProof,
  writeSigningDryRunProof,
};
