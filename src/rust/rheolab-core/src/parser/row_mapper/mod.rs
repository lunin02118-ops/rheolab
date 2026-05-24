use super::types::ColumnMapping;
use crate::types::RheoPoint;

mod detection;
pub use detection::*;

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
                if val_str.is_empty()
                    || val_str.contains('x')
                    || (val_str.contains('-') && val_str.len() < 2)
                {
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
                let parts: Vec<f64> = time_str
                    .split(':')
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
                let t_val_raw: f64 = if t_str.is_empty() {
                    0.0
                } else {
                    t_str.parse().unwrap_or(0.0)
                };
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
        }
        TemperatureUnit::Kelvin => {
            temp -= 273.15;
        }
        TemperatureUnit::Celsius => {}
    }

    // Bath temperature — only present when a dedicated column was detected
    let bath_temperature_c = if mapping.bath_temp_col.is_some() {
        let mut bt = get_val(mapping.bath_temp_col);
        match config.temp_unit {
            TemperatureUnit::Fahrenheit => {
                bt = (bt - 32.0) * 5.0 / 9.0;
            }
            TemperatureUnit::Kelvin => {
                bt -= 273.15;
            }
            TemperatureUnit::Celsius => {}
        }
        if bt != 0.0 {
            Some(bt)
        } else {
            None
        }
    } else {
        None
    };

    Some(RheoPoint {
        time_sec: time,
        viscosity_cp: visc,
        temperature_c: temp,
        shear_rate: if shear_rate != 0.0 {
            Some(shear_rate)
        } else {
            None
        },
        shear_stress: if shear_stress != 0.0 {
            Some(shear_stress)
        } else {
            None
        },
        pressure_bar: if pressure != 0.0 {
            Some(pressure)
        } else {
            None
        },
        rpm: if rpm != 0.0 { Some(rpm) } else { None },
        bath_temperature_c,
    })
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
