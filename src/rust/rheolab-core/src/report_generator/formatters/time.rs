//! Time-format rendering helpers.
//!
//! The UI chart X-axis and the stats table's `Время` column both respect
//! `chartSettings.rheologyUnits.timeFormat` — one of `"seconds"`,
//! `"minutes"`, or `"hh:mm:ss"`.  The report must match, otherwise the
//! user sees a time in seconds on the chart and in minutes in the
//! printed table — exactly the inconsistency flagged on 2026-04-22.
//!
//! All inputs are stored in **minutes** (the canonical base unit for
//! `CycleResult.time_min`).  Output is a ready-to-print string.

/// Localised axis / header unit suffix for the time column.
///
/// Matches `timeAxisUnit()` in `src/hooks/chart-options/time-format.ts`.
pub fn time_axis_unit(time_format: &str, lang: &str) -> &'static str {
    match time_format {
        "seconds" => if lang == "en" { "sec" } else { "с" },
        "hh:mm:ss" => if lang == "en" { "hh:mm:ss" } else { "чч:мм:сс" },
        _ => if lang == "en" { "min" } else { "мин" },
    }
}

/// Format a time value (in minutes) for a stats table cell according to
/// the user's configured time format.  Mirrors the TS `formatTimeTick`
/// behaviour so the report and the on-screen axis read identically.
///
/// - `"seconds"`: `540` (integer seconds)
/// - `"hh:mm:ss"`: `00:09:00`
/// - anything else (`"minutes"`): `9.0` (1 decimal) or `9` (integer)
pub fn format_time_value(time_min: f64, time_format: &str) -> String {
    if !time_min.is_finite() {
        return "-".to_string();
    }
    match time_format {
        "seconds" => {
            let secs = (time_min * 60.0).round() as i64;
            secs.to_string()
        }
        "hh:mm:ss" => {
            let total = (time_min * 60.0).round() as i64;
            let h = total / 3600;
            let m = (total % 3600) / 60;
            let s = total % 60;
            format!("{:02}:{:02}:{:02}", h, m, s)
        }
        _ => {
            // "minutes" (and default): 1 decimal, strip trailing `.0`
            let rounded = (time_min * 10.0).round() / 10.0;
            if rounded.fract().abs() < f64::EPSILON {
                format!("{}", rounded as i64)
            } else {
                format!("{:.1}", rounded)
            }
        }
    }
}
