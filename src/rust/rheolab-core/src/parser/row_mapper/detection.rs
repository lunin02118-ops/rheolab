//! Column/unit detection helpers for the row mapper.
use regex::Regex;
use std::sync::LazyLock;
use super::super::types::ColumnMapping;
use super::{TemperatureUnit, TimeParsingMode};

// Static compiled regexes for time-unit detection — compiled once (#8 fix).
// `.expect()` fires once on first LazyLock access; guarded by static pattern.
static TIME_MIN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)time.*min|время.*мин").expect("TIME_MIN_RE pattern is static and valid")
});
static TIME_HOUR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)time.*(hr|hour)|время.*час").expect("TIME_HOUR_RE pattern is static and valid")
});

#[derive(Debug, Clone)]
struct TimeSample {
    raw: String,
    value: f64,
}

pub fn detect_time_unit(header_row: &[String], mapping: &ColumnMapping, context: &str) -> (bool, bool) {
    if let Some(idx) = mapping.time_col {
        if idx < header_row.len() {
            let header = header_row[idx].to_lowercase();

            if header.contains("(min)") || header.contains("[min]") || header.contains("мин") {
                return (true, false);
            }
            if header.contains("(hr)") || header.contains("(h)") || header.contains("час") {
                return (false, true);
            }

            // Remove compound units where "мин"/"min" is NOT a time unit
            // (e.g. "об/мин" = RPM, "r/min", "1/мин" = frequency)
            let clean_context = context.to_lowercase()
                .replace("об/мин", "")
                .replace("об/min", "")
                .replace("r/min", "")
                .replace("r/мин", "")
                .replace("1/мин", "")
                .replace("1/min", "");

            let is_minutes = TIME_MIN_RE.is_match(&header) || TIME_MIN_RE.is_match(&clean_context);
            let is_hours = TIME_HOUR_RE.is_match(&header) || TIME_HOUR_RE.is_match(&clean_context);

            return (is_minutes, is_hours);
        }
    }
    (false, false)
}

fn collect_time_samples(
    data_rows: &[Vec<String>],
    header_idx: usize,
    mapping: &ColumnMapping,
    limit: usize,
) -> Vec<TimeSample> {
    let time_col = match mapping.time_col {
        Some(c) => c,
        None => return vec![],
    };

    let start = header_idx + 1;
    if start >= data_rows.len() {
        return vec![];
    }

    data_rows[start..]
        .iter()
        .filter_map(|row| {
            let raw = row.get(time_col)?.trim().to_string();
            if raw.is_empty() {
                return None;
            }
            let normalized = raw.replace(',', ".").replace(char::is_whitespace, "");
            let value = normalized.parse::<f64>().ok()?;
            if value <= 0.0 {
                return None;
            }
            Some(TimeSample { raw, value })
        })
        .take(limit)
        .collect()
}

/// Data-driven sanity check: determines whether a "minutes" classification is wrong.
/// Uses two heuristics:
/// 1. Max time > 2880 → unrealistic (2880 min = 48 hours)
/// 2. Sampling interval ≈ 1 with many points → typical 1-second sampling
/// Returns true if data suggests minutes classification is wrong (i.e., values
/// are actually in seconds).
pub fn is_time_too_large_for_minutes(
    data_rows: &[Vec<String>],
    header_row_idx: usize,
    mapping: &ColumnMapping,
) -> bool {
    let time_col = match mapping.time_col {
        Some(idx) => idx,
        None => return false,
    };

    let parse_cell = |row: &[String], col: usize| -> f64 {
        if col >= row.len() { return 0.0; }
        let s = row[col].trim().replace(',', ".").replace(char::is_whitespace, "");
        s.parse::<f64>().unwrap_or(0.0)
    };

    let data_start = header_row_idx + 1;
    if data_start >= data_rows.len() { return false; }
    let end = data_rows.len();
    let num_data_rows = end - data_start;

    // Heuristic 1: Check max time value
    let check_start = if end > data_start + 10 { end - 10 } else { data_start };
    let max_time = data_rows[check_start..end].iter()
        .map(|row| parse_cell(row, time_col))
        .fold(0.0_f64, f64::max);

    // 2880 minutes = 48 hours; no realistic rheology test runs that long
    if max_time > 2880.0 {
        return true;
    }

    // Heuristic 2: If avg time step ≈ 1 and there are many points,
    // it's likely 1-second sampling (not 1-minute sampling)
    if num_data_rows > 300 {
        // Sample first 10 data rows to check the time step
        let sample_end = std::cmp::min(data_start + 11, end);
        let sample_times: Vec<f64> = data_rows[data_start..sample_end].iter()
            .map(|row| parse_cell(row, time_col))
            .collect();

        if sample_times.len() >= 2 {
            let steps: Vec<f64> = sample_times.windows(2)
                .map(|w| (w[1] - w[0]).abs())
                .filter(|&s| s > 0.0)
                .collect();

            if !steps.is_empty() {
                let avg_step = steps.iter().sum::<f64>() / steps.len() as f64;
                // If step ≈ 1 (0.8–1.2) with 300+ rows, it's 1-second sampling
                if avg_step >= 0.8 && avg_step <= 1.2 {
                    return true;
                }
            }
        }
    }

    false
}

