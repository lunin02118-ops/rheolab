//! Native analysis pipeline commands for desktop mode.
//!
//! Executes rheology calculations directly in Rust via `tokio::spawn_blocking`,
//! replacing the old browser-side WebAssembly pipeline.
//!
//! Public Tauri commands mirror the original worker message types plus the
//! saved-experiment by-id analysis path:
//! - [`analysis_analyze_full`]        ← `ANALYZE_FULL`
//! - [`analysis_analyze_experiment_by_id`]
//! - [`analysis_detect_steps`]        ← `DETECT_STEPS`
//! - [`analysis_regroup_by_pattern`]  ← `REGROUP_BY_PATTERN`
//!
//! Internal decomposition:
//! - `dto`              — IPC-level input/output DTOs + validators
//! - `cycle_detection`  — boundary detection helpers
//! - `cycle_processing` — per-cycle post-processing + Grace calculation
//! - `commands`         — `#[tauri::command]` wrappers

mod commands;
mod cycle_detection;
mod cycle_processing;
mod dto;

// ── Public API ─────────────────────────────────────────────────────────
// Glob re-export from `commands` is required so Tauri's `#[tauri::command]`
// macro-generated helpers (`__cmd__<name>`) are reachable via
// `commands::analysis::__cmd__analysis_*` from `tauri::generate_handler!`.
pub use commands::*;
pub use dto::{
    AnalysisOutput, AnalyzeExperimentByIdInput, AnalyzeFullInput, DetectStepsInput,
    DetectStepsOutput, RegroupByPatternInput, RheoPointsColumnar,
};

// Re-export `RheoPoint` for the test module — kept for backward compatibility
// with the previous single-file layout where it was imported at the top.
#[cfg(test)]
pub(crate) use rheolab_core::types::RheoPoint;

// ── Test module hook ───────────────────────────────────────────────────
// The existing tests file lives one directory up in `commands/analysis_tests.rs`
// and was historically attached via `#[path = "analysis_tests.rs"]` from
// `analysis.rs`. After moving to `analysis/mod.rs` the path is rewritten
// relative to this module.
#[cfg(test)]
#[allow(unused_imports)]
pub(crate) use cycle_detection::{detect_cycles_native, make_cycle};

#[cfg(test)]
#[path = "../analysis_tests.rs"]
mod tests;
