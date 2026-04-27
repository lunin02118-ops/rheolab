//! Optional / forced AI-assisted parsing.
//!
//! [`parse_with_optional_ai`] tries the heuristic parser first and only falls
//! back to AI column-mapping when the heuristic is weak or when the caller
//! supplied inline bytes (untrusted upload path).
//!
//! [`parse_force_ai_only`] is invoked when the user explicitly requests
//! `force_ai=true` and skips the heuristic entirely.

use std::cmp::Ordering;

use crate::error::{AppError, Result};
use rheolab_core::parser::rheo_parser::extract_ai_context_candidates;

use super::super::ai_mapper::{validate_ai_mapping_response, AiColumnMapper};
use super::super::types::*;
use super::candidate::{compare_candidates, finalize_candidate_response, ParseCandidate};
use super::diagnostics::{
    ai_failure_reason, base_ai_diagnostics, diagnostics_accepted, diagnostics_failed,
    diagnostics_rejected,
};
use super::io::{parse_ai_candidate, parse_heuristic_candidate};

/// Try the heuristic parser, optionally ask the AI mapper to confirm or
/// override it, and return the best candidate.
pub(super) async fn parse_with_optional_ai(
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
            return finalize_candidate_response(candidate.clone(), &filename, &bytes, false, None);
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
    let base_diagnostics = base_ai_diagnostics(ai_mapper, model_name, ai_context_candidates.len());

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
    let base_diagnostics = base_ai_diagnostics(ai_mapper, model_name, ai_context_candidates.len());
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
    match heuristic_candidate {
        Ok(candidate) => finalize_candidate_response(
            candidate.clone(),
            filename,
            bytes,
            false,
            Some(diagnostics),
        ),
        Err(error) => Err(AppError::Parse(error.clone())),
    }
}
