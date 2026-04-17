import { describe, expect, it } from 'vitest';
import rollbackUtils from '../../scripts/release/lib/rollback-utils.js';

 
const rollback = rollbackUtils as any;
const {
  sortManifestEntries,
  selectRollbackTarget,
} = rollback;

function entry(fileName: string, version: string, generatedAt: string) {
  return {
    filePath: `/tmp/${fileName}`,
    manifest: {
      version,
      generatedAt,
    },
  };
}

describe('rollback-utils', () => {
  it('sorts manifest entries by generatedAt descending', () => {
    const sorted = sortManifestEntries([
      entry('release-manifest-v0.1.10.json', '0.1.10', '2026-02-14T10:00:00.000Z'),
      entry('release-manifest-v0.1.09.json', '0.1.9', '2026-02-14T09:00:00.000Z'),
      entry('release-manifest-v0.1.11.json', '0.1.11', '2026-02-14T11:00:00.000Z'),
    ]);

    expect(sorted.map((item: { manifest: { version: string } }) => item.manifest.version)).toEqual([
      '0.1.11',
      '0.1.10',
      '0.1.9',
    ]);
  });

  it('selects previous manifest automatically when current is latest', () => {
    const target = selectRollbackTarget({
      currentVersion: '0.1.11',
      entries: [
        entry('release-manifest-v0.1.11.json', '0.1.11', '2026-02-14T11:00:00.000Z'),
        entry('release-manifest-v0.1.10.json', '0.1.10', '2026-02-14T10:00:00.000Z'),
      ],
    });

    expect(target.manifest.version).toBe('0.1.10');
  });

  it('selects explicit target by file name', () => {
    const target = selectRollbackTarget({
      currentVersion: '0.1.11',
      toManifest: 'release-manifest-v0.1.09.json',
      entries: [
        entry('release-manifest-v0.1.11.json', '0.1.11', '2026-02-14T11:00:00.000Z'),
        entry('release-manifest-v0.1.10.json', '0.1.10', '2026-02-14T10:00:00.000Z'),
        entry('release-manifest-v0.1.09.json', '0.1.9', '2026-02-14T09:00:00.000Z'),
      ],
    });

    expect(target.manifest.version).toBe('0.1.9');
  });

  it('throws when no rollback target exists', () => {
    expect(() =>
      selectRollbackTarget({
        currentVersion: '0.1.11',
        entries: [entry('release-manifest-v0.1.11.json', '0.1.11', '2026-02-14T11:00:00.000Z')],
      }),
    ).toThrow(/cannot be resolved/i);
  });

  // ── --to-version tests ────────────────────────────────────────────────────
  it('selects target by version with --to-version', () => {
    const target = selectRollbackTarget({
      currentVersion: '0.1.11',
      toVersion: '0.1.9',
      entries: [
        entry('release-manifest-v0.1.11.json', '0.1.11', '2026-02-14T11:00:00.000Z'),
        entry('release-manifest-v0.1.10.json', '0.1.10', '2026-02-14T10:00:00.000Z'),
        entry('release-manifest-v0.1.09.json', '0.1.9',  '2026-02-14T09:00:00.000Z'),
      ],
    });

    expect(target.manifest.version).toBe('0.1.9');
  });

  it('--to-version takes precedence over automatic selection', () => {
    const target = selectRollbackTarget({
      currentVersion: '0.1.11',
      toVersion: '0.1.9',
      entries: [
        entry('release-manifest-v0.1.11.json', '0.1.11', '2026-02-14T11:00:00.000Z'),
        entry('release-manifest-v0.1.10.json', '0.1.10', '2026-02-14T10:00:00.000Z'),
        entry('release-manifest-v0.1.09.json', '0.1.9',  '2026-02-14T09:00:00.000Z'),
      ],
    });

    // Should not fall back to 0.1.10 (the automatic previous version)
    expect(target.manifest.version).toBe('0.1.9');
  });

  it('throws when --to-version specifies a version that does not exist', () => {
    expect(() =>
      selectRollbackTarget({
        currentVersion: '0.1.11',
        toVersion: '0.1.5',
        entries: [
          entry('release-manifest-v0.1.11.json', '0.1.11', '2026-02-14T11:00:00.000Z'),
          entry('release-manifest-v0.1.10.json', '0.1.10', '2026-02-14T10:00:00.000Z'),
        ],
      }),
    ).toThrow(/0\.1\.5/);
  });

  it('error message for --to-version includes available versions', () => {
    let errorMessage = '';
    try {
      selectRollbackTarget({
        currentVersion: '0.1.11',
        toVersion: '0.1.5',
        entries: [
          entry('release-manifest-v0.1.11.json', '0.1.11', '2026-02-14T11:00:00.000Z'),
          entry('release-manifest-v0.1.10.json', '0.1.10', '2026-02-14T10:00:00.000Z'),
        ],
      });
    } catch (e: unknown) {
      errorMessage = e instanceof Error ? e.message : String(e);
    }
    expect(errorMessage).toMatch(/0\.1\.11/);
    expect(errorMessage).toMatch(/0\.1\.10/);
  });

  it('--to-manifest still takes precedence over --to-version when both supplied', () => {
    const target = selectRollbackTarget({
      currentVersion: '0.1.11',
      toManifest: 'release-manifest-v0.1.10.json',
      toVersion: '0.1.9',
      entries: [
        entry('release-manifest-v0.1.11.json', '0.1.11', '2026-02-14T11:00:00.000Z'),
        entry('release-manifest-v0.1.10.json', '0.1.10', '2026-02-14T10:00:00.000Z'),
        entry('release-manifest-v0.1.09.json', '0.1.9',  '2026-02-14T09:00:00.000Z'),
      ],
    });

    expect(target.manifest.version).toBe('0.1.10');
  });
});
