# Find the RheoLab / Tauri app process and snapshot resources (PS5.1 compatible)
$patterns = @("*rheo*", "*RheoLab*", "*tauri*", "*cargo*", "*reallab*", "*RealLab*")

$all = Get-Process -ErrorAction SilentlyContinue
$found = @()
foreach ($p in $all) {
    foreach ($pat in $patterns) {
        if ($p.Name -like $pat) {
            $found += $p
            break
        }
    }
}

if ($found.Count -eq 0) {
    Write-Host "No matching RheoLab/Tauri process found." -ForegroundColor Yellow
} else {
    Write-Host "`n=== RheoLab / Tauri Processes ===" -ForegroundColor Cyan
    foreach ($p in $found) {
        $wsMb   = [math]::Round($p.WorkingSet64 / 1MB, 1)
        $privMb = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
        $cpuSec = [math]::Round($p.CPU, 2)
        Write-Host ("  {0,-30} PID={1,-6} WS={2,7}MB  Priv={3,7}MB  CPU={4,8}s  Thr={5}" -f $p.Name, $p.Id, $wsMb, $privMb, $cpuSec, $p.Threads.Count)
    }
}

Write-Host "`n--- Top 5 by RAM (all processes) ---" -ForegroundColor Gray
$sorted = $all | Sort-Object WorkingSet64 -Descending | Select-Object -First 5
foreach ($p in $sorted) {
    $wsMb = [math]::Round($p.WorkingSet64 / 1MB, 1)
    Write-Host ("  {0,-30} PID={1,-6} WS={2,7}MB" -f $p.Name, $p.Id, $wsMb)
}
