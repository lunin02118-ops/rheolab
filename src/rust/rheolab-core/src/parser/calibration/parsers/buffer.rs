//! Buffer-to-rows adapters: try XLSX → XLS → CSV/TXT before dispatching to
//! the device-specific calibration parser.

use std::io::Cursor;

use calamine::{open_workbook_from_rs, DataType, Reader, Xls, Xlsx};

use super::super::CalibrationReport;
use super::parse_calibration_data;

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

/// Try to parse calibration from CSV/TXT text data.
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

fn try_parse_calibration_from_workbook<RS, R>(workbook: &mut R) -> Option<CalibrationReport>
where
    RS: std::io::Read + std::io::Seek,
    R: Reader<RS>,
{
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
