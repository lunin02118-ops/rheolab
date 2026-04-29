# RheoLab Enterprise — Sprint 1 audit of current codebase

> **Provenance:** external static audit of `main @ 463dce2` (alpha.2), received 2026-04-29 via operator hand-off. Saved here verbatim for traceability. Audit-driven amendments to Sprint 2 plan are folded into `SPRINT-2-PLANNING.md` v3 (see § "External audit response" there).

Scope: static audit of current `main` state as visible through GitHub connector, with focus on Sprint 1 performance-architecture work and whether it is ready to be used as the foundation for Sprint 2.

Repo state observed:
- Repository: `10lunin021189-max/rheolab`
- Default branch: `main`
- Current release commit reviewed: `463dce2983e41c39c6d7776e87caee18d5baca4f`
- Current version: `0.2.2-alpha.2`
- Local test execution was not performed in this environment; the audit uses GitHub-visible code/docs and the test totals recorded in release commit/docs.

## Executive verdict

Sprint 1 is valid as a durable measurement/tooling sprint, but it did not complete the originally scoped "Measurement + contracts" mission. It delivered high-value microbench infrastructure and a cautious P10 release-profile verdict, while explicitly deferring several budget/contract items into Sprint 2.

Recommended status:
- Sprint 1: accept as closed.
- Sprint 2: proceed, but treat four lead-in items as required recovery work before or alongside native by-ids implementation.
- P10: keep for now, but keep the documented revisit triggers alive.

## Current branch/release state

The current `main` release commit `463dce2` is the 0.2.2-alpha.2 bump. Its message records the alpha.2 follow-up fixes, version consistency, and test totals: cargo lib 381/381, Vitest 1348/1348, version validate OK. This is sufficient as a repository-recorded verification baseline, but not a substitute for re-running tests on the next change.

## What Sprint 1 actually shipped

Confirmed deliverables:
1. `bench_comparison_pdf.rs`: synthetic comparison-PDF cargo example.
2. `bench_analysis_pipeline.rs`: analysis-pipeline cargo example.
3. `run-rust-microbench.mjs`: multi-target orchestrator.
4. Fixture mode for analysis bench.
5. `--all-experiments` DB sweep mode.
6. `db-sweep-compare.mjs`: A/B report with Welch t-test, bootstrap CI, Bonferroni.
7. `run_full_analysis_kernel`: production analysis IPC body extracted into a reusable kernel.
8. P10 validation reports and Sprint 1 retrospective.

## Audit findings

| ID | Severity | Area | Status | Finding | Recommendation |
|---|---:|---|---|---|---|
| S1-AUD-001 | High | Scope | Open/deferred | Sprint 1 did not deliver most of the originally scoped measurement/contract items. | Keep Sprint 2 lead-in mandatory: ADR-0013, V1_DDL.md, library smoke runner, comparison smoke runner. |
| S1-AUD-002 | Medium | Perf harness | Open/deferred | `run-rust-microbench.mjs` orchestrates synthetic sweeps, but fixture/all-experiment sweeps are still manual. | Add `--fixture-db` / `--all-experiments` support to orchestrator. |
| S1-AUD-003 | Medium | PDF bench parity | Open | `bench_comparison_pdf.rs` uses synthetic `ComparisonReportInput`; it does not mirror the real TS adapter or future native by-ids path. | During Sprint 2, add report input dump/by-ids arm and A/B against production-shaped DB fixtures. |
| S1-AUD-004 | Medium | P10 verdict | Watch | P10 verdict is KEEP but narrow; corpus CI includes zero and per-experiment effects are mixed. | Do not over-claim. Keep revisit triggers: binary size, sub-ms hot paths, user latency complaints. |
| S1-AUD-005 | High | Budgets | Open | Many L-*, C-*, DB-* rows remain TBD, including library open, filter, comparison setup, XLSX, long-task, DB-list/detail. | Make Sprint 2 lead-in runners produce baseline JSON and update BUDGETS/BASELINES. |
| S1-AUD-006 | Medium | Large IPC contract | Partial | Lint exists, but no formal ADR yet; comparison report large-IPC exception still exists until native by-ids lands. | ADR-0013 plus remove suppression in Sprint 2 after by-ids is default. |
| S1-AUD-007 | Medium | DB schema contract | Open | No human-readable V1_DDL contract doc yet; by-ids work will need stable table/column/index reference. | Ship `docs/db/V1_DDL.md`; later add schema-drift check. |
| S1-AUD-008 | Low | CI visibility | Info | GitHub combined status for current release commit returned no statuses in connector. | Keep explicit verification dumps in release commits and/or wire CI checks to commit statuses. |

## Positive controls

- The analysis bench now calls the same `run_full_analysis_kernel` used by production IPC, reducing benchmark drift risk.
- `db-sweep-compare.mjs` introduced reusable statistical comparison infrastructure.
- P10 was not rubber-stamped; the final verdict explicitly keeps caveats and triggers.
- The current package scripts expose the microbench build/run/compare commands, which makes the tooling discoverable.

## Recommended next steps

1. Ship `docs(adr): add ADR-0013-no-large-ipc-rule`.
2. Ship `docs(db): add V1_DDL.md`.
3. Add comparison smoke perf runner first; this is the direct baseline for Sprint 2.
4. Add library smoke runner as a parallel or immediate follow-up task.
5. Extend microbench/report harness to include production-shaped comparison fixtures.
6. Proceed with native `reports_*_by_ids`.
7. Keep old TS assembly path behind fallback flag for one alpha/beta cycle.
8. Remove `LARGE-IPC-EXCEPTION` after by-ids path is default and validated.
