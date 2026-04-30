# ADR-0013 — No-large-IPC rule for Tauri commands

- **Status**: Accepted — enforced with zero active suppressions
- **Date**: 2026-04-29
- **Deciders**: Architecture Team
- **Related**: ADR-0010 (comparison report architecture), Sprint 0 P14 audit, Sprint 2 plan
- **Enforced by**: `scripts/audit/check-large-ipc-contracts.mjs` (run via `npm run audit:large-ipc`)

---

## 1. Context

The Tauri IPC channel between the React frontend and the Rust backend marshals every parameter through `serde_json`. For non-trivial payloads — anything above a few KB — this incurs three costs:

1. **Frontend serialisation:** the JS object is encoded into a JSON string (cost dominated by `JSON.stringify` on deeply-nested objects).
2. **WebView2 bridge:** the string crosses the IPC bridge as bytes (cost dominated by message size; WebView2 uses chunked transport above ~64 KB).
3. **Backend deserialisation:** the string is decoded back into a Rust type via `serde_json::from_value` or typed `serde::Deserialize` (cost dominated by allocator pressure for nested `Vec<T>` of `T: Deserialize`).

The combined cost is non-linear above ~100 KB and dominates wall-clock time for payloads built from thousands of nested objects (e.g., a comparison report carrying 5–10 experiments, each with ~10 000 raw rheology points). Real measurements from Sprint 0's `FRONTEND-IPC-DEEP-AUDIT-LATEST.md` showed the comparison-export path spending **30–50 % of its wall time in the IPC marshalling itself**, before any actual report generation runs in Rust.

Sprint 0's audit-v2 added the **P14 lint** (`scripts/audit/check-large-ipc-contracts.mjs`) which scans every `#[tauri::command]` signature in `src-tauri/src/commands/` and flags forbidden parameter types. The lint originally shipped with one temporary suppression for the legacy comparison PDF payload IPC while Sprint 2 moved comparison reports to bounded by-IDs commands.

The RC hardening lane removed that legacy comparison payload IPC and the suppression marker. As of this update, `npm run audit:large-ipc` is expected to report zero unsuppressed findings and zero suppressions.

---

## 2. Decision

### 2.1 Rule statement

A `#[tauri::command]` function signature **must not** contain any of the following parameter types:

| Forbidden type | Why | Use instead |
| -------------- | --- | ----------- |
| `Vec<f64>`, `Vec<f32>` | Large numeric arrays — IPC marshalling dominates wall time. | `tauri::ipc::Response` with a binary encoding (postcard / custom header + bytes), or a downsampled DTO that fits the consumer's viewport. |
| `Vec<RawPoint>`, `Vec<DataPoint>` | Raw time-series points — same cost as `Vec<f64>` plus typed deserialisation overhead. | A by-ids command that loads from SQLite directly inside the handler, or a binary stream. |
| `serde_json::Value` | Untyped JSON parameter — masks an absent typed DTO; the IPC contract is not statically visible; no free schema validation. | A typed DTO (`#[derive(Deserialize)]`) so the lint can see the shape and so reviewers see the contract at the function signature. |

The lint is **regex-based**, not a full Rust parser. False negatives are accepted; false positives are not. The strict signature scope (only the lines between `#[tauri::command]` and the opening `{` of the function body) keeps false-positive rate at zero on the current codebase.

### 2.2 Suppression mechanism

Exceptions to the rule require a suppression marker placed **within 5 lines above** the `pub (async) fn` declaration:

```rust
// LARGE-IPC-EXCEPTION: <reason — must justify why a by-ids / binary / downsampled alternative does not work>
#[tauri::command]
pub async fn some_command(...) -> Result<...> { ... }
```

CI greps for the marker, so every exception is auditable. Adding a new exception requires:

1. The reason string in the marker (visible to reviewers and to grep-based audits).
2. An ADR amendment (this document) listing the new exception and a dated removal gate.

A new exception without ADR amendment is grounds to block the PR.

### 2.3 Enforcement

`scripts/audit/check-large-ipc-contracts.mjs` is the source of truth.

- Run via `npm run audit:large-ipc` locally and in CI.
- Walks every `.rs` file under `src-tauri/src/commands/`.
- For each `#[tauri::command]` attribute, locates the next `pub (async) fn ...` line and scans the signature region (up to the opening `{`) against the forbidden patterns.
- For each match, looks up the preceding 5 lines for the `LARGE-IPC-EXCEPTION:` marker.
- Exit codes:
  - `0` — no violations, **or** every violation is suppressed.
  - `1` — at least one unsuppressed violation.
  - `2` — internal error (e.g., command directory not found).

CI gates `audit:large-ipc` alongside `cargo test`, `vitest`, and `version:validate`. Any unsuppressed violation blocks merge to `main`.

