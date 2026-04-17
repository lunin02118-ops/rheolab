use std::cmp::Ordering;
use std::fs;
use std::sync::Arc;

use crate::error::{AppError, Result};
use rheolab_core::parser::calibration::parse_calibration_from_buffer;
use rheolab_core::parser::filename_parser::parse_filename;
use rheolab_core::parser::physics_engine::enforce_physics_and_geometry;
use rheolab_core::parser::rheo_parser::{
    extract_ai_context_candidates, parse_rheo_data, parse_rheo_data_with_ai_hint,
};
use rheolab_core::parser::types::{AiContextCandidate, AiMappingResponse, ParsingResult};
use rheolab_core::parser::validator::{build_candidate_validation_report, CandidateValidationReport};

use super::ai_mapper::{validate_ai_mapping_response, AiColumnMapper, GroqAiColumnMapper};
use super::helpers::{
    build_summary, map_filename_metadata, normalize_date_string, normalize_optional_date,
};
use super::types::*;
use super::{parse_cache_key, validate_file_path, PARSE_CACHE};

#[derive(Debug, Clone)]
struct ParseCandidate {
    source: &'static str,
    parsed: ParsingResult,
    report: CandidateValidationReport,
    ai_diagnostics: Option<AiDiagnostics>,
}

/// Real implementation — called by the `#[tauri::command]` wrapper in `mod.rs`.
///
/// `ai_key` is pre-resolved server-side by the command wrapper — never sent over IPC.
pub(crate) async fn parsing_parse_file_inner(
    request: ParseRequest,
    ai_key: Option<String>,
) -> Result<ParseFileResponse> {
    if request.force_ai.unwrap_or(false) && ai_key.is_none() {
        return Err(AppError::Parse(
            "force_ai=true but no active Groq API key configured".to_string(),
        ));
    }

    let mapper = ai_key.map(GroqAiColumnMapper::new);
    parsing_parse_file_inner_impl(
        request,
        mapper.as_ref().map(|value| value as &dyn AiColumnMapper),
    )
    .await
}

#[doc(hidden)]
pub(crate) async fn parsing_parse_file_inner_with_mapper(
    request: ParseRequest,
    ai_key: Option<String>,
    mapper: &dyn AiColumnMapper,
) -> Result<ParseFileResponse> {
    if request.force_ai.unwrap_or(false) && ai_key.is_none() {
        return Err(AppError::Parse(
            "force_ai=true but no active Groq API key configured".to_string(),
        ));
    }

    let ai_mapper = if ai_key.is_some() { Some(mapper) } else { None };
    parsing_parse_file_inner_impl(request, ai_mapper).await
}

async fn parsing_parse_file_inner_impl(
    request: ParseRequest,
    ai_mapper: Option<&dyn AiColumnMapper>,
) -> Result<ParseFileResponse> {
    let force_ai = request.force_ai.unwrap_or(false);
    if force_ai && ai_mapper.is_none() {
        return Err(AppError::Parse(
            "force_ai=true but no active Groq API key configured".to_string(),
        ));
    }

    if can_use_parse_cache(force_ai, request.bytes.is_some()) {
        let key_opt = request
            .file_path
            .as_deref()
            .and_then(|path| parse_cache_key(&request.filename, path));
        if let Some(key) = key_opt {
            {
                let mut cache = PARSE_CACHE
                    .lock()
                    .map_err(|error| AppError::Other(format!("Cache lock poisoned: {}", error)))?;
                if let Some(cached) = cache.get(&key) {
                    return Ok((**cached).clone());
                }
            }

            let result = parse_request_uncached(request, ai_mapper).await?;
            if should_store_parse_cache(force_ai, false, result.metadata.used_ai) {
                if let Ok(mut cache) = PARSE_CACHE.lock() {
                    cache.put(key, Arc::new(result.clone()));
                }
            }
            return Ok(result);
        }
    }

    parse_request_uncached(request, ai_mapper).await
}

