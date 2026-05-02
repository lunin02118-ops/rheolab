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

describe('tauri default capabilities security', () => {
  it('does not allow broad home-directory filesystem access', () => {
    expect(fsScopeAllowList()).not.toContain('$HOME/**');
  });

  it('keeps filesystem scope on explicit application/user document roots', () => {
    expect(fsScopeAllowList()).toEqual(expect.arrayContaining([
      '$APPDATA/com.rheolab.enterprise/**',
      '$LOCALAPPDATA/com.rheolab.enterprise/**',
      '$DOWNLOADS/**',
      '$TEMP/**',
      '$DESKTOP/**',
      '$DOCUMENT/**',
    ]));
  });
});
