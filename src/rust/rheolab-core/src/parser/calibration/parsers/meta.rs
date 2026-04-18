//! Metadata scanners and table-start locators used by both BSL and Chandler
//! calibration parsers.

pub(super) fn detect_device_type(rows: &[Vec<String>]) -> Option<String> {
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

pub(super) fn find_meta_value(rows: &[Vec<String>], key: &str) -> Option<String> {
    let lower_key = key.to_lowercase();
    for row in rows {
        for i in 0..row.len().saturating_sub(1) {
            if row[i].to_lowercase().contains(&lower_key) {
                let val = row[i + 1].trim();
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

pub(super) fn find_meta_number(rows: &[Vec<String>], key: &str) -> Option<f64> {
    find_meta_value(rows, key)
        .and_then(|v| v.replace(',', ".").replace(" ", "").parse::<f64>().ok())
}

pub(super) fn find_bsl_table_start(rows: &[Vec<String>]) -> Option<usize> {
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

pub(super) fn find_chandler_table_start(rows: &[Vec<String>]) -> Option<usize> {
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