async fn parse_request_uncached(
    request: ParseRequest,
    ai_mapper: Option<&dyn AiColumnMapper>,
) -> Result<ParseFileResponse> {
    let force_ai = request.force_ai.unwrap_or(false);
    if !force_ai && ai_mapper.is_none() {
        return tokio::task::spawn_blocking(move || parse_file_native(request))
            .await
            .map_err(|error| AppError::Other(format!("Parse task join error: {}", error)))?;
    }

    let filename = request.filename.trim().to_string();
    if filename.is_empty() {
        return Err(AppError::BadRequest("Filename is required".to_string()));
    }

    // Inline bytes (e.g. a browser/API upload) are treated as untrusted: we
    // always attempt optional-AI validation even when the heuristic is healthy.
    // File-path reads come from the local file system and are trusted enough to
    // short-circuit AI when the heuristic is clean.
    let has_inline_bytes = request.bytes.is_some();
    let bytes = read_request_bytes(&request)?;
    parse_with_optional_ai(
        bytes,
        filename,
        request.ai_model.clone(),
        force_ai,
        ai_mapper,
        has_inline_bytes,
    )
    .await
}

async fn parse_with_optional_ai(
    bytes: Vec<u8>,
    filename: String,
    ai_model: Option<String>,
    force_ai: bool,
    ai_mapper: Option<&dyn AiColumnMapper>,
    has_inline_bytes: bool,
) -> Result<ParseFileResponse> {
    if force_ai {
        let ai_mapper = ai_mapper.ok_or_else(|| {
            AppError::Parse("force_ai=true but no active Groq API key configured".to_string())
        })?;
        return parse_force_ai_only(bytes, filename, ai_model, ai_mapper).await;
    }

    let heuristic_candidate = parse_heuristic_candidate(bytes.clone(), filename.clone()).await;

    if let Ok(candidate) = &heuristic_candidate {
        // Skip optional AI when the heuristic is confident AND the input came
        // from a trusted file-path read.  Inline bytes (browser / API uploads)
        // always go through the AI validation path so that unusual encodings or
        // ambiguous column layouts are caught even when the heuristic succeeds.
        if candidate.report.hard_valid && !candidate.report.suspicious && !has_inline_bytes {
            return finalize_candidate_response(
                candidate.clone(),
                &filename,
                &bytes,
                false,
                None,
            );
        }
    }

    let Some(ai_mapper) = ai_mapper else {
        return match heuristic_candidate {
            Ok(candidate) => finalize_candidate_response(candidate, &filename, &bytes, false, None),
            Err(error) => Err(AppError::Parse(error)),
        };
    };

    let ai_context_candidates = extract_ai_context_candidates(&bytes, &filename);
    if ai_context_candidates.is_empty() {
        return match heuristic_candidate {
            Ok(candidate) => finalize_candidate_response(candidate, &filename, &bytes, false, None),
            Err(error) => Err(AppError::Parse(error)),
        };
    }

    let model_name = ai_mapper.resolve_model_name(ai_model.as_deref());
    let base_diagnostics = base_ai_diagnostics(
        ai_mapper,
        model_name,
        ai_context_candidates.len(),
    );

    let ai_mapping = match ai_mapper
        .map_columns(&ai_context_candidates, ai_model.as_deref())
        .await
    {
        Ok(mapping) => mapping,
        Err(error) => {
            let diagnostics = diagnostics_failed(base_diagnostics, ai_failure_reason(error));
            return fallback_to_heuristic_or_error(
                &heuristic_candidate,
                &filename,
                &bytes,
                diagnostics,
            );
        }
    };
    if let Err(error) = validate_ai_mapping_response(&ai_mapping, &ai_context_candidates) {
        let diagnostics = diagnostics_failed(base_diagnostics, ai_failure_reason(error));
        return fallback_to_heuristic_or_error(
            &heuristic_candidate,
            &filename,
            &bytes,
            diagnostics,
        );
    }

    let selected_candidate = match ai_context_candidates
        .get(ai_mapping.selected_candidate)
        .cloned()
    {
        Some(candidate) => candidate,
        None => {
            let diagnostics = diagnostics_failed(
                base_diagnostics,
                format!(
                    "AI selected_candidate {} is out of range for {} candidates",
                    ai_mapping.selected_candidate,
                    ai_context_candidates.len()
                ),
            );
            return fallback_to_heuristic_or_error(
                &heuristic_candidate,
                &filename,
                &bytes,
                diagnostics,
            );
        }
    };

    let ai_candidate = match parse_ai_candidate(
        bytes.clone(),
        filename.clone(),
        selected_candidate,
        ai_mapping.clone(),
        diagnostics_accepted(base_diagnostics.clone(), &ai_mapping),
    )
    .await
    {
        Ok(candidate) => candidate,
        Err(error) => {
            let diagnostics = diagnostics_failed(base_diagnostics, error);
            return fallback_to_heuristic_or_error(
                &heuristic_candidate,
                &filename,
                &bytes,
                diagnostics,
            );
        }
    };

    match heuristic_candidate {
        Ok(heuristic) => {
            if compare_candidates(&ai_candidate, &heuristic) == Ordering::Greater {
                finalize_candidate_response(ai_candidate, &filename, &bytes, true, None)
            } else {
                let diagnostics = diagnostics_rejected(
                    base_diagnostics,
                    "AI candidate ranked below heuristic candidate".to_string(),
                    &ai_mapping,
                );
                finalize_candidate_response(heuristic, &filename, &bytes, false, Some(diagnostics))
            }
        }
        Err(_) => {
            if ai_candidate.report.hard_valid {
                finalize_candidate_response(ai_candidate, &filename, &bytes, true, None)
            } else {
                Err(AppError::Parse(format!(
                    "AI candidate failed validation: {}",
                    ai_candidate.report.severe_errors.join("; ")
                )))
            }
        }
    }
}

