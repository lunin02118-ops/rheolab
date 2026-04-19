//! Root of the rheology parser.
//!
//! # Module layout
//! - [`workbook`]       — Excel (Xlsx/Xls) parsing via Calamine
//! - [`csv_parser`]     — delimited-text (CSV/TSV/DAT) parsing
//! - [`heuristics`]     — cell/row classifiers + delimiter detection
//! - [`ai_candidates`]  — AI-context candidate extraction and ranking
//!
//! The public surface is limited to three fns: [`parse_rheo_data`],
//! [`parse_rheo_data_with_ai_hint`], [`extract_ai_context_candidates`] (+
//! its legacy single-result wrapper [`extract_candidate_headers`]).

use std::io::Cursor;

use calamine::{open_workbook_from_rs, Xls, Xlsx};

use super::row_mapper::{
    detect_excel_serial_time, detect_pressure_multiplier, detect_pressure_multiplier_from_data,
    detect_stress_multiplier, detect_stress_multiplier_from_data, detect_temperature_unit,
    detect_time_mode_from_data, detect_time_unit, is_time_too_large_for_minutes, RowMapperConfig,
    TimeParsingMode,
};
use super::types::{AiContextCandidate, AiMappingResponse, ColumnMapping, ParsingResult};

mod ai_candidates;
mod csv_parser;
mod heuristics;
mod workbook;

pub use ai_candidates::{extract_ai_context_candidates, extract_candidate_headers};

// ── Public parse entry points ───────────────────────────────────────────────

pub fn parse_rheo_data(data: &[u8], filename: &str) -> Result<ParsingResult, String> {
    let cursor = Cursor::new(data);
    if let Ok(mut wb) = open_workbook_from_rs::<Xlsx<_>, _>(cursor.clone()) {
        return workbook::parse_workbook(&mut wb, filename);
    }

    let cursor = Cursor::new(data);
    if let Ok(mut wb) = open_workbook_from_rs::<Xls<_>, _>(cursor) {
        return workbook::parse_workbook(&mut wb, filename);
    }

    csv_parser::parse_csv(data, filename)
}

fn parse_rheo_data_with_column_override(
    data: &[u8],
    filename: &str,
    override_mapping: &ColumnMapping,
    source_sheet: Option<&str>,
    source_section_start: Option<usize>,
) -> Result<ParsingResult, String> {
    let cursor = Cursor::new(data);
    if let Ok(mut wb) = open_workbook_from_rs::<Xlsx<_>, _>(cursor.clone()) {
        return workbook::parse_workbook_with_override(
            &mut wb,
            filename,
            override_mapping,
            source_sheet,
            source_section_start,
        );
    }

    let cursor = Cursor::new(data);
    if let Ok(mut wb) = open_workbook_from_rs::<Xls<_>, _>(cursor) {
        return workbook::parse_workbook_with_override(
            &mut wb,
            filename,
            override_mapping,
            source_sheet,
            source_section_start,
        );
    }

    csv_parser::parse_csv_with_override(data, filename, override_mapping, source_section_start)
}

/// Parse a rheology file with a forced AI-provided column index hint.
///
/// `ai_hint` maps canonical field names (e.g. `"viscosity_cp"`) to zero-based
/// column indices. Where a mapping is provided it overrides the heuristic
/// `detect_header` result; un-mapped columns fall back to heuristic.
pub fn parse_rheo_data_with_ai_hint(
    data: &[u8],
    filename: &str,
    selected_candidate: &AiContextCandidate,
    ai_hint: &AiMappingResponse,
) -> Result<ParsingResult, String> {
    if ai_hint.mapping.is_empty() {
        return Err("AI mapping is empty".to_string());
    }

    let ai_mapping = ColumnMapping {
        time_col: ai_hint.mapping.get("time_sec").map(|field| field.index),
        viscosity_col: ai_hint.mapping.get("viscosity_cp").map(|field| field.index),
        temperature_col: ai_hint.mapping.get("temperature_c").map(|field| field.index),
        shear_rate_col: ai_hint.mapping.get("shear_rate_s1").map(|field| field.index),
        shear_stress_col: ai_hint.mapping.get("shear_stress_pa").map(|field| field.index),
        pressure_col: ai_hint.mapping.get("pressure_bar").map(|field| field.index),
        rpm_col: ai_hint.mapping.get("speed_rpm").map(|field| field.index),
        bath_temp_col: ai_hint.mapping.get("bath_temperature_c").map(|field| field.index),
    };

    let mut result = parse_rheo_data_with_column_override(
        data,
        filename,
        &ai_mapping,
        selected_candidate.source_sheet.as_deref(),
        Some(selected_candidate.section_start_row),
    )?;
    result.metadata.used_ai = true;
    Ok(result)
}

