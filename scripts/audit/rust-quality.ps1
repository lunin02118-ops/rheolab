$root = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $root

$rustFiles = Get-ChildItem -Path "src-tauri\src","src\rust\rheolab-core\src" -Recurse -Include *.rs

Write-Host "=== .unwrap()/.expect()/panic! breakdown by file (TEST vs PROD) ==="
Write-Host "Heuristic: lines matching after '#[cfg(test)]' header are treated as TEST."
Write-Host ""

$grandProdUnwrap = 0
$grandProdExpect = 0
$grandProdPanic  = 0
$prodOffenders = @{}

foreach ($file in $rustFiles) {
    # Treat entire file as test if filename indicates it
    $isTestFile = ($file.Name -match '(^|_)tests?\.rs$') -or
                  ($file.FullName -match '\\tests\\') -or
                  ($file.FullName -match '\\benches\\')
    if ($isTestFile) { continue }

    $content = Get-Content -Path $file.FullName -Raw
    # Remove everything starting from #[cfg(test)]
    $prodContent = $content
    $cfgIdx = $prodContent.IndexOf('#[cfg(test)]')
    if ($cfgIdx -ge 0) {
        $prodContent = $prodContent.Substring(0, $cfgIdx)
    }

    $fileUnwrapProd = ([regex]::Matches($prodContent, '\.unwrap\(\)')).Count
    $fileExpectProd = ([regex]::Matches($prodContent, '\.expect\(')).Count
    $filePanicProd  = ([regex]::Matches($prodContent, '\bpanic!\(')).Count

    if (($fileUnwrapProd + $fileExpectProd + $filePanicProd) -gt 0) {
        $rel = $file.FullName.Substring($root.Path.Length + 1)
        $prodOffenders[$rel] = [PSCustomObject]@{
            File    = $rel
            Unwrap  = $fileUnwrapProd
            Expect  = $fileExpectProd
            Panic   = $filePanicProd
            Total   = $fileUnwrapProd + $fileExpectProd + $filePanicProd
        }
    }

    $grandProdUnwrap += $fileUnwrapProd
    $grandProdExpect += $fileExpectProd
    $grandProdPanic  += $filePanicProd
}

Write-Host "TOP offenders (non-test production code):"
$prodOffenders.Values | Sort-Object Total -Descending | Select-Object -First 40 | Format-Table -AutoSize

Write-Host ""
Write-Host "=== TOTALS (production, non-test) ==="
Write-Host "unwrap(): $grandProdUnwrap"
Write-Host "expect(): $grandProdExpect"
Write-Host "panic!(): $grandProdPanic"
