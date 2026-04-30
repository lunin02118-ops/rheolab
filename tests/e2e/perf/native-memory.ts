import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface NativeMemorySnapshot {
  total_rss_mb: number;
  tauri_rss_mb: number;
  webview2_rss_mb: number;
  renderer_rss_mb: number;
  browser_rss_mb: number;
  gpu_rss_mb: number;
  utility_rss_mb: number;
  other_rss_mb: number;
  webview2_process_count: number;
}

export interface NativeMemoryStep extends Partial<NativeMemorySnapshot> {
  phase: string;
  at_ms: number;
  source: 'direct-win32' | 'unavailable';
  error?: string;
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function psPath(value: string): string {
  return value.replace(/'/g, "''");
}

export async function snapshotNativeMemory(): Promise<NativeMemorySnapshot | null> {
  if (process.platform !== 'win32') return null;

  const pidFile = path.resolve('.tauri-e2e.pid');
  if (!existsSync(pidFile)) return null;

  const script = `
$ErrorActionPreference = 'Stop'
$pidFile = '${psPath(pidFile)}'
if (-not (Test-Path $pidFile)) { Write-Output '{}'; exit 0 }
$rootPid = [int](Get-Content $pidFile -Raw).Trim()
$tauriProc = Get-Process -Id $rootPid -ErrorAction SilentlyContinue
if ($null -eq $tauriProc) { Write-Output '{}'; exit 0 }

$allWmi = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine -ErrorAction SilentlyContinue
$descendants = [System.Collections.Generic.HashSet[int]]::new()
$queue = [System.Collections.Generic.Queue[int]]::new()
$queue.Enqueue($rootPid)
while ($queue.Count -gt 0) {
  $cur = $queue.Dequeue()
  foreach ($p in $allWmi) {
    if ($p.ParentProcessId -eq $cur -and -not $descendants.Contains([int]$p.ProcessId)) {
      $null = $descendants.Add([int]$p.ProcessId)
      $queue.Enqueue([int]$p.ProcessId)
    }
  }
}

function Get-WebView2Type([string]$CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return 'other' }
  if ($CommandLine -match '(?i)(?:^|\\s)--type=([a-z0-9-]+)') {
    switch ($matches[1].ToLowerInvariant()) {
      'renderer' { return 'renderer' }
      'gpu-process' { return 'gpu' }
      'utility' { return 'utility' }
      'browser' { return 'browser' }
      default { return 'other' }
    }
  }
  if ($CommandLine -match '(?i)--embedded-browser-webview') { return 'browser' }
  return 'other'
}

$webview2WsMb = 0.0
$rendererWsMb = 0.0
$browserWsMb = 0.0
$gpuWsMb = 0.0
$utilityWsMb = 0.0
$otherWsMb = 0.0
$webview2Count = 0

foreach ($procMeta in @($allWmi)) {
  $procPid = [int]$procMeta.ProcessId
  if (-not $descendants.Contains($procPid)) { continue }
  if ([string]::IsNullOrWhiteSpace($procMeta.Name)) { continue }
  if ($procMeta.Name.ToLowerInvariant() -ne 'msedgewebview2.exe') { continue }
  $p = Get-Process -Id $procPid -ErrorAction SilentlyContinue
  if ($null -eq $p) { continue }
  $wsMb = [math]::Round($p.WorkingSet64 / 1MB, 2)
  $webview2WsMb += $wsMb
  $webview2Count++
  $type = Get-WebView2Type -CommandLine $procMeta.CommandLine
  switch ($type) {
    'renderer' { $rendererWsMb += $wsMb }
    'browser' { $browserWsMb += $wsMb }
    'gpu' { $gpuWsMb += $wsMb }
    'utility' { $utilityWsMb += $wsMb }
    default { $otherWsMb += $wsMb }
  }
}

$tauriWsMb = [math]::Round($tauriProc.WorkingSet64 / 1MB, 2)
$out = [PSCustomObject]@{
  total_rss_mb = [math]::Round($tauriWsMb + $webview2WsMb, 2)
  tauri_rss_mb = $tauriWsMb
  webview2_rss_mb = [math]::Round($webview2WsMb, 2)
  renderer_rss_mb = [math]::Round($rendererWsMb, 2)
  browser_rss_mb = [math]::Round($browserWsMb, 2)
  gpu_rss_mb = [math]::Round($gpuWsMb, 2)
  utility_rss_mb = [math]::Round($utilityWsMb, 2)
  other_rss_mb = [math]::Round($otherWsMb, 2)
  webview2_process_count = $webview2Count
}
$out | ConvertTo-Json -Compress -Depth 4
`;

  const { stdout } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)],
    { timeout: 10_000 },
  );
  const trimmed = stdout.trim();
  if (!trimmed || trimmed === '{}') return null;
  return JSON.parse(trimmed) as NativeMemorySnapshot;
}

export async function recordNativeMemoryStep(
  runStartedAt: number,
  phase: string,
): Promise<NativeMemoryStep> {
  try {
    const snap = await snapshotNativeMemory();
    if (!snap) {
      return { phase, at_ms: Date.now() - runStartedAt, source: 'unavailable' };
    }
    return {
      phase,
      at_ms: Date.now() - runStartedAt,
      source: 'direct-win32',
      ...snap,
    };
  } catch (error) {
    return {
      phase,
      at_ms: Date.now() - runStartedAt,
      source: 'unavailable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
