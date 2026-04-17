use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyItem {
    pub id: String,
    pub name: String,
    pub key: String,
    pub provider: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyCreatePayload {
    pub name: String,
    pub key: String,
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyMutationResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<ApiKeyItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ApiKeyMutationResponse {
    pub(super) fn ok(item: ApiKeyItem) -> Self {
        Self {
            success: true,
            key: Some(item),
            error: None,
        }
    }

    pub(super) fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            key: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyDeleteResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ApiKeyDeleteResponse {
    pub(super) fn ok() -> Self {
        Self {
            success: true,
            error: None,
        }
    }

    pub(super) fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyValidationResponse {
    pub is_valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ApiKeyValidationResponse {
    pub(super) fn ok() -> Self {
        Self {
            is_valid: true,
            error: None,
        }
    }

    pub(super) fn err(error: impl Into<String>) -> Self {
        Self {
            is_valid: false,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActiveApiKeyMeta {
    pub id: String,
    pub name: String,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActiveApiKeyResponse {
    pub provider: String,
    pub count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_key: Option<ActiveApiKeyMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
