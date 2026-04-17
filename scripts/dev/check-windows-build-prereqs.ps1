[CmdletBinding()]
param(
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Add-Result {
    param(
        [string]$Name,
        [bool]$Ok,
        [string]$Details,
        [string]$Fix = ''
    )

    [pscustomobject]@{
        Name    = $Name
        Status  = if ($Ok) { 'OK' } else { 'MISSING' }
        Ok      = $Ok
        Details = $Details
        Fix     = $Fix
    }
}

$results = @()

# Rust toolchain (cargo)
$cargoCmd = Get-Command cargo -ErrorAction SilentlyContinue
if ($null -ne $cargoCmd) {
    $cargoVersion = (& cargo --version 2>$null)
    $results += Add-Result -Name 'cargo' -Ok $true -Details "$cargoVersion ($($cargoCmd.Source))"
} else {
    $results += Add-Result -Name 'cargo' -Ok $false -Details 'cargo not found in PATH' -Fix 'Install Rust (MSVC): winget install Rustlang.Rustup'
}

# Rust compiler (rustc)
$rustcCmd = Get-Command rustc -ErrorAction SilentlyContinue
if ($null -ne $rustcCmd) {
    $rustcVersion = (& rustc --version 2>$null)
    $results += Add-Result -Name 'rustc' -Ok $true -Details "$rustcVersion ($($rustcCmd.Source))"
} else {
    $results += Add-Result -Name 'rustc' -Ok $false -Details 'rustc not found in PATH' -Fix 'Install Rust (MSVC): winget install Rustlang.Rustup'
}

# Rust target
$rustupCmd = Get-Command rustup -ErrorAction SilentlyContinue
if ($null -ne $rustupCmd) {
    $installedTargets = (& rustup target list --installed 2>$null)
    $hasMsvcTarget = $installedTargets -contains 'x86_64-pc-windows-msvc'
    if ($hasMsvcTarget) {
        $results += Add-Result -Name 'rust target (x86_64-pc-windows-msvc)' -Ok $true -Details 'Installed'
    } else {
        $results += Add-Result -Name 'rust target (x86_64-pc-windows-msvc)' -Ok $false -Details 'Missing target' -Fix 'Run: rustup target add x86_64-pc-windows-msvc'
    }
} else {
    $results += Add-Result -Name 'rustup' -Ok $false -Details 'rustup not found in PATH' -Fix 'Install Rust (MSVC): winget install Rustlang.Rustup'
}

# Visual Studio Build Tools detection
$vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path $vswherePath) {
    $vsPath = (& $vswherePath -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null)
    if ($vsPath) {
        $vcvarsPath = Join-Path $vsPath 'VC\Auxiliary\Build\vcvars64.bat'
        if (Test-Path $vcvarsPath) {
            $results += Add-Result -Name 'MSVC Build Tools' -Ok $true -Details "Found: $vsPath"

            $clPath = cmd /c "`"$vcvarsPath`" >nul && where cl" 2>$null
            if ($LASTEXITCODE -eq 0 -and $clPath) {
                $firstCl = ($clPath | Select-Object -First 1)
                $results += Add-Result -Name 'cl.exe' -Ok $true -Details "Found via vcvars64: $firstCl"
            } else {
                $results += Add-Result -Name 'cl.exe' -Ok $false -Details 'cl.exe not available after vcvars64' -Fix 'Repair VS Build Tools C++ workload'
            }
        } else {
            $results += Add-Result -Name 'vcvars64.bat' -Ok $false -Details "Missing in: $vsPath" -Fix 'Install Visual Studio C++ Build Tools workload'
        }
    } else {
        $results += Add-Result -Name 'MSVC Build Tools' -Ok $false -Details 'VC.Tools workload not found' -Fix 'Install: winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools"'
    }
} else {
    $results += Add-Result -Name 'vswhere' -Ok $false -Details 'vswhere.exe not found' -Fix 'Install Visual Studio 2022 Build Tools'
}

# NSIS (required for installer packaging)
$makensisCmd = Get-Command makensis -ErrorAction SilentlyContinue
if ($null -ne $makensisCmd) {
    $makensisVersion = (& makensis -VERSION 2>$null)
    $results += Add-Result -Name 'NSIS (makensis)' -Ok $true -Details "$makensisVersion ($($makensisCmd.Source))"
} else {
    $defaultNsis = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'
    if (Test-Path $defaultNsis) {
        $results += Add-Result -Name 'NSIS (makensis)' -Ok $true -Details "Found: $defaultNsis (not in PATH)"
    } else {
        $results += Add-Result -Name 'NSIS (makensis)' -Ok $false -Details 'makensis not found' -Fix 'Install: winget install NSIS.NSIS'
    }
}

# WebView2 runtime (required by WebView host)
$wv2Version = $null
$wv2RegKeys = @(
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)

foreach ($key in $wv2RegKeys) {
    if (Test-Path $key) {
        try {
            $pv = (Get-ItemProperty -Path $key -Name pv -ErrorAction Stop).pv
            if ($pv) {
                $wv2Version = $pv
                break
            }
        } catch {
            # no-op
        }
    }
}

if ($wv2Version) {
    $results += Add-Result -Name 'Microsoft Edge WebView2 Runtime' -Ok $true -Details "Version: $wv2Version"
} else {
    $results += Add-Result -Name 'Microsoft Edge WebView2 Runtime' -Ok $false -Details 'Runtime not detected' -Fix 'Install: winget install Microsoft.EdgeWebView2Runtime'
}

# Node.js (required for Vite frontend tooling)
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($null -ne $nodeCmd) {
    $nodeVersion = (& node --version 2>$null)
    $results += Add-Result -Name 'Node.js' -Ok $true -Details "$nodeVersion ($($nodeCmd.Source))"
} else {
    $results += Add-Result -Name 'Node.js' -Ok $false -Details 'node not found in PATH' -Fix 'Required for Vite frontend build: winget install OpenJS.NodeJS.LTS'
}

$requiredChecks = @(
    'cargo',
    'rustc',
    'rust target (x86_64-pc-windows-msvc)',
    'MSVC Build Tools',
    'cl.exe',
    'Microsoft Edge WebView2 Runtime'
)

$ready = $true
foreach ($name in $requiredChecks) {
    $row = $results | Where-Object { $_.Name -eq $name } | Select-Object -First 1
    if ($null -eq $row -or -not $row.Ok) {
        $ready = $false
        break
    }
}

if ($Json) {
    [pscustomobject]@{
        ready_for_windows_tauri_build = $ready
        checks = $results
    } | ConvertTo-Json -Depth 5
    exit 0
}

Write-Host ''
Write-Host 'RheoLab Enterprise V2 - Windows build prerequisites audit' -ForegroundColor Cyan
Write-Host '=========================================================' -ForegroundColor Cyan

$results | Format-Table -AutoSize Name, Status, Details

$missing = @($results | Where-Object { -not $_.Ok })
if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host 'Recommended fixes:' -ForegroundColor Yellow
    foreach ($item in $missing) {
        if ($item.Fix) {
            Write-Host "- $($item.Name): $($item.Fix)"
        }
    }
}

Write-Host ''
if ($ready) {
    Write-Host 'Ready for Windows Tauri build: YES' -ForegroundColor Green
    Write-Host 'Next: npm run tauri:build:debug'
} else {
    Write-Host 'Ready for Windows Tauri build: NO' -ForegroundColor Red
    Write-Host 'Install missing prerequisites, then run this script again.'
}
