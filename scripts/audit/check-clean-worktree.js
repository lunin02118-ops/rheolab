#!/usr/bin/env node

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const maxEntries = Number(process.env.RHEOLAB_AUDIT_DIRTY_PATH_LIMIT || 120);

function runGit(args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fail(message, details = '') {
  console.error(`[clean-worktree] ${message}`);
  if (details.trim()) {
    console.error(details.trim());
  }
  process.exit(1);
}

function main() {
  const inside = runGit(['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    fail('not inside a Git worktree', `${inside.stdout || ''}${inside.stderr || ''}`);
  }

  const status = runGit(['status', '--porcelain=v1', '--untracked-files=normal']);
  if (status.status !== 0) {
    fail('failed to read Git worktree status', `${status.stdout || ''}${status.stderr || ''}`);
  }

  const entries = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (entries.length === 0) {
    console.log('[clean-worktree] clean: no tracked, staged, or untracked changes');
    process.exit(0);
  }

  const counts = entries.reduce((acc, line) => {
    const code = line.slice(0, 2);
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});

  console.error(`[clean-worktree] dirty: ${entries.length} changed path(s)`);
  console.error(`[clean-worktree] status counts: ${JSON.stringify(counts)}`);
  console.error(`[clean-worktree] first ${Math.min(entries.length, maxEntries)} path(s):`);
  for (const line of entries.slice(0, maxEntries)) {
    console.error(line);
  }
  if (entries.length > maxEntries) {
    console.error(`[clean-worktree] omitted ${entries.length - maxEntries} additional path(s)`);
  }
  console.error('[clean-worktree] commit, stash, or revert unrelated local changes before a release audit.');
  process.exit(1);
}

main();
