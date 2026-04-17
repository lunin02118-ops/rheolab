#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Polls memory and CPU usage of a running process at regular intervals.
    Designed to monitor the Tauri app (rheolab-enterprise.exe) while running
    performance scenarios or during manual testing.

.PARAMETER ProcessName
    Process name to search for (default: "rheolab-enterprise").
    Can also be set via env var RHEOLAB_POLL_PROCESS.

.PARAMETER PollIntervalMs
    Polling interval in milliseconds (default: 1000).

.PARAMETER DurationSeconds
    How long to poll in seconds. 0 = run until Ctrl+C (default: 0).

.PARAMETER OutputCsv
    Path to write CSV output. Empty = stdout only.

.PARAMETER OutputJson
    Path to write JSON summary. Empty = no file.

.EXAMPLE
    # Monitor for 60 seconds, write CSV
    .\poll-process-resources.ps1 -DurationSeconds 60 -OutputCsv outputs/e2e/perf/process-resources.csv

.EXAMPLE
    # Run indefinitely until Ctrl+C, print to console
    .\poll-process-resources.ps1

.NOTES
    CPU% is sampled as the delta of TotalProcessorTime between samples,
    divided by elapsed wall-clock time × logical-processor count.
    This matches Task Manager's "CPU Usage" column.
#>
param(
    [string] $ProcessName   = '',
    [int]    $PollIntervalMs = 1000,
    [int]    $DurationSeconds = 0,
    [string] $OutputCsv     = '',
    [string] $OutputJson    = ''
)

# Default ProcessName: prefer env var, then fallback
if (-not $ProcessName) {
    $ProcessName = if ($env:RHEOLAB_POLL_PROCESS) { $env:RHEOLAB_POLL_PROCESS } else { 'rheolab-enterprise' }
}

$ErrorActionPreference = 'Stop'

$logicalCpuCount = [System.Environment]::ProcessorCount
$samples = [System.Collections.Generic.List[hashtable]]::new()
$header  = 'timestamp,pid,working_set_mb,private_bytes_mb,cpu_pct,handles,threads'

if ($OutputCsv) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path $OutputCsv -Parent) 2>$null
    Set-Content -Path $OutputCsv -Value $header -Encoding UTF8
}

Write-Host "[poll-process] Monitoring '$ProcessName' every ${PollIntervalMs} ms" -ForegroundColor Cyan
if ($DurationSeconds -gt 0) {
    Write-Host "[poll-process] Duration: ${DurationSeconds} s" -ForegroundColor Cyan
} else {
    Write-Host "[poll-process] Running until Ctrl+C..." -ForegroundColor Cyan
}
Write-Host $header -ForegroundColor DarkGray

$startTime     = Get-Date
$prevCpuTimes  = @{}   # pid -> TimeSpan
$prevWallTime  = @{}   # pid -> DateTime

$stopAt = if ($DurationSeconds -gt 0) { (Get-Date).AddSeconds($DurationSeconds) } else { [DateTime]::MaxValue }

while ((Get-Date) -lt $stopAt) {
    $now = Get-Date

    $procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
    if (-not $procs) {
        Write-Warning "[poll-process] Process '$ProcessName' not found - waiting..."
        Start-Sleep -Milliseconds $PollIntervalMs
        continue
    }

    foreach ($p in $procs) {
        $procId = $p.Id
        $wsMb   = [math]::Round($p.WorkingSet64   / 1MB, 2)
        $privMb = [math]::Round($p.PrivateMemorySize64 / 1MB, 2)
        $cpuPct = 0.0

        if ($prevCpuTimes.ContainsKey($procId)) {
            $prevCpu  = $prevCpuTimes[$procId]
            $prevWall = $prevWallTime[$procId]
            $cpuDelta  = ($p.TotalProcessorTime - $prevCpu).TotalSeconds
            $wallDelta = ($now - $prevWall).TotalSeconds
            if ($wallDelta -gt 0) {
                $cpuPct = [math]::Round(($cpuDelta / $wallDelta / $logicalCpuCount) * 100, 1)
                $cpuPct = [math]::Min($cpuPct, 100)   # cap at 100 %
            }
        }

        $prevCpuTimes[$procId] = $p.TotalProcessorTime
        $prevWallTime[$procId] = $now

        $ts  = $now.ToString('yyyy-MM-dd HH:mm:ss.fff')
        $row = "$ts,$procId,$wsMb,$privMb,$cpuPct,$($p.HandleCount),$($p.Threads.Count)"

        Write-Host $row -ForegroundColor Gray

        if ($OutputCsv) {
            Add-Content -Path $OutputCsv -Value $row -Encoding UTF8
        }

        $samples.Add(@{
            timestamp       = $ts
            pid             = $procId
            workingSetMb    = $wsMb
            privateBytesMb  = $privMb
            cpuPct          = $cpuPct
            handles         = $p.HandleCount
            threads         = $p.Threads.Count
        })
    }

    Start-Sleep -Milliseconds $PollIntervalMs
}

# --- Summary ---
if ($samples.Count -gt 0) {
    $wsSamples  = $samples | ForEach-Object { $_['workingSetMb'] }
    $cpuSamples = $samples | Where-Object { $_['cpuPct'] -gt 0 } | ForEach-Object { $_['cpuPct'] }

    # Compute CPU summary separately (PS5.1 cannot use 'if' inline as hashtable value)
    if ($cpuSamples) {
        $cpuStats = @{
            minPct = ($cpuSamples | Measure-Object -Minimum).Minimum
            maxPct = ($cpuSamples | Measure-Object -Maximum).Maximum
            avgPct = [math]::Round(($cpuSamples | Measure-Object -Average).Average, 2)
        }
    } else {
        $cpuStats = @{ minPct = 0; maxPct = 0; avgPct = 0 }
    }

    $summary = @{
        processName      = $ProcessName
        totalSamples     = $samples.Count
        duration         = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 1)
        workingSet = @{
            minMb = ($wsSamples | Measure-Object -Minimum).Minimum
            maxMb = ($wsSamples | Measure-Object -Maximum).Maximum
            avgMb = [math]::Round(($wsSamples | Measure-Object -Average).Average, 2)
        }
        cpu = $cpuStats
    }

    Write-Host "`n[poll-process] Summary:" -ForegroundColor Cyan
    Write-Host "  WorkingSet: min=$($summary.workingSet.minMb) MB  max=$($summary.workingSet.maxMb) MB  avg=$($summary.workingSet.avgMb) MB" -ForegroundColor White
    Write-Host "  CPU:        min=$($summary.cpu.minPct)%  max=$($summary.cpu.maxPct)%  avg=$($summary.cpu.avgPct)%" -ForegroundColor White

    if ($OutputJson) {
        $null = New-Item -ItemType Directory -Force -Path (Split-Path $OutputJson -Parent) 2>$null
        $summary | ConvertTo-Json -Depth 4 | Set-Content -Path $OutputJson -Encoding UTF8
        Write-Host "[poll-process] Summary written to $OutputJson" -ForegroundColor Cyan
    }
}
