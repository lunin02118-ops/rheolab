const path = require('node:path');

function parseGeneratedAt(manifest) {
  const value = manifest?.generatedAt;
  if (typeof value !== 'string') {
    return Number.NaN;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function sortManifestEntries(entries) {
  return [...entries].sort((a, b) => {
    const aGeneratedAt = parseGeneratedAt(a.manifest);
    const bGeneratedAt = parseGeneratedAt(b.manifest);

    if (Number.isFinite(aGeneratedAt) && Number.isFinite(bGeneratedAt) && aGeneratedAt !== bGeneratedAt) {
      return bGeneratedAt - aGeneratedAt;
    }

    return path.basename(b.filePath).localeCompare(path.basename(a.filePath));
  });
}

function normalizeManifestArg(toManifest) {
  if (typeof toManifest !== 'string') {
    return null;
  }

  const trimmed = toManifest.trim();
  return trimmed ? path.basename(trimmed) : null;
}

function selectRollbackTarget({ entries, currentVersion, toManifest, toVersion }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('No channel manifests found to perform rollback.');
  }

  const sorted = sortManifestEntries(entries);
  const normalizedTargetName = normalizeManifestArg(toManifest);

  if (normalizedTargetName) {
    const explicitEntry = sorted.find((entry) => path.basename(entry.filePath) === normalizedTargetName);
    if (!explicitEntry) {
      throw new Error(`Requested rollback manifest not found: ${normalizedTargetName}`);
    }
    return explicitEntry;
  }

  if (toVersion) {
    const versionEntry = sorted.find((entry) => entry.manifest?.version === toVersion);
    if (!versionEntry) {
      const available = sorted
        .map((e) => `  ${e.manifest?.version ?? '(unknown)'}  ←  ${path.basename(e.filePath)}`)
        .join('\n');
      throw new Error(
        `No manifest found for version ${toVersion}.\nAvailable versions:\n${available}`,
      );
    }
    return versionEntry;
  }

  const autoEntry = sorted.find((entry) => entry.manifest?.version !== currentVersion);
  if (!autoEntry) {
    throw new Error('Rollback target cannot be resolved automatically: no prior manifest with different version.');
  }

  return autoEntry;
}

module.exports = {
  parseGeneratedAt,
  sortManifestEntries,
  selectRollbackTarget,
};
