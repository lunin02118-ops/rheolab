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

function permissionIdentifiers(): string[] {
  return (readDefaultCapabilities().permissions ?? []).flatMap((permission) => {
    if (typeof permission === 'string') {
      return [permission];
    }

    return permission.identifier ? [permission.identifier] : [];
  });
}

const EXPECTED_FS_SCOPE_ALLOW_LIST = [
  '$APPDATA/com.rheolab.enterprise/**',
  '$LOCALAPPDATA/com.rheolab.enterprise/**',
  '$DOWNLOADS/*.pdf',
  '$DOWNLOADS/*.xlsx',
  '$DOWNLOADS/*.json',
  '$DOWNLOADS/*.db',
  '$DOWNLOADS/**/*.pdf',
  '$DOWNLOADS/**/*.xlsx',
  '$DOWNLOADS/**/*.json',
  '$DOWNLOADS/**/*.db',
  '$DESKTOP/*.pdf',
  '$DESKTOP/*.xlsx',
  '$DESKTOP/*.json',
  '$DESKTOP/*.db',
  '$DESKTOP/**/*.pdf',
  '$DESKTOP/**/*.xlsx',
  '$DESKTOP/**/*.json',
  '$DESKTOP/**/*.db',
  '$DOCUMENT/*.pdf',
  '$DOCUMENT/*.xlsx',
  '$DOCUMENT/*.json',
  '$DOCUMENT/*.db',
  '$DOCUMENT/**/*.pdf',
  '$DOCUMENT/**/*.xlsx',
  '$DOCUMENT/**/*.json',
  '$DOCUMENT/**/*.db',
  '$TEMP/rheolab-comparison-export-*/*.pdf',
  '$TEMP/rheolab-comparison-export-*/*.xlsx',
];

const FORBIDDEN_BROAD_FS_SCOPES = [
  '$HOME/**',
  '$APPDATA/**',
  '$LOCALAPPDATA/**',
  '$PROGRAMDATA/**',
  '$PROGRAMFILES/**',
  '$PROGRAMFILESX86/**',
  '$RESOURCE/**',
  '$DOWNLOADS/**',
  '$TEMP/**',
  '$DESKTOP/**',
  '$DOCUMENT/**',
  '/**',
  'C:/**',
  'C:\\**',
];

const FORBIDDEN_UNUSED_PLUGIN_PERMISSIONS = [
  'opener:default',
  'os:default',
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

  it('does not expose currently unused default plugin permissions', () => {
    const permissions = permissionIdentifiers();

    for (const permission of FORBIDDEN_UNUSED_PLUGIN_PERMISSIONS) {
      expect(permissions).not.toContain(permission);
    }
  });

  it('does not initialize currently unused plugins', () => {
    const libSource = readFileSync(join(REPO_ROOT, 'src-tauri', 'src', 'lib.rs'), 'utf8');

    expect(libSource).not.toContain('tauri_plugin_opener::init()');
    expect(libSource).not.toContain('tauri_plugin_os::init()');
  });
});
