use std::io::{Cursor, Read, Seek};
use calamine::{Reader, Xlsx, Xls, open_workbook_from_rs};
use super::types::{
    AiContextCandidate, AiContextRow, AiMappingResponse, ColumnMapping,
    ParsingResult,
};
use super::header_detector::{detect_header, detect_header_bsl_fast, find_raw_data_sections};
use super::row_mapper::{
    RowMapperConfig, TimeParsingMode,
    detect_time_unit, detect_time_mode_from_data, detect_temperature_unit,
    detect_stress_multiplier, detect_stress_multiplier_from_data,
    detect_pressure_multiplier, detect_pressure_multiplier_from_data,
    detect_excel_serial_time, is_time_too_large_for_minutes,
};
use super::instrument_detector::detect_instrument;

mod workbook;
mod csv_parser;

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

fn merge_mappings(heuristic: &ColumnMapping, ai_override: &ColumnMapping) -> ColumnMapping {
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

fn build_row_mapper_config(
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

fn parse_delimited_rows(data: &[u8]) -> Result<Vec<Vec<String>>, String> {
    let text = String::from_utf8_lossy(data);
    let lines: Vec<&str> = text.lines().collect();

    if lines.is_empty() {
        return Err("CSV file is empty".to_string());
    }

    let delimiter: char = {
        let mut detected = ',';
        for line in lines.iter().take(50) {
            if line.contains('\t') {
                detected = '\t';
                break;
            }
            if line.contains(';') && !line.contains(',') {
                detected = ';';
                break;
            }
        }
        detected
    };

    let byte_delim = delimiter as u8;
    Ok(lines
        .iter()
        .map(|line| {
            let mut rdr = csv::ReaderBuilder::new()
                .delimiter(byte_delim)
                .has_headers(false)
                .flexible(true)
                .from_reader(line.as_bytes());
            rdr.records()
                .next()
                .and_then(|r| r.ok())
                .map(|rec| rec.iter().map(|f| f.trim().to_string()).collect::<Vec<_>>())
                .unwrap_or_else(|| vec!["".to_string()])
        })
        .collect())
}

fn is_chart_sheet(sheet_name: &str) -> bool {
    let lower = sheet_name.to_lowercase();
    ["chart", "graph", "график", "formatted"]
        .iter()
        .any(|k| lower.contains(k))
}

fn candidate_sheet_bonus(sheet_name: Option<&str>) -> usize {
    let Some(sheet_name) = sheet_name else {
        return 0;
    };
    let lower = sheet_name.to_lowercase();
    if ["raw", "сырые", "unformatted", "data"]
        .iter()
        .any(|k| lower.contains(k))
    {
        200
    } else {
        0
    }
}

fn cell_looks_numeric(cell: &str) -> bool {
    let trimmed = cell.trim();
    if trimmed.is_empty() {
        return false;
    }

    let normalized = trimmed.replace(',', ".");
    if normalized.parse::<f64>().is_ok() {
        return true;
    }

    let parts: Vec<&str> = trimmed.split(':').collect();
    if parts.len() >= 2 && parts.len() <= 3 {
        return parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
    }

    false
}

fn looks_like_unit_row(row: &[String]) -> bool {
    let non_empty: Vec<&String> = row.iter().filter(|cell| !cell.trim().is_empty()).collect();
    if non_empty.len() < 2 {
        return false;
    }

    let text_like = non_empty
        .iter()
        .filter(|cell| {
            let value = cell.trim();
            value.contains('/')
                || value.contains('°')
                || value.contains('µ')
                || value.contains('₁')
                || value.contains('²')
                || value.contains('³')
                || value.contains('⁻')
                || value.contains('%')
                || value.chars().any(char::is_alphabetic)
        })
        .count();
    let numeric_like = non_empty
        .iter()
        .filter(|cell| cell_looks_numeric(cell))
        .count();

    text_like >= 2 && text_like >= numeric_like
}

fn build_ai_context_candidate(
    rows: &[Vec<String>],
    sheet_name: Option<&str>,
    instrument_hint: Option<&str>,
    section_start: usize,
    header_row_idx: usize,
    mapping: &ColumnMapping,
) -> Option<AiContextCandidate> {
    let section_rows = rows.get(section_start..)?;
    let relative_idx = header_row_idx.checked_sub(section_start)?;
    if relative_idx >= section_rows.len() {
        return None;
    }

    let header_cells = section_rows[relative_idx].clone();
    if header_cells
        .iter()
        .filter(|cell| !cell.trim().is_empty())
        .count()
        < 2
    {
        return None;
    }

    let unit_row = section_rows
        .get(relative_idx + 1)
        .filter(|row| looks_like_unit_row(row))
        .map(|row| AiContextRow {
            row_index: header_row_idx + 1,
            cells: row.clone(),
        });

    let sample_start = if unit_row.is_some() {
        relative_idx + 2
    } else {
        relative_idx + 1
    };
    let sample_rows = section_rows
        .iter()
        .enumerate()
        .skip(sample_start)
        .filter(|(_, row)| row.iter().any(|cell| !cell.trim().is_empty()))
        .take(5)
        .map(|(idx, row)| AiContextRow {
            row_index: section_start + idx,
            cells: row.clone(),
        })
        .collect::<Vec<_>>();

    Some(AiContextCandidate {
        source_sheet: sheet_name.map(ToOwned::to_owned),
        section_start_row: section_start,
        header_row_index: header_row_idx,
        header_cells,
        unit_row,
        sample_rows,
        instrument_hint: instrument_hint.map(ToOwned::to_owned),
        heuristic_mapping: mapping.clone(),
    })
}

fn collect_ai_context_candidates_from_rows(
    rows: &[Vec<String>],
    sheet_name: Option<&str>,
    instrument_hint: Option<&str>,
) -> Vec<(usize, AiContextCandidate)> {
    if rows.is_empty() {
        return Vec::new();
    }

    let section_starts = find_raw_data_sections(rows);
    let sections = if section_starts.is_empty() {
        vec![0]
    } else {
        section_starts
    };

    let is_bsl = instrument_hint == Some("BSL Model R1");
    let mut candidates = Vec::new();
    let bonus = candidate_sheet_bonus(sheet_name);

    for &section_start in &sections {
        if section_start >= rows.len() {
            continue;
        }

        let section_rows = &rows[section_start..];
        let header_opt = if is_bsl {
            detect_header_bsl_fast(section_rows).or_else(|| detect_header(section_rows, true))
        } else {
            detect_header(section_rows, true)
        };

        if let Some(header) = header_opt {
            let absolute_header_idx = section_start + header.row_index;
            let header_cells = &rows[absolute_header_idx];
            let non_empty = header_cells
                .iter()
                .filter(|cell| !cell.trim().is_empty())
                .count();
            if non_empty < 2 {
                continue;
            }

            let data_rows = section_rows.len().saturating_sub(header.row_index + 1);
            let check_col = header
                .mapping
                .time_col
                .or(header.mapping.viscosity_col)
                .or(header.mapping.rpm_col);
            let data_quality = if let Some(col) = check_col {
                section_rows
                    .iter()
                    .skip(header.row_index + 1)
                    .take(20)
                    .filter(|row| row.get(col).is_some_and(|cell| cell_looks_numeric(cell)))
                    .count()
            } else {
                0
            };
            let effective_rows = if data_quality >= 3 { data_rows } else { data_quality };
            let mut score = effective_rows * 10 + non_empty + bonus;
            if let Some(name) = sheet_name {
                if is_chart_sheet(name) {
                    score = 0;
                }
            }

            if let Some(candidate) = build_ai_context_candidate(
                rows,
                sheet_name,
                instrument_hint,
                section_start,
                absolute_header_idx,
                &header.mapping,
            ) {
                candidates.push((score, candidate));
            }
            continue;
        }

        let limit = std::cmp::min(section_rows.len(), 50);
        let mut best_text_idx: Option<usize> = None;
        let mut max_text_cols = 0usize;
        for (idx, row) in section_rows.iter().take(limit).enumerate() {
            let text_count = row
                .iter()
                .filter(|cell| !cell.trim().is_empty() && cell.chars().any(char::is_alphabetic))
                .count();
            if text_count > max_text_cols && text_count >= 3 {
                max_text_cols = text_count;
                best_text_idx = Some(idx);
            }
        }

        if let Some(relative_idx) = best_text_idx {
            let fallback_mapping = ColumnMapping::default();
            let absolute_header_idx = section_start + relative_idx;
            let non_empty = rows[absolute_header_idx]
                .iter()
                .filter(|cell| !cell.trim().is_empty())
                .count();
            let data_rows = section_rows.len().saturating_sub(relative_idx + 1);
            let score = data_rows * 10 + non_empty + bonus;
            if let Some(candidate) = build_ai_context_candidate(
                rows,
                sheet_name,
                instrument_hint,
                section_start,
                absolute_header_idx,
                &fallback_mapping,
            ) {
                candidates.push((score, candidate));
            }
        }
    }

    candidates
}

/// Extract ranked AI context candidates from a file.
pub fn extract_ai_context_candidates(data: &[u8], filename: &str) -> Vec<AiContextCandidate> {
    let cursor = Cursor::new(data);
    if let Ok(mut wb) = open_workbook_from_rs::<Xlsx<_>, _>(cursor.clone()) {
        return extract_ai_context_candidates_from_workbook(&mut wb);
    }

    let cursor = Cursor::new(data);
    if let Ok(mut wb) = open_workbook_from_rs::<Xls<_>, _>(cursor) {
        return extract_ai_context_candidates_from_workbook(&mut wb);
    }

    let lower = filename.to_lowercase();
    if lower.ends_with(".csv")
        || lower.ends_with(".txt")
        || lower.ends_with(".log")
        || lower.ends_with(".dat")
    {
        if let Ok(rows) = parse_delimited_rows(data) {
            let instrument_hint = detect_instrument(&rows, None);
            let mut candidates = collect_ai_context_candidates_from_rows(
                &rows,
                None,
                instrument_hint.as_deref(),
            );
            candidates.sort_by(|a, b| b.0.cmp(&a.0));
            candidates.truncate(3);
            return candidates.into_iter().map(|(_, candidate)| candidate).collect();
        }
    }

    Vec::new()
}

/// Backward-compatible wrapper used by older tests.
pub fn extract_candidate_headers(data: &[u8], filename: &str) -> (Vec<String>, Option<String>) {
    extract_ai_context_candidates(data, filename)
        .into_iter()
        .next()
        .map(|candidate| (candidate.header_cells, candidate.source_sheet))
        .unwrap_or((Vec::new(), None))
}

fn extract_ai_context_candidates_from_workbook<R: Read + Seek>(
    workbook: &mut impl Reader<R>,
) -> Vec<AiContextCandidate> {
    let mut candidates = Vec::new();

    for sheet_name in workbook.sheet_names().to_owned() {
        if let Some(Ok(range)) = workbook.worksheet_range(&sheet_name) {
            let rows: Vec<Vec<String>> = range
                .rows()
                .map(|row| {
                    row.iter()
                        .map(|c| match c {
                            calamine::DataType::String(v) => v.clone(),
                            calamine::DataType::Int(v) => v.to_string(),
                            calamine::DataType::Float(v) => v.to_string(),
                            calamine::DataType::Bool(v) => v.to_string(),
                            calamine::DataType::DateTime(v) => v.to_string(),
                            _ => "".to_string(),
                        })
                        .collect()
                })
                .collect();

            let instrument_hint = detect_instrument(&rows, Some(&sheet_name));
            candidates.extend(collect_ai_context_candidates_from_rows(
                &rows,
                Some(&sheet_name),
                instrument_hint.as_deref(),
            ));
        }
    }

    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.truncate(3);
    candidates.into_iter().map(|(_, candidate)| candidate).collect()
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