pub fn detect_temperature_unit(header_row: &[String], mapping: &ColumnMapping, context: &str) -> TemperatureUnit {
    if let Some(idx) = mapping.temperature_col {
        if idx < header_row.len() {
            let header = header_row[idx].to_lowercase();
            let combined = format!("{} {}", header, context.to_lowercase());

            if combined.contains("°f") || combined.contains("degf") || combined.contains("fahrenheit") || combined.contains("(f)") {
                return TemperatureUnit::Fahrenheit;
            }
            if combined.contains("°k") || combined.contains("kelvin") || combined.contains("(k)") {
                return TemperatureUnit::Kelvin;
            }
        }
    }
    TemperatureUnit::Celsius
}

// Heuristics for Stress and Pressure (simplified for now, can be expanded)
pub fn detect_stress_multiplier(header_row: &[String], mapping: &ColumnMapping, context: &str) -> f64 {
    if let Some(idx) = mapping.shear_stress_col {
        if idx < header_row.len() {
            let header = header_row[idx].to_lowercase();
            let combined = format!("{} {}", header, context.to_lowercase());
            
            if combined.contains("dyne") || combined.contains("d/cm") {
                return 0.1; // dyne/cm2 to Pa
            }
            if combined.contains("lb/100") {
                return 0.4788; // lb/100ft2 to Pa
            }
        }
    }
    1.0
}

/// Universal data-driven stress unit detection.
/// Samples the first data rows and checks the physics ratio:
///   expected_stress_Pa = viscosity_cP × shear_rate / 1000
///   ratio = actual_stress / expected_stress_Pa
/// If ratio ≈ 10 (range 8–12), stress is in dyne/cm² → multiplier = 0.1
/// This works for ANY instrument without knowing the instrument type.
pub fn detect_stress_multiplier_from_data(
    data_rows: &[Vec<String>],
    header_row_idx: usize,
    mapping: &ColumnMapping,
) -> Option<f64> {
    // Need all three columns to do the physics check
    let stress_col = mapping.shear_stress_col?;
    let visc_col = mapping.viscosity_col?;
    let rate_col = mapping.shear_rate_col?;

    let parse_cell = |row: &[String], col: usize| -> f64 {
        if col >= row.len() { return 0.0; }
        let s = row[col].trim().replace(',', ".").replace(char::is_whitespace, "");
        s.parse::<f64>().unwrap_or(0.0)
    };

    // Sample up to 9 data rows after header
    let start = header_row_idx + 1;
    let end = std::cmp::min(start + 9, data_rows.len());

    for row in data_rows[start..end].iter() {
        let visc = parse_cell(row, visc_col);
        let rate = parse_cell(row, rate_col);
        let stress = parse_cell(row, stress_col);

        if visc > 0.0 && rate > 0.0 && stress > 0.0 {
            let expected_stress_pa = (visc * rate) / 1000.0; // τ = η·γ̇ / 1000
            let ratio = stress / expected_stress_pa;

            if ratio > 8.0 && ratio < 12.0 {
                return Some(0.1); // dyne/cm² → Pa
            }
            // If ratio is ~1, units are already Pa — no correction needed
            if ratio > 0.5 && ratio < 2.0 {
                return Some(1.0);
            }
        }
    }

    None // Could not determine from data
}

pub fn detect_pressure_multiplier(header_row: &[String], mapping: &ColumnMapping, context: &str) -> f64 {
    if let Some(idx) = mapping.pressure_col {
        if idx < header_row.len() {
            let header = header_row[idx].to_lowercase();
            let combined = format!("{} {}", header, context.to_lowercase());

            if combined.contains("psi") {
                return 0.0689476; // PSI to Bar
            }
            if combined.contains("kpa") || combined.contains("кпа") {
                return 0.01; // kPa to Bar
            }
            if combined.contains("mpa") || combined.contains("мпа") {
                return 10.0; // MPa to Bar
            }
            if combined.contains("atm") || combined.contains("атм") {
                return 1.01325; // Atm to Bar
            }
            if combined.contains("pa") || combined.contains("па") {
                return 0.00001; // Pa to Bar
            }
        }
    }
    1.0
}

/// Data-driven PSI detection: when no pressure unit found in headers, inspect
/// the first few data values. If any value >50, it is physically impossible
/// for a bar reading on a rheometer (max realistic ~50-100 bar), so assume PSI.
/// Mirrors C# DataExtractor logic: val > 50 → pressureMultiplier = 0.0689476.
pub fn detect_pressure_multiplier_from_data(
    data_rows: &[Vec<String>],
    header_row_idx: usize,
    mapping: &ColumnMapping,
) -> Option<f64> {
    let pressure_col = mapping.pressure_col?;

    let parse_cell = |row: &[String]| -> f64 {
        if pressure_col >= row.len() { return 0.0; }
        let s = row[pressure_col].trim().replace(',', ".").replace(char::is_whitespace, "");
        s.parse::<f64>().unwrap_or(0.0)
    };

    let start = header_row_idx + 1;
    let end = std::cmp::min(start + 6, data_rows.len());

    for row in data_rows[start..end].iter() {
        let val = parse_cell(row);
        if val > 50.0 {
            return Some(0.0689476); // PSI → Bar
        }
    }

    None // Values are in a plausible bar range — no conversion needed
}

