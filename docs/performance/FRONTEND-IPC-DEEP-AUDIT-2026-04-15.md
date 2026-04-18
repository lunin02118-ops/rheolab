# Frontend + IPC Deep Audit (2026-04-15)

## Scope

- React runtime: rendering, store subscriptions, timers, heavy hooks/charts.
- IPC integration: frontend bridge <-> Tauri/Rust command payload pressure.
- Native memory profile: WebView2 browser/renderer/gpu contribution.
- CI gate rollout: non-blocking first, then selective blocking.

## Execution Context

- runId: `20260415-193838841-frontend-ipc-deep-audit`
- mode: quick
- nonBlocking: false
- windowsRunnerHint: false
- authoritativeNote: Windows runner flag not set; results should be treated as advisory in mixed environments.

## KPI Snapshot (p50/p95)

| Metric | Baseline p50 | Current p50 | Delta p50 | Baseline p95 | Current p95 |
|---|---:|---:|---:|---:|---:|
| peakHeapMb | 9.91 | 11.44 | 1.53 | 11.11 | 11.44 |
| peakNodes | 3607.00 | 7184.00 | 3577.00 | 6678.00 | 7184.00 |
| totalWallMs | 22487.00 | 24280.00 | 1793.00 | 26926.00 | 24280.00 |
| totalWsMb | 478.12 | 473.06 | -5.06 | 603.36 | 473.06 |
| rendererWsMb | 103.17 | 103.56 | 0.39 | 167.18 | 103.56 |

## Gate Status

- status: **FAIL**
- [GATE-NODES] Peak DOM nodes P50 regression: 7184 vs baseline 3607 (+99%, threshold 30%).

## Static Scan Summary

- files scanned: 281
- store subscriptions without selector: 0
- ui timers without clear path: 0
- allocation hotspots: 0
- ipc string payload hotspots: 0

| Finding | Bucket | Severity | Location | Title |
|---|---|---|---|---|
| n/a | n/a | n/a | n/a | n/a |

## Dynamic Command Results

| Step | Command | Status | Exit | Duration ms | Log |
|---|---|---|---:|---:|---|
| D-WARMUP | `cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:workflow` | PASS | 0 | 134364 | `runtime/audit/20260415-193838841-frontend-ipc-deep-audit/logs/D-WARMUP_npm_run_perf_workflow_fast.log` |
| D-WORKFLOW-1 | `cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:workflow` | PASS | 0 | 123868 | `runtime/audit/20260415-193838841-frontend-ipc-deep-audit/logs/D-WORKFLOW-1_npm_run_perf_workflow_fast.log` |
| D-SOAK-1 | `cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:soak:tauri` | PASS | 0 | 25430 | `runtime/audit/20260415-193838841-frontend-ipc-deep-audit/logs/D-SOAK-1_npm_run_perf_soak_tauri_fast.log` |
| D-BENCH-1 | `npm run perf:benchmark` | PASS | 0 | 171070 | `runtime/audit/20260415-193838841-frontend-ipc-deep-audit/logs/D-BENCH-1_npm_run_perf_benchmark.log` |
| D-MEM-AGG | `npm run perf:memory -- --skip-playwright --input-glob soak-*.json --last-runs 20` | PASS | 0 | 2110 | `runtime/audit/20260415-193838841-frontend-ipc-deep-audit/logs/D-MEM-AGG_npm_run_perf_memory_aggregate_input_glob_soak_json_last_runs_20.log` |

## Remediation Backlog

| ID | Bucket | Severity | Owner | Effort | Expected Gain | Verification | Status |
|---|---|---|---|---|---|---|---|
| P0-001 | P0 | high | Platform Team | S | Deterministic audit outputs; no false-green empty reports. | `npm run perf:memory -- --skip-playwright --source tauri-soak` | open |
| P1-001 | P1 | low | Frontend Team | M | Lower rerender churn and fewer stale async callbacks. | `rg -n "use[A-Za-z0-9_]*Store\(\)|setTimeout\(" src` | monitoring |
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

