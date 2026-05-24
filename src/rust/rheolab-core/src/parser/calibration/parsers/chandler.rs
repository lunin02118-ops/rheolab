//! Chandler 5550 calibration parser.

use std::sync::LazyLock;

use super::super::{CalibrationDataPoint, CalibrationMeta, CalibrationReport};
use super::analyze_quality;
use super::math::{
    calculate_average_curve, calculate_hysteresis, calculate_linear_regression, calculate_stdev,
};
use super::meta::find_chandler_table_start;

// Static compiled regexes for calibration parsing (#8 fix).
//
// Each `.expect()` fires at most once on first LazyLock access and is
// invariant-guarded: the pattern is a compile-time string literal verified by
// the parser test-suite on every run.  A panic here would indicate a typo
// introduced during editing of the pattern string itself.
static CHANDLER_DATE_RE1: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"Last Calibration[:\s]+([^,]+)")
        .expect("CHANDLER_DATE_RE1 pattern is static and valid")
});
static CHANDLER_DATE_RE2: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"Calibration Date[:\s]+([^,]+)")
        .expect("CHANDLER_DATE_RE2 pattern is static and valid")
});
static CHANDLER_DATE_RE3: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"Date[:\s]+([^,]+)").expect("CHANDLER_DATE_RE3 pattern is static and valid")
});

pub(super) fn parse_chandler_data(rows: &[Vec<String>]) -> Result<CalibrationReport, String> {
    let table_start = find_chandler_table_start(rows)
        .ok_or("Не удалось найти таблицу данных калибровки Chandler")?;

    let mut signals = Vec::new();
    let mut stresses = Vec::new();
    let mut raw_data = Vec::new();

    let mut last_cal_date = String::new();

    for row in rows.iter().take(40) {
        let line = row.join(" ");
        if let Some(caps) = CHANDLER_DATE_RE1.captures(&line) {
            last_cal_date = caps[1].trim().to_string();
            break;
        }
        if let Some(caps) = CHANDLER_DATE_RE2.captures(&line) {
            last_cal_date = caps[1].trim().to_string();
            break;
        }
        if line.to_lowercase().contains("calibration") && line.to_lowercase().contains("date") {
            if let Some(caps) = CHANDLER_DATE_RE3.captures(&line) {
                last_cal_date = caps[1].trim().to_string();
                break;
            }
        }
    }

    let header_row_index = table_start - 2;
    let header_row: Vec<String> = rows[header_row_index]
        .iter()
        .map(|c| c.to_lowercase())
        .collect();

    let find_col = |patterns: &[&str]| -> Option<usize> {
        header_row
            .iter()
            .position(|h| patterns.iter().any(|p| h.contains(p)))
    };

    let col_rpm = find_col(&["rotor speed", "rpm"]).unwrap_or(0);
    let col_shear_rate = find_col(&["shear rate"]).unwrap_or(1);
    let col_temp = find_col(&["temperature", "temp"]).unwrap_or(2);
    let col_viscosity = find_col(&["viscosity"]).unwrap_or(3);
    let col_shear_stress = find_col(&["shear stress", "stress"]).unwrap_or(4);
    let col_signal = find_col(&["signal", "torque", "volts", "voltage"]).unwrap_or(5);

    for row in rows.iter().skip(table_start) {
        if row.is_empty() {
            continue;
        }

        let row_string = row.join(" ").to_lowercase();
        if row_string.contains("**")
            || row_string.contains("rheological")
            || row_string.contains("raw data")
            || row_string.contains("schedule")
            || row_string.contains("test data")
            || row_string.contains("начало")
            || row_string.contains("start time")
        {
            break;
        }

        if row[0].contains(':') {
            break;
        }
        if row.len() < 2 {
            continue;
        }

        let parse_num = |idx: usize| -> f64 {
            row.get(idx)
                .and_then(|s| {
                    s.replace(',', ".")
                        .replace(
                            |c: char| !c.is_ascii_digit() && c != '.' && c != '-' && c != '+',
                            "",
                        )
                        .parse::<f64>()
                        .ok()
                })
                .unwrap_or(0.0)
        };

        let rpm = parse_num(col_rpm);
        if rpm <= 0.0 || rpm > 2000.0 {
            continue;
        }

        let shear_rate = parse_num(col_shear_rate);
        let temperature = parse_num(col_temp);
        let viscosity = parse_num(col_viscosity);
        let shear_stress = parse_num(col_shear_stress);
        let signal = parse_num(col_signal);

        // Check validity (shear stress must be valid number)
        // If shear_stress is 0.0 and it wasn't explicitly 0, it might be parsing error, but we'll accept 0.

        signals.push(signal);
        stresses.push(shear_stress);

        raw_data.push(CalibrationDataPoint {
            id: (raw_data.len() + 1) as i32,
            rpm,
            shear_rate,
            shear_stress,
            signal,
            calculated_stress: 0.0,
            error: 0.0,
            viscosity,
            temperature,
        });
    }

    if raw_data.is_empty() {
        return Err("Не удалось извлечь данные калибровки Chandler".to_string());
    }

    let regression = calculate_linear_regression(&signals, &stresses);

    // Calculate error for each point FIRST (needed for hysteresis/stdev)
    for point in &mut raw_data {
        point.calculated_stress = point.signal * regression.slope + regression.intercept;
        point.error = point.shear_stress - point.calculated_stress;
    }

    let average_curve = calculate_average_curve(&raw_data);
    let hyst_val = calculate_hysteresis(&raw_data, &average_curve);
    let stdev_val = calculate_stdev(&raw_data, &average_curve);

    let meta = CalibrationMeta {
        device_type: "chandler5550".to_string(),
        bsl_meta: None,
        r_squared: (regression.r_squared * 1000000.0).round() / 1000000.0,
        slope: (regression.slope * 100000.0).round() / 100000.0,
        intercept: (regression.intercept * 100000.0).round() / 100000.0,
        hysteresis: (hyst_val * 1000.0).round() / 1000.0,
        stdev: (stdev_val * 1000.0).round() / 1000.0,
        last_cal_date,
    };

    let issues = analyze_quality(&meta);

    Ok(CalibrationReport {
        meta,
        data: raw_data,
        status: if issues.is_empty() {
            "PASS".to_string()
        } else {
            "FAIL".to_string()
        },
        issues,
    })
}
