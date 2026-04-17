#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const isFastMode = args.includes('--fast');

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logsDir = path.join(repoRoot, 'runtime', 'qa');
const logPath = path.join(logsDir, `autonomous-cycle-${timestamp}.log`);

fs.mkdirSync(logsDir, { recursive: true });
fs.writeFileSync(logPath, '');

function appendLog(message) {
  fs.appendFileSync(logPath, message);
}

function logLine(message) {
  const line = `${message}\n`;
  process.stdout.write(line);
  appendLog(line);
}

function runCommand(command) {
  return new Promise((resolve) => {
    logLine(`\n[autonomous-cycle] ${command}`);

    const child = spawn(command, {
      cwd: repoRoot,
      env: process.env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      appendLog(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      appendLog(text);
    });

    child.on('error', (error) => {
      logLine(`[autonomous-cycle] failed to start command: ${error.message}`);
      resolve(1);
    });

    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  logLine('[autonomous-cycle] starting');
  logLine(`[autonomous-cycle] mode: ${isFastMode ? 'fast' : 'full'}`);
  logLine(`[autonomous-cycle] repo: ${repoRoot}`);
  logLine(`[autonomous-cycle] log: ${logPath}`);

  const commands = [
    'npm run -s test:desktop-core',
    'npm run -s build:ci',
  ];

  if (!isFastMode) {
    commands.push('npm run -s tauri:build:debug');
  }

  for (const command of commands) {
    const code = await runCommand(command);
    if (code !== 0) {
      logLine(`[autonomous-cycle] failed: "${command}" (exit ${code})`);
      logLine(`[autonomous-cycle] log file: ${logPath}`);
      process.exit(code);
    }
  }

  logLine('\n[autonomous-cycle] all steps passed');
  logLine(`[autonomous-cycle] log file: ${logPath}`);
}

main().catch((error) => {
  logLine(`[autonomous-cycle] unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  logLine(`[autonomous-cycle] log file: ${logPath}`);
  process.exit(1);
});
