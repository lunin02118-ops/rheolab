$root = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $root

Write-Host "=== UNWRAP / EXPECT / PANIC counts (all Rust files) ==="
$all = Get-ChildItem -Path "src-tauri\src","src\rust\rheolab-core\src" -Recurse -Include *.rs
$unwraps  = ($all | Select-String -Pattern "\.unwrap\(\)").Count
$expects  = ($all | Select-String -Pattern "\.expect\(").Count
$panics   = ($all | Select-String -Pattern "\bpanic!\(").Count
$todos    = ($all | Select-String -Pattern "\btodo!\(").Count
$unimpls  = ($all | Select-String -Pattern "\bunimplemented!\(").Count
Write-Host "unwrap()   total: $unwraps"
Write-Host "expect()   total: $expects"
Write-Host "panic!()   total: $panics"
Write-Host "todo!()    total: $todos"
Write-Host "unimpl!()  total: $unimpls"

Write-Host ""
Write-Host "=== Console.* calls in src/ (TS/TSX) ==="
$tsAll = Get-ChildItem -Path "src" -Recurse -Include *.ts,*.tsx |
    Where-Object { $_.FullName -notmatch '\\rust\\' -and $_.Name -notlike '*.d.ts' }
$consoles = ($tsAll | Select-String -Pattern "\bconsole\.(log|info|warn|error|debug|trace)\(").Count
Write-Host "console.*  total: $consoles"

Write-Host ""
Write-Host "=== format SELECT/INSERT/UPDATE/DELETE - potential SQL concat ==="
$sqlPattern = 'format!\("\s*(SELECT|INSERT|UPDATE|DELETE)'
$sqlConcat = $all | Select-String -Pattern $sqlPattern
$sqlConcat | ForEach-Object { Write-Host "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
Write-Host "Total matches: $($sqlConcat.Count)"

Write-Host ""
Write-Host "=== #[tauri::command] count ==="
$cmd = ($all | Select-String -Pattern "#\[tauri::command\]").Count
Write-Host "tauri::command total: $cmd"

Write-Host ""
Write-Host "=== Tests count (Rust) ==="
$tests = ($all | Select-String -Pattern "#\[test\]").Count
$tokioTests = ($all | Select-String -Pattern "#\[tokio::test\]").Count
Write-Host "#[test]        : $tests"
$testsMod = ($all | Select-String -Pattern "mod tests").Count
Write-Host "#[tokio::test] : $tokioTests"
Write-Host "mod tests decl : $testsMod"
