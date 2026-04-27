//! Constants and the [`PrecomputedTouchPoint`] result struct shared by
//! every other submodule in [`super`].

/// Algorithm schema version stored in `Experiment.touchPrecomputeVersion`.
///
/// Bump whenever a change to the smart-touch-point algorithm could produce
/// a different output for the same input — startup backfill will then
/// re-run for every row whose stored version is `< TOUCH_PRECOMPUTE_VERSION`
/// (see [`super::backfill::run_touch_point_backfill`]) so all results stay
/// consistent.
///
/// ## Version history
///
/// * **v1** — initial contract (`threshold = 50 cP`, `target_time = 10 min`).
/// * **v2** — alias-tolerant channel lookup in
///   [`super::inputs::to_touch_inputs_from_columns`].  Rows persisted by
///   v1 silently produced `has_crossing = false` for experiments whose
///   raw_points use snake_case keys (the real production shape, see
///   `src/lib/parsing/parse-normalize.ts` and
///   `src/lib/experiments/mappers.ts`).  The bump here forces a one-time
///   re-precompute on next startup.
/// * **v3** — forced re-precompute after Bug #3/4 fixes (per-iteration
///   connection release + SAVEPOINT atomicity).  Rows written by the
///   buggy v2 backfill may contain all-zero hasCrossing due to connection
///   starvation or partial writes; bumping forces a clean re-compute.
/// * **v4** — backward-walk fix: crossing marker now sits at the actual
///   raw crossing point instead of the delayed smoothed-curve crossing.
///   `crossingTimeMin` values shift earlier for many experiments.
pub const TOUCH_PRECOMPUTE_VERSION: i64 = 4;

/// Library-filter threshold — always in centipoise.  The UI label must
/// reflect this so the user cannot mistake it for their dynamic
/// Analysis-tab threshold.
pub const LIBRARY_THRESHOLD_CP: f64 = 50.0;

/// Library-filter target time — always in minutes.  Paired with
/// [`LIBRARY_THRESHOLD_CP`] as the *fixed library contract*.
pub const LIBRARY_TARGET_TIME_MIN: f64 = 10.0;

/// Outcome of a single precompute pass.  All four numeric fields are
/// `Option` because the algorithm may return only one of the two touch
/// points (or none at all) depending on the curve shape.
#[derive(Debug, Clone, PartialEq)]
pub struct PrecomputedTouchPoint {
    pub has_crossing: bool,
    pub crossing_time_min: Option<f64>,
    pub crossing_viscosity_cp: Option<f64>,
    pub viscosity_at_target_cp: Option<f64>,
}

impl PrecomputedTouchPoint {
    /// Placeholder used when the experiment has no usable points.
    /// `touchPrecomputeVersion` is still written so startup backfill does
    /// not keep retrying an empty row on every launch.
    pub const fn empty() -> Self {
        Self {
            has_crossing: false,
            crossing_time_min: None,
            crossing_viscosity_cp: None,
            viscosity_at_target_cp: None,
        }
    }
}
