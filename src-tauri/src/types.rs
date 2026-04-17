//! Common types for Tauri commands and IPC communication.

use serde::{Deserialize, Serialize};

/// Result of a backup operation
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct BackupResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl BackupResult {
    pub fn ok() -> Self {
        Self {
            success: true,
            name: None,
            error: None,
        }
    }

    pub fn ok_with_name(name: String) -> Self {
        Self {
            success: true,
            name: Some(name),
            error: None,
        }
    }

    pub fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            name: None,
            error: Some(error.into()),
        }
    }
}

/// Result of a database merge (import) operation
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct MergeResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Number of experiments added from the import source
    pub imported: u64,
    /// Number of experiments skipped (already existed)
    pub skipped: u64,
    /// FK violations detected after merge (non-fatal warnings)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
}

impl MergeResult {
    pub fn ok(imported: u64, skipped: u64) -> Self {
        Self { success: true, error: None, imported, skipped, warnings: None }
    }
    pub fn err(error: impl Into<String>) -> Self {
        Self { success: false, error: Some(error.into()), imported: 0, skipped: 0, warnings: None }
    }
}

/// Information about a backup file
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct BackupInfo {
    pub name: String,
    pub date: String, // ISO 8601 format
    pub size: u64,
}
