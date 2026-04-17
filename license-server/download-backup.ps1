param(
    [Parameter(Mandatory = $true)]
    [string]$Server,

    [string]$User = 'root',

    [string]$OutDir = '.',

    [switch]$TriggerBackup,

    [switch]$DbOnly,

    [string]$RemoteBackupRoot = '/var/backups/license-server'
)

$ErrorActionPreference = 'Stop'

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

Require-Command ssh
Require-Command scp

$resolvedOutDir = Resolve-Path -LiteralPath $OutDir -ErrorAction SilentlyContinue
if (-not $resolvedOutDir) {
    $null = New-Item -ItemType Directory -Path $OutDir -Force
    $resolvedOutDir = Resolve-Path -LiteralPath $OutDir
}

$target = "$User@$Server"
$triggerLiteral = if ($TriggerBackup.IsPresent) { 'true' } else { 'false' }

if ($DbOnly) {
    $remoteFile = "$RemoteBackupRoot/database_$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').sql.gz"
    $remoteCommand = @"
set -euo pipefail
mkdir -p '$RemoteBackupRoot'
mysqldump --defaults-file=/root/.my.cnf --single-transaction --no-tablespaces --skip-comments rheolab_license | gzip -c > '$remoteFile'
echo '$remoteFile'
"@
} else {
    $remoteCommand = @"
set -euo pipefail
mkdir -p '$RemoteBackupRoot'
if $triggerLiteral; then
  /usr/local/bin/backup-license.sh >/tmp/license-server-manual-backup.log 2>&1
fi
ls -1t '$RemoteBackupRoot'/backup_*.tar.gz 2>/dev/null | head -n 1
"@
}

$remotePath = (ssh $target $remoteCommand).Trim()
if (-not $remotePath) {
    throw 'Remote backup file was not found or could not be created.'
}

$fileName = Split-Path -Leaf $remotePath
$localPath = Join-Path $resolvedOutDir $fileName

Write-Host "Downloading $remotePath -> $localPath"
scp "${target}:$remotePath" "$localPath"

$hash = Get-FileHash -LiteralPath $localPath -Algorithm SHA256
Write-Host "SHA256: $($hash.Hash)"
Write-Host "Saved:  $localPath"