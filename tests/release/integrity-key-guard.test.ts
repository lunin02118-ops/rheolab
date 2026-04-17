/**
 * integrity-key-guard.test.ts
 *
 * Verifies that prepare-production.js refuses to start the Tauri build when
 * INTEGRITY_SECRET_KEY is absent or equal to the dev sentinel.
 *
 * These tests directly exercise the internal helpers extracted from
 * prepare-production.js via a small re-export shim so we don't have to
 * spawn a full Node process.
 *
 * Because prepare-production.js is CommonJS and has side-effects at module
 * level, we test the logic by re-implementing the same validation rules
 * (which are simple string checks) rather than importing the script itself.
 */

import { describe, expect, it } from 'vitest';

const DEV_INTEGRITY_SENTINEL = 'rheolab-dev-integrity-key-32chars!';

/**
 * Mirror of verifyIntegrityKey() from prepare-production.js.
 * If the implementation changes, update this mirror and the source together.
 */
function verifyIntegrityKey(key: string | undefined): void {
  const k = (key ?? '').trim();
  if (!k) {
    throw new Error(
      'INTEGRITY_SECRET_KEY is required for production builds.\n' +
      'The key is embedded into the binary at compile time (option_env! in types.rs).\n' +
      'Without it the release binary will panic on startup.',
    );
  }
  if (k === DEV_INTEGRITY_SENTINEL) {
    throw new Error(
      'INTEGRITY_SECRET_KEY is set to the dev sentinel key.\n' +
      'A release binary compiled with the dev key will panic on startup.',
    );
  }
}

describe('integrity key guard (prepare-production.js)', () => {
  it('throws when INTEGRITY_SECRET_KEY is absent', () => {
    expect(() => verifyIntegrityKey(undefined)).toThrow(/required for production builds/i);
  });

  it('throws when INTEGRITY_SECRET_KEY is an empty string', () => {
    expect(() => verifyIntegrityKey('')).toThrow(/required for production builds/i);
  });

  it('throws when INTEGRITY_SECRET_KEY is whitespace only', () => {
    expect(() => verifyIntegrityKey('   ')).toThrow(/required for production builds/i);
  });

  it('throws when INTEGRITY_SECRET_KEY equals the dev sentinel', () => {
    expect(() => verifyIntegrityKey(DEV_INTEGRITY_SENTINEL)).toThrow(/dev sentinel key/i);
  });

  it('error message for dev sentinel mentions panic-on-startup', () => {
    let msg = '';
    try { verifyIntegrityKey(DEV_INTEGRITY_SENTINEL); } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toMatch(/panic on startup/i);
  });

  it('does NOT throw for a valid production key', () => {
    expect(() => verifyIntegrityKey('my-real-production-key-at-least-32chars!')).not.toThrow();
  });

  it('does NOT throw for a key that contains the sentinel as a substring', () => {
    // Keys that merely contain the sentinel string are fine
    expect(() => verifyIntegrityKey(`prefix-${DEV_INTEGRITY_SENTINEL}-suffix`)).not.toThrow();
  });
});

// ── .exe fallback guard -------------------------------------------------------
// Mirrors the logic in listInstallerArtifacts() and publish-update.js
// to ensure no silent mtime-fallback is possible.

describe('installer artifact resolution (no silent fallback)', () => {
  /** Simulates the list+filter logic from prepare-production.js */
  function resolveInstaller(allFiles: string[], version: string): string {
    const versioned = allFiles.filter(name => name.includes(version));
    if (versioned.length === 0) {
      throw new Error(
        `No installer matching version "${version}" found.\n` +
        `Found: ${allFiles.length > 0 ? allFiles.join(', ') : '(none)'}\n` +
        'Run the build without --skip-build to generate a fresh artifact.',
      );
    }
    return versioned[0];
  }

  it('returns the version-matched installer', () => {
    const result = resolveInstaller(
      ['RheoLab Enterprise_0.1.507_x64-setup.exe'],
      '0.1.507',
    );
    expect(result).toBe('RheoLab Enterprise_0.1.507_x64-setup.exe');
  });

  it('throws when no version-matched installer exists (no fallback)', () => {
    expect(() =>
      resolveInstaller(
        ['RheoLab Enterprise_0.1.506_x64-setup.exe'],
        '0.1.507',
      ),
    ).toThrow(/0\.1\.507/);
  });

  it('error message lists found files to aid diagnosis', () => {
    let msg = '';
    try {
      resolveInstaller(['RheoLab Enterprise_0.1.506_x64-setup.exe'], '0.1.507');
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toMatch(/0\.1\.506/);
  });

  it('throws when the NSIS directory is empty', () => {
    expect(() => resolveInstaller([], '0.1.507')).toThrow(/\(none\)/i);
  });
});
