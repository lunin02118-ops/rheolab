import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Single source of truth for the published app version on the marketing site.
// Read from the repo-root version.json at build time so every download link
// (navbar, hero, footer, /download/latest fallback) always points at the
// freshly released installer instead of a hardcoded — and quickly stale —
// version string.
const versionJsonPath = fileURLToPath(new URL('../../../version.json', import.meta.url));

export const latestVersion: string = (
  JSON.parse(readFileSync(versionJsonPath, 'utf-8')) as { version: string }
).version;

const installerFile = `RheoLab Enterprise_${latestVersion}_x64-setup.exe`;

export const latestInstallerUrl =
  `https://license.vizbuka.ru/releases/artifacts/${latestVersion}/${encodeURIComponent(installerFile)}`;
