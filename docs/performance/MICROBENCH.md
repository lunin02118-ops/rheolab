# Native Rust Microbenches

**Status:** Sprint 1 / S1-1 + S1-2 (2026-04-28).
**Owner:** Architecture Team.

## Targets

| Slug | Cargo example | Measures | Sprint |
|---|---|---|---|
| `pdf` (default) | `bench_comparison_pdf` | `generate_comparison_pdf` Rust pure-CPU time (Typst + plotters + chart layout) | S1-1 |
| `analysis` | `bench_analysis_pipeline` | Full analysis pipeline: `detect_schedule` → `filter_parasitic_steps` → cycle detection → `process_all_cycles` (mirrors `analysis_analyze_full` IPC body) | S1-2 |

**Linked artefacts:**
- Example binaries: `src-tauri/examples/bench_comparison_pdf.rs`, `src-tauri/examples/bench_analysis_pipeline.rs`
- Orchestrator: `scripts/test/run-rust-microbench.mjs` (single script, `--target pdf|analysis`)
- npm scripts:
  - `perf:microbench:pdf:build`, `perf:microbench:pdf`, `perf:microbench:pdf:compare`
  - `perf:microbench:analysis:build`, `perf:microbench:analysis`, `perf:microbench:analysis:compare`
- Live validation reports:
  - `docs/performance/P10-VALIDATION-REPORT.md` (PDF target)
  - `docs/performance/P10-ANALYSIS-VALIDATION-REPORT.md` (analysis target, final P10 verdict)

## Why this exists

The S0-5 perf baseline (`AlphaBaseline-0.2.2-alpha.2`) measured the
**debug E2E binary** because Playwright tests, license-gate handling,
and WebView2 startup all rule out the production release binary.
That left two important blind spots:

1. **No way to validate `[profile.release.package.*]` overrides** —
   they only apply to release builds, so the debug E2E suite cannot
   see them.  `BUDGETS.md` keeps a "release-only" gate column that
   was permanently TBD.
2. **No way to isolate Rust pure-CPU time from IPC / UI overhead** —
   a workflow PDF wallTime of 1571 ms could be 100 ms of Typst plus
   1471 ms of IPC + serialisation + dialog open.  `BUDGETS.md` has
   `L-PDF` but it conflates everything.

The two microbenches fix both blind spots with cargo examples that:

- Live in `src-tauri/examples/` so the P10 overrides apply.
- Call `rheolab_core` primitives directly — no IPC, no UI, no license
  gate, no Tauri runtime, no WebView2.
- Synthesise deterministic fixtures inline (no JSON files to keep in
  sync with struct evolution).
- Emit stdout Markdown **and** an optional JSON sidecar that the
  orchestrator aggregates.

## Quick start

### One-shot baseline (PDF target)

```pwsh
# 1. Build the bench binary (needed once per Cargo.toml change; ~3-5 min cold, ~30s warm)
npm run perf:microbench:pdf:build

# 2. Run the default sweep (3 / 5 / 10 experiments, 4 h each, 5 iterations)
npm run perf:microbench:pdf

# 3. Tag the sweep with a label for future comparison
npm run perf:microbench:pdf -- --label MyExperiment-2026-05-01
```

### One-shot baseline (analysis target)

```pwsh
# Symmetrical to PDF — just swap the verb.
npm run perf:microbench:analysis:build
npm run perf:microbench:analysis
npm run perf:microbench:analysis -- --label MyAnalysis-2026-05-01
```

Output goes to `outputs/perf/microbench/`:
- `microbench-<target>-n<N>-h<H>-<ts>.json` — per-fixture JSON sidecar
- `microbench-sweep-<target>-<label>-<ts>.json` — aggregated index

### Fixture mode (real production data, analysis target only)

The `analysis` target also accepts `--load-fixture <path.db>
--experiment-index <i>` to run the pipeline against real raw points
loaded from a `rheolab-fixture-seed-*.db` SQLite file.  This bypasses
synthetic data generation and uses the production columnar decoder
(`rheolab_enterprise::db::columnar::decode_typed`) — same code path
as the live IPC, minus the IPC.

