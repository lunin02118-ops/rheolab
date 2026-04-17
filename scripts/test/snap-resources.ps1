# Quick one-shot process resource snapshot (PS5.1 compatible)
param(
    [string]$ProcessName = ""
)

$names = @("RealLab Enterprise V2", "rheolab-enterprise", "reallab-enterprise", "tauri", "RealLab")
if ($ProcessName -ne "") { $names = @($ProcessName) }

$found = $null
foreach ($n in $names) {
    $p = Get-Process -Name $n -ErrorAction SilentlyContinue
    if ($p) { $found = $p; break }
}

if (-not $found) {
    Write-Host "No matching process found. Running processes (first 40):"
    Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 40 |
        Format-Table Name, Id, @{N="WS_MB";E={[math]::Round($_.WorkingSet64/1MB,1)}}, @{N="CPU_sec";E={[math]::Round($_.CPU,2)}}, Handles -AutoSize
    exit 1
}

Write-Host ""
Write-Host "=== Process Snapshot ===" -ForegroundColor Cyan
foreach ($p in $found) {
    $wsMb = [math]::Round($p.WorkingSet64 / 1MB, 1)
    $privMb = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
    $cpu = [math]::Round($p.CPU, 2)
    Write-Host ("  Name:     {0}" -f $p.Name)
    Write-Host ("  PID:      {0}" -f $p.Id)
    Write-Host ("  WS RAM:   {0} MB" -f $wsMb)
    Write-Host ("  Priv RAM: {0} MB" -f $privMb)
    Write-Host ("  CPU (tot):{0} sec" -f $cpu)
    Write-Host ("  Handles:  {0}" -f $p.HandleCount)
    Write-Host ("  Threads:  {0}" -f $p.Threads.Count)
    Write-Host ""
}
