#!/usr/bin/env node
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import pathModule from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = pathModule.dirname(__filename);
const path = pathModule;

const repoRoot = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const env = normalizeEnv(process.env);

function normalizeEnv(source) {
  const result = {};
  const seenEnvKeys = new Set();

  for (const [key, value] of Object.entries(source)) {
    if (!key || key.includes('=') || key.includes('\0')) {
      continue;
    }
    const lower = key.toLowerCase();
    if (seenEnvKeys.has(lower)) {
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    seenEnvKeys.add(lower);
    result[key] = value;
  }

  return result;
}

const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';

function prependPath(current, addition) {
  if (!current) return addition;
  const delimiter = process.platform === 'win32' ? ';' : ':';
  return `${addition}${delimiter}${current}`;
}

function ensureCargoInPath() {
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  const cargoExe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const rustcExe = process.platform === 'win32' ? 'rustc.exe' : 'rustc';
  const cargoPath = path.join(cargoBin, cargoExe);
  const rustcPath = path.join(cargoBin, rustcExe);

  if (fs.existsSync(cargoPath)) {
    env[pathKey] = prependPath(env[pathKey], cargoBin);
    if (!env.CARGO) {
      env.CARGO = cargoPath;
    }
  }

  if (fs.existsSync(rustcPath) && !env.RUSTC) {
    env.RUSTC = rustcPath;
  }
}

function ensureNodeInPath() {
  const nodeBin = path.dirname(process.execPath);
  if (nodeBin) {
    env[pathKey] = prependPath(env[pathKey], nodeBin);
  }
}

function ensureNsisInPath() {
  if (process.platform !== 'win32') {
    return;
  }

  const nsisDir = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NSIS');
  const makensisPath = path.join(nsisDir, 'makensis.exe');

  if (fs.existsSync(makensisPath)) {
    env[pathKey] = prependPath(env[pathKey], nsisDir);
    if (!env.MAKENSIS) {
      env.MAKENSIS = makensisPath;
    }
  }
}

ensureNodeInPath();
ensureCargoInPath();
ensureNsisInPath();

const isBuildCommand = args.some((arg) => String(arg).toLowerCase() === 'build');
const isDevCommand = args.length === 0 || args.some((arg) => String(arg).toLowerCase() === 'dev');
const isDebugBuild = args.some((arg) => String(arg).toLowerCase() === '--debug');

// ── Version SSoT enforcement (defense-in-depth) ──────────────────────────────
// Every build path goes through this wrapper, including ones that bypass npm
// pre-hooks (`prepare-production.js` spawns this script directly via spawnSync,
// so `pretauri:build` never fires). Run version policing here so a
// rassinkhron between /version.json and the four dependent files cannot reach
// `tauri build` regardless of how this script is invoked.
//
//   - `dev` / `--debug` builds: run `version:sync` (auto-fix any drift, since
//     dev iterations should never be blocked by version housekeeping).
//   - release `build` (no `--debug`): run `version:validate` (fail fast — a
//     production-grade build must not silently mutate version files).
{
    const child = require('node:child_process');
    const versionScript = (isBuildCommand && !isDebugBuild)
        ? path.join(repoRoot, 'scripts', 'version', 'validate.js')
        : path.join(repoRoot, 'scripts', 'version', 'sync.js');
    const versionResult = child.spawnSync(process.execPath, [versionScript], {
        cwd: repoRoot,
        stdio: 'inherit',
    });
    if (versionResult.status !== 0) {
        console.error(
            '[tauri-wrapper] aborting: version SSoT check failed ' +
            `(see output of ${path.relative(repoRoot, versionScript)} above).`,
        );
        process.exit(versionResult.status ?? 1);
    }
}

// `RHEOLAB_SKIP_VERSION_BUMP` is now a no-op — the SSoT mechanism never bumps
// — but the env var is preserved so any third-party tooling that still inspects
// it does not crash. Do NOT set it here; callers may set it themselves.

// ── Inject production keys for release builds ─────────────────────────────────
// Compile-time requirements for a valid release binary:
//
//   1. INTEGRITY_SECRET_KEY  — option_env! in types.rs; baked into the binary.
//      Without it cargo silently uses the dev sentinel and the binary panics
//      on startup.
//
//   2. BETA_CHANNEL_SECRET   — option_env! in update-channel signing; baked in.
//      Required for X-Update-Token on the beta channel.
//
//   3. ALPHA_CHANNEL_SECRET  — option_env! in update-channel signing; baked in.
//      Required for X-Update-Token on the alpha channel. Must stay in sync with
//      scripts/release/prepare-production.js `_compileTimeSecretNames`, otherwise
//      builds through this wrapper diverge from the canonical release flow and
//      the proc-macro `tauri::generate_context!()` may skip frontend embedding
//      entirely (observed as a ~1 MB installer with no dist assets).
//
//   4. TAURI_SIGNING_PRIVATE_KEY — Tauri reads this at build time to produce
//      the .sig file alongside the installer. Without it auto-update silently
//      breaks for all installed clients (no signature = updater rejects the
//      bundle).
//
// All are loaded here so every build path (npm run tauri:build, VS Code task,
// CI, direct node invocation) works identically without requiring build.ps1.
// An explicit env var in the calling process always takes precedence.
if (isBuildCommand) {
  // ── 1. Load string values from .env.keys ───────────────────────────────────
  // Only the keys Tauri/cargo actually need are injected; the rest are ignored
  // to avoid polluting the cargo environment with unrelated secrets.
  // Keep this list in sync with scripts/release/prepare-production.js.
  const KEYS_ALLOWLIST = new Set([
    'INTEGRITY_SECRET_KEY',
    'BETA_CHANNEL_SECRET',
    'ALPHA_CHANNEL_SECRET',
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  ]);

  const keysFile = path.join(repoRoot, 'scripts', 'dev', '.env.keys');
  if (fs.existsSync(keysFile)) {
    const lines = fs.readFileSync(keysFile, 'utf8').split(/\r?\n/);  // handle both CRLF and LF
    let loaded = 0;
    for (const line of lines) {
      const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.+)$/);
      if (!m) continue;
      const k = m[1].trim();
      const v = m[2].trim();
      if (KEYS_ALLOWLIST.has(k) && !env[k]) {  // explicit process env always wins
        env[k] = v;
        loaded++;
      }
    }
    if (loaded > 0) {
      console.log(`[tauri-wrapper] injected ${loaded} key(s) from scripts/dev/.env.keys`);
    }
  } else {
    console.warn(
      '[tauri-wrapper] WARNING: scripts/dev/.env.keys not found.\n' +
      '  INTEGRITY_SECRET_KEY will be missing — release binary will panic on startup.\n' +
      '  Create the file or set INTEGRITY_SECRET_KEY in the environment.',
    );
  }

  // ── 2. Load TAURI_SIGNING_PRIVATE_KEY from the key file ────────────────────
  // This is the PEM content of the updater keypair, NOT a short string, so it
  // lives in src-tauri/keys/updater.key and is set as a multi-line env var.
  // Without it Tauri skips .sig generation and auto-update breaks silently.
  if (!env.TAURI_SIGNING_PRIVATE_KEY) {
    const updaterKeyFile = path.join(repoRoot, 'src-tauri', 'keys', 'updater.key');
    if (fs.existsSync(updaterKeyFile)) {
      env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(updaterKeyFile, 'utf8').trim();
      // Ensure the password var is always present (empty string = passwordless key).
      // Tauri requires the var to exist, not just be non-empty.
      if (!env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
        env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '';
      }
      console.log('[tauri-wrapper] updater signing key: loaded from src-tauri/keys/updater.key (.sig will be generated)');
    } else {
      console.warn(
        '[tauri-wrapper] WARNING: src-tauri/keys/updater.key not found.\n' +
        '  .sig files will NOT be generated — auto-update will not work for installed clients.\n' +
        '  Run: npx tauri signer generate --ci -w src-tauri/keys/updater.key',
      );
    }
  }
}

