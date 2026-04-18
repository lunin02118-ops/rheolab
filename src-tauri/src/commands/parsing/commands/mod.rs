//! Native-file parsing command domain.
//!
//! Module layout:
//! - [`candidate`]   — [`ParseCandidate`] struct + validation ordering + response assembly
//! - [`io`]          — file reading + CPU-bound parser invocations (`spawn_blocking`)
//! - [`ai`]          — AI column-mapping dispatch (optional & forced)
//! - [`diagnostics`] — [`AiDiagnostics`] lifecycle builders
//!
//! The three public `*_inner*` entrypoints are thin wrappers: they resolve the
//! AI mapper, delegate to [`parsing_parse_file_inner_impl`], and that fn
//! decides whether to short-circuit to the native parser, hit the parse cache,
//! or go through the full AI pipeline.

use std::sync::Arc;

use crate::error::{AppError, Result};

mod candidate;
mod io;
mod ai;
mod diagnostics;

use super::ai_mapper::{AiColumnMapper, GroqAiColumnMapper};
use super::types::*;
use super::{parse_cache_key, PARSE_CACHE};

use candidate::build_parse_candidate;
use io::read_request_bytes;
use ai::parse_with_optional_ai;

use rheolab_core::parser::rheo_parser::parse_rheo_data;

// ─── Public entrypoints ──────────────────────────────────────────────────────

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

// ─── Dispatch ────────────────────────────────────────────────────────────────

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

// ─── Synchronous native fallback ─────────────────────────────────────────────

pub(crate) fn parse_file_native(request: ParseRequest) -> Result<ParseFileResponse> {
    let filename = request.filename.trim().to_string();
    if filename.is_empty() {
        return Err(AppError::BadRequest("Filename is required".to_string()));
    }

    let bytes = read_request_bytes(&request)?;
    let parsed = parse_rheo_data(&bytes, &filename)
        .map_err(|error| AppError::Parse(format!("Native parser error: {}", error)))?;

    candidate::finalize_candidate_response(
        build_parse_candidate(parsed, "regex", None),
        &filename,
        &bytes,
        false,
        None,
    )
}

// ─── Cache eligibility helpers (kept here so tests can reach them easily) ───

fn can_use_parse_cache(force_ai: bool, has_inline_bytes: bool) -> bool {
    !force_ai && !has_inline_bytes
}

fn should_store_parse_cache(force_ai: bool, has_inline_bytes: bool, used_ai: bool) -> bool {
    can_use_parse_cache(force_ai, has_inline_bytes) && !used_ai
}

// ─── Tests ───────────────────────────────────────────────────────────────────

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
