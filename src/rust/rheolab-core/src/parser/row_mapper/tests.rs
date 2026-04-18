//! Unit tests for `row_mapper`.
//!
//! Extracted from `mod.rs` to keep the production file below the 500-LOC
//! hygiene limit.

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
