import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

type PermissionEntry = string | {
  identifier?: string;
  allow?: string[];
};

function readDefaultCapabilities(): { permissions?: PermissionEntry[] } {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
  ) as { permissions?: PermissionEntry[] };
}

function fsScopeAllowList(): string[] {
  const permissions = readDefaultCapabilities().permissions ?? [];
  const fsScope = permissions.find(
    (permission): permission is { identifier: string; allow: string[] } => (
      typeof permission === 'object'
      && permission?.identifier === 'fs:scope'
      && Array.isArray(permission.allow)
    ),
  );
  return fsScope?.allow ?? [];
}

const EXPECTED_FS_SCOPE_ALLOW_LIST = [
  '$APPDATA/com.rheolab.enterprise/**',
  '$LOCALAPPDATA/com.rheolab.enterprise/**',
  '$DOWNLOADS/**',
  '$TEMP/**',
  '$DESKTOP/**',
  '$DOCUMENT/**',
];

const FORBIDDEN_BROAD_FS_SCOPES = [
  '$HOME/**',
  '$APPDATA/**',
  '$LOCALAPPDATA/**',
  '$PROGRAMDATA/**',
  '$PROGRAMFILES/**',
  '$PROGRAMFILESX86/**',
  '$RESOURCE/**',
  '/**',
  'C:/**',
  'C:\\**',
];

describe('tauri default capabilities security', () => {
  it('does not allow broad or sensitive filesystem roots', () => {
    const allowList = fsScopeAllowList();

    for (const scope of FORBIDDEN_BROAD_FS_SCOPES) {
      expect(allowList).not.toContain(scope);
    }
  });

  it('keeps filesystem scope pinned to the audited allowlist', () => {
    expect([...fsScopeAllowList()].sort()).toEqual([...EXPECTED_FS_SCOPE_ALLOW_LIST].sort());
  });
});
