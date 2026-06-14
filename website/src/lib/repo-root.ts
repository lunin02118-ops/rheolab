import { existsSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findRepoRootFrom(importMetaUrl: string): string {
  let dir = dirname(fileURLToPath(importMetaUrl));
  const { root } = parse(dir);

  while (true) {
    if (existsSync(resolve(dir, 'version.json'))) {
      return dir;
    }
    if (dir === root) {
      throw new Error(`Unable to locate repo root from ${importMetaUrl}`);
    }
    dir = resolve(dir, '..');
  }
}