async fn parse_force_ai_only(
    bytes: Vec<u8>,
    filename: String,
    ai_model: Option<String>,
    ai_mapper: &dyn AiColumnMapper,
) -> Result<ParseFileResponse> {
    let ai_context_candidates = extract_ai_context_candidates(&bytes, &filename);
    if ai_context_candidates.is_empty() {
        return Err(AppError::Parse(
            "AI parsing failed: no valid context candidates found".to_string(),
        ));
    }

    let model_name = ai_mapper.resolve_model_name(ai_model.as_deref());
    let base_diagnostics = base_ai_diagnostics(
        ai_mapper,
        model_name,
        ai_context_candidates.len(),
    );
    let ai_mapping = ai_mapper
        .map_columns(&ai_context_candidates, ai_model.as_deref())
        .await
        .map_err(|error| AppError::Parse(format!("AI parsing failed: {}", error)))?;

    validate_ai_mapping_response(&ai_mapping, &ai_context_candidates)
        .map_err(|error| AppError::Parse(format!("AI parsing failed: {}", error)))?;

    let selected_candidate = ai_context_candidates
        .get(ai_mapping.selected_candidate)
        .cloned()
        .ok_or_else(|| {
            AppError::Parse(format!(
                "AI selected_candidate {} is out of range for {} candidates",
                ai_mapping.selected_candidate,
                ai_context_candidates.len()
            ))
        })?;

    let ai_candidate = parse_ai_candidate(
        bytes.clone(),
        filename.clone(),
        selected_candidate,
        ai_mapping.clone(),
        diagnostics_accepted(base_diagnostics, &ai_mapping),
    )
    .await
    .map_err(|error| AppError::Parse(format!("AI parsing failed: {}", error)))?;

    if !ai_candidate.report.hard_valid {
        return Err(AppError::Parse(format!(
            "AI candidate failed validation: {}",
            ai_candidate.report.severe_errors.join("; ")
        )));
    }

    finalize_candidate_response(ai_candidate, &filename, &bytes, true, None)
}