```pwsh
# 1. Make sure a seed DB exists (adds ~1 MB to outputs/seed/)
npm run db:seed:small

# 2. Inspect the fixture DB to find an experiment index of interest
& "src-tauri/target/release/examples/bench_analysis_pipeline.exe" `
    --load-fixture outputs/seed/rheolab-fixture-seed-small.db `
    --experiment-index 0 --iterations 1 --quiet

# 3. Run a fixture-mode sweep manually (orchestrator doesn't yet
# automate fixture-mode sweeps; one experiment index per invocation)
foreach ($idx in 3,4,14) {
    & "src-tauri/target/release/examples/bench_analysis_pipeline.exe" `
        --load-fixture outputs/seed/rheolab-fixture-seed-small.db `
        --experiment-index $idx `
        --n 5 --iterations 10 `
        --label "fixture-idx$idx" `
        --json "outputs/perf/microbench/fixture-mode/idx$idx.json" `
        --quiet
}
```

`--n N` in fixture mode means "replay this trace N times per timed
iteration" — the same workload semantics as the comparison-flow path
(analyse N experiments back-to-back).  `--duration-hours` is ignored
in fixture mode (the duration is whatever the experiment captured).

The PDF target does **not** support `--load-fixture` yet — comparison
PDFs require a `ComparisonReportInput` struct that the TS adapter
builds, which we don't yet have a way to dump from production.
Adding that is a future Sprint task.

### A vs B comparison

To prove or disprove a `Cargo.toml` profile change, run **two**
labelled sweeps with the binary rebuilt between them, then
`--compare` (works for either target — example uses analysis):

```pwsh
# 1. Capture WITH-P10 baseline
npm run perf:microbench:analysis:build
npm run perf:microbench:analysis -- --label WITH-P10

# 2. Stash the [profile.release.package.*] overrides
Copy-Item src-tauri/Cargo.toml src-tauri/Cargo.toml.bak
# … manually delete the [profile.release.package.*] block, save …

# 3. Capture NO-P10 baseline
npm run perf:microbench:analysis:build
npm run perf:microbench:analysis -- --label NO-P10

# 4. Restore Cargo.toml *before* running compare so workspace returns to canonical state
Move-Item src-tauri/Cargo.toml.bak src-tauri/Cargo.toml -Force
npm run perf:microbench:analysis:build  # rebuild WITH-P10 binary so subsequent runs are honest

# 5. Generate a Markdown delta report
npm run perf:microbench:analysis:compare -- `
    outputs/perf/microbench/microbench-sweep-analysis-WITH-P10-<ts1>.json `
    outputs/perf/microbench/microbench-sweep-analysis-NO-P10-<ts2>.json `
    --output docs/performance/MyExperiment-VALIDATION-REPORT.md
```

After the second sweep, **always restore + rebuild with the original
Cargo.toml** so the workspace state stays consistent for unrelated
work.

### Cross-target comparison is rejected

The orchestrator refuses to `--compare` a PDF sweep against an
analysis sweep — different fixtures, different schemas, the diff
would be meaningless.  Both inputs must come from the same
`--target`.

## CLI reference

### `bench_comparison_pdf` and `bench_analysis_pipeline` (Rust examples)

Both examples accept the same flags so the orchestrator can drive
them uniformly.  Per-target semantics differ in what `--n` means:

| Flag | PDF target | Analysis target | Default |
|---|---|---|---|
| `--n N` | experiments in the comparison report | `analyze_full`-equivalent calls per timed iteration | 3 (pdf) / 1 (analysis) |
| `--iterations K` | timing reps | timing reps | 5 |
| `--duration-hours H` | per-experiment data duration | per-call data duration | 4.0 |
| `--json PATH` | write JSON sidecar to PATH | same | none |
| `--label TEXT` | free-form tag written into sidecar | same | none |
| `--quiet` | suppress per-iteration stderr progress | same | off |
| `--help, -h` | show help | same | — |

### `run-rust-microbench.mjs` (orchestrator)

```
Targets:
  --target NAME         pdf | analysis (default: pdf)

Sweep mode (default):
  --fixtures LIST       Comma-separated fixtures, e.g. "3,5,10" or "3x4,5x4,10x8"
                        (per-target defaults are different — see TARGETS table
                        in the script)
  --iterations N        Iterations per fixture (default: 5)
  --label TEXT          Tag written into each JSON sidecar (e.g. "WITH-P10")

Compare mode:
  --compare WITH NO     Diff two sweep index files; print Markdown delta.
                        Both indexes must come from the same target.
  --output PATH         (compare mode) Write the report to PATH instead of stdout
