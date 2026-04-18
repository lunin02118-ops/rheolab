//! Builders for [`AiDiagnostics`] — keep the three lifecycle states
//! (`accepted` / `failed` / `rejected`) close together so they stay in sync.

use crate::error::AppError;
use rheolab_core::parser::types::AiMappingResponse;

use super::super::ai_mapper::AiColumnMapper;
use super::super::types::*;

/// Extract the human-readable inner message from an [`AppError`] for use in
/// AI diagnostics. Avoids leaking variant prefixes like "Parse error: " into
/// the `failure_reason` field.
pub(super) fn ai_failure_reason(error: AppError) -> String {
    match error {
        AppError::Parse(msg) | AppError::Other(msg) => msg,
        _ => error.to_string(),
    }
}

pub(super) fn base_ai_diagnostics(
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

pub(super) fn diagnostics_accepted(
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

pub(super) fn diagnostics_failed(mut diagnostics: AiDiagnostics, reason: String) -> AiDiagnostics {
    diagnostics.status = AiDiagnosticsStatus::Failed;
    diagnostics.failure_reason = Some(reason);
    diagnostics
}

pub(super) fn diagnostics_rejected(
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
