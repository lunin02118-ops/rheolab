use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchItem {
    pub id: String,
    pub source_lab_id: Option<String>,
    pub source_system: Option<String>,
    pub source_app_version: Option<String>,
    pub imported_by_user_id: Option<String>,
    pub file_name: Option<String>,
    pub checksum: Option<String>,
    pub notes: Option<String>,
    pub experiments_imported: i64,
    pub duplicates_detected: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentPayloadItem {
    pub id: String,
    pub experiment_id: String,
    pub import_batch_id: Option<String>,
    pub payload_version: i64,
    pub payload_format: String,
    pub content_fingerprint: String,
    pub source_lab_id: Option<String>,
    pub is_canonical: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParserArtifactItem {
    pub id: String,
    pub experiment_id: String,
    pub import_batch_id: Option<String>,
    pub parser_version: String,
    pub schema_version: String,
    pub content_fingerprint: String,
    pub promoted_to_hot: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportArtifactItem {
    pub id: String,
    pub experiment_id: String,
    pub import_batch_id: Option<String>,
    pub report_type: String,
    pub template_version: Option<String>,
    pub storage_path: Option<String>,
    pub binary_sha256: Option<String>,
    pub size_bytes: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusResponse {
    pub outbox_pending: i64,
    pub outbox_failed: i64,
    pub inbox_pending: i64,
    pub conflicts_open: i64,
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutboxItem {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub operation: String,
    pub status: String,
    pub retry_count: i64,
    pub next_attempt_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub processed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncInboxItem {
    pub id: String,
    pub remote_event_id: String,
    pub source_lab_id: Option<String>,
    pub source_system: Option<String>,
    pub status: String,
    pub received_at: String,
    pub processed_at: Option<String>,
    pub import_batch_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConflictItem {
    pub id: String,
    pub merge_event_id: Option<String>,
    pub experiment_id: Option<String>,
    pub field_name: String,
    pub local_value: Option<String>,
    pub incoming_value: Option<String>,
    pub resolution: Option<String>,
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}
