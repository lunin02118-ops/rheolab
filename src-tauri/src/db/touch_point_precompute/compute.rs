//! Pure-computation entry points wrapping the smart-touch-point
//! algorithm.  No database access here — just inputs in, results out.

use super::types::{PrecomputedTouchPoint, LIBRARY_TARGET_TIME_MIN, LIBRARY_THRESHOLD_CP};
use rheolab_core::report_generator::touch_point::{
    calculate_smart_touch_points, SmartTouchPointOptions, TouchPointInput, TouchPointType,
};

/// Run the smart-touch-point algorithm with a CUSTOM viscosity threshold
/// (in centipoise) and the fixed library target time (10 min).
///
/// Used by the library-filter **slow path**: when the user specifies a
/// per-query threshold (e.g. 500 cP for a crosslinked gel break-point)
/// we re-run the algorithm against each candidate experiment instead of
/// consulting the precomputed 50 cP columns.  The ramp / spike filtering
/// stays identical — only the `viscosity_threshold` option changes.
///
/// Returns `None` only when the input slice is empty; an absent crossing
/// still produces `Some(result)` with the `crossing_*` fields as `None`.
pub fn compute_from_inputs_with_threshold(
    inputs: &[TouchPointInput],
    viscosity_threshold_cp: f64,
) -> Option<PrecomputedTouchPoint> {
    if inputs.is_empty() {
        return None;
    }

    let options = SmartTouchPointOptions {
        viscosity_threshold: viscosity_threshold_cp,
        show_target_time: true,
        target_time: LIBRARY_TARGET_TIME_MIN,
        ..SmartTouchPointOptions::default()
    };

    let results = calculate_smart_touch_points(inputs, &options);

    let threshold = results
        .iter()
        .find(|r| r.tp_type == TouchPointType::Threshold);
    let target = results.iter().find(|r| r.tp_type == TouchPointType::Target);

    // "Started below threshold" guard — the core algorithm only sees
    // the threshold crossing itself, not the larger question of whether
    // a gel phase ever existed.  A curve that never rose ABOVE the
    // threshold has no gel-break to report: any "crossing" we see would
    // be the ramp-up leg clipping through on its way up, which is
    // physically meaningless to the lab researcher.
    //
    // We mirror the same check in `list::dynamic::query_with_dynamic_
    // threshold` so fast-path (precomputed) and slow-path (on-the-fly)
    // agree row-for-row.
    let (has_crossing, crossing_time_min, crossing_viscosity_cp) = match threshold {
        Some(r) => {
            let max_viscosity = inputs
                .iter()
                .map(|p| p.viscosity_cp)
                .fold(f64::NEG_INFINITY, f64::max);
            if max_viscosity.is_finite() && max_viscosity > viscosity_threshold_cp {
                (true, Some(r.time), Some(r.viscosity))
            } else {
                (false, None, None)
            }
        }
        None => (false, None, None),
    };

    Some(PrecomputedTouchPoint {
        has_crossing,
        crossing_time_min,
        crossing_viscosity_cp,
        viscosity_at_target_cp: target.map(|r| r.viscosity),
    })
}

/// Run the smart-touch-point algorithm under the fixed library contract
/// (`threshold = 50 cP`, `target_time = 10 min`) on the given inputs.
///
/// Thin wrapper over [`compute_from_inputs_with_threshold`] preserved for
/// the save-path / startup-backfill callers that persist results into
/// the legacy precomputed columns.
pub fn compute_from_inputs(inputs: &[TouchPointInput]) -> Option<PrecomputedTouchPoint> {
    compute_from_inputs_with_threshold(inputs, LIBRARY_THRESHOLD_CP)
}
