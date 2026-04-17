param(
    [switch]$WithSeed,
    [string]$ExePath,
    [string]$SeedDbPath,
    # ── Runtime key override (optional) ────────────────────────────────────────
    # Production binaries built via scripts\release\build.ps1 already have
    # INTEGRITY_SECRET_KEY embedded at compile time — end users need nothing.
    #
    # These params allow OVERRIDING the compiled-in key at runtime (e.g. for
    # key rotation without a full rebuild).  Leave empty to use the compiled key.
    # Values are read from scripts\dev\.env.keys if the file exists.
    [string]$IntegrityKey,
    [string]$LicenseKey
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

if (-not $ExePath) {
    $ExePath = Join-Path $repoRoot 'src-tauri\target\release\rheolab-enterprise.exe'
}
if (-not $SeedDbPath) {
    $SeedDbPath = Join-Path $repoRoot 'outputs\seed\rheolab-seed.db'
}

$appDataDir = Join-Path $env:APPDATA 'com.rheolab.enterprise'

# ── Load keys ──────────────────────────────────────────────────────────────────
# Priority: parameter > .env.keys file > source-embedded dev defaults
$keysFile = Join-Path $PSScriptRoot '.env.keys'
if (Test-Path $keysFile) {
    Get-Content $keysFile | ForEach-Object {
        if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.+)$') {
            $k = $Matches[1].Trim(); $v = $Matches[2].Trim()
            if ($k -eq 'INTEGRITY_SECRET_KEY' -and -not $IntegrityKey) { $IntegrityKey = $v }
            if ($k -eq 'LICENSE_ENCRYPTION_KEY' -and -not $LicenseKey)  { $LicenseKey  = $v }
        }
    }
}
if (-not $IntegrityKey) { $IntegrityKey = 'rheolab-dev-integrity-key-32chars!' }
if (-not $LicenseKey)   { $LicenseKey   = 'rheolab-dev-license-encr-key32ch!' }

Write-Host ''
Write-Host '=== RheoLab Enterprise - Fresh Launch ===' -ForegroundColor Cyan
Write-Host ''

# Step 1: Clean slate
Write-Host '  [1/3] Clean slate...' -ForegroundColor Yellow
$cleanScript = Join-Path $PSScriptRoot 'clean-slate.ps1'
& $cleanScript -Force
Write-Host ''

# Step 2: Deploy seed DB
if ($WithSeed) {
    Write-Host '  [2/3] Deploying seed DB...' -ForegroundColor Yellow

    if (-not (Test-Path $SeedDbPath)) {
        Write-Host '    Seed DB not found, generating...' -ForegroundColor Yellow

        $cargoPath = Join-Path $repoRoot 'tools\seed_db\Cargo.toml'
        if (-not (Test-Path $cargoPath)) {
            Write-Host '    ERROR: seed_db tool not found' -ForegroundColor Red
            exit 1
        }

        Push-Location $repoRoot
        $cargoDir = Join-Path $env:USERPROFILE '.cargo\bin'
        $env:PATH = "$cargoDir;$env:PATH"
        & cargo run --manifest-path $cargoPath --release
        Pop-Location

        if (-not (Test-Path $SeedDbPath)) {
            Write-Host '    ERROR: seed DB was not created' -ForegroundColor Red
            exit 1
        }
    }

    New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
    Copy-Item -Path $SeedDbPath -Destination (Join-Path $appDataDir 'rheolab.db') -Force
    $sizeMB = [math]::Round((Get-Item $SeedDbPath).Length / 1MB, 1)
    Write-Host "    OK: Seed DB ($sizeMB MB) deployed to $appDataDir" -ForegroundColor Green
} else {
    Write-Host '  [2/3] No seed DB (clean system — голый запуск)' -ForegroundColor Gray
}

Write-Host ''

# Step 3: Launch app
Write-Host '  [3/3] Launching app...' -ForegroundColor Yellow

if (-not (Test-Path $ExePath)) {
    Write-Host "    ERROR: $ExePath not found" -ForegroundColor Red
    Write-Host '    Build release first: npm run tauri:build' -ForegroundColor Yellow
    exit 1
}

$fileInfo = Get-Item $ExePath
Write-Host "    File:  $($fileInfo.Name)" -ForegroundColor Gray
Write-Host "    Size:  $([math]::Round($fileInfo.Length / 1MB, 1)) MB" -ForegroundColor Gray
Write-Host "    Date:  $($fileInfo.LastWriteTime)" -ForegroundColor Gray
Write-Host ''

# Set runtime keys so release binary does not panic (types.rs assert_production_keys)
$env:INTEGRITY_SECRET_KEY  = $IntegrityKey
$env:LICENSE_ENCRYPTION_KEY = $LicenseKey

Start-Process -FilePath $ExePath
Write-Host '  OK: App launched!' -ForegroundColor Green
Write-Host ''
