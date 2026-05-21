//! [`ParseCandidate`] type and the logic that finalises one candidate into a
//! full [`ParseFileResponse`] (metadata + calibration + filename parsing +
//! summary).

use std::cmp::Ordering;

use crate::error::{AppError, Result};
use rheolab_core::parser::calibration::parse_calibration_from_buffer;
use rheolab_core::parser::filename_parser::parse_filename;
use rheolab_core::parser::physics_engine::enforce_physics_and_geometry;
use rheolab_core::parser::types::ParsingResult;
use rheolab_core::parser::validator::{
    build_candidate_validation_report, CandidateValidationReport,
};

use crate::commands::experiments::types::{RheologyParameterRow, RheologyParameterSource};

use super::super::helpers::{
    build_summary, map_filename_metadata, normalize_date_string, normalize_optional_date,
};
use super::super::types::*;

#[derive(Debug, Clone)]
pub(super) struct ParseCandidate {
    pub(super) source: &'static str,
    pub(super) parsed: ParsingResult,
    pub(super) report: CandidateValidationReport,
    pub(super) ai_diagnostics: Option<AiDiagnostics>,
}

pub(super) fn build_parse_candidate(
    mut parsed: ParsingResult,
    source: &'static str,
    ai_diagnostics: Option<AiDiagnostics>,
) -> ParseCandidate {
    enforce_physics_and_geometry(&mut parsed.data, parsed.metadata.geometry.as_deref());
    let report = build_candidate_validation_report(&parsed.data, parsed.metadata.geometry.clone());

    ParseCandidate {
        source,
        parsed,
        report,
        ai_diagnostics,
    }
}

pub(super) fn compare_candidates(left: &ParseCandidate, right: &ParseCandidate) -> Ordering {
    let left_severe = left.report.severe_errors.len();
    let right_severe = right.report.severe_errors.len();

    left.report
        .hard_valid
        .cmp(&right.report.hard_valid)
        .then_with(|| right_severe.cmp(&left_severe))
        .then_with(|| left.report.row_count.cmp(&right.report.row_count))
        .then_with(|| {
            left.report
                .mandatory_field_coverage
                .cmp(&right.report.mandatory_field_coverage)
        })
        .then_with(|| {
            left.report
                .time_monotonicity_score
                .cmp(&right.report.time_monotonicity_score)
        })
        .then_with(|| {
            left.report
                .physics_consistency_score
                .cmp(&right.report.physics_consistency_score)
        })
}

/// Convert a winning [`ParseCandidate`] into the IPC [`ParseFileResponse`].
///
/// Side-effects: parses calibration metadata from the same buffer, runs
/// `parse_filename` to recover metadata from the file name, and emits a data
/// summary for the frontend.
pub(super) fn finalize_candidate_response(
    candidate: ParseCandidate,
    filename: &str,
    bytes: &[u8],
    used_ai: bool,
    override_diagnostics: Option<AiDiagnostics>,
) -> Result<ParseFileResponse> {
    let points: Vec<ParsedPoint> = candidate
        .parsed
        .data
        .iter()
        .map(|point| ParsedPoint {
            time_sec: point.time_sec,
            viscosity_cp: point.viscosity_cp,
            temperature_c: point.temperature_c,
            speed_rpm: point.rpm.unwrap_or(0.0),
            shear_rate_s1: point.shear_rate.unwrap_or(0.0),
            shear_stress_pa: point.shear_stress.unwrap_or(0.0),
            pressure_bar: point.pressure_bar.unwrap_or(0.0),
            bath_temperature_c: point.bath_temperature_c,
        })
        .collect();

    if points.is_empty() {
        return Err(AppError::Parse(
            "No valid data points found in file".to_string(),
        ));
    }

    let filename_parsed = parse_filename(filename);
    let filename_metadata = map_filename_metadata(&filename_parsed);
    let fallback_date = filename_parsed
        .test_date
        .as_deref()
        .map(normalize_date_string);

    let calibration = parse_calibration_from_buffer(bytes).ok().map(|report| {
        let calibration_date = normalize_optional_date(Some(report.meta.last_cal_date.as_str()));
        let raw_data = serde_json::to_string(&report.data).unwrap_or_else(|_| "[]".to_string());

        CalibrationResponse {
            device_type: report.meta.device_type,
            r_squared: report.meta.r_squared,
            slope: report.meta.slope,
            intercept: report.meta.intercept,
            hysteresis: report.meta.hysteresis,
            stdev: report.meta.stdev,
            status: report.status,
            last_cal_date: if report.meta.last_cal_date.is_empty() {
                None
            } else {
                Some(report.meta.last_cal_date)
            },
            calibration_date,
            issues: report.issues,
            raw_data,
        }
    });

    let summary = build_summary(&points);
    let normalized_test_date = candidate
        .parsed
        .metadata
        .test_date
        .as_deref()
        .map(normalize_date_string)
        .or(fallback_date);

    let ai_diagnostics = override_diagnostics.or(candidate.ai_diagnostics.clone());
    if cfg!(debug_assertions) {
        if let Some(ref diagnostics) = ai_diagnostics {
            tracing::info!(?diagnostics, filename, "AI parse diagnostics");
        }
    }

    Ok(ParseFileResponse {
        success: true,
        source: candidate.source.to_string(),
        data: points,
        instrument_rheology: candidate
            .parsed
            .instrument_rheology
            .into_iter()
            .map(core_rheology_row_to_ipc)
            .collect(),
        metadata: ParseMetadata {
            filename: filename.to_string(),
            instrument_type: candidate.parsed.metadata.instrument_type,
            geometry: candidate.parsed.metadata.geometry,
            geometry_source: candidate.parsed.metadata.geometry_source,
            used_ai,
            test_date: normalized_test_date,
            ai_diagnostics,
            filename_metadata,
            calibration,
        },
        summary,
    })
}

fn core_rheology_row_to_ipc(
    row: rheolab_core::parser::types::RheologyParameterRow,
) -> RheologyParameterRow {
    RheologyParameterRow {
        source: RheologyParameterSource::Instrument,
        cycle_no: row.cycle_no,
        time_min: row.time_min,
        end_time_min: row.end_time_min,
        temp_c: row.temp_c,
        pressure_bar: row.pressure_bar,
        n_prime: row.n_prime,
        kv_pasn: row.kv_pasn,
        k_prime_pasn: row.k_prime_pasn,
        k_slot_pasn: row.k_slot_pasn,
        k_pipe_pasn: row.k_pipe_pasn,
        r2: row.r2,
        viscosities: row.viscosities,
        bingham_pv_pas: row.bingham_pv_pas,
        bingham_yp_pa: row.bingham_yp_pa,
        bingham_r2: row.bingham_r2,
        calc_points: row.calc_points,
        source_sheet: row.source_sheet,
        source_row: row.source_row,
        units: row.units,
    }
}
