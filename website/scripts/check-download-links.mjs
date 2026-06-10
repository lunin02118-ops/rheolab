#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = join(websiteRoot, 'src');
const allowedHelper = 'src/lib/downloads.ts';
const directArtifactPattern = /https:\/\/license\.vizbuka\.ru\/releases\/artifacts\//;

function listSourceFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }
    if (/\.(astro|js|mjs|ts)$/.test(entry)) {
      files.push(path);
    }
  }

  return files;
}

const violations = [];
for (const file of listSourceFiles(srcRoot)) {
  const rel = relative(websiteRoot, file).replaceAll('\\', '/');
  if (rel === allowedHelper) {
    continue;
  }

  const text = readFileSync(file, 'utf8');
  if (directArtifactPattern.test(text)) {
    violations.push(rel);
  }
}

if (violations.length > 0) {
  console.error('Website source must not hard-code release artifact URLs.');
  console.error(`Use ${allowedHelper} instead. Violations:`);
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
