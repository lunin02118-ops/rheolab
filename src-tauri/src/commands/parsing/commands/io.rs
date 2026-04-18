//! File-reading + candidate parsing helpers.
//!
//! The parse functions run inside `tokio::task::spawn_blocking` because
//! `parse_rheo_data` and `parse_rheo_data_with_ai_hint` are CPU-bound and
//! must not block the Tokio executor.

use std::fs;

use crate::error::{AppError, Result};
use rheolab_core::parser::rheo_parser::{parse_rheo_data, parse_rheo_data_with_ai_hint};
use rheolab_core::parser::types::{AiContextCandidate, AiMappingResponse};

use super::super::types::*;
use super::super::validate_file_path;
use super::candidate::{build_parse_candidate, ParseCandidate};

pub(super) fn read_request_bytes(request: &ParseRequest) -> Result<Vec<u8>> {
    if let Some(path) = &request.file_path {
        let safe_path = validate_file_path(path)?;
        return fs::read(&safe_path)
            .map_err(|e| AppError::Other(format!("Failed to read file '{}': {}", path, e)));
    }
    if let Some(bytes) = &request.bytes {
        if bytes.is_empty() {
            return Err(AppError::BadRequest(
                "Empty bytes payload supplied to parser".to_string(),
            ));
        }
        return Ok(bytes.clone());
    }
    Err(AppError::BadRequest(
        "Neither file_path nor bytes supplied to parser".to_string(),
    ))
}

pub(super) async fn parse_heuristic_candidate(
    bytes: Vec<u8>,
    filename: String,
) -> std::result::Result<ParseCandidate, String> {
    tokio::task::spawn_blocking(move || {
        let parsed = parse_rheo_data(&bytes, &filename)
            .map_err(|error| format!("Native parser error: {}", error))?;
        Ok(build_parse_candidate(parsed, "regex", None))
    })
    .await
    .map_err(|error| format!("Parse task join error: {}", error))?
}

pub(super) async fn parse_ai_candidate(
    bytes: Vec<u8>,
    filename: String,
    selected_candidate: AiContextCandidate,
    mapping: AiMappingResponse,
    diagnostics: AiDiagnostics,
) -> std::result::Result<ParseCandidate, String> {
    tokio::task::spawn_blocking(move || {
        let parsed = parse_rheo_data_with_ai_hint(&bytes, &filename, &selected_candidate, &mapping)
            .map_err(|error| format!("AI-hinted parser error: {}", error))?;
        Ok(build_parse_candidate(parsed, "ai", Some(diagnostics)))
    })
    .await
    .map_err(|error| format!("Parse task join error: {}", error))?
}
