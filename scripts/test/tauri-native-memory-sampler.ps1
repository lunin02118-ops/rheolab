<#
.SYNOPSIS
    Сэмплирует нативную память Tauri-приложения + WebView2-процессов.

.DESCRIPTION
    Запускается как фоновый процесс через tauri-e2e-setup.js.
    Каждые IntervalMs мс записывает строку JSONL в OutputFile:
      - Working Set Tauri EXE
      - Working Set msedgewebview2.exe, являющихся потомками Tauri PID
        (исключая сторонние WebView2-процессы: Edge, Teams и т.п.)
      - Суммарный Working Set (Tauri + наши WebView2)
      - Разбивку WebView2 по типам процессов (browser/renderer/gpu/utility/other)
      - Private Bytes как по сумме, так и по типам процессов WebView2

    Завершается автоматически, когда Tauri-процесс завершился.

.PARAMETER PidFile
    Путь к файлу с PID запущенного Tauri-приложения (.tauri-e2e.pid).

.PARAMETER OutputFile
    Путь к файлу вывода JSONL (outputs/e2e/perf/native-memory-<ts>.jsonl).

.PARAMETER IntervalMs
    Интервал опроса в мс. По умолчанию: 2000.

.EXAMPLE
    powershell -File tauri-native-memory-sampler.ps1 `
        -PidFile .tauri-e2e.pid `
        -OutputFile outputs/e2e/perf/native-memory-12345.jsonl `
        -IntervalMs 2000
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$PidFile,

    [Parameter(Mandatory=$true)]
    [string]$OutputFile,

    [int]$IntervalMs = 2000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Прочитать PID Tauri-приложения
if (-not (Test-Path $PidFile)) {
    Write-Error "PID file not found: $PidFile"
    exit 1
}
$tauriPid = [int](Get-Content $PidFile -Raw).Trim()

# Убедиться, что выходная директория существует
$outDir = Split-Path $OutputFile -Parent
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$startTime = [System.Diagnostics.Stopwatch]::StartNew()
$sampleCount = 0

# Получить все PIDs потомков процесса рекурсивно через WMI
function Get-DescendantPids {
    param(
        [int]$RootPid,
        [object[]]$AllWmi
    )
    if ($null -eq $AllWmi) {
        $AllWmi = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId -ErrorAction SilentlyContinue
    }
    $result  = [System.Collections.Generic.HashSet[int]]::new()
    $queue   = [System.Collections.Generic.Queue[int]]::new()
    $queue.Enqueue($RootPid)
    while ($queue.Count -gt 0) {
        $cur = $queue.Dequeue()
        foreach ($p in $allWmi) {
            if ($p.ParentProcessId -eq $cur -and -not $result.Contains([int]$p.ProcessId)) {
                $null = $result.Add([int]$p.ProcessId)
                $queue.Enqueue([int]$p.ProcessId)
            }
        }
    }
    return $result
}

function Get-WebView2ProcessType {
    param([string]$CommandLine)

    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return 'other'
    }

    if ($CommandLine -match '(?i)(?:^|\s)--type=([a-z0-9-]+)') {
        $rawType = $matches[1].ToLowerInvariant()
        switch ($rawType) {
            'renderer'    { return 'renderer' }
            'gpu-process' { return 'gpu' }
            'utility'     { return 'utility' }
            'browser'     { return 'browser' }
            default       { return 'other' }
        }
    }

    if ($CommandLine -match '(?i)--embedded-browser-webview') {
        return 'browser'
    }

    return 'other'
}

function Add-TypeAggregate {
    param(
        [hashtable]$Agg,
        [string]$Type,
        [double]$WsBytes,
        [double]$PrivateBytes
    )

    if (-not $Agg.ContainsKey($Type)) {
        $Agg[$Type] = [PSCustomObject]@{
            type         = $Type
            count        = 0
            wsBytes      = [double]0
            privateBytes = [double]0
        }
    }

    $item = $Agg[$Type]
    $item.count++
    $item.wsBytes += $WsBytes
    $item.privateBytes += $PrivateBytes
}

function Get-TypeMb {
    param(
        [hashtable]$Agg,
        [string]$Type,
        [string]$Field
    )
    if ($Agg.ContainsKey($Type)) {
        return [math]::Round(($Agg[$Type].$Field) / 1MB, 2)
    }
    return 0
}

Write-Host "[sampler] Started. Tauri PID=$tauriPid  Output=$OutputFile  Interval=${IntervalMs}ms"

while ($true) {
    # Проверить жив ли Tauri-процесс
    $tauriProc = Get-Process -Id $tauriPid -ErrorAction SilentlyContinue
    if ($null -eq $tauriProc) {
        Write-Host "[sampler] Tauri process (PID=$tauriPid) exited. Stopping."
        break
    }

    try {
        # Working Set Tauri-процесса
        $tauriWsMb      = [math]::Round($tauriProc.WorkingSet64      / 1MB, 2)
        $tauriPrivateMb = [math]::Round($tauriProc.PrivateMemorySize64 / 1MB, 2)
        $tauriCpu       = [math]::Round($tauriProc.CPU, 3)

        # WebView2: только msedgewebview2.exe, порождённые нашим Tauri PID
        $allWmi = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine -ErrorAction SilentlyContinue
        $descendantPids = Get-DescendantPids -RootPid $tauriPid -AllWmi $allWmi

        $wv2WsBytes      = [double]0
        $wv2PrivateBytes = [double]0
        $wv2Count        = 0
        $wv2TypeAgg      = @{}
        $wv2Details      = New-Object System.Collections.Generic.List[object]

        if ($null -ne $allWmi) {
            foreach ($procMeta in @($allWmi)) {
                $procPid = [int]$procMeta.ProcessId
                if (-not $descendantPids.Contains($procPid)) { continue }
                if ([string]::IsNullOrWhiteSpace($procMeta.Name)) { continue }
                if ($procMeta.Name.ToLowerInvariant() -ne 'msedgewebview2.exe') { continue }

                $p = Get-Process -Id $procPid -ErrorAction SilentlyContinue
                if ($null -eq $p) { continue }

                $type = Get-WebView2ProcessType -CommandLine $procMeta.CommandLine
                $wsBytes = [double]$p.WorkingSet64
                $privateBytes = [double]$p.PrivateMemorySize64

                $wv2WsBytes += $wsBytes
                $wv2PrivateBytes += $privateBytes
                $wv2Count++

                Add-TypeAggregate -Agg $wv2TypeAgg -Type $type -WsBytes $wsBytes -PrivateBytes $privateBytes
                $null = $wv2Details.Add([PSCustomObject]@{
                    pid       = $procPid
                    type      = $type
                    wsMb      = [math]::Round($wsBytes / 1MB, 2)
                    privateMb = [math]::Round($privateBytes / 1MB, 2)
                })
            }
        }

        $wv2WsMb      = [math]::Round($wv2WsBytes / 1MB, 2)
        $wv2PrivateMb = [math]::Round($wv2PrivateBytes / 1MB, 2)

        $wv2BrowserWsMb  = Get-TypeMb -Agg $wv2TypeAgg -Type 'browser'  -Field 'wsBytes'
        $wv2RendererWsMb = Get-TypeMb -Agg $wv2TypeAgg -Type 'renderer' -Field 'wsBytes'
        $wv2GpuWsMb      = Get-TypeMb -Agg $wv2TypeAgg -Type 'gpu'      -Field 'wsBytes'
        $wv2UtilityWsMb  = Get-TypeMb -Agg $wv2TypeAgg -Type 'utility'  -Field 'wsBytes'
        $wv2OtherWsMb    = Get-TypeMb -Agg $wv2TypeAgg -Type 'other'    -Field 'wsBytes'

        $wv2BrowserPrivateMb  = Get-TypeMb -Agg $wv2TypeAgg -Type 'browser'  -Field 'privateBytes'
        $wv2RendererPrivateMb = Get-TypeMb -Agg $wv2TypeAgg -Type 'renderer' -Field 'privateBytes'
        $wv2GpuPrivateMb      = Get-TypeMb -Agg $wv2TypeAgg -Type 'gpu'      -Field 'privateBytes'
        $wv2UtilityPrivateMb  = Get-TypeMb -Agg $wv2TypeAgg -Type 'utility'  -Field 'privateBytes'
        $wv2OtherPrivateMb    = Get-TypeMb -Agg $wv2TypeAgg -Type 'other'    -Field 'privateBytes'

        $wv2TypeBreakdown = @(
            $wv2TypeAgg.Values |
                Sort-Object -Property wsBytes -Descending |
                ForEach-Object {
                    [PSCustomObject]@{
                        type      = $_.type
                        count     = $_.count
                        wsMb      = [math]::Round($_.wsBytes / 1MB, 2)
                        privateMb = [math]::Round($_.privateBytes / 1MB, 2)
                    }
                }
        )

        $wv2Processes = @(
            $wv2Details |
                Sort-Object -Property wsMb -Descending
        )

        $totalWsMb = [math]::Round($tauriWsMb + $wv2WsMb, 2)

        $sample = [PSCustomObject]@{
            elapsedMs      = [long]$startTime.Elapsed.TotalMilliseconds
            tauriWsMb      = $tauriWsMb
            tauriPrivateMb = $tauriPrivateMb
            tauriCpuSec    = $tauriCpu
            webview2WsMb   = $wv2WsMb
            webview2PrivateMb = $wv2PrivateMb
            webview2Count  = $wv2Count
            webview2BrowserWsMb  = $wv2BrowserWsMb
            webview2RendererWsMb = $wv2RendererWsMb
            webview2GpuWsMb      = $wv2GpuWsMb
            webview2UtilityWsMb  = $wv2UtilityWsMb
            webview2OtherWsMb    = $wv2OtherWsMb
            webview2BrowserPrivateMb  = $wv2BrowserPrivateMb
            webview2RendererPrivateMb = $wv2RendererPrivateMb
            webview2GpuPrivateMb      = $wv2GpuPrivateMb
            webview2UtilityPrivateMb  = $wv2UtilityPrivateMb
            webview2OtherPrivateMb    = $wv2OtherPrivateMb
            webview2TypeBreakdown = $wv2TypeBreakdown
            webview2Processes = $wv2Processes
            totalWsMb      = $totalWsMb
        }

        # Записать JSONL строку
        $line = $sample | ConvertTo-Json -Compress -Depth 6
        Add-Content -Path $OutputFile -Value $line -Encoding UTF8

        $sampleCount++
        if ($sampleCount % 15 -eq 0) {
            Write-Host "[sampler] $sampleCount samples  total=${totalWsMb} MB (tauri=${tauriWsMb} + wv2=${wv2WsMb}; renderer=${wv2RendererWsMb}; gpu=${wv2GpuWsMb})"
        }
    } catch {
        Write-Warning "[sampler] Sample error: $_"
    }

    Start-Sleep -Milliseconds $IntervalMs
}

Write-Host "[sampler] Done. $sampleCount samples written to $OutputFile"
