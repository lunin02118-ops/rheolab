<#
.SYNOPSIS
    Compute the same v2 machine-ID the Rust app computes, then query the
    license server's find_by_machine.php to see what it has on file for us.

    Mirrors src-tauri/src/commands/licensing/hardware/{collectors,machine_id}.rs
    byte-for-byte:
        cpu_id   = Win32_Processor.ProcessorId
        mobo     = Win32_ComputerSystemProduct.UUID
        bios     = Win32_BIOS.SerialNumber
        sanitize = trim + tolower + strip known OEM bogus values
        id       = first 32 hex chars of SHA-256("rheolab-hw-v2-" + cpu|mobo|bios)
#>

$bogus = @(
    'to be filled by o.e.m.',
    'default string',
    'none',
    'no asset tag',
    'not available',
    'not specified',
    'system serial number',
    'chassis serial number',
    '0123456789abcdef',
    '123456789',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '03000200-0400-0500-0006-000700080009',
    '0000000000000000'
)

function Sanitize([string]$raw) {
    if ($null -eq $raw) { return '' }
    $v = $raw.Trim().ToLower()
    if ($v.Length -lt 4) { return '' }
    if ($bogus -contains $v) { return '' }
    if (($v.ToCharArray() | Where-Object { $_ -ne '0' }).Count -eq 0) { return '' }
    if (($v.ToCharArray() | Where-Object { $_ -ne 'f' }).Count -eq 0) { return '' }
    return $v
}

$cpu  = Sanitize (Get-CimInstance Win32_Processor              | Select-Object -First 1 -ExpandProperty ProcessorId)
$mobo = Sanitize (Get-CimInstance Win32_ComputerSystemProduct  |                         Select-Object -ExpandProperty UUID)
$bios = Sanitize (Get-CimInstance Win32_BIOS                   |                         Select-Object -ExpandProperty SerialNumber)

$parts = @($cpu, $mobo, $bios) | Where-Object { $_ -ne '' }
if ($parts.Count -eq 0) { throw 'No hardware components available' }

$combined = ($parts -join '|')
$salted   = "rheolab-hw-v2-$combined"
$sha      = [System.Security.Cryptography.SHA256]::Create()
$bytes    = [System.Text.Encoding]::UTF8.GetBytes($salted)
$hash     = $sha.ComputeHash($bytes)
$hex      = -join ($hash | ForEach-Object { $_.ToString('x2') })
$machineId = $hex.Substring(0, 32)

Write-Host ''
Write-Host '── Hardware components (as the Rust app sees them) ──' -Fore Cyan
Write-Host ("  cpu_id           = {0}" -f $cpu)
Write-Host ("  motherboard_uuid = {0}" -f $mobo)
Write-Host ("  bios_serial      = {0}" -f $bios)
Write-Host ''
Write-Host '── Derived machine ID (v2) ──' -Fore Cyan
Write-Host ("  {0}" -f $machineId) -Fore Yellow
Write-Host ''

Write-Host '── Server lookup (find_by_machine.php) ──' -Fore Cyan
$body = @{ machineId = $machineId } | ConvertTo-Json -Compress
$response = $null
$statusCode = $null
try {
    $resp = Invoke-WebRequest -Uri 'https://license.vizbuka.ru/api/find_by_machine.php' `
        -Method POST -ContentType 'application/json' -Body $body `
        -ErrorAction Stop -UseBasicParsing
    $statusCode = $resp.StatusCode
    $response = $resp.Content
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $stream = $_.Exception.Response.GetResponseStream()
    if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $response = $reader.ReadToEnd()
    } else {
        $response = $_.Exception.Message
    }
}
Write-Host ("  HTTP {0}" -f $statusCode)
Write-Host "  Body:"
Write-Host $response
Write-Host ''
