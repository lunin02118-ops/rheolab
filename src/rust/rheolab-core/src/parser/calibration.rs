use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

// Static compiled regexes for calibration parsing (#8 fix)
static BSL_DATE_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(\d{2}\.\d{2}\.\d{4})").unwrap()
});
static CHANDLER_DATE_RE1: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"Last Calibration[:\s]+([^,]+)").unwrap()
});
static CHANDLER_DATE_RE2: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"Calibration Date[:\s]+([^,]+)").unwrap()
});
static CHANDLER_DATE_RE3: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"Date[:\s]+([^,]+)").unwrap()
});

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CalibrationDataPoint {
    pub id: i32,
    pub rpm: f64,
    #[serde(rename = "shearRate")]
    pub shear_rate: f64,
    #[serde(rename = "shearStress")]
    pub shear_stress: f64,
    pub signal: f64,
    #[serde(rename = "calculatedStress")]
    pub calculated_stress: f64,
    pub error: f64,
    pub viscosity: f64,
    pub temperature: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BSLMeta {
    pub filename: String,
    pub date: String,
    pub rotor: String,
    pub moment: f64,
    #[serde(rename = "calibrationFluid")]
    pub calibration_fluid: String,
    #[serde(rename = "calibrationType")]
    pub calibration_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CalibrationMeta {
    #[serde(rename = "deviceType")]
    pub device_type: String,
    #[serde(rename = "bslMeta")]
    pub bsl_meta: Option<BSLMeta>,
    #[serde(rename = "rSquared")]
    pub r_squared: f64,
    pub slope: f64,
    pub intercept: f64,
    pub hysteresis: f64,
    pub stdev: f64,
    #[serde(rename = "lastCalDate")]
    pub last_cal_date: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CalibrationReport {
    pub meta: CalibrationMeta,
    pub data: Vec<CalibrationDataPoint>,
    pub status: String,
    pub issues: Vec<String>,
}

// Universal calibration quality limits (industry standard for Couette rheometers)
// StdDev < 4 dyne/cm², Hysteresis < 8 dyne/cm², R² > 0.99
const CALIBRATION_LIMITS_STDEV: f64 = 4.0;       // dyne/cm²
const CALIBRATION_LIMITS_HYSTERESIS: f64 = 8.0;   // dyne/cm²
const CALIBRATION_LIMITS_R_SQUARED: f64 = 0.99;

const R1B1_GEOMETRY_FACTOR: f64 = 1.703;  // K-factor for R1B1 (universal)
const UNIT_CONVERSION_PA_TO_DYNE_CM2: f64 = 10.0;

// --- Math Utils ---

struct LinearRegression {
    slope: f64,
    intercept: f64,
    r_squared: f64,
}

fn calculate_linear_regression(x: &[f64], y: &[f64]) -> LinearRegression {
    let n = x.len() as f64;
    if n == 0.0 {
        return LinearRegression { slope: 0.0, intercept: 0.0, r_squared: 0.0 };
    }

    let sum_x: f64 = x.iter().sum();
    let sum_y: f64 = y.iter().sum();
    let sum_xy: f64 = x.iter().zip(y.iter()).map(|(xi, yi)| xi * yi).sum();
    let sum_xx: f64 = x.iter().map(|xi| xi * xi).sum();
    let sum_yy: f64 = y.iter().map(|yi| yi * yi).sum();

    let slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x);
    let intercept = (sum_y - slope * sum_x) / n;

    let numerator = n * sum_xy - sum_x * sum_y;
    let denominator = ((n * sum_xx - sum_x * sum_x) * (n * sum_yy - sum_y * sum_y)).sqrt();
    let r = if denominator != 0.0 { numerator / denominator } else { 0.0 };

    LinearRegression {
        slope,
        intercept,
        r_squared: r * r,
    }
}

// Calculate average curve (avg stress for each unique RPM)
// Calculate average curve grouped by RPM, returns (signal, stress) sorted by signal
fn calculate_average_curve(data: &[CalibrationDataPoint]) -> Vec<(f64, f64)> {
    let mut groups: std::collections::HashMap<String, (f64, f64, usize)> = std::collections::HashMap::new();

    for p in data {
        let key = format!("{:.0}", p.rpm); // Group by RPM
        let entry = groups.entry(key).or_insert((0.0, 0.0, 0));
        entry.0 += p.signal;       // sum of signals
        entry.1 += p.shear_stress; // sum of stresses
        entry.2 += 1;              // count
    }

    let mut result: Vec<(f64, f64)> = groups.values().map(|(sum_signal, sum_stress, count)| {
        let avg_signal = sum_signal / *count as f64;
        let avg_stress = sum_stress / *count as f64;
        (avg_signal, avg_stress) // (X, Y) = (signal, stress)
    }).collect();

    // Sort by signal (X) for correct interpolation
    result.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    result
}

fn calculate_hysteresis(data: &[CalibrationDataPoint], avg_curve: &[(f64, f64)]) -> f64 {
    // Chandler calculates hysteresis as max deviation from average curve
    // Average curve is grouped by RPM, sorted by signal (X)
    if data.is_empty() || avg_curve.is_empty() { return 0.0; }
    
    let mut max_deviation = 0.0;

    for p in data {
        let theoretical_stress = interpolate_curve(p.signal, avg_curve);
        let deviation = (p.shear_stress - theoretical_stress).abs();
        if deviation > max_deviation {
            max_deviation = deviation;
        }
    }

    max_deviation
}

fn calculate_stdev(data: &[CalibrationDataPoint], avg_curve: &[(f64, f64)]) -> f64 {
    // Chandler calculates STDEV of deviations from average curve
    // Uses N-1 (sample standard deviation)
    let n = data.len();
    if n < 2 { return 0.0; }

    let sum_sq_errors: f64 = data.iter().map(|p| {
        let theoretical_stress = interpolate_curve(p.signal, avg_curve);
        let deviation = p.shear_stress - theoretical_stress;
        deviation * deviation
    }).sum();
    
    // N-1 for sample standard deviation
    (sum_sq_errors / (n - 1) as f64).sqrt()
}

/// Linear interpolation on average curve (sorted by signal/X)
fn interpolate_curve(x: f64, curve: &[(f64, f64)]) -> f64 {
    if curve.is_empty() { return 0.0; }
    if curve.len() == 1 { return curve[0].1; }
    
    // Extrapolate if x is outside range
    if x <= curve[0].0 {
        let (x1, y1) = curve[0];
        let (x2, y2) = curve[1];
        if (x2 - x1).abs() < 1e-9 { return y1; }
        return y1 + (x - x1) * (y2 - y1) / (x2 - x1);
    }
    if x >= curve[curve.len() - 1].0 {
        let (x1, y1) = curve[curve.len() - 2];
        let (x2, y2) = curve[curve.len() - 1];
        if (x2 - x1).abs() < 1e-9 { return y2; }
        return y1 + (x - x1) * (y2 - y1) / (x2 - x1);
    }
    
    // Find interval and interpolate
    for i in 0..curve.len() - 1 {
        let (x1, y1) = curve[i];
        let (x2, y2) = curve[i + 1];
        if x >= x1 && x <= x2 {
            if (x2 - x1).abs() < 1e-9 { return y1; }
            return y1 + (x - x1) * (y2 - y1) / (x2 - x1);
        }
    }
    
    0.0
}

// --- Parsing Logic ---

fn detect_device_type(rows: &[Vec<String>]) -> Option<String> {
    let preview: String = rows.iter().take(50)
        .map(|r| r.join(" ").to_lowercase())
        .collect::<Vec<_>>()
        .join("\n");

    if preview.contains("калибровка прибора") || (preview.contains("ротор") && preview.contains("обороты") && preview.contains("угол")) {
        return Some("bslR1".to_string());
    }

    if preview.contains("имя файла") && (preview.contains("ротор/боб") || preview.contains("момент")) {
        return Some("bslR1".to_string());
    }

    if preview.contains("rotor speed") && preview.contains("shear rate") {
        return Some("chandler5550".to_string());
    }

    if preview.contains("chandler engineering") || preview.contains("5550") {
        return Some("chandler5550".to_string());
    }

    // Chandler CSV files with embedded calibration data
    if preview.contains("last calibration") || preview.contains("calibration data") {
        return Some("chandler5550".to_string());
    }

    None
}

fn find_meta_value(rows: &[Vec<String>], key: &str) -> Option<String> {
    let lower_key = key.to_lowercase();
    for row in rows {
        for i in 0..row.len().saturating_sub(1) {
            if row[i].to_lowercase().contains(&lower_key) {
                let val = row[i+1].trim();
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

fn find_meta_number(rows: &[Vec<String>], key: &str) -> Option<f64> {
    find_meta_value(rows, key)
        .and_then(|v| v.replace(',', ".").replace(" ", "").parse::<f64>().ok())
}

fn find_bsl_table_start(rows: &[Vec<String>]) -> Option<usize> {
    for (i, row) in rows.iter().enumerate() {
        let line = row.join(" ").to_lowercase();
        if line.contains("обороты") && (line.contains("угол") || line.contains("момент") || line.contains("напр")) {
            return Some(i + 1);
        }
        if line.contains("№") && row.iter().any(|c| c.to_lowercase().contains("обороты")) {
            return Some(i + 1);
        }
    }
    None
}

fn find_chandler_table_start(rows: &[Vec<String>]) -> Option<usize> {
    let mut found_calibration_marker = false;

    for (i, row) in rows.iter().enumerate() {
        let line = row.join(" ").to_lowercase();

        if line.contains("calibration data") || line.contains("-- calibration") {
            found_calibration_marker = true;
        }

        if found_calibration_marker && line.contains("rotor speed") && line.contains("shear rate") {
            return Some(i + 2);
        }
    }

    // Fallback
    for (i, row) in rows.iter().take(50).enumerate() {
        let line = row.join(" ").to_lowercase();
        if line.contains("rotor speed") && line.contains("shear rate") {
            return Some(i + 2);
        }
    }

    None
}

fn parse_bsl_data(rows: &[Vec<String>]) -> Result<CalibrationReport, String> {
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
        rotor: find_meta_value(header_rows, "Ротор/боб").or_else(|| find_meta_value(header_rows, "Ротор")).unwrap_or_default(),
        moment: find_meta_number(header_rows, "Момент").unwrap_or(0.0),
        calibration_fluid: find_meta_value(header_rows, "Кал. жидкость").unwrap_or_default(),
        calibration_type: find_meta_value(header_rows, "Тип калибровки").unwrap_or_else(|| "Стандарт".to_string()),
    };

    let table_start = find_bsl_table_start(rows).ok_or("Не удалось найти таблицу данных в файле BSL")?;

    let mut signals = Vec::new();
    let mut stresses = Vec::new();
    let mut raw_data = Vec::new();

    for row in rows.iter().skip(table_start) {
        if row.len() < 5 { continue; }
        if row[0].is_empty() { continue; }

        let parse_num = |idx: usize| -> f64 {
            row.get(idx).and_then(|s| s.replace(',', ".").replace(" ", "").parse::<f64>().ok()).unwrap_or(0.0)
        };

        let rpm = parse_num(1);
        let angle = parse_num(2);
        let viscosity = parse_num(3);
        let shear_stress_pa = parse_num(4);
        let temperature = parse_num(5); // Default 25 handled by 0.0? No, logic says || 25.
        let temperature = if temperature == 0.0 && !row[5].contains('0') { 25.0 } else { temperature };

        if rpm == 0.0 { continue; }

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
        status: if issues.is_empty() { "PASS".to_string() } else { "FAIL".to_string() },
        issues,
    })
}

fn parse_chandler_data(rows: &[Vec<String>]) -> Result<CalibrationReport, String> {
    let table_start = find_chandler_table_start(rows).ok_or("Не удалось найти таблицу данных калибровки Chandler")?;

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
    let header_row: Vec<String> = rows[header_row_index].iter().map(|c| c.to_lowercase()).collect();

    let find_col = |patterns: &[&str]| -> Option<usize> {
        header_row.iter().position(|h| patterns.iter().any(|p| h.contains(p)))
    };

    let col_rpm = find_col(&["rotor speed", "rpm"]).unwrap_or(0);
    let col_shear_rate = find_col(&["shear rate"]).unwrap_or(1);
    let col_temp = find_col(&["temperature", "temp"]).unwrap_or(2);
    let col_viscosity = find_col(&["viscosity"]).unwrap_or(3);
    let col_shear_stress = find_col(&["shear stress", "stress"]).unwrap_or(4);
    let col_signal = find_col(&["signal", "torque", "volts", "voltage"]).unwrap_or(5);

    for row in rows.iter().skip(table_start) {
        if row.is_empty() { continue; }
        
        let row_string = row.join(" ").to_lowercase();
        if row_string.contains("**") || row_string.contains("rheological") || 
           row_string.contains("raw data") || row_string.contains("schedule") ||
           row_string.contains("test data") || row_string.contains("начало") ||
           row_string.contains("start time") {
            break;
        }

        if row[0].contains(':') { break; }
        if row.len() < 2 { continue; }

        let parse_num = |idx: usize| -> f64 {
            row.get(idx).and_then(|s| s.replace(',', ".").replace(|c: char| !c.is_ascii_digit() && c != '.' && c != '-' && c != '+', "").parse::<f64>().ok()).unwrap_or(0.0)
        };

        let rpm = parse_num(col_rpm);
        if rpm <= 0.0 || rpm > 2000.0 { continue; }

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
        status: if issues.is_empty() { "PASS".to_string() } else { "FAIL".to_string() },
        issues,
    })
}

fn analyze_quality(meta: &CalibrationMeta) -> Vec<String> {
    let mut issues = Vec::new();

    if meta.stdev >= CALIBRATION_LIMITS_STDEV {
        issues.push(format!("STDEV ({:.2}) превышает предел {} dyne/cm²", meta.stdev, CALIBRATION_LIMITS_STDEV));
    }

    if meta.hysteresis >= CALIBRATION_LIMITS_HYSTERESIS {
        issues.push(format!("Гистерезис ({:.2}) превышает предел {} dyne/cm²", meta.hysteresis, CALIBRATION_LIMITS_HYSTERESIS));
    }

    if meta.r_squared < CALIBRATION_LIMITS_R_SQUARED {
        issues.push(format!("R² ({}) ниже минимального порога {}", meta.r_squared, CALIBRATION_LIMITS_R_SQUARED));
    }

    issues
}

pub fn parse_calibration_data(rows: &[Vec<String>]) -> Result<CalibrationReport, String> {
    let device_type = detect_device_type(rows).ok_or("Не удалось определить тип калибровочного файла")?;

    match device_type.as_str() {
        "bslR1" => parse_bsl_data(rows),
        "chandler5550" | "chandlerCSV" => parse_chandler_data(rows),
        _ => Err(format!("Неподдерживаемый тип устройства: {}", device_type)),
    }
}

use calamine::{Reader, Xlsx, Xls, DataType, open_workbook_from_rs};
use std::io::Cursor;

pub fn parse_calibration_from_buffer(data: &[u8]) -> Result<CalibrationReport, String> {
    // Try XLSX first
    let cursor = Cursor::new(data);
    if let Ok(mut workbook) = open_workbook_from_rs::<Xlsx<_>, _>(cursor.clone()) {
        if let Some(report) = try_parse_calibration_from_workbook(&mut workbook) {
            return Ok(report);
        }
    }
    
    // Try XLS (older format)
    let cursor = Cursor::new(data);
    if let Ok(mut workbook) = open_workbook_from_rs::<Xls<_>, _>(cursor) {
        if let Some(report) = try_parse_calibration_from_workbook(&mut workbook) {
            return Ok(report);
        }
    }

    // Try CSV/TXT (text format) - for Chandler CSV files with embedded calibration
    if let Ok(report) = try_parse_calibration_from_text(data) {
        return Ok(report);
    }

    Err("Calibration data not found".to_string())
}

/// Try to parse calibration from CSV/TXT text data
fn try_parse_calibration_from_text(data: &[u8]) -> Result<CalibrationReport, String> {
    let text = String::from_utf8_lossy(data);
    
    // Check if this looks like a Chandler CSV with calibration data
    let text_lower = text.to_lowercase();
    if !text_lower.contains("calibration") {
        return Err("No calibration data in text file".to_string());
    }
    
    // Convert text to rows (same format as Excel parsing)
    let rows: Vec<Vec<String>> = text.lines()
        .map(|line| {
            // Detect delimiter
            let delimiter = if line.contains('\t') {
                '\t'
            } else if line.contains(';') && !line.contains(',') {
                ';'
            } else {
                ','
            };
            line.split(delimiter)
                .map(|s| s.trim().to_string())
                .collect()
        })
        .collect();
    
    if rows.len() < 10 {
        return Err("Text file too short for calibration data".to_string());
    }
    
    // Try to parse as Chandler calibration
    parse_calibration_data(&rows)
}

fn try_parse_calibration_from_workbook<RS: std::io::Read + std::io::Seek, R: Reader<RS>>(workbook: &mut R) -> Option<CalibrationReport> {
    // 1. Search for specific calibration sheet
    let sheet_names = workbook.sheet_names().to_vec();
    let calibration_keywords = ["калибровка", "calibration", "калибровка прибора"];
    
    for sheet_name in &sheet_names {
        let name_lower = sheet_name.to_lowercase();
        if calibration_keywords.iter().any(|k| name_lower.contains(k)) {
            if let Some(Ok(range)) = workbook.worksheet_range(sheet_name) {
                let rows: Vec<Vec<String>> = range.rows()
                    .map(|row: &[DataType]| row.iter().map(|c| c.to_string()).collect())
                    .collect();
                
                if let Ok(report) = parse_calibration_data(&rows) {
                    return Some(report);
                }
            }
        }
    }

    // 2. Search in all sheets
    for sheet_name in &sheet_names {
        if let Some(Ok(range)) = workbook.worksheet_range(sheet_name) {
            let rows: Vec<Vec<String>> = range.rows()
                .map(|row: &[DataType]| row.iter().map(|c| c.to_string()).collect())
                .collect();
            
            if rows.len() < 5 { continue; }
            
            if let Ok(report) = parse_calibration_data(&rows) {
                return Some(report);
            }
        }
    }

    None
}
