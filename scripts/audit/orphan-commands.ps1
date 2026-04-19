$root = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $root

$rustFiles = Get-ChildItem -Path "src-tauri\src" -Recurse -Include *.rs

$defined = @{}
foreach ($file in $rustFiles) {
    $lines = Get-Content -Path $file.FullName
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -match '^\s*#\[tauri::command\]') {
            # Scan forward for fn name
            for ($j = $i + 1; $j -lt [Math]::Min($i + 10, $lines.Length); $j++) {
                if ($lines[$j] -match '^\s*(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?fn\s+(\w+)') {
                    $defined[$Matches[1]] = $file.FullName.Substring($root.Path.Length + 1) + ":" + ($j + 1)
                    break
                }
            }
        }
    }
}

# Load lib.rs invoke handler
$lib = Get-Content -Path "src-tauri\src\lib.rs" -Raw
$registered = @{}
foreach ($m in [regex]::Matches($lib, 'commands::[\w:]+::(\w+)\s*[,\]]')) {
    $registered[$m.Groups[1].Value] = $true
}

Write-Host "=== Commands defined: $($defined.Count) ==="
Write-Host "=== Commands registered: $($registered.Count) ==="

Write-Host ""
Write-Host "=== Orphans (defined, NOT registered) ==="
$orphans = $defined.Keys | Where-Object { -not $registered.ContainsKey($_) }
foreach ($name in $orphans | Sort-Object) {
    Write-Host "  $name   [$($defined[$name])]"
}
Write-Host "Orphan count: $($orphans.Count)"

Write-Host ""
Write-Host "=== Registered but NOT defined (broken handler) ==="
$broken = $registered.Keys | Where-Object { -not $defined.ContainsKey($_) }
foreach ($name in $broken | Sort-Object) {
    Write-Host "  $name"
}
Write-Host "Broken count: $($broken.Count)"