function ensureAuthEnvForDesktopDev() {
  // No-op: auth is now handled entirely by Rust (auth.rs) with session tokens.
  // No NextAuth or AUTH_SECRET env vars needed.
}

ensureAuthEnvForDesktopDev();

const logsDir = path.join(repoRoot, 'runtime', 'audit');
fs.mkdirSync(logsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const wrapperLogPath = process.env.RHEOLAB_TAURI_WRAPPER_LOG_PATH
  ? path.resolve(process.env.RHEOLAB_TAURI_WRAPPER_LOG_PATH)
  : path.join(logsDir, `tauri-wrapper-${stamp}.log`);

function appendLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  fs.appendFileSync(wrapperLogPath, `${line}\n`);
}

function forwardStream(stream, label, output) {
  let buffered = '';

  stream.on('data', (chunk) => {
    const text = chunk.toString();
    output.write(text);
    buffered += text;

    let newlineIndex = buffered.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffered.slice(0, newlineIndex).replace(/\r$/, '');
      appendLog(`[${label}] ${line}`);
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf('\n');
    }
  });

  stream.on('end', () => {
    if (buffered.length > 0) {
      appendLog(`[${label}] ${buffered.replace(/\r$/, '')}`);
      buffered = '';
    }
  });
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commandArgs = ['exec', 'tauri', '--', ...args];
const startedAt = Date.now();
const heartbeatMs = Number(process.env.RHEOLAB_TAURI_HEARTBEAT_MS || 15000);

