#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);

const quick = args.includes('--quick');
const nonBlocking = args.includes('--non-blocking');
const windowsRunner = args.includes('--windows-runner');
const skipDynamic = args.includes('--skip-dynamic');

function getArgValue(flag) {
  const prefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = args.indexOf(flag);
  if (index >= 0 && index < args.length - 1) {
    const value = args[index + 1];
    if (!value.startsWith('--')) return value;
  }
  return null;
}

const runIdArg = getArgValue('--run-id');
const commandTimeoutMs = Number(getArgValue('--command-timeout-ms'))
  || (quick ? 12 * 60 * 1000 : 25 * 60 * 1000);
const defaultRunId = `${new Date().toISOString().replace(/[^\dT]/g, '').replace('T', '-')}-frontend-ipc-deep-audit`;
const runId = runIdArg || defaultRunId;
const auditStartedAt = new Date();
const auditStartMs = auditStartedAt.getTime();

const outDir = path.join(repoRoot, 'runtime', 'audit', runId);
const logsDir = path.join(outDir, 'logs');
const summaryPath = path.join(outDir, 'frontend-ipc-audit-summary.json');
const staticPath = path.join(outDir, 'static-scan-findings.json');
const reportDate = localDateStamp(new Date());
const reportPath = path.join(repoRoot, 'docs', 'performance', `FRONTEND-IPC-DEEP-AUDIT-${reportDate}.md`);
const latestReportPath = path.join(repoRoot, 'docs', 'performance', 'FRONTEND-IPC-DEEP-AUDIT-LATEST.md');
const baselinesPath = path.join(repoRoot, 'docs', 'performance', 'BASELINES.md');
const outputPerfDir = path.join(repoRoot, 'outputs', 'e2e', 'perf');
const tauriTeardownScript = path.join(repoRoot, 'scripts', 'test', 'tauri-e2e-teardown.js');
const ARTIFACT_MTIME_GRACE_BEFORE_MS = 5_000;
const ARTIFACT_MTIME_GRACE_AFTER_MS = 30_000;
const activeChildren = new Map();

const runConfig = quick
  ? { warmup: 1, workflow: 1, soak: 1, benchmark: 1 }
  : { warmup: 1, workflow: 5, soak: 3, benchmark: 2 };

