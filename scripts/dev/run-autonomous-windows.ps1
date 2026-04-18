param(
    [switch]$NoLaunch,
    [switch]$WithQa
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

function Add-CargoBinToPath {
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path $cargoBin) {
        if (-not $env:PATH.Contains($cargoBin)) {
            $env:PATH = "$cargoBin;$env:PATH"
        }
    }
}

function Ensure-Npm {
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCmd) {
        return $npmCmd.Path
    }

    $defaultNodePath = "C:\Program Files\nodejs\npm.cmd"
    if (Test-Path $defaultNodePath) {
        $env:PATH = "C:\Program Files\nodejs;$env:PATH"
        return $defaultNodePath
    }

    throw "npm.cmd not found. Install Node.js 20+ and retry."
}

Add-CargoBinToPath
$null = Ensure-Npm

Write-Host "[rheolab] Runtime mode: native (Vite + Tauri)" -ForegroundColor Cyan
Write-Host "[rheolab] Project root: $root" -ForegroundColor DarkGray

if ($WithQa) {
    Write-Host "[rheolab] Running autonomous QA preflight (fast mode)..." -ForegroundColor Cyan
    & npm.cmd run qa:autonomous -- --fast
    if ($LASTEXITCODE -ne 0) {
        throw "Autonomous QA preflight failed with exit code $LASTEXITCODE"
    }
}

if ($NoLaunch) {
    Write-Host "[rheolab] NoLaunch flag is set; exiting before app start." -ForegroundColor Yellow
    exit 0
}

Write-Host "[rheolab] Starting Tauri desktop..." -ForegroundColor Green
& npm.cmd run tauri:dev
