//! Touch-point precompute — library-filter fast-path.
//!
//! The experiment-library filter sidebar needs to answer queries such as
//! *"find every experiment whose smoothed viscosity crossed 50 cP between
//! minute 6 and minute 8"* for a library that may hold thousands of rows.
//! Running the smart-touch-point algorithm on demand would mean decoding
//! every experiment's columnar blob on every filter change, which does not
//! scale.
//!
//! To solve this, the `Experiment` table carries five precomputed columns
//! (added in migration `v0002_touch_point_metrics`):
//!
//! | Column                         | Meaning                                             |
//! | ------------------------------ | --------------------------------------------------- |
//! | `touchHasCrossing`             | 1 = crossing found, 0 = no crossing, NULL = pending |
//! | `touchCrossingTimeMin`         | Time (minutes) of the crossing — NULL when absent   |
//! | `touchCrossingViscosityCp`     | Viscosity (cP) at the crossing instant              |
//! | `touchViscosityAtTargetCp`     | Viscosity (cP) at `LIBRARY_TARGET_TIME_MIN`         |
//! | `touchPrecomputeVersion`       | Algorithm schema version that wrote the four above  |
//!
//! These columns are populated by two paths:
//!   1. **Save-path** (`update_touch_point_row`) — called from
//!      `persist_experiment` so new/updated experiments get their values
//!      set inside the same transaction as the insert.
//!   2. **Startup backfill** (`run_touch_point_backfill`) — walks the rows
//!      where `touchPrecomputeVersion IS NULL` and fills them in after the
//!      migration has added the columns to a pre-existing database.
//!
//! Both paths use the *fixed library contract*:
//! `threshold = 50 cP`, `target_time = 10 min`.  The user's
//! Analysis-tab threshold is NOT used here — the library filter is
//! intentionally constant across users and sessions.
//!
//! If the algorithm's output could change for the same input (new bug fix,
//! reworked smoothing, etc.), bump `TOUCH_PRECOMPUTE_VERSION` so the next
//! startup re-runs the backfill on every row.
//!
//! ## Module layout
//!
//! Split per concern (≤ 500 LOC each):
//!
//! * [`types`] — version constant + result struct
//! * [`inputs`] — JSON / columnar → `TouchPointInput` adapters
//! * [`compute`] — pure-computation entry points
//! * [`writer`] — database persistence (save-path)
//! * [`backfill`] — startup backfill (locate-and-recompute)
//!
//! Public API is preserved: every symbol that other modules used to
//! import from `crate::db::touch_point_precompute::*` is re-exported
//! here via [`pub use`] so the refactor is invisible to callers.

mod backfill;
mod compute;
mod inputs;
mod types;
mod writer;

#[cfg(test)]
mod tests;

// ── Public re-exports ────────────────────────────────────────────────
//
// The pre-refactor module exposed these names directly under
// `crate::db::touch_point_precompute::*`.  Keep the surface byte-for-byte
// identical so callers (`startup/setup.rs`, `repositories/experiments/
// write.rs`, `commands/experiments/list/dynamic.rs`, several test
// modules) compile without touching their `use` statements.

pub use backfill::{run_touch_point_backfill, BackfillStats};
pub use compute::{compute_from_inputs, compute_from_inputs_with_threshold};
pub use inputs::{to_touch_inputs, to_touch_inputs_from_columns};
pub use types::{
    PrecomputedTouchPoint, LIBRARY_TARGET_TIME_MIN, LIBRARY_THRESHOLD_CP, TOUCH_PRECOMPUTE_VERSION,
};
pub use writer::update_touch_point_row;