fn fallback_to_heuristic_or_error(
    heuristic_candidate: &std::result::Result<ParseCandidate, String>,
    filename: &str,
    bytes: &[u8],
    diagnostics: AiDiagnostics,
) -> Result<ParseFileResponse> {
    let reason = diagnostics
        .failure_reason
        .clone()
        .unwrap_or_else(|| "AI parsing failed".to_string());

    match heuristic_candidate {
        Ok(candidate) => finalize_candidate_response(
            candidate.clone(),
            filename,
            bytes,
            false,
            Some(diagnostics),
        ),
        Err(heuristic_error) => Err(AppError::Parse(format!(
            "Heuristic parse failed: {}; {}",
            heuristic_error, reason
        ))),
    }
}

/// Extract the human-readable inner message from an `AppError` for use in AI diagnostics.
/// Avoids leaking variant prefixes like "Parse error: " into the `failure_reason` field.
fn ai_failure_reason(error: AppError) -> String {
    match error {
        AppError::Parse(msg) | AppError::Other(msg) => msg,
        _ => error.to_string(),
    }
}

fn can_use_parse_cache(force_ai: bool, has_inline_bytes: bool) -> bool {
    !force_ai && !has_inline_bytes
}

fn should_store_parse_cache(force_ai: bool, has_inline_bytes: bool, used_ai: bool) -> bool {
    can_use_parse_cache(force_ai, has_inline_bytes) && !used_ai
}

fn read_request_bytes(request: &ParseRequest) -> Result<Vec<u8>> {
    if let Some(path) = &request.file_path {
        let safe_path = validate_file_path(path)?;
        return fs::read(&safe_path)
            .map_err(|error| AppError::Io(std::io::Error::new(error.kind(), format!(
                "Failed to read file '{}': {}",
                path,
                error
            ))));
    }

    if let Some(bytes) = &request.bytes {
        if bytes.is_empty() {
            return Err(AppError::BadRequest("File bytes are empty".to_string()));
        }
        return Ok(bytes.clone());
    }

    Err(AppError::BadRequest(
        "Either filePath or bytes must be provided".to_string(),
    ))
}

async fn parse_heuristic_candidate(bytes: Vec<u8>, filename: String) -> std::result::Result<ParseCandidate, String> {
    tokio::task::spawn_blocking(move || {
        let parsed = parse_rheo_data(&bytes, &filename)
            .map_err(|error| format!("Native parser error: {}", error))?;
        Ok(build_parse_candidate(parsed, "regex", None))
    })
    .await
    .map_err(|error| format!("Parse task join error: {}", error))?
}

async fn parse_ai_candidate(
    bytes: Vec<u8>,
    filename: String,
    selected_candidate: AiContextCandidate,
    ai_mapping: AiMappingResponse,
    ai_diagnostics: AiDiagnostics,
) -> std::result::Result<ParseCandidate, String> {
    tokio::task::spawn_blocking(move || {
        let parsed = parse_rheo_data_with_ai_hint(&bytes, &filename, &selected_candidate, &ai_mapping)
            .map_err(|error| format!("Native parser error: {}", error))?;
        Ok(build_parse_candidate(parsed, "ai", Some(ai_diagnostics)))
    })
    .await
    .map_err(|error| format!("Parse task join error: {}", error))?
}

fn build_parse_candidate(
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

fn compare_candidates(left: &ParseCandidate, right: &ParseCandidate) -> Ordering {
    let left_severe = left.report.severe_errors.len();
    let right_severe = right.report.severe_errors.len();

    left.report
        .hard_valid
        .cmp(&right.report.hard_valid)
        .then_with(|| right_severe.cmp(&left_severe))
        .then_with(|| left.report.row_count.cmp(&right.report.row_count))
        .then_with(|| left.report.mandatory_field_coverage.cmp(&right.report.mandatory_field_coverage))
        .then_with(|| left.report.time_monotonicity_score.cmp(&right.report.time_monotonicity_score))
        .then_with(|| left.report.physics_consistency_score.cmp(&right.report.physics_consistency_score))
}

fn finalize_candidate_response(
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
        return Err(AppError::Parse("No valid data points found in file".to_string()));
    }

    let filename_parsed = parse_filename(filename);
    let filename_metadata = map_filename_metadata(&filename_parsed);
    let fallback_date = filename_parsed
        .test_date
        .as_deref()
        .map(normalize_date_string);

    let calibration = parse_calibration_from_buffer(bytes)
        .ok()
        .map(|report| {
            let calibration_date =
                normalize_optional_date(Some(report.meta.last_cal_date.as_str()));
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
        metadata: ParseMetadata {
            filename: filename.to_string(),
            instrument_type: candidate.parsed.metadata.instrument_type,
            geometry: candidate.parsed.metadata.geometry,
            geometry_source: candidate.parsed.metadata.geometry_source,
            used_ai: used_ai,
            test_date: normalized_test_date,
            ai_diagnostics,
            filename_metadata,
            calibration,
        },
        summary,
    })
}

