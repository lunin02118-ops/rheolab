<#
.SYNOPSIS
    Production release build for RheoLab Enterprise.

.DESCRIPTION
    Reads INTEGRITY_SECRET_KEY from scripts\dev\.env.keys and passes it to
    `cargo build --release` via an environment variable.  The key is then
    EMBEDDED INTO THE BINARY at compile time (option_env! in types.rs), so
    end users do NOT need any environment variables installed on their machines.

.EXAMPLE
    .\scripts\release\build.ps1

    With a custom key inline (overrides .env.keys):
    .\scripts\release\build.ps1 -IntegrityKey "my-prod-key-at-least-32chars!!"
#>

param(
    [string]$IntegrityKey
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$signingKeyPassword = $null

# ── Load production keys ───────────────────────────────────────────────────────
$keysFile = Join-Path $repoRoot 'scripts\dev\.env.keys'
if (Test-Path $keysFile) {
    Get-Content $keysFile | ForEach-Object {
        if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.+)$') {
            $k = $Matches[1].Trim(); $v = $Matches[2].Trim()
            if ($k -eq 'INTEGRITY_SECRET_KEY' -and -not $IntegrityKey) { $IntegrityKey = $v }
            if ($k -eq 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD') { $signingKeyPassword = $v }
        }
    }
}

$devSentinel = 'rheolab-dev-integrity-key-32chars!'
if (-not $IntegrityKey) {
    Write-Host ''
    Write-Host '  ERROR: INTEGRITY_SECRET_KEY not set.' -ForegroundColor Red
    Write-Host '  Create scripts\dev\.env.keys with a production key:' -ForegroundColor Yellow
    Write-Host '    INTEGRITY_SECRET_KEY=your-unique-production-secret-32chars+' -ForegroundColor Yellow
    Write-Host '  Or pass it directly: .\scripts\release\build.ps1 -IntegrityKey "..."' -ForegroundColor Yellow
    exit 1
}
if ($IntegrityKey -eq $devSentinel) {
    Write-Host ''
    Write-Host '  WARNING: You are building with the DEV sentinel key.' -ForegroundColor Yellow
    Write-Host '  The release binary will panic on startup (intentional guard).' -ForegroundColor Yellow
    Write-Host '  Set a real production key in scripts\dev\.env.keys' -ForegroundColor Yellow
    Write-Host ''
    $confirm = Read-Host '  Continue anyway? (y/N)'
    if ($confirm -notmatch '^[yY]') { exit 1 }
}

Write-Host ''
Write-Host '=== RheoLab Enterprise - Production Build ===' -ForegroundColor Cyan
Write-Host ''
Write-Host "  Key source : $keysFile" -ForegroundColor Gray
Write-Host "  Key preview: $($IntegrityKey.Substring(0, [Math]::Min(8, $IntegrityKey.Length)))..." -ForegroundColor Gray
Write-Host '  Key will be EMBEDDED into the binary at compile time.' -ForegroundColor Gray
Write-Host '  End users need NO environment variables.' -ForegroundColor Green
Write-Host ''

# ── Set for this process (cargo picks it up via option_env! at compile time) ──
$env:INTEGRITY_SECRET_KEY = $IntegrityKey

# ── Load Tauri updater signing key ────────────────────────────────────────────
$signingKeyFile = Join-Path $repoRoot 'src-tauri\keys\updater.key'
if (Test-Path $signingKeyFile) {
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $signingKeyFile -Raw).Trim()
    # Always set the password var (empty string for passwordless keys);
    # Tauri-during-build only auto-creates .sig when the var is present.
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = if ($signingKeyPassword) { $signingKeyPassword } else { '' }
    Write-Host '  Signing key: loaded from src-tauri\keys\updater.key' -ForegroundColor Gray
    Write-Host '  .sig files  : will be generated alongside the installer' -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host '  WARNING: src-tauri\keys\updater.key not found.' -ForegroundColor Yellow
    Write-Host '  Auto-update .sig files will NOT be generated.' -ForegroundColor Yellow
    Write-Host '  Run: npx tauri signer generate --ci -w src-tauri\keys\updater.key' -ForegroundColor Yellow
    Write-Host ''
}

Set-Location $repoRoot

# ── Bump version + regenerate version.ts ────────────────────────────────────────────
Write-Host '  Bumping version and generating version.ts...' -ForegroundColor Yellow
Remove-Item Env:RHEOLAB_SKIP_VERSION_BUMP -ErrorAction SilentlyContinue
node scripts\build\generate-version.js
if ($LASTEXITCODE -ne 0) {
    Write-Host '  ERROR: generate-version.js failed.' -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host '  Building...' -ForegroundColor Yellow
# Передаём SKIP чтобы tauri:build не запускал generate-version повторно
$env:RHEOLAB_SKIP_VERSION_BUMP = '1'
npm run tauri:build

if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  BUILD FAILED.' -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ''
Write-Host '  BUILD COMPLETE.' -ForegroundColor Green

# ── Find the freshly built installer ──────────────────────────────────────────
$version = (Get-Content (Join-Path $repoRoot 'package.json') | ConvertFrom-Json).version
$nsisDir = Join-Path $repoRoot 'src-tauri\target\release\bundle\nsis'
$installer = Get-ChildItem (Join-Path $nsisDir "*.exe") -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notlike '*uninstall*' -and $_.Name -like "*$version*" } |
    Select-Object -First 1
if (-not $installer) {
    $found = Get-ChildItem (Join-Path $nsisDir '*.exe') -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike '*uninstall*' } |
        Select-Object -ExpandProperty Name
    $foundList = if ($found) { $found -join ', ' } else { '(none)' }
    Write-Error "No installer matching version '$version' found in $nsisDir. Found: $foundList"
    exit 1
}

if ($installer) {
    Write-Host "  Installer: $($installer.FullName)" -ForegroundColor Cyan
    Write-Host "  Size:      $([Math]::Round($installer.Length / 1MB, 1)) MB" -ForegroundColor Gray

    # ── Sign the installer ───────────────────────────────────────────────────
    # Always re-sign after build so the .sig always matches the freshly built installer.
    if ($signingKeyFile -and (Test-Path $signingKeyFile)) {
        Write-Host ''
        Write-Host '  Signing installer...' -ForegroundColor Yellow
        $env:TAURI_PRIVATE_KEY = (Get-Content $signingKeyFile -Raw).Trim()
        Remove-Item env:TAURI_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
        if ($signingKeyPassword) {
            $env:TAURI_PRIVATE_KEY_PASSWORD = $signingKeyPassword
        } else {
            Remove-Item Env:TAURI_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
        }
        $signResult = npx tauri signer sign "$($installer.FullName)" 2>&1
        $sigPath = "$($installer.FullName).sig"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  .sig:      $sigPath" -ForegroundColor Green
        } else {
            Write-Host '  WARNING: Signing failed. .sig not generated.' -ForegroundColor Yellow
            Write-Host "  $signResult" -ForegroundColor Gray
        }
    }
} else {
    Write-Host '  WARNING: Could not locate installer .exe' -ForegroundColor Yellow
}
Write-Host ''
