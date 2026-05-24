//! BSL R1 calibration parser.

use std::sync::LazyLock;

use super::super::{BSLMeta, CalibrationDataPoint, CalibrationMeta, CalibrationReport};
use super::analyze_quality;
use super::math::{
    calculate_average_curve, calculate_hysteresis, calculate_linear_regression, calculate_stdev,
};
use super::meta::{find_bsl_table_start, find_meta_number, find_meta_value};
use super::{R1B1_GEOMETRY_FACTOR, UNIT_CONVERSION_PA_TO_DYNE_CM2};

// Static compiled regex for calibration parsing (#8 fix).
//
// `.expect()` fires at most once on first LazyLock access and is
// invariant-guarded: the pattern is a compile-time string literal verified by
// the parser test-suite on every run.  A panic here would indicate a typo
// introduced during editing of the pattern string itself.
static BSL_DATE_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(\d{2}\.\d{2}\.\d{4})").expect("BSL_DATE_RE pattern is static and valid")
});

pub(super) fn parse_bsl_data(rows: &[Vec<String>]) -> Result<CalibrationReport, String> {
    let header_rows = if rows.len() > 15 { &rows[0..15] } else { rows };

    let mut date = find_meta_value(header_rows, "Дата")
        .or_else(|| find_meta_value(header_rows, "Date"))
        .unwrap_or_default();

    if date.is_empty() {
        for row in header_rows {
            let line = row.join(" ");
            if let Some(caps) = BSL_DATE_RE.captures(&line) {
                date = caps[1].to_string();
                break;
            }
        }
    }

    let bsl_meta = BSLMeta {
        filename: find_meta_value(header_rows, "Имя файла").unwrap_or_default(),
        date: date.clone(),
        rotor: find_meta_value(header_rows, "Ротор/боб")
            .or_else(|| find_meta_value(header_rows, "Ротор"))
            .unwrap_or_default(),
        moment: find_meta_number(header_rows, "Момент").unwrap_or(0.0),
        calibration_fluid: find_meta_value(header_rows, "Кал. жидкость").unwrap_or_default(),
        calibration_type: find_meta_value(header_rows, "Тип калибровки")
            .unwrap_or_else(|| "Стандарт".to_string()),
    };

    let table_start =
        find_bsl_table_start(rows).ok_or("Не удалось найти таблицу данных в файле BSL")?;

    let mut signals = Vec::new();
    let mut stresses = Vec::new();
    let mut raw_data = Vec::new();

    for row in rows.iter().skip(table_start) {
        if row.len() < 5 {
            continue;
        }
        if row[0].is_empty() {
            continue;
        }

        let parse_num = |idx: usize| -> f64 {
            row.get(idx)
                .and_then(|s| s.replace(',', ".").replace(" ", "").parse::<f64>().ok())
                .unwrap_or(0.0)
        };

        let rpm = parse_num(1);
        let angle = parse_num(2);
        let viscosity = parse_num(3);
        let shear_stress_pa = parse_num(4);
        let temperature = parse_num(5); // Default 25 handled by 0.0? No, logic says || 25.
        let temperature = if temperature == 0.0 && !row[5].contains('0') {
            25.0
        } else {
            temperature
        };

        if rpm == 0.0 {
            continue;
        }

        let shear_stress_dyne = shear_stress_pa * UNIT_CONVERSION_PA_TO_DYNE_CM2;

        signals.push(angle);
        stresses.push(shear_stress_dyne);

        raw_data.push(CalibrationDataPoint {
            id: (raw_data.len() + 1) as i32,
            rpm,
            shear_rate: rpm * R1B1_GEOMETRY_FACTOR,
            shear_stress: shear_stress_dyne,
            signal: angle,
            calculated_stress: 0.0,
            error: 0.0,
            viscosity,
            temperature,
        });
    }

    if raw_data.is_empty() {
        return Err("Не удалось извлечь данные калибровки из файла BSL".to_string());
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
        device_type: "bslR1".to_string(),
        bsl_meta: Some(bsl_meta),
        r_squared: (regression.r_squared * 100000.0).round() / 100000.0,
        slope: (regression.slope * 10000.0).round() / 10000.0,
        intercept: (regression.intercept * 10000.0).round() / 10000.0,
        hysteresis: (hyst_val * 100.0).round() / 100.0,
        stdev: (stdev_val * 1000.0).round() / 1000.0,
        last_cal_date: date,
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
