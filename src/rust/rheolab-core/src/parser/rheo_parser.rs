use std::io::{Cursor, Read, Seek};
use calamine::{Reader, Xlsx, Xls, open_workbook_from_rs};
use super::types::{
    AiContextCandidate, AiContextRow, AiMappingResponse, ColumnMapping, ParsingMetadata,
    ParsingResult,
};
use crate::types::RheoPoint as RheoDataPoint;
use super::header_detector::{detect_header, detect_header_bsl_fast, find_raw_data_sections};
use super::row_mapper::{map_row, RowMapperConfig, TimeParsingMode, detect_time_unit, detect_time_mode_from_data, detect_temperature_unit, detect_stress_multiplier, detect_stress_multiplier_from_data, detect_pressure_multiplier, detect_pressure_multiplier_from_data, detect_excel_serial_time, is_time_too_large_for_minutes};
use super::date_detector::detect_date;
use super::instrument_detector::detect_instrument;
use super::geometry_verifier::{detect_geometry, physics_geometry};


pub fn parse_rheo_data(data: &[u8], filename: &str) -> Result<ParsingResult, String> {
    // Try XLSX
    let cursor = Cursor::new(data);
    if let Ok(mut wb) = open_workbook_from_rs::<Xlsx<_>, _>(cursor.clone()) {
        return parse_workbook(&mut wb, filename);
    }
    
    // Try XLS
    let cursor = Cursor::new(data);
    if let Ok(mut wb) = open_workbook_from_rs::<Xls<_>, _>(cursor) {
        return parse_workbook(&mut wb, filename);
    }

    // Try CSV / Text
    let lower_name = filename.to_lowercase();
    if lower_name.ends_with(".csv") || lower_name.ends_with(".txt") || lower_name.ends_with(".log") || lower_name.ends_with(".dat") {
        return parse_csv(data, filename);
    }

    Err("Failed to open workbook (unknown format)".to_string())
}

/// Same as `parse_rheo_data` but overrides `ColumnMapping` from AI hint.
/// Fields set in `override_mapping` take precedence over heuristic detection.
fn parse_rheo_data_with_column_override(
    data: &[u8],
    filename: &str,
    override_mapping: &ColumnMapping,
    source_sheet: Option<&str>,
    source_section_start: Option<usize>,
) -> Result<ParsingResult, String> {
    let cursor = Cursor::new(data);
    if let Ok(mut wb) = open_workbook_from_rs::<Xlsx<_>, _>(cursor.clone()) {
        return parse_workbook_with_override(
            &mut wb,
            filename,
            override_mapping,
            source_sheet,
            source_section_start,
        );
    }
    let cursor = Cursor::new(data);
    if let Ok(mut wb) = open_workbook_from_rs::<Xls<_>, _>(cursor) {
        return parse_workbook_with_override(
            &mut wb,
            filename,
            override_mapping,
            source_sheet,
            source_section_start,
        );
    }

    let lower_name = filename.to_lowercase();
    if lower_name.ends_with(".csv") || lower_name.ends_with(".txt") || lower_name.ends_with(".log") || lower_name.ends_with(".dat") {
        return parse_csv_with_override(data, filename, override_mapping, source_section_start);
    }

    Err("Failed to open workbook (unknown format)".to_string())
}

