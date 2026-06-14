# Frontend + IPC Deep Audit (2026-06-14)

## Scope

- React runtime: rendering, store subscriptions, timers, heavy hooks/charts.
- IPC integration: frontend bridge <-> Tauri/Rust command payload pressure.
- Native memory profile: WebView2 browser/renderer/gpu contribution.
- CI gate rollout: non-blocking first, then selective blocking.

## Execution Context

- runId: `20260614-032455883-frontend-ipc-deep-audit`
- mode: full
- nonBlocking: false
- windowsRunnerHint: false
- authoritativeNote: Windows runner flag not set; results should be treated as advisory in mixed environments.

## KPI Snapshot (p50/p95)

| Metric | Baseline p50 | Current p50 | Delta p50 | Baseline p95 | Current p95 |
|---|---:|---:|---:|---:|---:|
| peakHeapMb | 10.58 | 10.64 | 0.06 | 10.59 | 10.66 |
| peakNodes | 2149.00 | 2145.00 | -4.00 | 2149.00 | 2146.00 |
| totalWallMs | 34055.00 | 22399.00 | -11656.00 | 50563.00 | 22777.00 |
| totalWsMb | 729.28 | 723.32 | -5.96 | 2209.84 | 764.41 |
| rendererWsMb | 216.03 | 219.28 | 3.25 | 228.58 | 223.95 |

## Gate Status

- status: **PASS**
- none

## Static Scan Summary

- files scanned: 405
- store subscriptions without selector: 0
- ui timers without clear path: 0
- allocation hotspots: 1
- ipc string payload hotspots: 0

| Finding | Bucket | Severity | Location | Title |
|---|---|---|---|---|
| P2-ALLOC-1 | P2 | medium | src/components/library/experiment-filters.tsx:53 | Potential allocation hotspot |

## Dynamic Command Results

| Step | Command | Status | Exit | Duration ms | Log |
|---|---|---|---:|---:|---|
| D-PREP-E2E-BUILD | `npx tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json` | PASS | 0 | 26060 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-PREP-E2E-BUILD_npx_tauri_build_debug_no_bundle_config_src_tauri_tauri_e2e_conf_json.log` |
| D-WARMUP | `npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:workflow:tauri` | PASS | 0 | 32746 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-WARMUP_npx_cross_env_tauri_e2e_skip_build_1_npm_run_perf_workflow_tauri.log` |
| D-WORKFLOW-1 | `npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:workflow:tauri` | PASS | 0 | 31962 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-WORKFLOW-1_npx_cross_env_tauri_e2e_skip_build_1_npm_run_perf_workflow_tauri.log` |
| D-WORKFLOW-2 | `npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:workflow:tauri` | PASS | 0 | 31223 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-WORKFLOW-2_npx_cross_env_tauri_e2e_skip_build_1_npm_run_perf_workflow_tauri.log` |
| D-WORKFLOW-3 | `npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:workflow:tauri` | PASS | 0 | 31708 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-WORKFLOW-3_npx_cross_env_tauri_e2e_skip_build_1_npm_run_perf_workflow_tauri.log` |
| D-WORKFLOW-4 | `npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:workflow:tauri` | PASS | 0 | 31504 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-WORKFLOW-4_npx_cross_env_tauri_e2e_skip_build_1_npm_run_perf_workflow_tauri.log` |
| D-WORKFLOW-5 | `npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:workflow:tauri` | PASS | 0 | 30727 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-WORKFLOW-5_npx_cross_env_tauri_e2e_skip_build_1_npm_run_perf_workflow_tauri.log` |
| D-SOAK-1 | `npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:soak:tauri` | PASS | 0 | 23487 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-SOAK-1_npx_cross_env_tauri_e2e_skip_build_1_npm_run_perf_soak_tauri.log` |
| D-SOAK-2 | `npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:soak:tauri` | PASS | 0 | 22586 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-SOAK-2_npx_cross_env_tauri_e2e_skip_build_1_npm_run_perf_soak_tauri.log` |
| D-SOAK-3 | `npx cross-env TAURI_E2E_SKIP_BUILD=1 npm run perf:soak:tauri` | PASS | 0 | 22407 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-SOAK-3_npx_cross_env_tauri_e2e_skip_build_1_npm_run_perf_soak_tauri.log` |
| D-BENCH-1 | `npm run perf:benchmark` | PASS | 0 | 169548 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-BENCH-1_npm_run_perf_benchmark.log` |
| D-BENCH-2 | `npm run perf:benchmark` | PASS | 0 | 170981 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-BENCH-2_npm_run_perf_benchmark.log` |
| D-MEM-AGG | `npm run perf:memory -- --skip-playwright --input-glob soak-*.json --last-runs 20` | PASS | 0 | 877 | `runtime/audit/20260614-032455883-frontend-ipc-deep-audit/logs/D-MEM-AGG_npm_run_perf_memory_skip_playwright_input_glob_soak_json_last_runs_20.log` |

## Artifact Collection

- workflow artifacts (all/measured): 6/5
- soak artifacts: 6
- native-memory artifacts (all/measured): 7/5
- benchmark artifacts: 2
- Warm-up workflow artifact was excluded from measured workflow KPI rows.
- Warm-up or extra native-memory artifact was excluded from measured native KPI rows.

## Remediation Backlog

| ID | Bucket | Severity | Owner | Effort | Expected Gain | Verification | Status |
|---|---|---|---|---|---|---|---|
| P0-001 | P0 | medium | Platform Team | S | Deterministic audit outputs; no false-green empty reports. | `npm run perf:memory -- --skip-playwright --source tauri-soak` | monitoring |
| P1-001 | P1 | low | Frontend Team | M | Lower rerender churn and fewer stale async callbacks. | `rg -n "use[A-Za-z0-9_]*Store\(\)|setTimeout\(" src` | monitoring |
| P2-001 | P2 | medium | Frontend + Platform | M | Reduce serialization/copy overhead for report and bridge payloads. | `rg -n "JSON\.stringify\(|input_json\s*:\s*String" src src-tauri/src/commands` | monitoring |
| P3-001 | P3 | high | Architecture Team | L | Move toward <=600MB p95 and improved desktop stability. | `npm run audit:frontend-ipc -- --windows-runner` | open |

## Phased Targets

- Phase A (current): stabilize pipeline and metrics transparency (p50/p95 on each run).
- Phase B: reduce native peak/p95 via prioritized P1/P2 fixes.
- Phase C: architecture-level actions when target requires sub-600MB p95.

## Assumptions

- Tauri/Windows metrics are authoritative for release gating.
- Web benchmark is informative only in this phase (non-gating).
- Baseline source uses latest five successful workflow + native-memory artifacts.

