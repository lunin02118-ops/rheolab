param(
    [int]$TopN = 30
)

$root = Resolve-Path "$PSScriptRoot\..\.."
Write-Host "=== Rust files > 500 LOC ==="
Get-ChildItem -Path "$root\src-tauri\src","$root\src\rust\rheolab-core\src" -Recurse -Include *.rs |
    ForEach-Object {
        $lines = (Get-Content -Path $_.FullName | Measure-Object -Line).Lines
        [PSCustomObject]@{
            Path  = $_.FullName.Substring($root.Path.Length + 1)
            Lines = $lines
        }
    } |
    Where-Object { $_.Lines -gt 500 } |
    Sort-Object Lines -Descending |
    Format-Table -AutoSize

Write-Host ""
Write-Host "=== TypeScript files > 400 LOC (src/, excludes d.ts, generated, rust/) ==="
Get-ChildItem -Path "$root\src" -Recurse -Include *.ts,*.tsx |
    Where-Object {
        $_.FullName -notmatch '\\rust\\' -and
        $_.FullName -notmatch '\\node_modules\\' -and
        $_.Name -notlike '*.d.ts' -and
        $_.Name -notlike '*.generated.*'
    } |
    ForEach-Object {
        $lines = (Get-Content -Path $_.FullName | Measure-Object -Line).Lines
        [PSCustomObject]@{
            Path  = $_.FullName.Substring($root.Path.Length + 1)
            Lines = $lines
        }
    } |
    Where-Object { $_.Lines -gt 400 } |
    Sort-Object Lines -Descending |
    Format-Table -AutoSize

Write-Host ""
Write-Host "=== TOTAL LOC ==="
$rustLoc = (Get-ChildItem -Path "$root\src-tauri\src","$root\src\rust\rheolab-core\src" -Recurse -Include *.rs | Get-Content | Measure-Object -Line).Lines
$tsLoc = (Get-ChildItem -Path "$root\src" -Recurse -Include *.ts,*.tsx | Where-Object { $_.FullName -notmatch '\\rust\\' -and $_.Name -notlike '*.d.ts' } | Get-Content | Measure-Object -Line).Lines
Write-Host "Rust LOC   : $rustLoc"
Write-Host "TS/TSX LOC : $tsLoc"