// ── Helpers shared with workbook / csv_parser sub-modules ──────────────────

/// Merge an AI-provided mapping on top of a heuristic mapping.  Every field
/// present in the AI override takes precedence; un-mapped fields fall back to
/// the heuristic result.
pub(super) fn merge_mappings(heuristic: &ColumnMapping, ai_override: &ColumnMapping) -> ColumnMapping {
    ColumnMapping {
        time_col: ai_override.time_col.or(heuristic.time_col),
        viscosity_col: ai_override.viscosity_col.or(heuristic.viscosity_col),
        temperature_col: ai_override.temperature_col.or(heuristic.temperature_col),
        shear_rate_col: ai_override.shear_rate_col.or(heuristic.shear_rate_col),
        shear_stress_col: ai_override.shear_stress_col.or(heuristic.shear_stress_col),
        pressure_col: ai_override.pressure_col.or(heuristic.pressure_col),
        rpm_col: ai_override.rpm_col.or(heuristic.rpm_col),
        bath_temp_col: ai_override.bath_temp_col.or(heuristic.bath_temp_col),
    }
}

pub(super) fn build_row_mapper_config(
    section_rows: &[Vec<String>],
    header_row_idx: usize,
    header_row: &[String],
    mapping: &ColumnMapping,
    context_rows: &str,
) -> RowMapperConfig {
    let time_mode = if mapping.time_col.is_none() {
        TimeParsingMode::Snapshot
    } else {
        let (is_min, is_hr) = detect_time_unit(header_row, mapping, context_rows);
        if is_min {
            if is_time_too_large_for_minutes(section_rows, header_row_idx, mapping) {
                TimeParsingMode::Seconds
            } else {
                TimeParsingMode::Minutes
            }
        } else if is_hr {
            TimeParsingMode::Hours
        } else if let Some(mode) = detect_time_mode_from_data(section_rows, header_row_idx, mapping) {
            mode
        } else if detect_excel_serial_time(section_rows, header_row_idx, mapping) {
            TimeParsingMode::ExcelSerial
        } else {
            TimeParsingMode::Seconds
        }
    };

    let temp_unit = detect_temperature_unit(header_row, mapping, context_rows);
    let mut stress_mult = detect_stress_multiplier(header_row, mapping, context_rows);
    let mut press_mult = detect_pressure_multiplier(header_row, mapping, context_rows);
    if stress_mult == 1.0 {
        if let Some(multiplier) = detect_stress_multiplier_from_data(section_rows, header_row_idx, mapping) {
            stress_mult = multiplier;
        }
    }
    if press_mult == 1.0 {
        if let Some(multiplier) = detect_pressure_multiplier_from_data(section_rows, header_row_idx, mapping) {
            press_mult = multiplier;
        }
    }

    RowMapperConfig {
        time_mode,
        stress_multiplier: stress_mult,
        pressure_multiplier: press_mult,
        temp_unit,
    }
}

// Re-export for the csv_parser sub-module (sibling) — it imports via
// `super::parse_delimited_rows`.
pub(self) use heuristics::parse_delimited_rows;

pub(super) fn calculate_sheet_score(sheet_name: &str, result: &ParsingResult) -> f64 {
    let mut score = result.data.len() as f64;
    let lower_name = sheet_name.to_lowercase();

    if ["raw", "сырые", "unformatted", "data"]
        .iter()
        .any(|k| lower_name.contains(k))
    {
        score += 200.0;
    }
    if ["chart", "graph", "график", "formatted"]
        .iter()
        .any(|k| lower_name.contains(k))
    {
        score -= 500.0;
    }

    score
}