---

## 3. Consequences

### 3.1 Positive

- **IPC payload size is architecturally bounded.** Authors cannot accidentally introduce a 5 MB payload by adding a new command — the lint catches it before review.
- **Forces by-ids design.** When a command genuinely needs heavy data, the architecturally-correct answer is "fetch it from SQLite by ID inside the handler, not over IPC". The lint nudges authors towards this pattern at design time, not after profiling.
- **Free schema visibility.** Forbidding `serde_json::Value` ensures every typed DTO is visible at the signature, which makes reviewers' jobs easier and gives the IPC contract free schema validation via `serde`.
- **Drift detection in CI.** A change that would re-introduce a large-IPC pattern on a previously-clean command fails CI immediately.
- **Zero-suppression baseline.** The lint now reports **zero suppressed findings**. Any future exception is a new architecture decision, not inherited debt.

### 3.2 Negative / costs

- **One-time architectural cost.** The comparison report flow paid this cost across Sprint 2 and the RC hardening lane: default exports moved to by-IDs, and the legacy payload IPC was removed.
- **Regex-based lint accepts false negatives.** A future Rust-aware linter (clippy custom lint, `rustc_lint`-style plugin) would be more robust, but is out of scope. The existing regex catches the realistic patterns.
- **Authors of new commands must justify exceptions in writing.** The marker reason must articulate why a by-ids / binary / downsampled alternative does not work. This is mild friction but a desired behaviour — exceptions should be rare and well-reasoned.

### 3.3 Neutral

The lint remains intentionally regex-based and signature-scoped. Typed DTOs are visible at review time, while explicit raw arrays and `serde_json::Value` stay forbidden for Tauri command parameters. The comparison family now uses by-IDs IPC, so it no longer relies on this typed-DTO distinction for large report payloads.

This neutral consequence will be revisited in a future ADR if the lint is ever extended to flag *all* large typed DTOs (not just the explicit raw-data shapes). Current scope is intentionally narrow.

---

## 4. Historical exception and final removal

There are **no active `LARGE-IPC-EXCEPTION` suppressions** in the codebase.

The historical suppression was:

| File | Command | Reason |
| ---- | ------- | ------ |
| `src-tauri/src/commands/reports.rs` | `reports_generate_comparison_pdf` | REP-001 anti-DoS pre-deserialise count check for the legacy large payload command. |

It was added in Sprint 0 audit-v2 (commits `9fb902f`, `e77fb26`) and removed during the RC hardening lane after Sprint 6.

### 4.1 Final state

Sprint 2 shipped:

- **S2-1** — new IPC commands `reports_generate_comparison_pdf_by_ids(...)` and `_excel_by_ids(...)`. The payload is bounded by experiment IDs plus settings, which is naturally small by construction.
- **S2-2** — parity/golden tests proving by-ids and the legacy path produce equivalent PDF/XLSX outputs.
- **S2-3** — validation report quantifying fixture-backed native render wall time and artifact sizes.
- **S2 frontend switch** — default comparison exports use by-IDs IPC.
- **RC hardening** — removed the legacy comparison payload frontend fallback, removed the legacy comparison payload IPC commands, and removed the remaining suppression marker.

### 4.2 What if a future sprint cannot complete the final removal?

If a future exception is required, this ADR must be amended with the same level of detail as the historical row above plus a dated removal gate. A new exception is release-risk debt and must not be treated as a casual lint bypass.

---

## 5. Implementation references

- `scripts/audit/check-large-ipc-contracts.mjs` — the lint (Sprint 0, P14 from audit-v2).
- `package.json` script: `audit:large-ipc` invokes the lint.
- `docs/performance/BUDGETS.md` § "Sprint 0 deliverables tracker" — references the P14 lint and the historical exception.
- `docs/performance/SPRINT-2-PLANNING.md` § "Definition of done" — records the rollback-window deferral for final marker removal.
- `docs/performance/REPORTS-NATIVE-BY-IDS-VALIDATION.md` — Sprint 2 validation report for the new default path.
- `docs/performance/PERF-ROADMAP-SPRINTS-1-6.md` — Sprint 2 mission overview where this rule is cited as a side benefit of the native-by-ids work.

---

## 6. See also

- ADR-0010 (Comparison report architecture) — the architecture this rule constrains; will be revised by Sprint 2 with a "post-Sprint-2 by-ids path" section that cites this ADR.
- `docs/ipc-surface.md` — the catalogue of all current Tauri IPC commands, kept in sync with the lint scope.
- `docs/db/V1_DDL.md` — schema contract for the 5 tables the by-ids handler reads from (Sprint 2 / S2-L2).
- `docs/performance/FRONTEND-IPC-DEEP-AUDIT-LATEST.md` — original audit that motivated the rule.
