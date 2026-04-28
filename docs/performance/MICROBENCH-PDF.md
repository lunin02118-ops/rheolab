# Comparison-PDF Microbench

**Status:** Sprint 1 / S1-1 (2026-04-28).
**Owner:** Architecture Team.
**Linked artefacts:**
- Example binary: `src-tauri/examples/bench_comparison_pdf.rs`
- Orchestrator: `scripts/test/run-pdf-microbench.mjs`
- npm scripts: `perf:microbench:pdf:build`, `perf:microbench:pdf`, `perf:microbench:pdf:compare`
- Sample sweep output: `outputs/perf/microbench/microbench-sweep-WITH-P10-1777396464988.json`
- Live validation report: `docs/performance/P10-VALIDATION-REPORT.md`

## Why this exists

The S0-5 perf baseline (`AlphaBaseline-0.2.2-alpha.2`) measured the
**debug E2E binary** because Playwright tests, license-gate handling,
and WebView2 startup all rule out the production release binary.
That left two important blind spots:

1. **No way to validate `[profile.release.package.*]` overrides** —
   they only apply to release builds, so the debug E2E suite cannot
   see them.  `BUDGETS.md` keeps a "release-only" gate column that
   was permanently TBD.
2. **No way to isolate Rust pure-PDF time from IPC / UI overhead** —
   a workflow PDF wallTime of 1571 ms could be 100 ms of Typst plus
   1471 ms of IPC + serialisation + dialog open.  `BUDGETS.md` has
   `L-PDF` but it conflates everything.

This microbench fixes both blind spots with a single 280-line cargo
example that:

- Lives in `src-tauri/examples/` so the P10 overrides apply.
- Calls `rheolab_core::report_generator::comparison::generate_comparison_pdf`
  directly — no IPC, no UI, no license gate, no Tauri runtime, no
  WebView2.
- Synthesises deterministic fixtures inline (no JSON files to keep in
  sync with struct evolution).
- Emits stdout Markdown **and** an optional JSON sidecar that the
  orchestrator aggregates.

## Quick start

### One-shot baseline

```pwsh
# 1. Build the bench binary (needed once per Cargo.toml change; ~3-5 min)
npm run perf:microbench:pdf:build

# 2. Run the default sweep (3 / 5 / 10 experiments, 4 h each, 5 iterations)
npm run perf:microbench:pdf

# 3. Tag the sweep with a label for future comparison
npm run perf:microbench:pdf -- --label MyExperiment-2026-05-01
```

Output goes to `outputs/perf/microbench/`:
- `microbench-pdf-n3-<ts>.json` — per-fixture JSON
- `microbench-pdf-n5-<ts>.json`
- `microbench-pdf-n10-<ts>.json`
- `microbench-sweep-<label>-<ts>.json` — aggregated index

### A vs B comparison

To prove or disprove a `Cargo.toml` profile change, run **two**
labelled sweeps with the binary rebuilt between them, then `--compare`:

```pwsh
# Capture WITH-P10 baseline
npm run perf:microbench:pdf:build
npm run perf:microbench:pdf -- --label WITH-P10

# Stash the [profile.release.package.*] overrides — copy file, edit, save
Copy-Item src-tauri/Cargo.toml src-tauri/Cargo.toml.bak
# (manually delete the [profile.release.package.*] block, save)

# Capture NO-P10 baseline
npm run perf:microbench:pdf:build
npm run perf:microbench:pdf -- --label NO-P10

# Restore Cargo.toml
Move-Item src-tauri/Cargo.toml.bak src-tauri/Cargo.toml -Force

# Generate a Markdown delta report
node scripts/test/run-pdf-microbench.mjs --compare `
    outputs/perf/microbench/microbench-sweep-WITH-P10-<ts1>.json `
    outputs/perf/microbench/microbench-sweep-NO-P10-<ts2>.json `
    --output docs/performance/MyExperiment-VALIDATION-REPORT.md
```

After the second sweep, **always rebuild with the original
Cargo.toml** so the workspace state stays consistent for unrelated
work.

## CLI reference

### `bench_comparison_pdf` (Rust example)

```
Usage: bench_comparison_pdf [OPTIONS]

Options:
  --n N                 Number of experiments (default: 3)
  --iterations K        Iterations to run (default: 5)
  --duration-hours H    Per-experiment data duration in hours (default: 4.0)
  --json PATH           Write results as JSON to PATH (sidecar)
  --label TEXT          Free-form label written into the JSON sidecar
  --quiet               Suppress per-iteration progress lines on stderr
  --help, -h            Show this help
```

### `run-pdf-microbench.mjs` (orchestrator)

```
Sweep mode (default):
  --fixtures LIST       Comma-separated fixtures, e.g. "3,5,10" or "3x4,5x4,10x8"
                        (default: "3x4,5x4,10x4" — n experiments x duration hours)
  --iterations N        Iterations per fixture (default: 5)
  --label TEXT          Tag written into each JSON sidecar (e.g. "WITH-P10")

Compare mode:
  --compare WITH NO     Diff two sweep index files; print Markdown delta
  --output PATH         (compare mode) Write the report to PATH instead of stdout
```

## What the microbench does NOT measure

This is **release-binary, Rust-only, pure CPU time** for
`generate_comparison_pdf`.  Out of scope:

| Layer | Where to measure |
|---|---|
| TS adapter (`buildPayload`) | `cmp:pdf:buildPayload` mark in `useComparisonReportExport.ts` (Sprint 0 / S0-6) |
| IPC roundtrip (TS → Rust → TS bytes) | `cmp:pdf:ipcRoundtrip` mark, same hook |
| File save dialog + write | `cmp:pdf:saveBlob` mark, same hook |
| WebView2 / UI re-render after save | not instrumented yet — Sprint 4 candidate |
| Analysis pipeline (cycle detection, viscosity calculations) | **Sprint 1 / S1-2** — pending |

For end-to-end comparison-PDF wall time **including** IPC, use
`perf:workflow:tauri` against the debug E2E build — but remember that
debug build's `[profile.dev.package.*]` overrides are **different**
from release; absolute numbers are not directly comparable to
microbench numbers.

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
   sampling density and curve shape; results from this bench may not
   match production timings exactly.  Sprint 1 / S1-2+ will add a
   `--load-fixture <path>` flag to load real `ComparisonReportInput`
   JSON dumps.
2. **Single-process measurement.** No process-level memory or CPU
   sampling — use `perf:soak:tauri` for that, against the debug
   binary.
3. **No statistical significance test.** 5 iterations is enough for
   p50/p95 trend-spotting but not for ANOVA.  If you need significance,
   bump `--iterations` to 20+ and run multiple sweeps.
4. **Workspace state side-effect.** `--compare` does **not** modify
   anything, but the **Cargo.toml stash dance** for A/B profile
   measurement does.  Always restore Cargo.toml after the second
   sweep — the orchestrator does not do that for you.

## See also

- `docs/performance/BUDGETS.md` — formal performance contract.
- `docs/performance/BASELINES.md` — captured baselines (debug E2E).
- `docs/performance/P10-VALIDATION-REPORT.md` — first use of this
  microbench: P10 vs no-P10 delta on synthetic fixtures.
- `src-tauri/examples/bench_comparison_pdf.rs` — the example binary.
- `scripts/test/run-pdf-microbench.mjs` — the orchestrator.