appendLog(`wrapper start`);
appendLog(`cwd=${repoRoot}`);
appendLog(`command=${npmCommand} ${commandArgs.join(' ')}`);
appendLog(`RHEOLAB_SKIP_VERSION_BUMP=${env.RHEOLAB_SKIP_VERSION_BUMP || ''}`);
if (isBuildCommand) {
  const keyPresent = Boolean((env.INTEGRITY_SECRET_KEY || '').trim());
  const keyIsDevSentinel = (env.INTEGRITY_SECRET_KEY || '').trim() === 'rheolab-dev-integrity-key-32chars!';
  const signingKeyPresent = Boolean((env.TAURI_SIGNING_PRIVATE_KEY || '').trim());
  const signingPasswordPresent = Boolean((env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '') !== undefined);
  appendLog(`INTEGRITY_SECRET_KEY present=${keyPresent} dev_sentinel=${keyIsDevSentinel}`);
  appendLog(`TAURI_SIGNING_PRIVATE_KEY present=${signingKeyPresent} len=${(env.TAURI_SIGNING_PRIVATE_KEY || '').length}`);
  appendLog(`TAURI_SIGNING_PRIVATE_KEY_PASSWORD present=${signingPasswordPresent}`);
  if (!keyPresent) {
    console.error('[tauri-wrapper] ERROR: INTEGRITY_SECRET_KEY not set — release binary will panic on startup');
  } else if (keyIsDevSentinel) {
    console.warn('[tauri-wrapper] WARNING: building with dev sentinel key — release binary will panic on startup');
  }
  if (!signingKeyPresent) {
    console.warn('[tauri-wrapper] WARNING: TAURI_SIGNING_PRIVATE_KEY not set — .sig files will NOT be generated');
  }
}
console.log(`[tauri-wrapper] log: ${path.relative(repoRoot, wrapperLogPath).replace(/\\/g, '/')}`);

function spawnDirect() {
  return spawn(npmCommand, commandArgs, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    shell: false,
  });
}

function spawnViaShellFallback() {
  const quotedArgs = commandArgs.map((arg) => `"${String(arg).replace(/"/g, '\\"')}"`);
  const shellCommand = `${npmCommand} ${quotedArgs.join(' ')}`;
  appendLog(`using shell fallback: ${shellCommand}`);
  return spawn(shellCommand, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    shell: true,
  });
}

let child;
try {
  child = spawnDirect();
} catch (error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  if (code === 'EINVAL' || code === 'ENOENT') {
    appendLog(`direct spawn failed (${code}), switching to shell fallback`);
    child = spawnViaShellFallback();
  } else {
    throw error;
  }
}

