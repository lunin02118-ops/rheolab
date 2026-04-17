use serde::{Deserialize, Serialize};

// ── Public types (unchanged contract with TypeScript) ──────────────────

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StoredReagent {
    pub id: String,
    pub name: String,
    pub category: String,
    pub manufacturer: Option<String>,
    pub country: Option<String>,
    pub description: Option<String>,
    pub active_substance: Option<String>,
    pub form: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReagentUpsertPayload {
    pub name: String,
    pub category: String,
    pub manufacturer: Option<String>,
    pub country: Option<String>,
    pub description: Option<String>,
    pub active_substance: Option<String>,
    pub form: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReagentMutationResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reagent: Option<StoredReagent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ReagentMutationResponse {
    pub(crate) fn ok(reagent: StoredReagent) -> Self {
        Self {
            success: true,
            reagent: Some(reagent),
            error: None,
        }
    }

    pub(crate) fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            reagent: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReagentDeleteResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ReagentDeleteResponse {
    pub(crate) fn ok() -> Self {
        Self {
            success: true,
            error: None,
        }
    }

    pub(crate) fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(error.into()),
        }
    }
}
