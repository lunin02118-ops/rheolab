$root = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $root

Write-Host "=== TOP 20 TypeScript files in src/ by LOC (excludes rust/, d.ts) ==="
Get-ChildItem -Path "src" -Recurse -Include *.ts,*.tsx |
    Where-Object {
        $_.FullName -notmatch '\\rust\\' -and
        $_.Name -notlike '*.d.ts'
    } |
    ForEach-Object {
        [PSCustomObject]@{
            Lines = (Get-Content -Path $_.FullName | Measure-Object -Line).Lines
            Path  = $_.FullName.Substring($root.Path.Length + 1)
        }
    } |
    Sort-Object Lines -Descending |
    Select-Object -First 20 |
    Format-Table -AutoSize

Write-Host ""
Write-Host "=== src/lib/tauri/ files (WP-2.4 safeInvoke) ==="
Get-ChildItem -Path "src\lib\tauri" -File | ForEach-Object {
    [PSCustomObject]@{
        Name = $_.Name
        Size = $_.Length
    }
} | Format-Table -AutoSize

Write-Host ""
Write-Host "=== tauri.d.ts + generated.d.ts ==="
@(
    "src\types\tauri.d.ts",
    "src\types\generated.d.ts"
) | ForEach-Object {
    if (Test-Path $_) {
        $lc = (Get-Content -Path $_ | Measure-Object -Line).Lines
        Write-Host "$_ : $lc lines"
    } else {
        Write-Host "$_ : NOT FOUND"
    }
}
