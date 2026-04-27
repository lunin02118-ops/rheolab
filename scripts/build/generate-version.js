const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJsonPath = path.join(__dirname, '../../package.json');
const versionFilePath = path.join(__dirname, '../../src/lib/version.ts');
const cargoTomlPath = path.join(__dirname, '../../src-tauri/Cargo.toml');
const skipVersionBump = process.env.RHEOLAB_SKIP_VERSION_BUMP === '1';

function updateCargoVersion(nextVersion) {
    if (!fs.existsSync(cargoTomlPath)) {
        return;
    }

    const original = fs.readFileSync(cargoTomlPath, 'utf-8');
    const lines = original.split(/\r?\n/);
    let inPackageSection = false;
    let updated = false;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('[')) {
            inPackageSection = trimmed === '[package]';
            continue;
        }

        if (inPackageSection && /^version\s*=/.test(trimmed)) {
            lines[i] = `version = "${nextVersion}"`;
            updated = true;
            break;
        }
    }

    if (!updated) {
        console.warn('Cargo.toml package version field not found, skipping Cargo version sync.');
        return;
    }

    const normalizedEol = original.includes('\r\n') ? '\r\n' : '\n';
    const result = `${lines.join(normalizedEol)}${normalizedEol}`;

    if (result !== original) {
        fs.writeFileSync(cargoTomlPath, result);
        console.log(`Updated Cargo.toml version to ${nextVersion}`);
    }
}

// Читаем версию из package.json
const packageJson = require(packageJsonPath);
let version = packageJson.version;

function bumpVersion(currentVersion) {
    const prereleaseMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)-([A-Za-z]+)\.(\d+)$/);
    if (prereleaseMatch) {
        const [, major, minor, patch, tag, pre] = prereleaseMatch;
        return `${major}.${minor}.${patch}-${tag}.${Number(pre) + 1}`;
    }

    const parts = currentVersion.split('.').map(Number);
    if (parts.length === 3 && parts.every(n => Number.isFinite(n))) {
        parts[2]++;
        return parts.join('.');
    }

    throw new Error(`Unsupported version format: ${currentVersion}`);
}

// Auto-increment patch version (disabled for CI/reproducible verification runs)
if (skipVersionBump) {
    console.log('Skipping version bump (RHEOLAB_SKIP_VERSION_BUMP=1).');
} else {
    try {
        version = bumpVersion(version);
        packageJson.version = version;
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        console.log(`Bumped version to ${version}`);

        // Update tauri.conf.json
        const tauriConfPath = path.join(__dirname, '../../src-tauri/tauri.conf.json');
        if (fs.existsSync(tauriConfPath)) {
            const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
            tauriConf.version = version;
            fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\r\n');
            console.log(`Updated tauri.conf.json to ${version}`);
        }

        updateCargoVersion(version);
    } catch (e) {
        console.error('Failed to bump version:', e);
    }
}

// Получаем дату сборки (Local Time)
const now = new Date();
const offset = now.getTimezoneOffset() * 60000;
const localDate = new Date(now.getTime() - offset);
const buildDate = localDate.toISOString().split('T')[0];

// Получаем хеш коммита (если есть git)
let commitHash = 'dev';
try {
    commitHash = execSync('git rev-parse --short HEAD', {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
        .toString()
        .trim();
} catch (e) {
    const ciHash = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA;
    if (ciHash && ciHash.length >= 7) {
        commitHash = ciHash.slice(0, 7);
    } else {
        console.warn('Git hash not found, using "dev"');
    }
}

// Генерируем файл с версией
const content = `/**
 * Auto-generated version file
 * Do not edit manually
 */

export const APP_VERSION = '${version}';
export const BUILD_DATE = '${buildDate}';
export const COMMIT_HASH = '${commitHash}';
`;

fs.writeFileSync(versionFilePath, content);
console.log(`Version file updated: ${version} (${commitHash})`);
