#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  resolveReleaseChannel,
} = require('./lib/release-policy');
const {
  selectRollbackTarget,
} = require('./lib/rollback-utils');

const repoRoot = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const channel = resolveReleaseChannel(args, process.env.RHEOLAB_RELEASE_CHANNEL);

function readFlagValue(name) {
  const index = args.findIndex((item) => item === name);
  if (index < 0) {
    return null;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Flag ${name} requires a value`);
  }

  return value;
}

const toManifest = readFlagValue('--to-manifest');
const toVersion = readFlagValue('--to-version');
const reason = readFlagValue('--reason') || 'manual rollback';

function readJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function listChannelManifestEntries(channelDir) {
  if (!fs.existsSync(channelDir)) {
    return [];
  }

  return fs
    .readdirSync(channelDir)
    .filter((name) => /^release-manifest-v.+\.json$/i.test(name))
    .map((name) => {
      const filePath = path.join(channelDir, name);
      return {
        filePath,
        manifest: readJson(filePath),
      };
    });
}

function listRootManifestEntries(releaseDir) {
  if (!fs.existsSync(releaseDir)) {
    return [];
  }

  return fs
    .readdirSync(releaseDir)
    .filter((name) => /^release-manifest-v.+\.json$/i.test(name))
    .map((name) => {
      const filePath = path.join(releaseDir, name);
      return {
        filePath,
        manifest: readJson(filePath),
      };
    });
}

function toStamp(value) {
  return value.replace(/[:.]/g, '-');
}

function main() {
  console.log(`[release:rollback] channel: ${channel}`);
  console.log(`[release:rollback] dry-run: ${dryRun ? 'yes' : 'no'}`);

  const channelDir = path.join(repoRoot, 'runtime', 'release', 'channels', channel);
  const releaseDir = path.join(repoRoot, 'runtime', 'release');
  const channelLatestPath = path.join(channelDir, 'latest-manifest.json');
  const globalLatestPath = path.join(releaseDir, 'latest-manifest.json');
  const shouldFallbackToGlobalStable = channel === 'stable';

  const latestPath = fs.existsSync(channelLatestPath)
    ? channelLatestPath
    : shouldFallbackToGlobalStable
      ? globalLatestPath
      : null;

  if (!latestPath || !fs.existsSync(latestPath)) {
    throw new Error(`latest-manifest.json not found for channel "${channel}"`);
  }

  const currentManifest = readJson(latestPath);
  const entries = [
    ...listChannelManifestEntries(channelDir),
    ...(shouldFallbackToGlobalStable ? listRootManifestEntries(releaseDir) : []),
  ];
  const targetEntry = selectRollbackTarget({
    entries,
    currentVersion: currentManifest.version,
    toManifest,
    toVersion,
  });

  console.log(`[release:rollback] from version: ${currentManifest.version}`);
  console.log(`[release:rollback] to version: ${targetEntry.manifest.version}`);
  console.log(`[release:rollback] target manifest: ${path.basename(targetEntry.filePath)}`);

  if (dryRun) {
    console.log('[release:rollback] dry-run complete, no files were modified.');
    return;
  }

  fs.mkdirSync(channelDir, { recursive: true });
  writeJson(channelLatestPath, targetEntry.manifest);

  // Keep root latest aligned with stable channel distribution.
  if (channel === 'stable') {
    writeJson(globalLatestPath, targetEntry.manifest);
  }

  const generatedAt = new Date().toISOString();
  const rollbackRecord = {
    generatedAt,
    channel,
    reason,
    fromVersion: currentManifest.version,
    fromGeneratedAt: currentManifest.generatedAt || null,
    toVersion: targetEntry.manifest.version,
    toGeneratedAt: targetEntry.manifest.generatedAt || null,
    toManifestFile: path.basename(targetEntry.filePath),
    operator: process.env.USER || process.env.USERNAME || 'unknown',
  };

  const rollbackLogPath = path.join(
    channelDir,
    `rollback-log-${toStamp(generatedAt)}.json`,
  );
  writeJson(rollbackLogPath, rollbackRecord);

  console.log(`[release:rollback] updated channel latest: ${channelLatestPath}`);
  if (channel === 'stable') {
    console.log(`[release:rollback] updated global latest: ${globalLatestPath}`);
  }
  console.log(`[release:rollback] audit log: ${rollbackLogPath}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[release:rollback] failed: ${message}`);
  process.exit(1);
}