/// Data-driven time-unit detection: identifies fractional-minute time encoding.
///
/// Some rheometers (e.g. BSL R1) store time in **fractional minutes** but write
/// a bare "Время" / "Time" header with no unit suffix.  The header-scan
/// (`detect_time_unit`) therefore returns `(false, false)` for these files.
///
/// Detection criteria:
///   1. First sampled value ∈ [0.005, 1.0)   – represents a short time into the
///      test; avoids Excel serials (caught separately; those are < 0.001)
///   2. Maximum of first ~10 values < 10     – early data is still in a small
///      fractional range
///   3. Average inter-sample step * 60 ∈ [0.5, 60] seconds – consistent with a
///      realistic rheometer sampling rate when the unit is minutes
///
/// Returns `(true, false)` when the pattern matches (is_minutes, is_hours).
pub fn detect_time_unit_from_data(
    data_rows: &[Vec<String>],
    header_idx: usize,
    mapping: &ColumnMapping,
) -> (bool, bool) {
    match detect_time_mode_from_data(data_rows, header_idx, mapping) {
        Some(mode) if mode.uses_minutes() => (true, false),
        Some(TimeParsingMode::Hours) => (false, true),
        _ => (false, false),
    }
}

pub fn detect_time_mode_from_data(
    data_rows: &[Vec<String>],
    header_idx: usize,
    mapping: &ColumnMapping,
) -> Option<TimeParsingMode> {
    let samples = collect_time_samples(data_rows, header_idx, mapping, 30);
    if samples.len() < 2 {
        return None;
    }

    let has_fractional_text = samples.iter().any(|sample| {
        sample.value > 0.0
            && sample.value < 1.0
            && (sample.raw.contains(',') || sample.raw.contains('.'))
    });
    let has_large_integer = samples
        .iter()
        .any(|sample| sample.value >= 100.0 && sample.value.fract().abs() < 1e-9);

    if has_fractional_text && has_large_integer {
        let corrected: Vec<f64> = samples
            .iter()
            .map(|sample| {
                if sample.value >= 100.0 && sample.value.fract().abs() < 1e-9 {
                    sample.value / 1000.0
                } else {
                    sample.value
                }
            })
            .collect();

        let first = corrected[0];
        let max_val = corrected.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let monotonic = corrected.windows(2).all(|w| w[1] >= w[0]);
        let steps: Vec<f64> = corrected
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .filter(|&step| step > 1e-9)
            .collect();

        if monotonic && first > 0.0 && first < 1.0 && max_val < 60.0 && !steps.is_empty() {
            let avg_step = steps.iter().sum::<f64>() / steps.len() as f64;
            let step_as_sec = avg_step * 60.0;
            if (1.0..=120.0).contains(&step_as_sec) {
                return Some(TimeParsingMode::BslDroppedDecimalMinutes);
            }
        }
    }

    let times: Vec<f64> = samples.iter().map(|sample| sample.value).collect();

    let first = times[0];
    let max_val = times.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

    // Criterion 1 & 2
    if first < 0.005 || first >= 1.0 || max_val >= 10.0 {
        return None;
    }

    // Criterion 3: average step expressed as minutes should convert to a
    // realistic sampling interval in seconds.
    let steps: Vec<f64> = times.windows(2)
        .map(|w| (w[1] - w[0]).abs())
        .filter(|&s| s > 1e-9)
        .collect();

    if steps.is_empty() {
        return None;
    }

    let avg_step = steps.iter().sum::<f64>() / steps.len() as f64;
    let step_as_sec = avg_step * 60.0;
    if step_as_sec < 0.5 || step_as_sec > 60.0 {
        return None;
    }

    Some(TimeParsingMode::Minutes)
}

pub fn detect_excel_serial_time(rows: &[Vec<String>], header_idx: usize, mapping: &ColumnMapping) -> bool {
    let samples = collect_time_samples(rows, header_idx, mapping, 12);
    if samples.len() < 2 {
        return false;
    }

    let values: Vec<f64> = samples.iter().map(|sample| sample.value).collect();
    if values.iter().any(|&value| value > 40_000.0) {
        return true;
    }

    let max_val = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    if max_val >= 1.0 {
        return false;
    }

    let steps: Vec<f64> = values
        .windows(2)
        .map(|w| (w[1] - w[0]).abs())
        .filter(|&step| step > 1e-9)
        .collect();

    if steps.is_empty() {
        return false;
    }

    let avg_step = steps.iter().sum::<f64>() / steps.len() as f64;
    let step_as_sec = avg_step * 86400.0;

    if (0.1..=3600.0).contains(&step_as_sec) {
        let max_as_sec = max_val * 86400.0;
        if max_as_sec <= 86_400.0 {
            return true;
        }
    }

    false
}
