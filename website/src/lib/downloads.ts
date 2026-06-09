import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..', '..', '..');
const versionInfo = JSON.parse(
  readFileSync(resolve(repoRoot, 'version.json'), 'utf8')
) as { version: string };

export const appVersion = versionInfo.version;
export const updateManifestUrl =
  'https://license.vizbuka.ru/releases/v1/update/windows-x86_64/stable.json';

const installerFileName = `RheoLab Enterprise_${appVersion}_x64-setup.exe`;

export const fallbackInstallerUrl =
  `https://license.vizbuka.ru/releases/artifacts/${appVersion}/${encodeURIComponent(installerFileName)}`;

export const latestDownloadPath = `/download/latest/?v=${encodeURIComponent(appVersion)}`;
