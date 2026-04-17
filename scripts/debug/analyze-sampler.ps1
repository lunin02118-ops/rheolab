param([string]$JsonlPath = "")

if ($JsonlPath -eq "") {
    $JsonlPath = Get-ChildItem "outputs/e2e/perf/native-memory-*.jsonl" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $JsonlPath) { Write-Error "No native-memory JSONL found in outputs/e2e/perf/"; exit 1 }
Write-Host "File: $JsonlPath" -ForegroundColor DarkGray

$file = $JsonlPath
$data = Get-Content $file | ForEach-Object { $_ | ConvertFrom-Json }
$count = @($data).Count
Write-Host "Samples: $count"

$peak = $data | Sort-Object totalWsMb -Descending | Select-Object -First 1

Write-Host ""
Write-Host "=== PEAK SAMPLE (elapsed=$($peak.elapsedMs)ms) ==="
Write-Host "Total WS:           $($peak.totalWsMb) MB"
Write-Host "Tauri WS:           $($peak.tauriWsMb) MB  (Private: $($peak.tauriPrivateMb) MB)"
Write-Host "WebView2 total WS:  $($peak.webview2WsMb) MB  (Private: $($peak.webview2PrivateMb) MB)"
Write-Host "WebView2 count:     $($peak.webview2Count) processes"
Write-Host ""
Write-Host "--- WebView2 by type (Working Set) ---"
Write-Host "  browser:  $($peak.webview2BrowserWsMb) MB WS / $($peak.webview2BrowserPrivateMb) MB Private"
Write-Host "  renderer: $($peak.webview2RendererWsMb) MB WS / $($peak.webview2RendererPrivateMb) MB Private"
Write-Host "  gpu:      $($peak.webview2GpuWsMb) MB WS / $($peak.webview2GpuPrivateMb) MB Private"
Write-Host "  utility:  $($peak.webview2UtilityWsMb) MB WS / $($peak.webview2UtilityPrivateMb) MB Private"
Write-Host "  other:    $($peak.webview2OtherWsMb) MB WS / $($peak.webview2OtherPrivateMb) MB Private"
Write-Host ""
Write-Host "--- Per-process breakdown at peak ---"
$peak.webview2Processes | ForEach-Object { Write-Host "  PID=$($_.pid) type=$($_.type) WS=$($_.wsMb)MB Private=$($_.privateMb)MB" }

Write-Host ""
Write-Host "=== TIMELINE (all samples) ==="
Write-Host "elapsed(ms) | total  | tauri  | wv2    | browser | renderer | gpu    | utility"
Write-Host "------------|--------|--------|--------|---------|----------|--------|--------"
$data | ForEach-Object {
    $elapsed = "{0,11}" -f $_.elapsedMs
    $total   = "{0,6}" -f $_.totalWsMb
    $tauri   = "{0,6}" -f $_.tauriWsMb
    $wv2     = "{0,6}" -f $_.webview2WsMb
    $br      = "{0,7}" -f $_.webview2BrowserWsMb
    $ren     = "{0,8}" -f $_.webview2RendererWsMb
    $gpu     = "{0,6}" -f $_.webview2GpuWsMb
    $util    = "{0,7}" -f $_.webview2UtilityWsMb
    Write-Host "$elapsed | $total | $tauri | $wv2 | $br | $ren | $gpu | $util"
}