```

## What these microbenches do NOT measure

Both are **release-binary, Rust-only, pure CPU time**.  Out of scope:

| Layer | Where to measure |
|---|---|
| TS adapter (`buildPayload`) | `cmp:pdf:buildPayload` mark in `useComparisonReportExport.ts` (Sprint 0 / S0-6) |
| IPC roundtrip (TS → Rust → TS bytes) | `cmp:pdf:ipcRoundtrip` mark, same hook |
| File save dialog + write | `cmp:pdf:saveBlob` mark, same hook |
| WebView2 / UI re-render after save | not instrumented yet — Sprint 4 candidate |
| Real-instrument fixture (large DB, multi-format parsers) | pending — future `--load-fixture <path>` flag (Sprint 2+) |

For end-to-end wall time **including** IPC, use `perf:workflow:tauri`
against the debug E2E build — but remember that debug build's
`[profile.dev.package.*]` overrides are **different** from release;
absolute numbers are not directly comparable to microbench numbers.

## Determinism guarantees

- **Fixture content** is deterministic in `(n, duration_hours)`: two
  invocations with the same parameters generate the same input bytes.
  No PRNG, no clock-based input, no env var dependencies.
- **Iteration timing** is **not** deterministic — Typst font cache,
  OS scheduler, allocator behaviour all vary.  Iteration 1 is always
  3–5× slower than warm iterations because of font cache miss; we do
  **not** strip it from the percentile aggregation.  If you want a
  warmup-stripped result, do it manually from the `samples` array
  in the JSON sidecar.

## When to re-run

| Trigger | Action |
|---|---|
| Cargo profile change (`[profile.release.*]`, `[profile.release.package.*]`) | Run sweep before + after, `--compare` |
| `rheolab-core` PDF generation refactor | Run sweep against `main` and feature branch, `--compare` |
| Typst major version bump | Run sweep, capture in `outputs/perf/microbench/`, document delta in changelog |
| New fixture archetype (e.g. 50-experiment comparison) | Add to `--fixtures` list, capture baseline, document expected p50/p95 in `BUDGETS.md` |

## Known limitations

1. **Synthetic fixtures only.** Real instrument data has different
   sampling density and curve shape; bench results may not match
   production timings exactly.  Sprint 2+ will add a
   `--load-fixture <path>` flag to load real `ComparisonReportInput`
   JSON dumps (PDF) and `Vec<RheoPoint>` traces (analysis).
2. **Single-process measurement.** No process-level memory or CPU
   sampling — use `perf:soak:tauri` for that, against the debug
   binary.
3. **No statistical significance test.** 5 iterations is enough for
   p50/p95 trend-spotting but not for ANOVA.  If you need significance,
   bump `--iterations` to 20+ and run multiple sweeps.
4. **Workspace state side-effect.** `--compare` does **not** modify
   anything, but the **Cargo.toml stash dance** for A/B profile
   measurement does.  Always restore + rebuild with the original
   Cargo.toml after the second sweep — the orchestrator does not do
   that for you, and stale binary builds will silently produce
   wrong-target numbers in subsequent runs.
5. **Analysis bench vendoring drift.** `bench_analysis_pipeline.rs`
   inlines two helpers (`vendored_detect_cycles`,
   `vendored_process_all_cycles`) copied from
   `src-tauri/src/commands/analysis/{cycle_detection,cycle_processing}.rs`
   because those are `pub(crate)`/`pub(super)`.  If the production
   pipeline changes shape, the vendored copies need a manual sync.
   A future refactor could lift them to `pub fn run_full_analysis(...)`
   in `src-tauri/src/commands/analysis/mod.rs` and let the bench
   call that directly.

## See also

- `docs/performance/BUDGETS.md` — formal performance contract.
- `docs/performance/BASELINES.md` — captured baselines (debug E2E).
- `docs/performance/P10-VALIDATION-REPORT.md` — PDF target P10 measurement.
- `docs/performance/P10-ANALYSIS-VALIDATION-REPORT.md` — analysis target P10 measurement on synthetic data.
- `docs/performance/P10-FIXTURE-VALIDATION-REPORT.md` — analysis target P10 measurement on real fixtures (S1-3, narrows the verdict).
- `src-tauri/examples/bench_comparison_pdf.rs` — PDF bench source.
- `src-tauri/examples/bench_analysis_pipeline.rs` — analysis bench source.
- `scripts/test/run-rust-microbench.mjs` — the multi-target orchestrator.
