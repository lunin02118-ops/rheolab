# Reports native by-IDs validation — Sprint 2 closeout

**Status:** Sprint 2 validation baseline captured (2026-04-29)  
**Scope:** comparison report generation after switching the UI default to native by-IDs.  
**Branch:** `10lunin021189-max/test/byids-report-parity-tests`

## Verdict

Native by-IDs comparison export is the default path for PDF and XLSX in alpha. The old TypeScript-assembled payload path remains only as an explicit rollback lane via `localStorage['rheolab.comparisonReports.forceLegacy']='1'` or missing by-IDs IPC.

External closeout review on `3994022` confirmed the same verdict from GitHub-visible code, commit diff, and docs: **GO** for merge after the final release gate on the merge commit; **NO-GO** for removing the legacy payload path during the current rollback window.

The Sprint 2 validation evidence is split into three layers:

| Layer | Evidence | Result |
| --- | --- | --- |
| Correctness | Rust by-IDs parity tests for PDF and XLSX | Passed |
| UI routing | Vitest hook/client tests prove default by-IDs and legacy fallback | Passed |
| Native render budget | Production-shaped fixture microbench for PDF and XLSX, N=5 and N=10 | Passed |

## Production-shaped fixture microbench

Command shape:

```pwsh
node scripts/test/run-rust-microbench.mjs --target pdf \
  --fixture-db outputs/seed/rheolab-fixture-seed-small.db \
  --experiment-index 0 --fixtures 5 --iterations 3 --quiet \
  --label S2-closeout-pdf5-v2

node scripts/test/run-rust-microbench.mjs --target xlsx \
  --fixture-db outputs/seed/rheolab-fixture-seed-small.db \
  --experiment-index 0 --fixtures 5 --iterations 3 --quiet \
  --label S2-closeout-xlsx5
```

The PDF/XLSX targets use the same `bench_comparison_pdf` binary and the same fixture-backed `ComparisonReportInput` builder. `--target xlsx` passes `--format xlsx` to the binary.

| Budget | Format | N | Total points | p50 ms | p95 ms | Mean ms | Mean bytes | Sidecar |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `L-CMP-PDF-5` | PDF | 5 | 78,466 | 230.8 | 246.1 | 231.6 | 66,091 | `outputs/perf/microbench/dbsweep-pdf-S2-closeout-pdf5-v2-1777437805796.json` |
| `L-CMP-PDF-10` | PDF | 10 | 86,159 | 252.3 | 289.9 | 262.9 | 88,626 | `outputs/perf/microbench/dbsweep-pdf-S2-closeout-pdf10-v2-1777437807611.json` |
| `L-CMP-XLSX-5` | XLSX | 5 | 78,466 | 2,399.8 | 2,458.0 | 2,411.4 | 9,034,076 | `outputs/perf/microbench/dbsweep-xlsx-S2-closeout-xlsx5-1777437734536.json` |
| `L-CMP-XLSX-10` | XLSX | 10 | 86,159 | 2,657.9 | 2,689.8 | 2,641.5 | 10,118,570 | `outputs/perf/microbench/dbsweep-xlsx-S2-closeout-xlsx10-1777437734694.json` |

## Comparison against current soft budgets

| Budget | Current soft p50 budget | Measured p50 | Status |
| --- | ---: | ---: | --- |
| `L-CMP-PDF-5` | 12,000 ms | 230.8 ms | Within |
| `L-CMP-XLSX-5` | 5,000 ms | 2,399.8 ms | Within |

`L-CMP-PDF-10` and `L-CMP-XLSX-10` remain optional Sprint 2 measurements, but the closeout run captured both.

## IPC payload-size validation

The default UI path now sends a bounded `ComparisonReportByIdsRequest` instead of a fully materialized `ComparisonReportInput` containing per-experiment raw data. Tests verify the hook calls `generateComparisonPdfReportByIdsBlob` and `generateComparisonExcelReportByIdsBlob` by default and does not call the heavy comparison adapter/builders on the default path.

The legacy `reports_generate_comparison_pdf` command still carries the historical `LARGE-IPC-EXCEPTION` because the rollback path intentionally remains available for one alpha/beta cycle. It is no longer the default production path.

## Memory metrics

The current Sprint 2 harness captures report wall time and artifact byte size. It does not yet capture per-report JS heap peak or Rust RSS peak. Those metrics are explicitly carried into Sprint 3/4 instrumentation work:

- JS heap: add Browser DevTools heap sampling around comparison export.
- Rust RSS: add process RSS sampling around by-IDs handler spans or scheduler jobs.

## Verification summary

Previously completed before this closeout:

- `cargo test --manifest-path src-tauri/Cargo.toml commands::reports::tests --lib` — passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` — passed.
- focused Vitest hook/client tests — passed.
- full `npm test` for the UI switch — passed.
- `npm run version:validate` — passed.
- `npm run audit:large-ipc` — passed with the expected suppressed legacy rollback exception.
- `git diff --check` — passed.

Closeout-specific checks:

- `cargo check --manifest-path src-tauri/Cargo.toml --example bench_comparison_pdf` — passed.
- `cargo build --release --example bench_comparison_pdf --manifest-path src-tauri/Cargo.toml` — passed.
- `rustfmt --edition 2021 --check src-tauri/examples/bench_comparison_pdf.rs` — passed.
- `node --check scripts/test/run-rust-microbench.mjs` — passed.
- PDF fixture microbench N=5/N=10 — passed.
- XLSX fixture microbench N=5/N=10 — passed.

External review note: the reviewer did not run local commands in their environment, and GitHub combined statuses for `3994022` did not return CI checks. Treat the command results above as implementer-recorded verification until the final release gate runs on the merge commit.

## Closeout note

Sprint 2 closes the native by-IDs architecture and default UI switch. The legacy fallback path and its large-IPC suppression are intentionally deferred to removal after the rollback window, not treated as active blockers for alpha closeout.
