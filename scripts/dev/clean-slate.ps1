param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# Tauri v2 app_data_dir() resolves to APPDATA (Roaming) on Windows
$appDataDirRoaming = Join-Path $env:APPDATA 'com.rheolab.enterprise'
# WebView2 data, logs, startup.log live under LOCALAPPDATA
$appDataDirLocal   = Join-Path $env:LOCALAPPDATA 'com.rheolab.enterprise'
# Secure storage (AES-256 encrypted license data)
$secureDirRoaming  = Join-Path $env:APPDATA '.rheolab'
$secureDirLocal    = Join-Path $env:LOCALAPPDATA '.rheolab'
# Legacy V1 data directory
$legacyDir         = Join-Path $env:LOCALAPPDATA 'RheoLab'

$regPaths = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RheoLab Enterprise*',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\RheoLab Enterprise*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\RheoLab Enterprise*'
)

Write-Host ''
Write-Host '=== RheoLab Enterprise - Clean Slate ===' -ForegroundColor Cyan
Write-Host ''

$targets = @()

foreach ($dir in @(
    @{ Tag='APP-R'; Path=$appDataDirRoaming },
    @{ Tag='APP-L'; Path=$appDataDirLocal },
    @{ Tag='SEC-R'; Path=$secureDirRoaming },
    @{ Tag='SEC-L'; Path=$secureDirLocal },
    @{ Tag='LEGACY'; Path=$legacyDir }
)) {
    if (Test-Path $dir.Path) {
        $size = (Get-ChildItem -Path $dir.Path -Recurse -ErrorAction SilentlyContinue |
                 Measure-Object -Property Length -Sum).Sum
        $sizeMB = [math]::Round($size / 1MB, 1)
        $targets += "  [$($dir.Tag)] $($dir.Path) ($sizeMB MB)"
    }
}

foreach ($rp in $regPaths) {
    $found = Get-Item $rp -ErrorAction SilentlyContinue
    if ($found) {
        $targets += "  [REG] $($found.PSPath)"
    }
}

if ($targets.Count -eq 0) {
    Write-Host '  System is already clean.' -ForegroundColor Green
    Write-Host ''
    exit 0
}

Write-Host '  Will delete:' -ForegroundColor Yellow
foreach ($t in $targets) {
    Write-Host $t -ForegroundColor Gray
}
Write-Host ''

if (-not $Force) {
    $answer = Read-Host '  Continue? (y/N)'
    if ($answer -notin @('y', 'Y', 'yes')) {
        Write-Host '  Cancelled.' -ForegroundColor Yellow
        exit 1
    }
}

# Kill running app
$procs = Get-Process -Name 'rheolab-enterprise' -ErrorAction SilentlyContinue
if ($procs) {
    Write-Host '  Stopping running processes...' -ForegroundColor Yellow
    $procs | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Delete all data directories
foreach ($dir in @($appDataDirRoaming, $appDataDirLocal, $secureDirRoaming, $secureDirLocal, $legacyDir)) {
    if (Test-Path $dir) {
        Write-Host "  Removing $dir ..." -ForegroundColor Gray
        Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $dir) {
            Start-Sleep -Seconds 2
            Remove-Item -Path $dir -Recurse -Force
        }
        Write-Host '  OK: removed' -ForegroundColor Green
    }
}

# Delete registry keys
foreach ($rp in $regPaths) {
    $found = Get-Item $rp -ErrorAction SilentlyContinue
    if ($found) {
        Write-Host "  Removing registry: $($found.PSPath) ..." -ForegroundColor Gray
        Remove-Item $found.PSPath -Recurse -Force
        Write-Host '  OK: registry cleaned' -ForegroundColor Green
    }
}

Write-Host ''
Write-Host '  === Done! System fully cleaned. ===' -ForegroundColor Green
Write-Host ''