fn base_ai_diagnostics(
    mapper: &dyn AiColumnMapper,
    model_name: String,
    candidate_count: usize,
) -> AiDiagnostics {
    AiDiagnostics {
        attempted: true,
        provider: mapper.provider_name().to_string(),
        model: model_name,
        prompt_version: mapper.prompt_version().to_string(),
        candidate_count,
        selected_candidate: None,
        status: AiDiagnosticsStatus::Failed,
        failure_reason: None,
        applied_mapping: Vec::new(),
    }
}

fn diagnostics_accepted(
    mut diagnostics: AiDiagnostics,
    mapping: &AiMappingResponse,
) -> AiDiagnostics {
    diagnostics.selected_candidate = Some(mapping.selected_candidate);
    diagnostics.status = AiDiagnosticsStatus::Accepted;
    diagnostics.applied_mapping = mapping
        .mapping
        .iter()
        .map(|(field, column)| AiAppliedMappingEntry {
            field: field.clone(),
            index: column.index,
            confidence: column.confidence,
        })
        .collect();
    diagnostics
}

fn diagnostics_failed(mut diagnostics: AiDiagnostics, reason: String) -> AiDiagnostics {
    diagnostics.status = AiDiagnosticsStatus::Failed;
    diagnostics.failure_reason = Some(reason);
    diagnostics
}

fn diagnostics_rejected(
    mut diagnostics: AiDiagnostics,
    reason: String,
    mapping: &AiMappingResponse,
) -> AiDiagnostics {
    diagnostics.selected_candidate = Some(mapping.selected_candidate);
    diagnostics.status = AiDiagnosticsStatus::Rejected;
    diagnostics.failure_reason = Some(reason);
    diagnostics.applied_mapping = mapping
        .mapping
        .iter()
        .map(|(field, column)| AiAppliedMappingEntry {
            field: field.clone(),
            index: column.index,
            confidence: column.confidence,
        })
        .collect();
    diagnostics
}

pub(crate) fn parse_file_native(request: ParseRequest) -> Result<ParseFileResponse> {
    let filename = request.filename.trim().to_string();
    if filename.is_empty() {
        return Err(AppError::BadRequest("Filename is required".to_string()));
    }

    let bytes = read_request_bytes(&request)?;
    let parsed = parse_rheo_data(&bytes, &filename)
        .map_err(|error| AppError::Parse(format!("Native parser error: {}", error)))?;

    finalize_candidate_response(
        build_parse_candidate(parsed, "regex", None),
        &filename,
        &bytes,
        false,
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::{can_use_parse_cache, should_store_parse_cache};

    #[test]
    fn cache_is_allowed_for_non_force_file_path_requests() {
        assert!(can_use_parse_cache(false, false));
        assert!(!can_use_parse_cache(true, false));
        assert!(!can_use_parse_cache(false, true));
    }

    #[test]
    fn cache_only_stores_deterministic_non_ai_results() {
        assert!(should_store_parse_cache(false, false, false));
        assert!(!should_store_parse_cache(false, false, true));
        assert!(!should_store_parse_cache(true, false, false));
        assert!(!should_store_parse_cache(false, true, false));
    }
}
