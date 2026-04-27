# Frontend + IPC Deep Audit (2026-04-24)

## Scope

- React runtime: rendering, store subscriptions, timers, heavy hooks/charts.
- IPC integration: frontend bridge <-> Tauri/Rust command payload pressure.
- Native memory profile: WebView2 browser/renderer/gpu contribution.
- CI gate rollout: non-blocking first, then selective blocking.

## Execution Context

- runId: `wave3-frontend-ipc-static-only`
- mode: full
- nonBlocking: false
- windowsRunnerHint: false
- authoritativeNote: Windows runner flag not set; results should be treated as advisory in mixed environments.

## KPI Snapshot (p50/p95)

| Metric | Baseline p50 | Current p50 | Delta p50 | Baseline p95 | Current p95 |
|---|---:|---:|---:|---:|---:|
| peakHeapMb | n/a | n/a | n/a | n/a | n/a |
| peakNodes | n/a | n/a | n/a | n/a | n/a |
| totalWallMs | n/a | n/a | n/a | n/a | n/a |
| totalWsMb | 1054.18 | n/a | n/a | 3137.68 | n/a |
| rendererWsMb | 129.33 | n/a | n/a | 156.46 | n/a |

## Gate Status

- status: **SKIPPED**
- [GATE-SKIP] Dynamic profiling pass was skipped; current-run KPI gates were not evaluated.

## Static Scan Summary

- files scanned: 359
- store subscriptions without selector: 0
- ui timers without clear path: 1
- allocation hotspots: 1
- ipc string payload hotspots: 0

| Finding | Bucket | Severity | Location | Title |
|---|---|---|---|---|
| P1-TIMER-1 | P1 | medium | src/components/dashboard/file-upload.tsx:18 | UI timer without explicit clearTimeout path |
| P2-ALLOC-2 | P2 | medium | src/components/library/experiment-filters.tsx:53 | Potential allocation hotspot |

## Dynamic Command Results

| Step | Command | Status | Exit | Duration ms | Log |
|---|---|---|---:|---:|---|
| n/a | n/a | n/a | n/a | n/a | n/a |

## Remediation Backlog

| ID | Bucket | Severity | Owner | Effort | Expected Gain | Verification | Status |
|---|---|---|---|---|---|---|---|
| P0-001 | P0 | high | Platform Team | S | Deterministic audit outputs; no false-green empty reports. | `npm run perf:memory -- --skip-playwright --source tauri-soak` | open |
| P1-001 | P1 | high | Frontend Team | M | Lower rerender churn and fewer stale async callbacks. | `rg -n "use[A-Za-z0-9_]*Store\(\)|setTimeout\(" src` | open |
| P2-001 | P2 | medium | Frontend + Platform | M | Reduce serialization/copy overhead for report and bridge payloads. | `rg -n "JSON\.stringify\(|input_json\s*:\s*String" src src-tauri/src/commands` | monitoring |
| P3-001 | P3 | medium | Architecture Team | L | Move toward <=600MB p95 and improved desktop stability. | `npm run audit:frontend-ipc -- --windows-runner` | monitoring |

## Phased Targets

- Phase A (current): stabilize pipeline and metrics transparency (p50/p95 on each run).
- Phase B: reduce native peak/p95 via prioritized P1/P2 fixes.
- Phase C: architecture-level actions when target requires sub-600MB p95.

## Assumptions

- Tauri/Windows metrics are authoritative for release gating.
- Web benchmark is informative only in this phase (non-gating).
- Baseline source uses latest five successful workflow + native-memory artifacts.

