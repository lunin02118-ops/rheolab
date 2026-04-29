# AnalysisArtifact Cache Validation - Sprint 3

**Status:** initial vertical-slice validation captured (2026-04-29)
**Scope:** comparison PDF/XLSX by-IDs path after adding persistent `AnalysisArtifact` cache.
**Sidecar:** `outputs/perf/microbench/analysis-artifact-cache-20260429T103850.455876400+0000.json`

## Verdict

The cache is functionally wired into comparison PDF/XLSX by-IDs generation:

- cold run stores one artifact per experiment,
- warm run hits those artifacts,
- corrupt artifacts are deleted and recomputed,
- request order is preserved on cold and warm paths,
- DB connections are not held during analysis or report rendering.

Performance result for full report generation is intentionally modest: warm PDF/XLSX exports are almost unchanged because Typst/XLSX rendering dominates the wall time, while the cached analysis artifact is small.

Dashboard analysis and single-experiment report adoption are intentionally deferred from this vertical slice. The current dashboard command sends mutable frontend points over IPC and can apply expert overrides/manual geometry remapping before analysis; using a persistent DB-blob cache there needs a new by-id command contract so the cache key exactly matches the analyzed input.

## Two-Stage Before/After Summary

| Stage | Path compared | PDF wall delta | XLSX wall delta | CPU/RAM measurement | Verdict |
| --- | --- | ---: | ---: | --- | --- |
| Sprint 2 refactor | Legacy payload IPC -> native by-IDs | -18.0% | -4.1% | Yes: renderer CPU improved for both; PDF native CPU and native working set improved materially; XLSX native WS rose by 3.51 MB in that run. | Material IPC/renderer win, especially PDF. |
| Sprint 3 cache | Cold by-IDs -> warm AnalysisArtifact cache | -0.9% | -0.05% | No: this Rust fixture bench records wall time, cache hits, rows, and artifact bytes only. | Functional cache win, no material full-render latency win yet. |

## Cold vs Warm Fixture Bench

Command:

```pwsh
cargo test --manifest-path src-tauri/Cargo.toml `
  bench_analysis_artifact_cache_cold_warm_fixture_db --lib -- --ignored --nocapture
```

Fixture source:

`outputs/seed/rheolab-fixture-seed-small.db`

Scenario:

- N = 5 experiments
- 3 cold iterations per format
- 3 warm iterations per format after a seed run
- full cached by-IDs path, including report render

| Format | Cold mean ms | Warm mean ms | Delta mean | Cold p95 ms | Warm p95 ms | Cache hits | Artifact bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PDF | 3,228.0 | 3,200.0 | -0.9% | 3,265.3 | 3,206.1 | 15 | 15,666 |
| XLSX | 11,182.9 | 11,177.4 | -0.0% | 11,201.1 | 11,213.7 | 15 | 15,660 |

Interpretation:

- Warm cache is working: 5 artifacts x 3 measured warm iterations = 15 hits.
- No material full-export latency win yet: render dominates this debug Rust test.
- This is still useful for dashboard/scheduler work, where analysis can be reused without paying full report-render cost.

## Sprint 2 A/B Context

Separate release E2E A/B already measured the larger Sprint 2 refactor from legacy payload IPC to native by-IDs:

Sidecar:

`outputs/e2e/perf/comparison-ab-perf-1777457027737-release-ab.json`

| Format | Stage | Wall ms | Renderer CPU ms | Native CPU sec | JS heap delta MB | Native WS delta MB |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| PDF | Legacy payload | 111 | 138.1 | 0.42 | +0.03 | +1.10 |
| PDF | Native by-IDs | 91 | 92.9 | 0.13 | +0.00 | -19.76 |
| PDF | Delta | -18.0% | -32.7% | -69.0% | -0.03 MB | -20.86 MB |
| XLSX | Legacy payload | 267 | 172.2 | 0.55 | +0.00 | +1.83 |
| XLSX | Native by-IDs | 256 | 136.0 | 0.57 | +0.00 | +5.34 |
| XLSX | Delta | -4.1% | -21.0% | +3.6% | +0.00 MB | +3.51 MB |

## CPU and Memory Note

The Sprint 3 cold/warm cache bench is Rust-only and records wall time, bytes, artifact rows, and hit counts. It does not sample process CPU, RSS, or JS heap.

CPU/RAM values above come from the prior Sprint 2 release E2E A/B harness. Sprint 4 scheduler instrumentation should add per-job Rust RSS and CPU sampling around report/cache jobs.

## Follow-up

- Do not tighten `L-CMP-PDF-5` or `L-CMP-XLSX-5` budgets from this cache bench; no material full-render win was observed.
- Use the cache for dashboard/scheduler flows next, where avoiding analysis recompute should be more visible.
- Add release-mode cache bench or scheduler job metrics before claiming CPU/RAM improvements for Sprint 3.
