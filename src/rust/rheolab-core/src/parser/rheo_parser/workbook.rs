//! Workbook (XLSX/XLS) parsing for the rheolab parser.
use std::io::{Read, Seek};
use calamine::Reader;
use crate::types::RheoPoint as RheoDataPoint;
use super::super::types::{ColumnMapping, ParsingResult, ParsingMetadata};
use super::super::header_detector::{detect_header, detect_header_bsl_fast, find_raw_data_sections};
use super::super::row_mapper::map_row;
use super::super::date_detector::detect_date;
use super::super::instrument_detector::detect_instrument;
use super::super::geometry_verifier::{detect_geometry, physics_geometry};
use super::{merge_mappings, build_row_mapper_config, calculate_sheet_score};

pub(super) fn parse_workbook_with_override<R: Read + Seek>(
    workbook: &mut impl Reader<R>,
    filename: &str,
    override_mapping: &ColumnMapping,
    source_sheet: Option<&str>,
    source_section_start: Option<usize>,
) -> Result<ParsingResult, String> {
    let sheet_names = workbook.sheet_names().to_owned();
    let mut best_candidate: Option<(f64, ParsingResult)> = None;

    for sheet_name in sheet_names {
        if source_sheet.is_some() && source_sheet != Some(sheet_name.as_str()) {
            continue;
        }
        if let Some(Ok(range)) = workbook.worksheet_range(&sheet_name) {
            if let Some(result) = process_sheet_with_override(
                &range,
                filename,
                &sheet_name,
                override_mapping,
                source_section_start,
            ) {
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

    best_candidate
        .map(|(_, res)| res)
        .ok_or("No valid data found in workbook".to_string())
}

fn process_sheet_with_override(
    range: &calamine::Range<calamine::DataType>,
    filename: &str,
    sheet_name: &str,
    override_mapping: &ColumnMapping,
    source_section_start: Option<usize>,
) -> Option<ParsingResult> {
    let rows: Vec<Vec<String>> = range
        .rows()
        .map(|row| {
            row.iter()
                .map(|c| match c {
                    calamine::DataType::String(v) => v.clone(),
                    calamine::DataType::Int(v) => v.to_string(),
                    calamine::DataType::Float(v) => v.to_string(),
                    calamine::DataType::Bool(v) => v.to_string(),
                    calamine::DataType::Error(e) => format!("{:?}", e),
                    calamine::DataType::DateTime(v) => v.to_string(),
                    _ => "".to_string(),
                })
                .collect::<Vec<String>>()
        })
        .collect();

    if rows.is_empty() {
        return None;
    }

    let section_starts = find_raw_data_sections(&rows);
    let sections_to_process = if section_starts.is_empty() {
        vec![0]
    } else {
        section_starts
    };

    let mut combined_data: Vec<RheoDataPoint> = Vec::new();
    let test_date = detect_date(&rows);
    let instrument_type = detect_instrument(&rows, Some(sheet_name));
    let mut geometry = detect_geometry(&rows);
    let mut geometry_source = if geometry.is_some() {
        Some("context".to_string())
    } else {
        None
    };
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

        let should_apply_override =
            source_section_start.is_none() || source_section_start == Some(section_start);
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
        return None;
    }

    combined_data.sort_by(|a, b| {
        a.time_sec
            .partial_cmp(&b.time_sec)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
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

pub(super) fn parse_workbook<R: Read + Seek>(
    workbook: &mut impl Reader<R>,
    filename: &str,
) -> Result<ParsingResult, String> {
    let sheet_names = workbook.sheet_names().to_owned();
    let mut best_candidate: Option<(f64, ParsingResult)> = None;

    // First pass: scan ALL sheets for geometry context (metadata sheets may have it)
    let mut global_geometry: Option<String> = None;
    for sheet_name in &sheet_names {
        if let Some(Ok(range)) = workbook.worksheet_range(sheet_name) {
            let rows: Vec<Vec<String>> = range
                .rows()
                .take(50)
                .map(|row| {
                    row.iter()
                        .map(|c| match c {
                            calamine::DataType::String(v) => v.clone(),
                            calamine::DataType::Int(v) => v.to_string(),
                            calamine::DataType::Float(v) => v.to_string(),
                            _ => "".to_string(),
                        })
                        .collect::<Vec<String>>()
                })
                .collect();
            if let Some(geo) = detect_geometry(&rows) {
                global_geometry = Some(geo);
                break;
            }
        }
    }

    for sheet_name in sheet_names {
        if let Some(Ok(range)) = workbook.worksheet_range(&sheet_name) {
            if let Some(mut result) = process_sheet(&range, filename, &sheet_name) {
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

    best_candidate
        .map(|(_, res)| res)
        .ok_or("No valid data found in workbook".to_string())
}

fn process_sheet(
    range: &calamine::Range<calamine::DataType>,
    filename: &str,
    sheet_name: &str,
) -> Option<ParsingResult> {
    let rows: Vec<Vec<String>> = range
        .rows()
        .map(|row| {
            row.iter()
                .map(|c| match c {
                    calamine::DataType::Int(v) => v.to_string(),
                    calamine::DataType::Float(v) => v.to_string(),
                    calamine::DataType::String(v) => v.clone(),
                    calamine::DataType::Bool(v) => v.to_string(),
                    calamine::DataType::Error(e) => format!("{:?}", e),
                    calamine::DataType::DateTime(v) => v.to_string(),
                    _ => "".to_string(),
                })
                .collect::<Vec<String>>()
        })
        .collect();

    if rows.is_empty() {
        return None;
    }

    let section_starts = find_raw_data_sections(&rows);
    let sections_to_process = if section_starts.is_empty() {
        vec![0]
    } else {
        section_starts
    };

    let mut combined_data: Vec<RheoDataPoint> = Vec::new();
    let test_date = detect_date(&rows);
    let instrument_type = detect_instrument(&rows, Some(sheet_name));
    let mut geometry = detect_geometry(&rows);
    let mut geometry_source = if geometry.is_some() {
        Some("context".to_string())
    } else {
        None
    };

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

        let is_bsl = instrument_type.as_deref() == Some("BSL Model R1");
        let header_opt = if is_bsl {
            detect_header_bsl_fast(section_rows).or_else(|| detect_header(section_rows, true))
        } else {
            detect_header(section_rows, true)
        };
        if let Some(header_cand) = header_opt {
            let mapping = &header_cand.mapping;
            let header_row_idx = header_cand.row_index;

            if header_row_idx >= section_rows.len() {
                continue;
            }
            let header_row = &section_rows[header_row_idx];

            let ctx_start = header_row_idx.saturating_sub(2);
            let ctx_end = std::cmp::min(header_row_idx + 5, section_rows.len());
            let context_rows = section_rows[ctx_start..ctx_end]
                .iter()
                .map(|r| r.join(" "))
                .collect::<Vec<_>>()
                .join(" ");
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
        return None;
    }

    combined_data.sort_by(|a, b| {
        a.time_sec
            .partial_cmp(&b.time_sec)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut unique_data = Vec::new();
    if !combined_data.is_empty() {
        unique_data.push(combined_data[0].clone());
        for p in combined_data.iter().skip(1) {
            let last = unique_data.last().expect("non-empty: element pushed before loop");
            if (p.time_sec - last.time_sec).abs() > 1e-6 {
                unique_data.push(p.clone());
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
