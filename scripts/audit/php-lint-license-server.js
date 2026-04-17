#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const licenseRoot = path.join(repoRoot, 'license-server');
const args = process.argv.slice(2);
const reportPathArg = args.find((arg) => arg.startsWith('--report-json='));
const reportPath = reportPathArg ? path.resolve(repoRoot, reportPathArg.split('=')[1]) : null;

function writeReport(payload) {
  if (!reportPath) {
    return;
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function walkPhpFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') {
        continue;
      }

      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }

      if (entry.isFile() && absolutePath.toLowerCase().endsWith('.php')) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort();
}

function runPhpLint(filePath) {
  return spawnSync('php', ['-l', filePath], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    encoding: 'utf8',
  });
}

function main() {
  if (!fs.existsSync(licenseRoot)) {
    console.error('[php-lint] license-server directory not found');
    writeReport({
      status: 'error',
      reason: 'license-server directory not found',
      filesChecked: 0,
      failedFiles: [],
    });
    process.exit(1);
  }

  const phpVersion = spawnSync('php', ['-v'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    encoding: 'utf8',
  });

  if (phpVersion.error || phpVersion.status !== 0) {
    console.error('[php-lint] php runtime is unavailable in PATH');
    if (phpVersion.error) {
      console.error(`[php-lint] ${phpVersion.error.message}`);
    }
    if (phpVersion.stderr) {
      console.error(phpVersion.stderr.trim());
    }
    writeReport({
      status: 'runtime_unavailable',
      reason: 'php runtime is unavailable in PATH',
      filesChecked: 0,
      failedFiles: [],
    });
    process.exit(127);
  }

  const phpFiles = walkPhpFiles(licenseRoot);
  if (phpFiles.length === 0) {
    console.log('[php-lint] no php files found under license-server');
    writeReport({
      status: 'ok',
      reason: 'no php files found under license-server',
      filesChecked: 0,
      failedFiles: [],
    });
    process.exit(0);
  }

  console.log(`[php-lint] checking ${phpFiles.length} files`);
  const failures = [];

  for (const filePath of phpFiles) {
    const result = runPhpLint(filePath);
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');

    if (result.status === 0) {
      console.log(`[php-lint] OK ${relPath}`);
      continue;
    }

    failures.push({
      file: relPath,
      status: result.status ?? 1,
      stderr: (result.stderr || '').trim(),
      stdout: (result.stdout || '').trim(),
    });

    console.error(`[php-lint] FAIL ${relPath}`);
    if (result.stdout) {
      console.error(result.stdout.trim());
    }
    if (result.stderr) {
      console.error(result.stderr.trim());
    }
  }

  if (failures.length > 0) {
    console.error(`[php-lint] failed files: ${failures.length}/${phpFiles.length}`);
    writeReport({
      status: 'fail',
      reason: 'php lint failures detected',
      filesChecked: phpFiles.length,
      failedFiles: failures,
    });
    process.exit(1);
  }

  console.log('[php-lint] all files are valid');
  writeReport({
    status: 'ok',
    reason: 'all files are valid',
    filesChecked: phpFiles.length,
    failedFiles: [],
  });
}

main();
