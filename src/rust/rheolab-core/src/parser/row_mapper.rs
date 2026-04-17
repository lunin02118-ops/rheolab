use crate::types::RheoPoint;
use super::types::ColumnMapping;
use regex::Regex;
use std::sync::LazyLock;

// Static compiled regexes for time-unit detection — compiled once (#8 fix)
static TIME_MIN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)time.*min|время.*мин").unwrap()
});
static TIME_HOUR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)time.*(hr|hour)|время.*час").unwrap()
});

#[derive(Debug, Clone, PartialEq)]
pub enum TemperatureUnit {
    Celsius,
    Fahrenheit,
    Kelvin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeParsingMode {
    Seconds,
    Minutes,
    Hours,
    ExcelSerial,
    Snapshot,
    BslDroppedDecimalMinutes,
}

impl TimeParsingMode {
    fn uses_minutes(self) -> bool {
        matches!(
            self,
            TimeParsingMode::Minutes | TimeParsingMode::BslDroppedDecimalMinutes
        )
    }
}

#[derive(Debug, Clone)]
pub struct RowMapperConfig {
    pub time_mode: TimeParsingMode,
    pub stress_multiplier: f64,
    pub pressure_multiplier: f64,
    pub temp_unit: TemperatureUnit,
}

impl Default for RowMapperConfig {
    fn default() -> Self {
        Self {
            time_mode: TimeParsingMode::Seconds,
            stress_multiplier: 1.0,
            pressure_multiplier: 1.0,
            temp_unit: TemperatureUnit::Celsius,
        }
    }
}

#[derive(Debug, Clone)]
struct TimeSample {
    raw: String,
    value: f64,
}

/// Repair a BSL "broken decimal" time string where the comma decimal separator
/// was replaced by a space during export (Russian locale: comma = decimal point).
///
/// Pattern: INTEGER SPACE 1-3_DIGITS  →  INTEGER.DIGITS
///   "1 017" → "1.017"
///   "9 85"  → "9.85"
///   "2 183" → "2.183"
///
/// Any string that does not match the pattern is returned unchanged.
pub fn repair_broken_decimal(s: &str) -> String {
    let s = s.trim();
    if let Some(sp) = s.find(' ') {
        let before = &s[..sp];
        let after = s[sp + 1..].trim();
        let before_ok = !before.is_empty() && before.chars().all(|c| c.is_ascii_digit());
        let after_ok = !after.is_empty()
            && after.len() <= 3
            && after.chars().all(|c| c.is_ascii_digit())
            && !after.contains(' ');
        if before_ok && after_ok {
            return format!("{}.{}", before, after);
        }
    }
    s.to_string()
}

/// Map a single data row to a `RheoPoint`.
///
/// `snapshot_counter` must be passed when `config.time_mode == Snapshot`:
/// the caller increments it after each successfully mapped row so that
/// each point receives a unique synthetic timestamp (0, 10, 20 … seconds).
pub fn map_row(
    row: &[String],
    mapping: &ColumnMapping,
    config: &RowMapperConfig,
    snapshot_counter: &mut usize,
) -> Option<RheoPoint> {
    let get_val = |col_idx: Option<usize>| -> f64 {
        if let Some(idx) = col_idx {
            if idx < row.len() {
                let val_str = row[idx].trim().replace(',', ".");
                // Remove spaces? TS does replace(/\s/g, '')
                let val_str = val_str.replace(char::is_whitespace, "");
                if val_str.is_empty() || val_str.contains('x') || (val_str.contains('-') && val_str.len() < 2) {
                    return 0.0;
                }
                return val_str.parse::<f64>().unwrap_or(0.0);
            }
        }
        0.0
    };

    let visc = get_val(mapping.viscosity_col);
    let rpm = get_val(mapping.rpm_col);

    // Validity check: Must have Viscosity OR RPM (TS: if (visc === 0 && rpm === 0) return null;)
    if visc == 0.0 && rpm == 0.0 {
        return None;
    }

    // Time parsing
    let mut time = 0.0;
    if config.time_mode == TimeParsingMode::Snapshot {
        // No time column — assign synthetic timestamp exactly like C# DataExtractor:
        //   newPoint = point with { Time = artificialTime }; artificialTime += 10;
        time = (*snapshot_counter as f64) * 10.0;
        *snapshot_counter += 1;
    } else if let Some(time_idx) = mapping.time_col {
        if time_idx < row.len() {
            let raw_time = &row[time_idx];
            let time_str = raw_time.trim();
            
            if time_str.contains(':') {
                // HH:MM:SS or MM:SS
                let parts: Vec<f64> = time_str.split(':')
                    .map(|p| p.replace(',', ".").parse::<f64>().unwrap_or(0.0))
                    .collect();
                
                if parts.len() == 3 {
                    time = parts[0] * 3600.0 + parts[1] * 60.0 + parts[2];
                } else if parts.len() == 2 {
                    time = parts[0] * 60.0 + parts[1];
                }
            } else {
                let repaired = if config.time_mode == TimeParsingMode::BslDroppedDecimalMinutes {
                    repair_broken_decimal(raw_time.trim())
                } else {
                    raw_time.trim().to_string()
                };
                let t_str = repaired.replace(',', ".").replace(char::is_whitespace, "");
                let t_val_raw: f64 = if t_str.is_empty() { 0.0 } else { t_str.parse().unwrap_or(0.0) };
                let t_val = if config.time_mode == TimeParsingMode::BslDroppedDecimalMinutes
                    && t_val_raw >= 100.0
                {
                    t_val_raw / 1000.0
                } else {
                    t_val_raw
                };
                if t_val > 0.0 {
                    time = match config.time_mode {
                        TimeParsingMode::Snapshot => unreachable!("snapshot handled above"),
                        TimeParsingMode::ExcelSerial => {
                            if t_val > 40000.0 {
                                (t_val - t_val.floor()) * 86400.0
                            } else {
                                t_val * 86400.0
                            }
                        }
                        TimeParsingMode::Minutes | TimeParsingMode::BslDroppedDecimalMinutes => {
                            t_val * 60.0
                        }
                        TimeParsingMode::Hours => t_val * 3600.0,
                        TimeParsingMode::Seconds => {
                            if t_val > 40000.0 {
                                let frac = t_val - t_val.floor();
                                if frac > 0.0 {
                                    frac * 86400.0
                                } else {
                                    t_val
                                }
                            } else {
                                t_val
                            }
                        }
                    }
                }
            } // end else (non-colon time)
        }
    } // end time parsing

    // Other values
    let shear_rate = get_val(mapping.shear_rate_col);
    let mut shear_stress = get_val(mapping.shear_stress_col);
    let mut pressure = get_val(mapping.pressure_col);
    let mut temp = get_val(mapping.temperature_col);

    // Apply multipliers/conversions
    shear_stress *= config.stress_multiplier;
    pressure *= config.pressure_multiplier;

    // Temperature conversion
    match config.temp_unit {
        TemperatureUnit::Fahrenheit => {
            temp = (temp - 32.0) * 5.0 / 9.0;
        },
        TemperatureUnit::Kelvin => {
            temp -= 273.15;
        },
        TemperatureUnit::Celsius => {},
    }

    // Bath temperature — only present when a dedicated column was detected
    let bath_temperature_c = if mapping.bath_temp_col.is_some() {
        let mut bt = get_val(mapping.bath_temp_col);
        match config.temp_unit {
            TemperatureUnit::Fahrenheit => { bt = (bt - 32.0) * 5.0 / 9.0; },
            TemperatureUnit::Kelvin => { bt -= 273.15; },
            TemperatureUnit::Celsius => {},
        }
        if bt != 0.0 { Some(bt) } else { None }
    } else {
        None
    };

    Some(RheoPoint {
        time_sec: time,
        viscosity_cp: visc,
        temperature_c: temp,
        shear_rate: if shear_rate != 0.0 { Some(shear_rate) } else { None },
        shear_stress: if shear_stress != 0.0 { Some(shear_stress) } else { None },
        pressure_bar: if pressure != 0.0 { Some(pressure) } else { None },
        rpm: if rpm != 0.0 { Some(rpm) } else { None },
        bath_temperature_c,
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_row_basic() {
        let row = vec![
            "10.5".to_string(), // Time
            "100".to_string(),  // Viscosity
            "25".to_string(),   // Temp
        ];
        let mapping = ColumnMapping {
            time_col: Some(0),
            viscosity_col: Some(1),
            temperature_col: Some(2),
            ..Default::default()
        };
        let config = RowMapperConfig::default();

        let point = map_row(&row, &mapping, &config, &mut 0).unwrap();
        assert_eq!(point.time_sec, 10.5);
        assert_eq!(point.viscosity_cp, 100.0);
        assert_eq!(point.temperature_c, 25.0);
    }

    #[test]
    fn test_map_row_time_format() {
        let row = vec![
            "01:30:00".to_string(), // 1h 30m = 5400s
            "100".to_string(),
            "25".to_string(),
        ];
        let mapping = ColumnMapping {
            time_col: Some(0),
            viscosity_col: Some(1),
            temperature_col: Some(2),
            ..Default::default()
        };
        let config = RowMapperConfig::default();

        let point = map_row(&row, &mapping, &config, &mut 0).unwrap();
        assert_eq!(point.time_sec, 5400.0);
    }

    #[test]
    fn test_map_row_conversions() {
        let row = vec![
            "10".to_string(),
            "100".to_string(),
            "77".to_string(), // 77 F = 25 C
            "50".to_string(), // 50 dyne/cm2 = 5 Pa
        ];
        let mapping = ColumnMapping {
            time_col: Some(0),
            viscosity_col: Some(1),
            temperature_col: Some(2),
            shear_stress_col: Some(3),
            ..Default::default()
        };
        let config = RowMapperConfig {
            temp_unit: TemperatureUnit::Fahrenheit,
            stress_multiplier: 0.1,
            ..Default::default()
        };

        let point = map_row(&row, &mapping, &config, &mut 0).unwrap();
        assert_eq!(point.temperature_c, 25.0);
        assert_eq!(point.shear_stress.unwrap(), 5.0);
    }

    #[test]
    fn test_map_row_bsl_dropped_decimal_mode() {
        let row = vec![
            "1017".to_string(),
            "100".to_string(),
            "25".to_string(),
        ];
        let mapping = ColumnMapping {
            time_col: Some(0),
            viscosity_col: Some(1),
            temperature_col: Some(2),
            ..Default::default()
        };
        let config = RowMapperConfig {
            time_mode: TimeParsingMode::BslDroppedDecimalMinutes,
            ..Default::default()
        };

        let point = map_row(&row, &mapping, &config, &mut 0).unwrap();
        assert!((point.time_sec - 61.02).abs() < 1e-9);
    }
    
    #[test]
    fn test_detect_units() {
        let header = vec!["Time (min)".to_string(), "Temp (F)".to_string(), "Stress (dyne/cm2)".to_string()];
        let mapping = ColumnMapping {
            time_col: Some(0),
            temperature_col: Some(1),
            shear_stress_col: Some(2),
            ..Default::default()
        };
        
        let (is_min, is_hr) = detect_time_unit(&header, &mapping, "");
        assert!(is_min);
        assert!(!is_hr);
        
        let temp_unit = detect_temperature_unit(&header, &mapping, "");
        assert_eq!(temp_unit, TemperatureUnit::Fahrenheit);
        
        let stress_mult = detect_stress_multiplier(&header, &mapping, "");
        assert_eq!(stress_mult, 0.1);
    }

    #[test]
    fn test_detect_time_unit_no_false_positive_from_rpm() {
        // BSL file: header "Время" with no unit, but "об/мин" in speed column
        let header = vec![
            "Время".to_string(), "Температура нагр".to_string(),
            "Температура образца".to_string(), "Давление".to_string(),
            "Угол".to_string(), "Напряж сдвига".to_string(),
            "Вязкость".to_string(), "Скорость".to_string(), "Ku".to_string(),
        ];
        let mapping = ColumnMapping {
            time_col: Some(0),
            viscosity_col: Some(6),
            temperature_col: Some(2),
            shear_stress_col: Some(5),
            ..Default::default()
        };
        // Context includes unit row with "об/мин" for speed column
        let context = "Время Температура нагр Температура образца Давление Угол Напряж сдвига Вязкость Скорость Ku  град С град С PSI Град мН/м2 сП об/мин";

        let (is_min, is_hr) = detect_time_unit(&header, &mapping, context);
        assert!(!is_min, "Should NOT detect minutes from 'об/мин' in speed column");
        assert!(!is_hr);
    }

    #[test]
    fn test_is_time_too_large_for_minutes_by_max_value() {
        let mapping = ColumnMapping { time_col: Some(0), ..Default::default() };
        // Simulate data with max time = 5000 (> 2880 threshold)
        let mut rows: Vec<Vec<String>> = vec![
            vec!["Время".to_string()], // header at idx 0
        ];
        for i in 0..10 {
            rows.push(vec![format!("{}", 500 * i)]);
        }
        // Last value = 4500 > 2880
        assert!(is_time_too_large_for_minutes(&rows, 0, &mapping));
    }

    #[test]
    fn test_is_time_too_large_for_minutes_by_sampling_rate() {
        let mapping = ColumnMapping { time_col: Some(0), ..Default::default() };
        // Simulate 1-second sampling with 500+ rows
        let mut rows: Vec<Vec<String>> = vec![
            vec!["Время".to_string()], // header at idx 0
        ];
        for i in 0..500 {
            rows.push(vec![format!("{}", i)]);
        }
        // Max time = 499 (< 2880), but step = 1 with 500 points → seconds
        assert!(is_time_too_large_for_minutes(&rows, 0, &mapping));
    }

    #[test]
    fn test_is_time_too_large_for_minutes_real_minutes_ok() {
        let mapping = ColumnMapping { time_col: Some(0), ..Default::default() };
        // Real minutes data: Chandler with 30-second intervals in minutes
        let mut rows: Vec<Vec<String>> = vec![
            vec!["Time".to_string()], // header at idx 0
        ];
        for i in 0..100 {
            rows.push(vec![format!("{:.1}", i as f64 * 0.5)]); // 0, 0.5, 1.0, 1.5, ...
        }
        // Max time = 49.5, step = 0.5, count = 100 → genuinely minutes
        assert!(!is_time_too_large_for_minutes(&rows, 0, &mapping));
    }

    #[test]
    fn test_detect_pressure_multiplier_from_data_psi() {
        // Brookfield-style: unlabeled PSI column — values ~300-1200
        let mapping = ColumnMapping { pressure_col: Some(0), ..Default::default() };
        let rows: Vec<Vec<String>> = vec![
            vec!["Pressure".to_string()],    // header at idx 0
            vec!["0".to_string()],           // first data row (zero, skip)
            vec!["340.5".to_string()],       // clearly PSI
            vec!["820.0".to_string()],
        ];
        let result = detect_pressure_multiplier_from_data(&rows, 0, &mapping);
        assert_eq!(result, Some(0.0689476));
    }

    #[test]
    fn test_detect_pressure_multiplier_from_data_bar_ok() {
        // Normal bar pressure (≤50 bar) → no conversion needed
        let mapping = ColumnMapping { pressure_col: Some(0), ..Default::default() };
        let rows: Vec<Vec<String>> = vec![
            vec!["Pressure".to_string()],
            vec!["5.2".to_string()],
            vec!["14.8".to_string()],
            vec!["48.0".to_string()],
        ];
        let result = detect_pressure_multiplier_from_data(&rows, 0, &mapping);
        assert_eq!(result, None); // No conversion — values already in bar
    }

    #[test]
    fn test_detect_pressure_multiplier_from_data_no_pressure_col() {
        // No pressure column mapped → returns None
        let mapping = ColumnMapping { pressure_col: None, ..Default::default() };
        let rows: Vec<Vec<String>> = vec![
            vec!["Time".to_string()],
            vec!["100.0".to_string()],
        ];
        let result = detect_pressure_multiplier_from_data(&rows, 0, &mapping);
        assert_eq!(result, None);
    }

    /// BSL 562@60C: bare "Время" header, time values are fractional minutes.
    /// detect_time_unit returns (false, false); the data-driven fallback must
    /// classify them as minutes.
    #[test]
    fn test_detect_time_unit_from_data_bsl_fractional_minutes() {
        let mapping = ColumnMapping { time_col: Some(0), viscosity_col: Some(1), ..Default::default() };
        let mut rows: Vec<Vec<String>> = vec![
            vec!["Время".to_string(), "Вязкость".to_string()], // header row 0
        ];
        // Simulated BSL time values in fractional minutes (5-second intervals)
        let times = ["0.017", "0.1", "0.183", "0.267", "0.35", "0.433", "0.517", "0.6"];
        for t in times {
            rows.push(vec![t.to_string(), "100".to_string()]);
        }
        let (is_min, is_hr) = detect_time_unit_from_data(&rows, 0, &mapping);
        assert!(is_min, "Should detect fractional minutes for BSL-style time values");
        assert!(!is_hr);
    }

    /// Must NOT trigger for files where time is in whole seconds (e.g. Brookfield, Chandler).
    #[test]
    fn test_detect_time_unit_from_data_no_false_positive_seconds() {
        let mapping = ColumnMapping { time_col: Some(0), viscosity_col: Some(1), ..Default::default() };
        let mut rows: Vec<Vec<String>> = vec![
            vec!["Time".to_string(), "Viscosity".to_string()],
        ];
        // 5-second intervals in seconds
        for i in 1_u32..=8 {
            rows.push(vec![format!("{}", i * 5), "100".to_string()]);
        }
        let (is_min, is_hr) = detect_time_unit_from_data(&rows, 0, &mapping);
        assert!(!is_min, "Should NOT trigger for seconds-scale time (first value = 5)");
        assert!(!is_hr);
    }

    #[test]
    fn test_detect_time_mode_from_data_bsl_mixed_dropped_decimal_minutes() {
        let mapping = ColumnMapping {
            time_col: Some(0),
            viscosity_col: Some(1),
            ..Default::default()
        };
        let rows: Vec<Vec<String>> = vec![
            vec!["Время".to_string(), "Вязкость".to_string()],
            vec!["0,017".to_string(), "100".to_string()],
            vec!["0,517".to_string(), "100".to_string()],
            vec!["1017".to_string(), "100".to_string()],
            vec!["1517".to_string(), "100".to_string()],
            vec!["2017".to_string(), "100".to_string()],
            vec!["2517".to_string(), "100".to_string()],
        ];

        let mode = detect_time_mode_from_data(&rows, 0, &mapping);
        assert_eq!(mode, Some(TimeParsingMode::BslDroppedDecimalMinutes));
    }

    #[test]
    fn test_detect_excel_serial_time_for_time_only_fraction() {
        let mapping = ColumnMapping {
            time_col: Some(0),
            ..Default::default()
        };
        let rows: Vec<Vec<String>> = vec![
            vec!["Time".to_string()],
            vec!["0.000011574074".to_string()],
            vec!["0.000023148148".to_string()],
            vec!["0.000034722222".to_string()],
        ];

        assert!(detect_excel_serial_time(&rows, 0, &mapping));
    }
}