/// Merge heuristic ColumnMapping with AI override: AI fields take priority.
fn merge_mappings(heuristic: &ColumnMapping, ai_override: &ColumnMapping) -> ColumnMapping {
    ColumnMapping {
        time_col:         ai_override.time_col.or(heuristic.time_col),
        viscosity_col:    ai_override.viscosity_col.or(heuristic.viscosity_col),
        temperature_col:  ai_override.temperature_col.or(heuristic.temperature_col),
        shear_rate_col:   ai_override.shear_rate_col.or(heuristic.shear_rate_col),
        shear_stress_col: ai_override.shear_stress_col.or(heuristic.shear_stress_col),
        pressure_col:     ai_override.pressure_col.or(heuristic.pressure_col),
        rpm_col:          ai_override.rpm_col.or(heuristic.rpm_col),
        bath_temp_col:    ai_override.bath_temp_col.or(heuristic.bath_temp_col),
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
        return parts.iter().all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
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
    if header_cells.iter().filter(|cell| !cell.trim().is_empty()).count() < 2 {
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
            let non_empty = header_cells.iter().filter(|cell| !cell.trim().is_empty()).count();
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

fn parse_workbook_with_override<R: Read + Seek>(
    workbook: &mut impl Reader<R>,
    filename: &str,
    override_mapping: &ColumnMapping,
    source_sheet: Option<&str>,
    source_section_start: Option<usize>,
) -> Result<ParsingResult, String> {
    let sheet_names = workbook.sheet_names().to_owned();
    let mut best_candidate: Option<(f64, ParsingResult)> = None;

    let mut global_geometry: Option<String> = None;
    for sheet_name in &sheet_names {
        if let Some(Ok(range)) = workbook.worksheet_range(sheet_name) {
            let rows: Vec<Vec<String>> = range.rows().take(50).map(|row| {
                row.iter().map(|c| match c {
                    calamine::DataType::String(v) => v.clone(),
                    calamine::DataType::Int(v) => v.to_string(),
                    calamine::DataType::Float(v) => v.to_string(),
                    _ => "".to_string(),
                }).collect()
            }).collect();
            if let Some(geo) = detect_geometry(&rows) {
                global_geometry = Some(geo);
                break;
            }
        }
    }

    let empty_override = ColumnMapping::default();
    for sheet_name in sheet_names {
        if let Some(Ok(range)) = workbook.worksheet_range(&sheet_name) {
            // Only apply the AI override to the specific sheet whose headers were sent
            // to the AI. For all other sheets, fall back to pure heuristic mapping.
            // This prevents the 4-col mapping from "Основное" corrupting the 11-col
            // "Сырые данные" sheet (or Chandler Sheet1 vs Unformatted Data).
            let effective_override = if source_sheet.is_none() || source_sheet == Some(sheet_name.as_str()) {
                override_mapping
            } else {
                &empty_override
            };
            if let Some(mut result) = process_sheet_with_override(
                &range,
                filename,
                &sheet_name,
                effective_override,
                source_section_start,
            ) {
                if result.metadata.geometry.is_none() {
                    if let Some(ref geo) = global_geometry {
                        result.metadata.geometry = Some(geo.clone());
                        result.metadata.geometry_source = Some("context".to_string());
                    }
                }
                let score = calculate_sheet_score(&sheet_name, &result);
                match &best_candidate {
                    None => best_candidate = Some((score, result)),
                    Some((best_score, _)) if score > *best_score => best_candidate = Some((score, result)),
                    _ => {}
                }
            }
        }
    }

    best_candidate
        .map(|(_, r)| r)
        .ok_or_else(|| "No valid rheology data found in workbook".to_string())
}

fn process_sheet_with_override(
    range: &calamine::Range<calamine::DataType>,
    filename: &str,
    sheet_name: &str,
    override_mapping: &ColumnMapping,
    source_section_start: Option<usize>,
) -> Option<ParsingResult> {
    let rows: Vec<Vec<String>> = range.rows().map(|row| {
        row.iter().map(|c| match c {
            calamine::DataType::String(v) => v.clone(),
            calamine::DataType::Int(v) => v.to_string(),
            calamine::DataType::Float(v) => v.to_string(),
            calamine::DataType::Bool(b) => b.to_string(),
            calamine::DataType::DateTime(dt) => dt.to_string(),
            _ => "".to_string(),
        }).collect()
    }).collect();
    if rows.is_empty() { return None; }

    let section_starts = find_raw_data_sections(&rows);
    let sections_to_process = if section_starts.is_empty() { vec![0] } else { section_starts };

    let mut combined_data: Vec<RheoDataPoint> = Vec::new();
    let test_date = detect_date(&rows);
    let instrument_type = detect_instrument(&rows, Some(sheet_name));
    let mut geometry = detect_geometry(&rows);
    let mut geometry_source = if geometry.is_some() { Some("context".to_string()) } else { None };
    let empty_override = ColumnMapping::default();

    for (i, &section_start) in sections_to_process.iter().enumerate() {
        let next_section_start = if i < sections_to_process.len() - 1 {
            sections_to_process[i + 1]
        } else {
            rows.len()
        };
        if section_start >= rows.len() { continue; }
        let section_rows = &rows[section_start..next_section_start];
        if section_rows.is_empty() { continue; }

        // Detect header heuristically, then merge with AI override.
        // BSL fast-path: if instrument already identified as BSL, try the
        // lightweight 4-keyword scanner first (O(rows×4) vs O(rows×50)).
        let is_bsl = instrument_type.as_deref() == Some("BSL Model R1");
        let should_apply_override = source_section_start.is_none() || source_section_start == Some(section_start);
        let scoped_override = if should_apply_override {
            override_mapping
        } else {
            &empty_override
        };

        let (heuristic_mapping, header_row_idx) = if is_bsl {
            if let Some(hc) = detect_header_bsl_fast(section_rows) {
                (hc.mapping, hc.row_index)
            } else if let Some(hc) = detect_header(section_rows, true) {
                (hc.mapping, hc.row_index)
            } else {
                (ColumnMapping::default(), 0)
            }
        } else if let Some(hc) = detect_header(section_rows, true) {
            (hc.mapping, hc.row_index)
        } else {
            // When detect_header fails but AI override provides time_col, scan forward to find
            // the first numeric data row and set header_row_idx = first_numeric_idx - 1.
            // This ensures context_rows (header_row_idx ± few rows) includes actual header/units
            // rows (e.g. "Min", "dyne/cm^2") so that detect_time_unit and
            // detect_stress_multiplier work correctly for non-standard sheet layouts.
            let fallback_idx = if let Some(tcol) = scoped_override.time_col {
                let mut found = 0usize;
                for (i, row) in section_rows.iter().enumerate() {
                    if let Some(cell) = row.get(tcol) {
                        let s = cell.trim().replace(',', ".").replace(char::is_whitespace, "");
                        if !s.is_empty() && s.parse::<f64>().is_ok() {
                            found = i.saturating_sub(1);
                            break;
                        }
                    }
                }
                found
            } else {
                0
            };
            (ColumnMapping::default(), fallback_idx)
        };
        let mapping = merge_mappings(&heuristic_mapping, scoped_override);

        if header_row_idx >= section_rows.len() { continue; }
        let header_row = &section_rows[header_row_idx];

        let ctx_start = header_row_idx.saturating_sub(2);
        let ctx_end = std::cmp::min(header_row_idx + 5, section_rows.len());
        let context_rows = section_rows[ctx_start..ctx_end].iter().map(|r| r.join(" ")).collect::<Vec<_>>().join(" ");
        let config = build_row_mapper_config(
            section_rows,
            header_row_idx,
            header_row,
            &mapping,
            &context_rows,
        );

        let mut snapshot_counter: usize = 0;
        for row in section_rows.iter().skip(header_row_idx + 1) {
            if let Some(point) = map_row(row, &mapping, &config, &mut snapshot_counter) {
                combined_data.push(point);
            }
        }
    }

    if combined_data.is_empty() { return None; }

    combined_data.sort_by(|a, b| a.time_sec.partial_cmp(&b.time_sec).unwrap_or(std::cmp::Ordering::Equal));
    let mut unique_data = Vec::new();
    if !combined_data.is_empty() {
        unique_data.push(combined_data[0].clone());
        for p in combined_data.iter().skip(1) {
            let last = unique_data.last().expect("non-empty");
            if (p.time_sec - last.time_sec).abs() > 1e-6 {
                unique_data.push(p.clone());
            }
        }
    }
    combined_data = unique_data;

    // Physics-based geometry check:
    // • If context found nothing → fill from physics.
    // • If context found something → still run physics (strong cross-check).
    //   When physics confidently disagrees (different geometry, ≥20 points) it wins
    //   because a Fann35 pre-test line in the header may have slipped through the
    //   Fann35-exclusion filter, or the metadata block refers to a different rotor.
    if let Some(phys) = physics_geometry(&combined_data) {
        match &geometry {
            None => {
                // No context geometry at all — take physics result.
                geometry = Some(phys.geometry);
                geometry_source = Some("physics".to_string());
            }
            Some(ctx_geo) if *ctx_geo != phys.geometry => {
                // Context and physics disagree — physics wins when we have
                // enough points (already guaranteed by physics_geometry's MIN check).
                geometry = Some(phys.geometry);
                geometry_source = Some("physics".to_string());
            }
            _ => {} // context == physics — keep context source label
        }
    }

    Some(ParsingResult {
        data: combined_data,
        metadata: ParsingMetadata {
            filename: filename.to_string(),
            test_date,
            instrument_type,
            geometry,
            geometry_source,
            used_ai: false,
        },
    })
}

/// Parse CSV/TSV/DAT file, splitting by auto-detected delimiter.
///
/// Uses `str::lines()` semantics to preserve the multi-section row-index
/// behaviour that complex instrument files (e.g. Chandler 5550 .csv exports)
/// depend on.  The delimiter is sniffed once from the first line.
fn parse_csv(data: &[u8], filename: &str) -> Result<ParsingResult, String> {
    let rows = parse_delimited_rows(data)?;

    // Use the same logic as process_sheet
    parse_csv_rows(&rows, filename)
}

fn parse_csv_with_override(
    data: &[u8],
    filename: &str,
    override_mapping: &ColumnMapping,
    source_section_start: Option<usize>,
) -> Result<ParsingResult, String> {
    let rows = parse_delimited_rows(data)?;
    parse_csv_rows_with_override(&rows, filename, override_mapping, source_section_start)
}

fn parse_csv_rows_with_override(
    rows: &[Vec<String>],
    filename: &str,
    override_mapping: &ColumnMapping,
    source_section_start: Option<usize>,
) -> Result<ParsingResult, String> {
    if rows.is_empty() {
        return Err("No data in CSV".to_string());
    }

    let section_starts = find_raw_data_sections(rows);
    let sections_to_process = if section_starts.is_empty() {
        vec![0]
    } else {
        section_starts
    };

    let mut combined_data: Vec<RheoDataPoint> = Vec::new();
    let test_date = detect_date(rows);
    let instrument_type = detect_instrument(rows, None);
    let mut geometry = detect_geometry(rows);
    let mut geometry_source = if geometry.is_some() { Some("context".to_string()) } else { None };
    let is_bsl = instrument_type.as_deref() == Some("BSL Model R1");
    let empty_override = ColumnMapping::default();

    for (i, &section_start) in sections_to_process.iter().enumerate() {
        let next_section_start = if i < sections_to_process.len() - 1 {
            sections_to_process[i + 1]
        } else {
            rows.len()
        };

        if section_start >= rows.len() {
            continue;
        }

        let section_rows = &rows[section_start..next_section_start];
        if section_rows.is_empty() {
            continue;
        }

        let should_apply_override = source_section_start.is_none() || source_section_start == Some(section_start);
        let scoped_override = if should_apply_override {
            override_mapping
        } else {
            &empty_override
        };

        let (heuristic_mapping, header_row_idx) = if is_bsl {
            if let Some(hc) = detect_header_bsl_fast(section_rows) {
                (hc.mapping, hc.row_index)
            } else if let Some(hc) = detect_header(section_rows, true) {
                (hc.mapping, hc.row_index)
            } else {
                (ColumnMapping::default(), 0)
            }
        } else if let Some(hc) = detect_header(section_rows, true) {
            (hc.mapping, hc.row_index)
        } else {
            let fallback_idx = if let Some(tcol) = scoped_override.time_col {
                let mut found = 0usize;
                for (row_idx, row) in section_rows.iter().enumerate() {
                    if let Some(cell) = row.get(tcol) {
                        let normalized = cell.trim().replace(',', ".").replace(char::is_whitespace, "");
                        if !normalized.is_empty() && normalized.parse::<f64>().is_ok() {
                            found = row_idx.saturating_sub(1);
                            break;
                        }
                    }
                }
                found
            } else {
                0
            };
            (ColumnMapping::default(), fallback_idx)
        };

        let mapping = merge_mappings(&heuristic_mapping, scoped_override);
        if header_row_idx >= section_rows.len() {
            continue;
        }

        let header_row = &section_rows[header_row_idx];
        let ctx_start = header_row_idx.saturating_sub(2);
        let ctx_end = std::cmp::min(header_row_idx + 5, section_rows.len());
        let context_rows = section_rows[ctx_start..ctx_end]
            .iter()
            .map(|row| row.join(" "))
            .collect::<Vec<_>>()
            .join(" ");
        let config = build_row_mapper_config(
            section_rows,
            header_row_idx,
            header_row,
            &mapping,
            &context_rows,
        );

        let mut snapshot_counter = 0usize;
        for row in section_rows.iter().skip(header_row_idx + 1) {
            if let Some(point) = map_row(row, &mapping, &config, &mut snapshot_counter) {
                combined_data.push(point);
            }
        }
    }

    if combined_data.is_empty() {
        return Err("No valid data found in CSV".to_string());
    }

    combined_data.sort_by(|a, b| a.time_sec.partial_cmp(&b.time_sec).unwrap_or(std::cmp::Ordering::Equal));
    let mut unique_data = Vec::new();
    if !combined_data.is_empty() {
        unique_data.push(combined_data[0].clone());
        for point in combined_data.iter().skip(1) {
            let last = unique_data.last().expect("non-empty: element pushed before loop");
            if (point.time_sec - last.time_sec).abs() > 1e-6 {
                unique_data.push(point.clone());
            }
        }
    }
    combined_data = unique_data;

    if let Some(phys) = physics_geometry(&combined_data) {
        match &geometry {
            None => {
                geometry = Some(phys.geometry);
                geometry_source = Some("physics".to_string());
            }
            Some(ctx_geo) if *ctx_geo != phys.geometry => {
                geometry = Some(phys.geometry);
                geometry_source = Some("physics".to_string());
            }
            _ => {}
        }
    }

    Ok(ParsingResult {
        data: combined_data,
        metadata: ParsingMetadata {
            filename: filename.to_string(),
            test_date,
            instrument_type,
            geometry,
            geometry_source,
            used_ai: false,
        },
    })
}

fn parse_csv_rows(rows: &[Vec<String>], filename: &str) -> Result<ParsingResult, String> {
    if rows.is_empty() { 
        return Err("No data in CSV".to_string()); 
    }

    let section_starts = find_raw_data_sections(rows);
    let sections_to_process = if section_starts.is_empty() { 
        vec![0] 
    } else { 
        section_starts 
    };

    let mut combined_data: Vec<RheoDataPoint> = Vec::new();

    let test_date = detect_date(rows);
    let instrument_type = detect_instrument(rows, None);
    let mut geometry = detect_geometry(rows);
    let mut geometry_source = if geometry.is_some() { Some("context".to_string()) } else { None };

    for (i, &section_start) in sections_to_process.iter().enumerate() {
        let next_section_start = if i < sections_to_process.len() - 1 {
            sections_to_process[i + 1]
        } else {
            rows.len()
        };

        if section_start >= rows.len() { continue; }
        
        let section_rows = &rows[section_start..next_section_start];
        if section_rows.is_empty() { continue; }

        if let Some(header_cand) = detect_header(section_rows, true) {
            let mapping = &header_cand.mapping;
            let header_row_idx = header_cand.row_index;
            
            if header_row_idx >= section_rows.len() { continue; }
            let header_row = &section_rows[header_row_idx];

            let context_limit = std::cmp::min(header_row_idx + 5, section_rows.len());
            let context_rows = section_rows.iter().take(context_limit).map(|r| r.join(" ")).collect::<Vec<_>>().join(" ");
            let config = build_row_mapper_config(
                section_rows,
                header_row_idx,
                header_row,
                mapping,
                &context_rows,
            );

            let mut snapshot_counter: usize = 0;
            for row in section_rows.iter().skip(header_row_idx + 1) {
                if let Some(point) = map_row(row, mapping, &config, &mut snapshot_counter) {
                    combined_data.push(point);
                }
            }
        }
    }

    if combined_data.is_empty() { 
        return Err("No valid data found in CSV".to_string()); 
    }

    // Sort and deduplicate
    combined_data.sort_by(|a, b| a.time_sec.partial_cmp(&b.time_sec).unwrap_or(std::cmp::Ordering::Equal));
    
    let mut unique_data = Vec::new();
    if !combined_data.is_empty() {
        unique_data.push(combined_data[0].clone());
        for p in combined_data.iter().skip(1) {
            // Guarded: unique_data has at least 1 element from the push() above.
            let last = unique_data.last().expect("non-empty: element pushed before loop");
            if (p.time_sec - last.time_sec).abs() > 1e-6 {
                unique_data.push(p.clone());
            }
        }
    }
    combined_data = unique_data;

    // Physics-based geometry check (same override logic as xlsx path).
    if let Some(phys) = physics_geometry(&combined_data) {
        match &geometry {
            None => {
                geometry = Some(phys.geometry);
                geometry_source = Some("physics".to_string());
            }
            Some(ctx_geo) if *ctx_geo != phys.geometry => {
                geometry = Some(phys.geometry);
                geometry_source = Some("physics".to_string());
            }
            _ => {}
        }
    }

    Ok(ParsingResult {
        data: combined_data,
        metadata: ParsingMetadata {
            filename: filename.to_string(),
            test_date,
            instrument_type, 
            geometry,
            geometry_source,
            used_ai: false,
        }
    })
}


fn parse_workbook<R: Read + Seek>(workbook: &mut impl Reader<R>, filename: &str) -> Result<ParsingResult, String> {
    let sheet_names = workbook.sheet_names().to_owned();
    let mut best_candidate: Option<(f64, ParsingResult)> = None;

    // First pass: scan ALL sheets for geometry context (metadata sheets may have it)
    let mut global_geometry: Option<String> = None;
    for sheet_name in &sheet_names {
        if let Some(Ok(range)) = workbook.worksheet_range(sheet_name) {
            let rows: Vec<Vec<String>> = range.rows()
                .take(50)
                .map(|row| {
                    row.iter().map(|c| {
                        match c {
                            calamine::DataType::String(v) => v.clone(),
                            calamine::DataType::Int(v) => v.to_string(),
                            calamine::DataType::Float(v) => v.to_string(),
                            _ => "".to_string(),
                        }
                    }).collect::<Vec<String>>()
                })
                .collect();
            if let Some(geo) = detect_geometry(&rows) {
                global_geometry = Some(geo);
                break; // Use first geometry found
            }
        }
    }

    for sheet_name in sheet_names {
        if let Some(Ok(range)) = workbook.worksheet_range(&sheet_name) {
            if let Some(mut result) = process_sheet(&range, filename, &sheet_name) {
                // If this sheet has no geometry, use global geometry from other sheets
                if result.metadata.geometry.is_none() {
                    if let Some(ref geo) = global_geometry {
                        result.metadata.geometry = Some(geo.clone());
                        result.metadata.geometry_source = Some("context".to_string());
                    }
                }

                let score = calculate_sheet_score(&sheet_name, &result);
                
                let is_better = match &best_candidate {
                    Some((best_score, _)) => score > *best_score,
                    None => true,
                };
                
                if is_better {
                    best_candidate = Some((score, result));
                }
            }
        }
    }

    best_candidate.map(|(_, res)| res).ok_or("No valid data found in workbook".to_string())
}

fn process_sheet(range: &calamine::Range<calamine::DataType>, filename: &str, sheet_name: &str) -> Option<ParsingResult> {
    // Convert range to Vec<Vec<String>> for detectors
    let rows: Vec<Vec<String>> = range.rows()
        .map(|row| {
            row.iter().map(|c| {
                match c {
                    calamine::DataType::Int(v) => v.to_string(),
                    calamine::DataType::Float(v) => v.to_string(),
                    calamine::DataType::String(v) => v.clone(),
                    calamine::DataType::Bool(v) => v.to_string(),
                    calamine::DataType::Error(e) => format!("{:?}", e),
                    calamine::DataType::DateTime(v) => v.to_string(),
                    _ => "".to_string(),
                }
            }).collect::<Vec<String>>()
        })
        .collect();

    if rows.is_empty() { return None; }

    // Multi-section parsing logic
    let section_starts = find_raw_data_sections(&rows);
    let sections_to_process = if section_starts.is_empty() { 
        vec![0] 
    } else { 
        section_starts 
    };

    let mut combined_data: Vec<RheoDataPoint> = Vec::new();
    // Detect Date globally or per section? TS detects globally or per sheet.
    // Let's try global detection first
    let test_date = detect_date(&rows);
    let instrument_type = detect_instrument(&rows, Some(sheet_name));
    let mut geometry = detect_geometry(&rows);
    let mut geometry_source = if geometry.is_some() { Some("context".to_string()) } else { None };

    for (i, &section_start) in sections_to_process.iter().enumerate() {
        let next_section_start = if i < sections_to_process.len() - 1 {
            sections_to_process[i + 1]
        } else {
            rows.len()
        };

        if section_start >= rows.len() { continue; }
        
        // Use slice for this section
        let section_rows = &rows[section_start..next_section_start];
        if section_rows.is_empty() { continue; }

        // Detect Header — BSL fast-path then generic fallback
        let is_bsl = instrument_type.as_deref() == Some("BSL Model R1");
        let header_opt = if is_bsl {
            detect_header_bsl_fast(section_rows).or_else(|| detect_header(section_rows, true))
        } else {
            detect_header(section_rows, true)
        };
        if let Some(header_cand) = header_opt {
            let mapping = &header_cand.mapping;
            let header_row_idx = header_cand.row_index; // Relative to section start
            
            if header_row_idx >= section_rows.len() { continue; }
            let header_row = &section_rows[header_row_idx];

            // Context window: headerIdx-2 to headerIdx+5 (matching C# DataExtractor)
            let ctx_start = header_row_idx.saturating_sub(2);
            let ctx_end = std::cmp::min(header_row_idx + 5, section_rows.len());
            let context_rows = section_rows[ctx_start..ctx_end].iter().map(|r| r.join(" ")).collect::<Vec<_>>().join(" ");
            let config = build_row_mapper_config(
                section_rows,
                header_row_idx,
                header_row,
                mapping,
                &context_rows,
            );

            // Extract Data
            let mut snapshot_counter: usize = 0;
            for row in section_rows.iter().skip(header_row_idx + 1) {
                if let Some(point) = map_row(row, mapping, &config, &mut snapshot_counter) {
                    combined_data.push(point);
                }
            }
        }
    }

    if combined_data.is_empty() { return None; }

    // Deduplicate and Sort by TIME
    // Use stable sort
    combined_data.sort_by(|a, b| a.time_sec.partial_cmp(&b.time_sec).unwrap_or(std::cmp::Ordering::Equal));
    
    // Simple deduplication (TS logic: if same time (rounded), skip)
    // We'll use a simple approach: if time diff is negligible, keep first
    let mut unique_data = Vec::new();
    if !combined_data.is_empty() {
        unique_data.push(combined_data[0].clone());
        for p in combined_data.iter().skip(1) {
            // Guarded: unique_data has at least 1 element from the push() above.
            let last = unique_data.last().expect("non-empty: element pushed before loop");
            if (p.time_sec - last.time_sec).abs() > 1e-6 {
                unique_data.push(p.clone());
            }
        }
    }
    combined_data = unique_data;

    // Physics-based geometry check (same override logic as other parse paths).
    if let Some(phys) = physics_geometry(&combined_data) {
        match &geometry {
            None => {
                geometry = Some(phys.geometry);
                geometry_source = Some("physics".to_string());
            }
            Some(ctx_geo) if *ctx_geo != phys.geometry => {
                geometry = Some(phys.geometry);
                geometry_source = Some("physics".to_string());
            }
            _ => {}
        }
    }

    Some(ParsingResult {
        data: combined_data,
        metadata: ParsingMetadata {
            filename: filename.to_string(),
            test_date,
            instrument_type, 
            geometry,
            geometry_source,
            used_ai: false,
        }
    })
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
    if lower.ends_with(".csv") || lower.ends_with(".txt") || lower.ends_with(".log") || lower.ends_with(".dat") {
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

    // Build a ColumnMapping override from the AI hint map (canonical_name → col_idx).
    // Any fields not present in the hint stay as None (heuristic will fill them).
    let ai_mapping = ColumnMapping {
        time_col:        ai_hint.mapping.get("time_sec").map(|field| field.index),
        viscosity_col:   ai_hint.mapping.get("viscosity_cp").map(|field| field.index),
        temperature_col: ai_hint.mapping.get("temperature_c").map(|field| field.index),
        shear_rate_col:  ai_hint.mapping.get("shear_rate_s1").map(|field| field.index),
        shear_stress_col: ai_hint.mapping.get("shear_stress_pa").map(|field| field.index),
        pressure_col:    ai_hint.mapping.get("pressure_bar").map(|field| field.index),
        rpm_col:         ai_hint.mapping.get("speed_rpm").map(|field| field.index),
        bath_temp_col:   ai_hint.mapping.get("bath_temperature_c").map(|field| field.index),
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

fn calculate_sheet_score(sheet_name: &str, result: &ParsingResult) -> f64 {
    let mut score = result.data.len() as f64;
    let lower_name = sheet_name.to_lowercase();

    if ["raw", "сырые", "unformatted", "data"].iter().any(|k| lower_name.contains(k)) { score += 200.0; }
    if ["chart", "graph", "график", "formatted"].iter().any(|k| lower_name.contains(k)) { score -= 500.0; }

    score
}