const heartbeat = setInterval(() => {
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const message = `heartbeat: pid=${child.pid ?? 'unknown'} elapsed=${elapsedSec}s`;
  appendLog(message);
  process.stdout.write(`[tauri-wrapper] ${message}\n`);
}, heartbeatMs);
heartbeat.unref();

if (child.stdout) {
  forwardStream(child.stdout, 'stdout', process.stdout);
}

if (child.stderr) {
  forwardStream(child.stderr, 'stderr', process.stderr);
}

child.on('error', (error) => {
  clearInterval(heartbeat);
  appendLog(`wrapper error: ${error.message}`);
  console.error(`Failed to launch Tauri CLI: ${error.message}`);
  process.exit(1);
});

// Post-build signing: replicates the `npx tauri signer sign` step from build.ps1.
// Tauri v2 does NOT auto-generate .sig files during build unless createUpdaterArtifacts
// is set in tauri.conf.json.  We run the explicit sign command here so that
// `npm run tauri:build` always produces a valid .sig regardless of config.
function runPostBuildSign() {
  const signingKey = (env.TAURI_SIGNING_PRIVATE_KEY || '').trim();
  if (!signingKey) {
    appendLog('post-build sign: TAURI_SIGNING_PRIVATE_KEY not set, skipping');
    return;
  }

  // Determine installer version from package.json
  let version;
  try {
    version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  } catch (e) {
    appendLog(`post-build sign: failed to read version — ${String(e)}`);
    return;
  }

  // Locate the freshly built NSIS installer
  const nsisDir = path.join(repoRoot, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  let installer;
  try {
    const entries = fs.readdirSync(nsisDir);
    // prefer exact version match; fall back to newest .exe if version is unknown
    const match = entries.find(
      (f) => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall') && f.includes(version),
    );
    const fallback = entries
      .filter((f) => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(nsisDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    installer = match
      ? path.join(nsisDir, match)
      : fallback ? path.join(nsisDir, fallback.name) : null;
  } catch (e) {
    appendLog(`post-build sign: failed to scan nsis dir — ${String(e)}`);
    return;
  }

  if (!installer) {
    appendLog('post-build sign: no installer exe found — skipping');
    return;
  }

  appendLog(`post-build sign: signing ${path.basename(installer)}`);
  console.log(`[tauri-wrapper] post-build sign: signing ${path.basename(installer)}...`);

  // tauri signer sign reads TAURI_PRIVATE_KEY (v1 env var name used by the sign subcommand)
  const signerEnv = normalizeEnv({
    ...env,
    TAURI_PRIVATE_KEY: signingKey,
    TAURI_PRIVATE_KEY_PASSWORD: (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || ''),
  });

  const result = spawnSync(
    'npx',
    ['tauri', 'signer', 'sign', `"${installer}"`],
    { cwd: repoRoot, env: signerEnv, encoding: 'utf8', shell: true },
  );

  if (result.error) {
    appendLog(`post-build sign: spawn error — ${String(result.error)}`);
    console.warn('[tauri-wrapper] WARNING: post-build signing spawn error');
    return;
  }

  const sigPath = `${installer}.sig`;
  if (result.status === 0) {
    appendLog(`post-build sign: success → ${path.basename(sigPath)}`);
    console.log(`[tauri-wrapper] post-build sign: .sig created → ${path.basename(sigPath)}`);
  } else {
    const detail = (result.stderr || result.stdout || 'no output').slice(0, 400);
    appendLog(`post-build sign: FAILED (code=${result.status}) — ${detail}`);
    console.warn(`[tauri-wrapper] WARNING: post-build signing failed (code=${result.status})`);
    console.warn(detail);
  }
}

child.on('exit', (code, signal) => {
  clearInterval(heartbeat);
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  appendLog(`wrapper exit: code=${code ?? 'null'} signal=${signal ?? 'null'} elapsed=${elapsedSec}s`);
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (isBuildCommand && code === 0) {
    runPostBuildSign();
  }
  process.exit(code ?? 1);
});