const IGNORED_DIRS = new Set([
  '.git',
  '.vscode',
  '.agent',
  'node_modules',
  'dist',
  'outputs',
  'runtime',
  'coverage',
  '.next',
  'playwright-report',
  'playwright-report-benchmark',
  'playwright-report-tauri-perf',
  'playwright-report-tauri-soak',
  'playwright-report-workflow-perf',
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toRel(absPath) {
  return path.relative(repoRoot, absPath).replace(/\\/g, '/');
}

function localDateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function slugify(value) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120)
    .toLowerCase();
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function round(value, digits = 2) {
  if (value === null || Number.isNaN(value) || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarizeSeries(values) {
  const filtered = values.filter((v) => Number.isFinite(v));
  if (!filtered.length) {
    return { count: 0, min: null, max: null, mean: null, p50: null, p95: null };
  }
  return {
    count: filtered.length,
    min: round(Math.min(...filtered)),
    max: round(Math.max(...filtered)),
    mean: round(mean(filtered)),
    p50: round(percentile(filtered, 50)),
    p95: round(percentile(filtered, 95)),
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readJsonLines(filePath) {
  try {
    return fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function collectFiles(rootDir, extensions) {
  const out = [];

  function walk(current) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(absolute);
        continue;
      }
      if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        out.push(absolute);
      }
    }
  }

  walk(rootDir);
  return out;
}

function findLine(content, needleRegex) {
  const lines = content.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (needleRegex.test(lines[idx])) {
      return { line: idx + 1, snippet: lines[idx].trim() };
    }
  }
  return { line: 1, snippet: '' };
}

function runStaticScan() {
  const findings = [];
  const stats = {
    filesScanned: 0,
    storeWithoutSelector: 0,
    timerWithoutClear: 0,
    allocationHotspots: 0,
    ipcStringPayloads: 0,
  };

  const tsFiles = collectFiles(path.join(repoRoot, 'src'), new Set(['.ts', '.tsx']));
  const rustFiles = collectFiles(path.join(repoRoot, 'src-tauri', 'src'), new Set(['.rs']));
  stats.filesScanned = tsFiles.length + rustFiles.length;

  for (const file of tsFiles) {
    const rel = toRel(file);
    const content = fs.readFileSync(file, 'utf8');

    const storeMatches = [...content.matchAll(/\buse[A-Za-z0-9_]*Store\(\)/g)];
    if (storeMatches.length > 0) {
      stats.storeWithoutSelector += storeMatches.length;
      const { line, snippet } = findLine(content, /\buse[A-Za-z0-9_]*Store\(\)/);
      findings.push({
        id: `P1-STORE-${findings.length + 1}`,
        bucket: 'P1',
        severity: 'medium',
        owner: 'Frontend Team',
        effort: 'S',
        title: 'Store subscription without selector',
        impact: 'Can trigger avoidable re-renders when unrelated store fields change.',
        verification: `rg -n "use[A-Za-z0-9_]*Store\\(\\)" ${rel}`,
        file: rel,
        line,
        snippet,
      });
    }

    if (/setTimeout\(/.test(content) && !/clearTimeout\(/.test(content) && /src\/(app|components|hooks|contexts)\//.test(rel)) {
      const lines = content.split(/\r?\n/);
      const timeoutLineIndexes = lines
        .map((line, idx) => (/setTimeout\(/.test(line) ? idx : -1))
        .filter((idx) => idx >= 0);
      const actionableTimerIndex = timeoutLineIndexes.find((idx) => {
        const ctx = lines.slice(Math.max(0, idx - 12), Math.min(idx + 6, lines.length)).join('\n');
        // Skip benign patterns that cannot cause memory leaks:
        // 1. Sleep/idle helpers: new Promise(resolve => setTimeout(resolve, N))
        const isSleepHelper = /new\s+Promise\s*\([^)]*resolve[\s\S]*setTimeout\s*\(\s*resolve\b/.test(ctx);
        // 2. Intentional reload/navigate timers; page teardown clears the timer.
        const isReloadTimer = /window\.location\.reload|location\.reload\b|location\.href\s*=/.test(ctx);
        return !isSleepHelper && !isReloadTimer;
      });

      if (actionableTimerIndex !== undefined) {
        stats.timerWithoutClear += 1;
        findings.push({
          id: `P1-TIMER-${findings.length + 1}`,
          bucket: 'P1',
          severity: 'medium',
          owner: 'Frontend Team',
          effort: 'S',
          title: 'UI timer without explicit clearTimeout path',
          impact: 'Risk of stale updates after unmount and unnecessary queued work.',
          verification: `rg -n "setTimeout\\(" ${rel}`,
          file: rel,
          line: actionableTimerIndex + 1,
          snippet: lines[actionableTimerIndex].trim(),
        });
      }
    }

    const stringifyCount = (content.match(/JSON\.stringify\(/g) || []).length;
    const memoCount = (content.match(/useMemo\(/g) || []).length;
    const p2AllocSuppressed = /\/\/\s*audit-suppress:\s*P2-ALLOC/.test(content);
    if (!p2AllocSuppressed && (stringifyCount >= 3 || memoCount >= 8)) {
      stats.allocationHotspots += 1;
      const { line, snippet } = stringifyCount >= 3
        ? findLine(content, /JSON\.stringify\(/)
        : findLine(content, /useMemo\(/);
      findings.push({
        id: `P2-ALLOC-${findings.length + 1}`,
        bucket: 'P2',
        severity: 'medium',
        owner: 'Frontend Team',
        effort: 'M',
        title: 'Potential allocation hotspot',
        impact: 'High-frequency serialization or heavy memo blocks may increase CPU/GC pressure.',
        verification: stringifyCount >= 3
          ? `rg -n "JSON\\.stringify\\(" ${rel}`
          : `rg -n "useMemo\\(" ${rel}`,
        file: rel,
        line,
        snippet,
      });
    }

    if (/src\/lib\/reports\/client/.test(rel) && /JSON\.stringify\(/.test(content)) {
      stats.ipcStringPayloads += 1;
      const { line, snippet } = findLine(content, /JSON\.stringify\(/);
      findings.push({
        id: `P2-IPC-${findings.length + 1}`,
        bucket: 'P2',
        severity: 'high',
        owner: 'Frontend + Platform',
        effort: 'M',
        title: 'IPC path still uses string payload serialization',
        impact: 'Extra serialization/copy overhead in report/bridge flows.',
        verification: `rg -n "JSON\\.stringify\\(" ${rel}`,
        file: rel,
        line,
        snippet,
      });
    }
  }

  for (const file of rustFiles) {
    const rel = toRel(file);
    const content = fs.readFileSync(file, 'utf8');
    if (/input_json\s*:\s*String/.test(content)) {
      stats.ipcStringPayloads += 1;
      const { line, snippet } = findLine(content, /input_json\s*:\s*String/);
      findings.push({
        id: `P2-IPC-RUST-${findings.length + 1}`,
        bucket: 'P2',
        severity: 'high',
        owner: 'Platform Team',
        effort: 'M',
        title: 'Rust command accepts JSON string payload',
        impact: 'Adds parse/serialization overhead and limits typed IPC evolution.',
        verification: `rg -n "input_json\\s*:\\s*String" ${rel}`,
        file: rel,
        line,
        snippet,
      });
    }
  }

  return { stats, findings };
}

function isTauriRuntimeCommand(command) {
  return /\bperf:(workflow|soak|benchmark):tauri\b|playwright\.tauri\.config\.ts/.test(command);
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      cwd: repoRoot,
      stdio: 'ignore',
      shell: false,
      timeout: 30_000,
    });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }
}

function runTauriTeardown(logStream = null) {
  if (!fs.existsSync(tauriTeardownScript)) return;
  const result = spawnSync(process.execPath, [tauriTeardownScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  if (logStream) {
    logStream.write('\n[frontend-ipc-audit] tauri cleanup\n');
    if (result.stdout) logStream.write(result.stdout);
    if (result.stderr) logStream.write(result.stderr);
    logStream.write(`[frontend-ipc-audit] tauri cleanup exit=${result.status ?? 1}\n`);
  }
}

function cleanupActiveChildren() {
  for (const pid of activeChildren.keys()) {
    killProcessTree(pid);
  }
  activeChildren.clear();
}

function installProcessCleanupHandlers() {
  const cleanupAndExit = (exitCode) => {
    cleanupActiveChildren();
    runTauriTeardown();
    process.exit(exitCode);
  };

  process.once('SIGINT', () => cleanupAndExit(130));
  process.once('SIGTERM', () => cleanupAndExit(143));
  process.once('SIGHUP', () => cleanupAndExit(129));
}

function runCommand(id, command, extraEnv = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const logPath = path.join(logsDir, `${id}_${slugify(command)}.log`);
    const mergedEnv = { ...process.env, ...extraEnv };
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });
    let settled = false;
    let timedOut = false;
    let spawnError = null;
    let wroteStderrHeader = false;

    logStream.write(`[${new Date(startedAt).toISOString()}] $ ${command}\n`);
    logStream.write(`command_timeout_ms=${commandTimeoutMs}\n\n[stdout]\n`);

    const child = spawn(command, {
      cwd: repoRoot,
      env: mergedEnv,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (child.pid) {
      activeChildren.set(child.pid, { id, command });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      logStream.write(`\n[frontend-ipc-audit] command timed out after ${commandTimeoutMs}ms\n`);
      if (child.pid) {
        killProcessTree(child.pid);
      } else {
        try {
          child.kill('SIGTERM');
        } catch {
          // Process already exited.
        }
      }
      if (isTauriRuntimeCommand(command)) {
        runTauriTeardown(logStream);
      }
    }, commandTimeoutMs);

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.pid) activeChildren.delete(child.pid);

      const durationMs = Date.now() - startedAt;
      const finishedAt = startedAt + durationMs;
      const exitCode = spawnError ? 1 : timedOut ? 124 : code ?? 1;

      if (isTauriRuntimeCommand(command)) {
        runTauriTeardown(logStream);
      }

      logStream.write(
        [
          '',
          '[summary]',
          `exit_code=${exitCode}`,
          `signal=${signal ?? 'none'}`,
          `timed_out=${timedOut}`,
          `duration_ms=${durationMs}`,
          spawnError ? `spawn_error=${spawnError.message}` : null,
          '',
        ].filter(Boolean).join('\n'),
      );
      logStream.end(() => {
        resolve({
          id,
          command,
          exitCode,
          signal: signal ?? null,
          timedOut,
          durationMs,
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date(finishedAt).toISOString(),
          startedAtMs: startedAt,
          finishedAtMs: finishedAt,
          logFile: toRel(logPath),
          ok: exitCode === 0,
        });
      });
    };

    child.stdout.on('data', (chunk) => logStream.write(chunk));
    child.stderr.on('data', (chunk) => {
      if (!wroteStderrHeader) {
        wroteStderrHeader = true;
        logStream.write('\n[stderr]\n');
      }
      logStream.write(chunk);
    });
    child.on('error', (error) => {
      spawnError = error;
      finish(1, null);
    });
    child.on('close', finish);
  });
}

function listPerfFiles(regex, sinceMs = null, beforeMs = null) {
  if (!fs.existsSync(outputPerfDir)) return [];
  return fs
    .readdirSync(outputPerfDir)
    .filter((name) => regex.test(name))
    .map((name) => {
      const abs = path.join(outputPerfDir, name);
      const stat = fs.statSync(abs);
      return { name, abs, mtimeMs: stat.mtimeMs };
    })
    .filter((item) => (sinceMs === null || item.mtimeMs >= sinceMs))
    .filter((item) => (beforeMs === null || item.mtimeMs < beforeMs))
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function matchesRegex(regex, value) {
  regex.lastIndex = 0;
  return regex.test(value);
}

function addPerfFile(out, item, source) {
  const existing = out.get(item.name);
  if (existing) {
    existing.sources = Array.from(new Set([...(existing.sources || []), source]));
    return;
  }
  out.set(item.name, { ...item, sources: [source] });
}

function readCommandLog(run) {
  const relLog = String(run.logFile || '').replace(/\//g, path.sep);
  const absLog = path.isAbsolute(relLog) ? relLog : path.join(repoRoot, relLog);
  try {
    return fs.readFileSync(absLog, 'utf8');
  } catch {
    return '';
  }
}

function extractPerfNamesFromLog(content, regex) {
  const names = new Set();
  regex.lastIndex = 0;
  let match = regex.exec(content);
  while (match) {
    const raw = String(match[1] || match[0] || '').replace(/\\/g, '/').replace(/[),.;\]]+$/g, '');
    names.add(path.posix.basename(raw));
    match = regex.exec(content);
  }
  return [...names];
}

function perfInfoFromName(name, expectedRegex) {
  const cleanName = path.posix.basename(String(name).replace(/\\/g, '/').replace(/[),.;\]]+$/g, ''));
  if (!matchesRegex(expectedRegex, cleanName)) return null;
  const abs = path.join(outputPerfDir, cleanName);
  if (!fs.existsSync(abs)) return null;
  const stat = fs.statSync(abs);
  return { name: cleanName, abs, mtimeMs: stat.mtimeMs };
}

function collectPerfFilesForRuns(runs, expectedRegex, logRegex) {
  if (skipDynamic || runs.length === 0) {
    return listPerfFiles(expectedRegex, auditStartMs);
  }

  const out = new Map();
  for (const run of runs) {
    const since = Number.isFinite(run.startedAtMs)
      ? Math.max(0, run.startedAtMs - ARTIFACT_MTIME_GRACE_BEFORE_MS)
      : auditStartMs;
    const before = Number.isFinite(run.finishedAtMs)
      ? run.finishedAtMs + ARTIFACT_MTIME_GRACE_AFTER_MS
      : null;

    for (const item of listPerfFiles(expectedRegex, since, before)) {
      addPerfFile(out, item, `${run.id}:mtime-window`);
    }

    const logContent = readCommandLog(run);
    for (const name of extractPerfNamesFromLog(logContent, logRegex)) {
      const item = perfInfoFromName(name, expectedRegex);
      if (item) addPerfFile(out, item, `${run.id}:log`);
    }
  }

  return [...out.values()].sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function parseWorkflowFiles(files) {
  return files
    .map((item) => {
      const json = readJson(item.abs);
      if (!json) return null;
      return {
        file: item.name,
        generatedAt: json.generatedAt || null,
        peakHeapMb: Number(json.peakHeapMb),
        peakNodes: Number(json.peakNodes),
        totalWallMs: Number(json.totalWallMs),
      };
    })
    .filter(Boolean)
    .filter((row) => Number.isFinite(row.peakHeapMb) && Number.isFinite(row.peakNodes) && Number.isFinite(row.totalWallMs));
}

function parseSoakFiles(files) {
  return files
    .map((item) => {
      const json = readJson(item.abs);
      if (!json) return null;
      const slope = Number(json.slope);
      const nodesRatio = Number(json.nodesRatio);
      const cfg = json.config || {};
      const limitSlope = Number(cfg.heapSlopeThreshold);
      const limitNodesRatio = Number(cfg.nodesGrowthFactor);
      const gatePass =
        Number.isFinite(slope) &&
        Number.isFinite(nodesRatio) &&
        Number.isFinite(limitSlope) &&
        Number.isFinite(limitNodesRatio) &&
        slope < limitSlope &&
        nodesRatio < limitNodesRatio;

      return {
        file: item.name,
        generatedAt: json.generatedAt || null,
        scenario: String(json.scenario || 'unknown'),
        slopeMbPerRound: slope,
        nodesRatio,
        limitSlope,
        limitNodesRatio,
        gatePass,
      };
    })
    .filter(Boolean)
    .filter((row) => Number.isFinite(row.slopeMbPerRound) || Number.isFinite(row.nodesRatio));
}

function parseNativeMemoryFiles(files) {
  return files
    .map((item) => {
      const lines = readJsonLines(item.abs);
      if (!lines.length) return null;
      const total = lines.map((x) => Number(x.totalWsMb)).filter((v) => Number.isFinite(v));
      const renderer = lines.map((x) => Number(x.webview2RendererWsMb)).filter((v) => Number.isFinite(v));
      const gpu = lines.map((x) => Number(x.webview2GpuWsMb)).filter((v) => Number.isFinite(v));
      const browser = lines.map((x) => Number(x.webview2BrowserWsMb)).filter((v) => Number.isFinite(v));
      if (!total.length) return null;
      return {
        file: item.name,
        samples: total.length,
        totalWsMbPeak: Math.max(...total),
        totalWsMbStart: total[0],
        totalWsMbEnd: total[total.length - 1],
        rendererWsMbPeak: renderer.length ? Math.max(...renderer) : null,
        gpuWsMbPeak: gpu.length ? Math.max(...gpu) : null,
        browserWsMbPeak: browser.length ? Math.max(...browser) : null,
      };
    })
    .filter(Boolean);
}

function selectMeasuredWorkflowRows(rows) {
  if (skipDynamic) return rows;
  if (!rows.length) return rows;

  const measuredTarget = runConfig.workflow;
  if (rows.length >= measuredTarget + 1) {
    // Warm-up run is first; include only measured workflow runs.
    return rows.slice(-measuredTarget);
  }

  // If counts are ambiguous, prefer dropping the earliest row as possible warm-up.
  if (rows.length > 1) {
    return rows.slice(1);
  }
  return [];
}

function selectMeasuredNativeRows(rows, measuredWorkflowCount) {
  if (skipDynamic) return rows;
  if (!rows.length) return rows;
  if (measuredWorkflowCount > 0 && rows.length > measuredWorkflowCount) {
    // Keep only rows likely corresponding to measured workflow runs.
    return rows.slice(-measuredWorkflowCount);
  }
  if (measuredWorkflowCount > 0) return rows;

  // A workflow command can fail after Tauri launches and the native sampler
  // writes a valid jsonl file. Preserve those artifacts for KPI transparency
  // instead of turning a partial-but-real run into a false empty signal.
  if (rows.length >= runConfig.workflow + 1) {
    return rows.slice(-runConfig.workflow);
  }
  if (rows.length > 1) {
    return rows.slice(1);
  }
  return rows;
}

function buildMetricPack(workflowRows, nativeRows) {
  return {
    peakHeapMb: summarizeSeries(workflowRows.map((r) => r.peakHeapMb)),
    peakNodes: summarizeSeries(workflowRows.map((r) => r.peakNodes)),
    totalWallMs: summarizeSeries(workflowRows.map((r) => r.totalWallMs)),
    totalWsMb: summarizeSeries(nativeRows.map((r) => r.totalWsMbPeak)),
    rendererWsMb: summarizeSeries(nativeRows.map((r) => r.rendererWsMbPeak).filter((v) => Number.isFinite(v))),
  };
}

function buildKpiDelta(current, baseline) {
  const metrics = ['peakHeapMb', 'peakNodes', 'totalWallMs', 'totalWsMb', 'rendererWsMb'];
  const out = {};
  for (const metric of metrics) {
    const cur = current[metric]?.p50;
    const base = baseline[metric]?.p50;
    out[metric] = {
      baselineP50: base ?? null,
      currentP50: cur ?? null,
      deltaP50: Number.isFinite(cur) && Number.isFinite(base) ? round(cur - base) : null,
      baselineP95: baseline[metric]?.p95 ?? null,
      currentP95: current[metric]?.p95 ?? null,
    };
  }
  return out;
}

function evaluateGates(dynamicRuns, workflowRows, soakRows, nativeRows, kpiDelta) {
  if (skipDynamic) {
    return {
      status: 'skipped',
      violations: [
        {
          id: 'GATE-SKIP',
          severity: 'low',
          message: 'Dynamic profiling pass was skipped; current-run KPI gates were not evaluated.',
        },
      ],
    };
  }

  const violations = [];

  const expectedWorkflow = runConfig.workflow;
  const expectedSoak = runConfig.soak;

  if (!skipDynamic && workflowRows.length < expectedWorkflow) {
    violations.push({
      id: 'GATE-001',
      severity: 'high',
      message: `Expected at least ${expectedWorkflow} workflow tauri runs, got ${workflowRows.length}.`,
    });
  }

  if (!skipDynamic && soakRows.length < expectedSoak) {
    violations.push({
      id: 'GATE-002',
      severity: 'high',
      message: `Expected at least ${expectedSoak} soak artifacts, got ${soakRows.length}.`,
    });
  }

  if (!skipDynamic && nativeRows.length === 0) {
    violations.push({
      id: 'GATE-003',
      severity: 'high',
      message: 'No native-memory artifacts were captured for this audit run.',
    });
  }

  const memoryAggregate = dynamicRuns.find((run) => run.id === 'D-MEM-AGG');
  if (memoryAggregate && !memoryAggregate.ok) {
    violations.push({
      id: 'GATE-004',
      severity: 'high',
      message: 'Memory aggregate step failed (fail-fast on empty/missing data expected).',
    });
  }

  const failedCommands = dynamicRuns.filter((run) => !run.ok);
  if (failedCommands.length > 0) {
    violations.push({
      id: 'GATE-CMD',
      severity: 'high',
      message: `${failedCommands.length} dynamic profiling command(s) failed: ${failedCommands.slice(0, 4).map((run) => run.id).join(', ')}.`,
    });
  }

  const soakFailed = soakRows.filter((row) => row.gatePass === false);
  if (soakFailed.length > 0) {
    violations.push({
      id: 'GATE-005',
      severity: 'medium',
      message: `${soakFailed.length} soak artifacts failed slope/nodes thresholds.`,
    });
  }

  // ── Regression gates: current run vs rolling 5-run baseline ─────────────
  if (kpiDelta) {
    const hp = kpiDelta.peakHeapMb;
    if (hp?.currentP50 != null && hp?.baselineP50 != null && hp.baselineP50 > 0) {
      if (hp.currentP50 > hp.baselineP50 * 1.20) {
        violations.push({
          id: 'GATE-HEAP',
          severity: 'high',
          message: `Peak heap P50 regression: ${hp.currentP50} MB vs baseline ${hp.baselineP50} MB (+${Math.round((hp.currentP50 / hp.baselineP50 - 1) * 100)}%, threshold 20%).`,
        });
      }
    }
    if (hp?.currentP50 != null && hp.currentP50 > 50) {
      violations.push({
        id: 'GATE-HEAP-ABS',
        severity: 'high',
        message: `Peak heap P50 absolute ceiling exceeded: ${hp.currentP50} MB > 50 MB.`,
      });
    }

    const wall = kpiDelta.totalWallMs;
    if (wall?.currentP50 != null && wall?.baselineP50 != null && wall.baselineP50 > 0) {
      if (wall.currentP50 > wall.baselineP50 * 1.25) {
        violations.push({
          id: 'GATE-WALL',
          severity: 'medium',
          message: `Total wall time P50 regression: ${wall.currentP50} ms vs baseline ${wall.baselineP50} ms (+${Math.round((wall.currentP50 / wall.baselineP50 - 1) * 100)}%, threshold 25%).`,
        });
      }
    }

    const nodes = kpiDelta.peakNodes;
    if (nodes?.currentP50 != null && nodes?.baselineP50 != null && nodes.baselineP50 > 0) {
      if (nodes.currentP50 > nodes.baselineP50 * 1.30) {
        violations.push({
          id: 'GATE-NODES',
          severity: 'medium',
          message: `Peak DOM nodes P50 regression: ${nodes.currentP50} vs baseline ${nodes.baselineP50} (+${Math.round((nodes.currentP50 / nodes.baselineP50 - 1) * 100)}%, threshold 30%).`,
        });
      }
    }
    if (nodes?.currentP50 != null && nodes.currentP50 > 10000) {
      violations.push({
        id: 'GATE-NODES-ABS',
        severity: 'medium',
        message: `Peak DOM nodes P50 absolute ceiling exceeded: ${nodes.currentP50} > 10 000.`,
      });
    }

    const ws = kpiDelta.totalWsMb;
    // Threshold 1200 MB is calibrated from B#12–B#14 native baselines
    // (total WS peak range: 851–896 MB). Gives ~34% headroom for OS variance
    // before flagging a genuine native-memory regression.
    if (ws?.currentP95 != null && ws.currentP95 > 1200) {
      violations.push({
        id: 'GATE-NATIVE',
        severity: 'high',
        message: `Native working set P95 ceiling exceeded: ${ws.currentP95} MB > 1200 MB.`,
      });
    }
  }

  return {
    status: violations.length === 0 ? 'pass' : (nonBlocking ? 'warning' : 'fail'),
    violations,
  };
}

function buildBacklog(staticFindings, gateEvaluation, kpiPack) {
  const backlog = [];

  backlog.push({
    id: 'P0-001',
    bucket: 'P0',
    title: 'Audit pipeline correctness and fail-fast guarantees',
    severity: gateEvaluation.violations.length > 0 ? 'high' : 'medium',
    owner: 'Platform Team',
    effort: 'S',
    expectedGain: 'Deterministic audit outputs; no false-green empty reports.',
    verificationCommand: 'npm run perf:memory -- --skip-playwright --source tauri-soak',
    status: gateEvaluation.violations.length > 0 ? 'open' : 'monitoring',
  });

  backlog.push({
    id: 'P1-001',
    bucket: 'P1',
    title: 'Frontend runtime rerender/timer hygiene',
    severity: staticFindings.stats.storeWithoutSelector > 0 || staticFindings.stats.timerWithoutClear > 0 ? 'high' : 'low',
    owner: 'Frontend Team',
    effort: 'M',
    expectedGain: 'Lower rerender churn and fewer stale async callbacks.',
    verificationCommand: 'rg -n "use[A-Za-z0-9_]*Store\\(\\)|setTimeout\\(" src',
    status: staticFindings.stats.storeWithoutSelector > 0 || staticFindings.stats.timerWithoutClear > 0 ? 'open' : 'monitoring',
  });

  backlog.push({
    id: 'P2-001',
    bucket: 'P2',
    title: 'IPC/report serialization pressure reduction',
    severity: staticFindings.stats.ipcStringPayloads > 0 ? 'high' : 'medium',
    owner: 'Frontend + Platform',
    effort: 'M',
    expectedGain: 'Reduce serialization/copy overhead for report and bridge payloads.',
    verificationCommand: 'rg -n "JSON\\.stringify\\(|input_json\\s*:\\s*String" src src-tauri/src/commands',
    status: staticFindings.stats.ipcStringPayloads > 0 ? 'open' : 'monitoring',
  });

  const totalWsP95 = kpiPack.current.totalWsMb.p95;
  backlog.push({
    id: 'P3-001',
    bucket: 'P3',
    title: 'Native memory ceiling reduction (WebView2 renderer/browser)',
    severity: totalWsP95 !== null && totalWsP95 > 600 ? 'high' : 'medium',
    owner: 'Architecture Team',
    effort: 'L',
    expectedGain: 'Move toward <=600MB p95 and improved desktop stability.',
    verificationCommand: 'npm run audit:frontend-ipc -- --windows-runner',
    status: totalWsP95 !== null && totalWsP95 > 600 ? 'open' : 'monitoring',
  });

  return backlog;
}

function fmt(v, digits = 2) {
  if (v === null || Number.isNaN(v) || !Number.isFinite(v)) return 'n/a';
  return Number(v).toFixed(digits);
}

function buildReportMarkdown(summary) {
  const metricRows = ['peakHeapMb', 'peakNodes', 'totalWallMs', 'totalWsMb', 'rendererWsMb']
    .map((key) => {
      const row = summary.kpi.delta[key];
      return `| ${key} | ${fmt(row.baselineP50)} | ${fmt(row.currentP50)} | ${fmt(row.deltaP50)} | ${fmt(row.baselineP95)} | ${fmt(row.currentP95)} |`;
    })
    .join('\n');

  const violations = summary.gates.violations.length
    ? summary.gates.violations.map((v) => `- [${v.id}] ${v.message}`).join('\n')
    : '- none';

  const staticTop = summary.static.findings
    .slice(0, 15)
    .map((f) => `| ${f.id} | ${f.bucket} | ${f.severity} | ${f.file}:${f.line} | ${f.title} |`)
    .join('\n');

  const dynamicRows = summary.dynamic.commands
    .map((run) => `| ${run.id} | \`${run.command}\` | ${run.ok ? 'PASS' : 'FAIL'} | ${run.exitCode} | ${fmt(run.durationMs, 0)} | \`${run.logFile}\` |`)
    .join('\n');

  const artifactWarnings = summary.dynamic.artifactWarnings.length
    ? summary.dynamic.artifactWarnings.map((warning) => `- ${warning}`).join('\n')
    : '- none';

  const backlogRows = summary.backlog
    .map(
      (item) =>
        `| ${item.id} | ${item.bucket} | ${item.severity} | ${item.owner} | ${item.effort} | ${item.expectedGain} | \`${item.verificationCommand}\` | ${item.status} |`,
    )
    .join('\n');

  return [
    `# Frontend + IPC Deep Audit (${localDateStamp(new Date(summary.generatedAt))})`,
    '',
    '## Scope',
    '',
    '- React runtime: rendering, store subscriptions, timers, heavy hooks/charts.',
    '- IPC integration: frontend bridge <-> Tauri/Rust command payload pressure.',
    '- Native memory profile: WebView2 browser/renderer/gpu contribution.',
    '- CI gate rollout: non-blocking first, then selective blocking.',
    '',
    '## Execution Context',
    '',
    `- runId: \`${summary.runId}\``,
    `- mode: ${summary.mode.quick ? 'quick' : 'full'}`,
    `- nonBlocking: ${summary.mode.nonBlocking}`,
    `- windowsRunnerHint: ${summary.mode.windowsRunner}`,
    `- authoritativeNote: ${summary.assumptions.authoritativeEnvironment}`,
    '',
    '## KPI Snapshot (p50/p95)',
    '',
    '| Metric | Baseline p50 | Current p50 | Delta p50 | Baseline p95 | Current p95 |',
    '|---|---:|---:|---:|---:|---:|',
    metricRows,
    '',
    '## Gate Status',
    '',
    `- status: **${summary.gates.status.toUpperCase()}**`,
    violations,
    '',
    '## Static Scan Summary',
    '',
    `- files scanned: ${summary.static.stats.filesScanned}`,
    `- store subscriptions without selector: ${summary.static.stats.storeWithoutSelector}`,
    `- ui timers without clear path: ${summary.static.stats.timerWithoutClear}`,
    `- allocation hotspots: ${summary.static.stats.allocationHotspots}`,
    `- ipc string payload hotspots: ${summary.static.stats.ipcStringPayloads}`,
    '',
    '| Finding | Bucket | Severity | Location | Title |',
    '|---|---|---|---|---|',
    staticTop || '| n/a | n/a | n/a | n/a | n/a |',
    '',
    '## Dynamic Command Results',
    '',
    '| Step | Command | Status | Exit | Duration ms | Log |',
    '|---|---|---|---:|---:|---|',
    dynamicRows || '| n/a | n/a | n/a | n/a | n/a | n/a |',
    '',
    '## Artifact Collection',
    '',
    `- workflow artifacts (all/measured): ${summary.dynamic.workflowFilesAll.length}/${summary.dynamic.workflowFiles.length}`,
    `- soak artifacts: ${summary.dynamic.soakFiles.length}`,
    `- native-memory artifacts (all/measured): ${summary.dynamic.nativeFilesAll.length}/${summary.dynamic.nativeFiles.length}`,
    `- benchmark artifacts: ${summary.dynamic.benchmarkFiles.length}`,
    artifactWarnings,
    '',
    '## Remediation Backlog',
    '',
    '| ID | Bucket | Severity | Owner | Effort | Expected Gain | Verification | Status |',
    '|---|---|---|---|---|---|---|---|',
    backlogRows,
    '',
    '## Phased Targets',
    '',
    '- Phase A (current): stabilize pipeline and metrics transparency (p50/p95 on each run).',
    '- Phase B: reduce native peak/p95 via prioritized P1/P2 fixes.',
    '- Phase C: architecture-level actions when target requires sub-600MB p95.',
    '',
    '## Assumptions',
    '',
    '- Tauri/Windows metrics are authoritative for release gating.',
    '- Web benchmark is informative only in this phase (non-gating).',
    '- Baseline source uses latest five successful workflow + native-memory artifacts.',
    '',
  ].join('\n');
}

function appendBaselineSection(summary) {
  if (!fs.existsSync(baselinesPath)) return { updated: false, reason: 'BASELINES.md not found' };
  if (!summary.dynamic.workflowFiles.length) return { updated: false, reason: 'No workflow artifacts for this run' };

  const content = fs.readFileSync(baselinesPath, 'utf8');
  if (content.includes(summary.runId)) {
    return { updated: false, reason: 'Baseline section already contains this runId' };
  }

  const matches = [...content.matchAll(/## Baseline #(\d+)/g)];
  const nextNumber = matches.length ? Math.max(...matches.map((m) => Number(m[1]))) + 1 : 1;

  const latestWorkflow = summary.dynamic.workflowFiles[summary.dynamic.workflowFiles.length - 1];
  const latestNative = summary.dynamic.nativeFiles[summary.dynamic.nativeFiles.length - 1] || null;

  const block = [
    '',
    `## Baseline #${nextNumber} — Frontend IPC Deep Audit (${localDateStamp(new Date(summary.generatedAt))})`,
    '',
    `**runId:** \`${summary.runId}\``,
    `**Workflow artifact:** \`outputs/e2e/perf/${latestWorkflow.file}\``,
    latestNative ? `**Native memory artifact:** \`outputs/e2e/perf/${latestNative.file}\`` : '**Native memory artifact:** n/a',
    '',
    '### KPI (current p50/p95)',
    '',
    '| Metric | p50 | p95 |',
    '|---|---:|---:|',
    `| peakHeapMb | ${fmt(summary.kpi.current.peakHeapMb.p50)} | ${fmt(summary.kpi.current.peakHeapMb.p95)} |`,
    `| peakNodes | ${fmt(summary.kpi.current.peakNodes.p50)} | ${fmt(summary.kpi.current.peakNodes.p95)} |`,
    `| totalWallMs | ${fmt(summary.kpi.current.totalWallMs.p50)} | ${fmt(summary.kpi.current.totalWallMs.p95)} |`,
    `| totalWsMb | ${fmt(summary.kpi.current.totalWsMb.p50)} | ${fmt(summary.kpi.current.totalWsMb.p95)} |`,
    `| rendererWsMb | ${fmt(summary.kpi.current.rendererWsMb.p50)} | ${fmt(summary.kpi.current.rendererWsMb.p95)} |`,
    '',
    '### Notes',
    '',
    `- Gate status: ${summary.gates.status.toUpperCase()}`,
    `- Report: \`${toRel(reportPath)}\``,
    '',
  ].join('\n');

  fs.appendFileSync(baselinesPath, block, 'utf8');
  return { updated: true, reason: `Baseline #${nextNumber} appended` };
}

async function runDynamicPass() {
  const commands = [];

  if (skipDynamic) {
    return commands;
  }

  const e2eBuild = await runCommand(
    'D-PREP-E2E-BUILD',
    'npx tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json',
  );
  commands.push(e2eBuild);
  if (!e2eBuild.ok) {
    return commands;
  }

  const workflowFastCommand = 'npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:workflow:tauri';
  const warmup = await runCommand('D-WARMUP', workflowFastCommand);
  commands.push(warmup);
  if (!warmup.ok) {
    return commands;
  }

  for (let i = 0; i < runConfig.workflow; i += 1) {
    commands.push(await runCommand(`D-WORKFLOW-${i + 1}`, workflowFastCommand));
  }

  for (let i = 0; i < runConfig.soak; i += 1) {
    commands.push(await runCommand(`D-SOAK-${i + 1}`, 'npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:soak:tauri'));
  }

  for (let i = 0; i < runConfig.benchmark; i += 1) {
    commands.push(await runCommand(`D-BENCH-${i + 1}`, 'npm run perf:benchmark'));
  }

  commands.push(
    await runCommand(
      'D-MEM-AGG',
      'npm run perf:memory -- --skip-playwright --input-glob soak-*.json --last-runs 20',
    ),
  );

  return commands;
}

async function main() {
  installProcessCleanupHandlers();
  ensureDir(outDir);
  ensureDir(logsDir);
  ensureDir(path.dirname(reportPath));

  console.log(`[frontend-ipc-audit] runId=${runId}`);
  console.log(`[frontend-ipc-audit] outDir=${toRel(outDir)}`);

  const staticScan = runStaticScan();
  fs.writeFileSync(staticPath, `${JSON.stringify(staticScan, null, 2)}\n`);

  const dynamicCommands = await runDynamicPass();

  const workflowCommandRuns = dynamicCommands.filter((run) => run.id === 'D-WARMUP' || /^D-WORKFLOW-\d+$/.test(run.id));
  const soakCommandRuns = dynamicCommands.filter((run) => /^D-SOAK-\d+$/.test(run.id));
  const benchmarkCommandRuns = dynamicCommands.filter((run) => /^D-BENCH-\d+$/.test(run.id));

  const workflowFilesAll = parseWorkflowFiles(collectPerfFilesForRuns(
    workflowCommandRuns,
    /^workflow-.*-tauri\.json$/,
    /(workflow-[^\s'"`]+-tauri\.json)/g,
  ));
  const workflowFiles = selectMeasuredWorkflowRows(workflowFilesAll);
  const soakFiles = parseSoakFiles(collectPerfFilesForRuns(
    soakCommandRuns,
    /^soak-.*-\d+\.json$/,
    /(soak-[^\s'"`]+-\d+\.json)/g,
  ));
  const nativeFilesAll = parseNativeMemoryFiles(collectPerfFilesForRuns(
    workflowCommandRuns,
    /^native-memory-\d+\.jsonl$/,
    /(native-memory-\d+\.jsonl)/g,
  ));
  const nativeFiles = selectMeasuredNativeRows(nativeFilesAll, workflowFiles.length);
  const benchmarkFiles = collectPerfFilesForRuns(
    benchmarkCommandRuns,
    /^benchmark-.*\.json$/,
    /(benchmark-[^\s'"`]+\.json)/g,
  ).map((x) => x.name);

  const artifactWarnings = [];
  if (!skipDynamic && workflowFiles.length === 0 && nativeFiles.length > 0) {
    artifactWarnings.push(
      'Native-memory artifacts were captured even though measured workflow JSON artifacts were missing; native KPI rows were retained.',
    );
  }
  if (!skipDynamic && workflowFilesAll.length > workflowFiles.length) {
    artifactWarnings.push('Warm-up workflow artifact was excluded from measured workflow KPI rows.');
  }
  if (!skipDynamic && nativeFilesAll.length > nativeFiles.length) {
    artifactWarnings.push('Warm-up or extra native-memory artifact was excluded from measured native KPI rows.');
  }

  const historicalWorkflow = parseWorkflowFiles(listPerfFiles(/^workflow-.*-tauri\.json$/, null, auditStartMs)).slice(-5);
  const historicalNative = parseNativeMemoryFiles(listPerfFiles(/^native-memory-\d+\.jsonl$/, null, auditStartMs)).slice(-5);

  const currentKpi = buildMetricPack(workflowFiles, nativeFiles);
  const baselineKpi = buildMetricPack(historicalWorkflow, historicalNative);
  const deltaKpi = buildKpiDelta(currentKpi, baselineKpi);

  const gateEvaluation = evaluateGates(dynamicCommands, workflowFiles, soakFiles, nativeFiles, deltaKpi);
  const backlog = buildBacklog(staticScan, gateEvaluation, { current: currentKpi, baseline: baselineKpi });

  const summary = {
    runId,
    generatedAt: new Date().toISOString(),
    startedAt: auditStartedAt.toISOString(),
    mode: {
      quick,
      nonBlocking,
      windowsRunner,
      skipDynamic,
      runConfig,
    },
    assumptions: {
      authoritativeEnvironment: windowsRunner
        ? 'Windows CI runner is marked authoritative for decision making.'
        : 'Windows runner flag not set; results should be treated as advisory in mixed environments.',
      baselineWindow: 'Last 5 successful workflow-tauri and native-memory artifacts before this run.',
    },
    static: staticScan,
    dynamic: {
      commands: dynamicCommands,
      artifactCollection: {
        outputDir: toRel(outputPerfDir),
        workflowCommandCount: workflowCommandRuns.length,
        soakCommandCount: soakCommandRuns.length,
        benchmarkCommandCount: benchmarkCommandRuns.length,
        mtimeGraceBeforeMs: ARTIFACT_MTIME_GRACE_BEFORE_MS,
        mtimeGraceAfterMs: ARTIFACT_MTIME_GRACE_AFTER_MS,
      },
      artifactWarnings,
      workflowFilesAll,
      workflowFiles,
      soakFiles,
      nativeFilesAll,
      nativeFiles,
      benchmarkFiles,
    },
    kpi: {
      baseline: baselineKpi,
      current: currentKpi,
      delta: deltaKpi,
    },
    gates: gateEvaluation,
    backlog,
  };

  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  const report = buildReportMarkdown(summary);
  fs.writeFileSync(reportPath, `${report}\n`, 'utf8');
  fs.writeFileSync(latestReportPath, `${report}\n`, 'utf8');

  const baselineUpdate = appendBaselineSection(summary);

  console.log(`[frontend-ipc-audit] summary: ${toRel(summaryPath)}`);
  console.log(`[frontend-ipc-audit] report: ${toRel(reportPath)}`);
  console.log(`[frontend-ipc-audit] latest: ${toRel(latestReportPath)}`);
  console.log(`[frontend-ipc-audit] baseline update: ${baselineUpdate.reason}`);

  if (gateEvaluation.violations.length > 0 && !nonBlocking) {
    console.error('[frontend-ipc-audit] gate violations detected; exiting with failure');
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  cleanupActiveChildren();
  runTauriTeardown();
  console.error(`[frontend-ipc-audit] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
