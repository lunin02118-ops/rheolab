import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import signingDryRunProof from '../../scripts/release/lib/signing-dry-run-proof.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CURRENT_VERSION = JSON.parse(
  readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
).version as string;

const utils = signingDryRunProof as any;
const {
  assertNoReleaseSecretLeak,
  createExpectedReleaseArtifacts,
  createSigningDryRunProof,
  writeSigningDryRunProof,
} = utils;

const secretEnv = {
  TAURI_SIGNING_PRIVATE_KEY: 'PRIVATE-KEY-SECRET-123456789',
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'PASSWORD-SECRET-123456789',
  INTEGRITY_SECRET_KEY: 'INTEGRITY-SECRET-123456789',
  BETA_CHANNEL_SECRET: 'BETA-SECRET-123456789',
  ALPHA_CHANNEL_SECRET: 'ALPHA-SECRET-123456789',
  LICENSE_ENCRYPTION_KEY: 'LICENSE-SECRET-123456789',
};

const updaterValidation = {
  valid: true,
  summary: {
    configured: true,
    endpointCount: 1,
    endpoints: ['https://license.vizbuka.ru/releases/v1/update/windows-x86_64/update?channel=beta'],
    pubkeyConfigured: true,
  },
  issues: [],
};

const updaterPatch = {
  mutated: true,
  usedEnvPubkey: false,
  usedEnvEndpoints: false,
  endpointsChanged: true,
};

function makeProof(overrides: Record<string, unknown> = {}) {
  return createSigningDryRunProof({
    version: '0.2.3-alpha.19',
    channel: 'beta',
    tauriConfig: {
      productName: 'RheoLab Enterprise',
    },
    updaterValidation,
    updaterPatch,
    env: secretEnv,
    allowUnsigned: false,
    ...overrides,
  });
}

describe('signing dry-run proof', () => {
  let tmpRoot: string | null = null;

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = null;
    }
  });

  it('creates deterministic release artifact names', () => {
    const artifacts = createExpectedReleaseArtifacts({
      productName: 'RheoLab Enterprise',
      version: '0.2.3-alpha.19',
      channel: 'beta',
    });

    expect(artifacts).toEqual(createExpectedReleaseArtifacts({
      productName: 'RheoLab Enterprise',
      version: '0.2.3-alpha.19',
      channel: 'beta',
    }));
    expect(artifacts.installerFileName).toBe('RheoLab Enterprise_0.2.3-alpha.19_x64-setup.exe');
    expect(artifacts.signatureFileName).toBe('RheoLab Enterprise_0.2.3-alpha.19_x64-setup.exe.sig');
    expect(artifacts.updaterPlatform).toBe('windows-x86_64');
    expect(artifacts.updaterManifestFileName).toBe('beta.json');
    expect(artifacts.dryRunProofFileName).toBe(
      'signing-dry-run-proof-beta-v0.2.3-alpha.19.json',
    );
  });

  it('records signing policy without embedding secret material', () => {
    const proof = makeProof();
    const serialized = JSON.stringify(proof);

    for (const secret of Object.values(secretEnv)) {
      expect(serialized).not.toContain(secret);
    }
    expect(proof.policy.signingEnvironmentValidated).toBe(true);
    expect(proof.signing.privateKeyConfigured).toBe(true);
    expect(proof.signing.strictSignedDryRun).toBe(true);
    expect(proof.compileTimeSecrets.integrityKeyConfigured).toBe(true);
    expect(proof.updater.validationIssues).toEqual([]);
  });

  it('marks allow-unsigned dry-runs as non-strict signing proof', () => {
    const proof = makeProof({
      env: {},
      allowUnsigned: true,
    });

    expect(proof.policy.allowUnsignedOverride).toBe(true);
    expect(proof.policy.signingEnvironmentValidated).toBe(false);
    expect(proof.signing.privateKeyConfigured).toBe(false);
    expect(proof.signing.strictSignedDryRun).toBe(false);
  });

  it('fails closed if proof text contains release secret values', () => {
    expect(() =>
      assertNoReleaseSecretLeak(
        { leaked: secretEnv.TAURI_SIGNING_PRIVATE_KEY },
        secretEnv,
      ),
    ).toThrow(/TAURI_SIGNING_PRIVATE_KEY/);

    try {
      assertNoReleaseSecretLeak(
        { leaked: secretEnv.TAURI_SIGNING_PRIVATE_KEY },
        secretEnv,
      );
    } catch (error) {
      expect(String(error)).not.toContain(secretEnv.TAURI_SIGNING_PRIVATE_KEY);
    }
  });

  it('writes proof to a deterministic ignored runtime path', () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'rheolab-release-proof-'));
    const proof = makeProof();
    const proofPath = writeSigningDryRunProof({
      repoRoot: tmpRoot,
      proof,
      env: secretEnv,
    });

    expect(basename(proofPath)).toBe('signing-dry-run-proof-beta-v0.2.3-alpha.19.json');
    expect(proofPath.replace(/\\/g, '/')).toContain('/runtime/release/dry-run/');
    expect(existsSync(proofPath)).toBe(true);
    expect(readFileSync(proofPath, 'utf8')).toMatch(/\n$/);
  });

  it('release:prepare dry-run writes proof without printing secrets', () => {
    const env = {
      ...process.env,
      ...secretEnv,
      RHEOLAB_RELEASE_CHANNEL: '',
    };
    const result = spawnSync(
      process.execPath,
      ['scripts/release/prepare-production.js', '--channel', 'beta', '--dry-run', '--skip-qa'],
      {
        cwd: REPO_ROOT,
        env,
        encoding: 'utf8',
      },
    );

    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status, output).toBe(0);
    expect(output).toContain('signing dry-run proof');
    for (const secret of Object.values(secretEnv)) {
      expect(output).not.toContain(secret);
    }

    const proofPath = join(
      REPO_ROOT,
      'runtime',
      'release',
      'dry-run',
      `signing-dry-run-proof-beta-v${CURRENT_VERSION}.json`,
    );
    const proofText = readFileSync(proofPath, 'utf8');
    for (const secret of Object.values(secretEnv)) {
      expect(proofText).not.toContain(secret);
    }

    const proof = JSON.parse(proofText);
    expect(proof.policy.signingEnvironmentValidated).toBe(true);
    expect(proof.policy.updaterConfigValidated).toBe(true);
    expect(proof.artifactNaming.installerFileName).toBe(
      `RheoLab Enterprise_${CURRENT_VERSION}_x64-setup.exe`,
    );
  });
});
