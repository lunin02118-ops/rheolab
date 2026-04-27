//! Test fixtures commands for desktop demo workflows.
//!
//! These commands provide local fixture file listing/reading for the
//! desktop application.

use super::parsing::{parse_file_native, ParseFileResponse, ParseRequest};
use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const SUPPORTED_EXTENSIONS: [&str; 5] = [".xlsx", ".xls", ".csv", ".dat", ".txt"];

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FixtureItem {
    pub name: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FixturesListResponse {
    pub success: bool,
    pub fixtures: Vec<FixtureItem>,
    pub count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl FixturesListResponse {
    fn ok(fixtures: Vec<FixtureItem>) -> Self {
        let count = fixtures.len();
        Self {
            success: true,
            fixtures,
            count,
            error: None,
        }
    }

    fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            fixtures: vec![],
            count: 0,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FixtureReadResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl FixtureReadResponse {
    fn ok(filename: String, bytes: Vec<u8>) -> Self {
        Self {
            success: true,
            filename: Some(filename),
            bytes: Some(bytes),
            error: None,
        }
    }

    fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            filename: None,
            bytes: None,
            error: Some(error.into()),
        }
    }
}

#[tauri::command]
pub async fn test_fixtures_list() -> Result<FixturesListResponse> {
    let Some(fixtures_dir) = resolve_fixtures_dir() else {
        return Ok(FixturesListResponse::err(
            "Fixtures directory not found (expected tests/fixtures).",
        ));
    };

    let entries = std::fs::read_dir(&fixtures_dir).map_err(|error| {
        format!(
            "Failed to read fixtures directory {:?}: {}",
            fixtures_dir, error
        )
    })?;

    let mut fixtures = vec![];
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("sample-") {
            continue;
        }
        if !is_supported_fixture(&name) {
            continue;
        }

        fixtures.push(FixtureItem {
            display_name: fixture_display_name(&name),
            name,
        });
    }

    fixtures.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
            .then(left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(FixturesListResponse::ok(fixtures))
}

#[tauri::command]
pub async fn test_fixtures_read(filename: String) -> Result<FixtureReadResponse> {
    match read_fixture_bytes(&filename) {
        Ok((normalized, bytes)) => Ok(FixtureReadResponse::ok(normalized, bytes)),
        Err(error) => Ok(FixtureReadResponse::err(error.to_string())),
    }
}

#[tauri::command]
pub async fn test_fixtures_parse(filename: String) -> Result<ParseFileResponse> {
    tokio::task::spawn_blocking(move || {
        let (normalized, bytes) = read_fixture_bytes(&filename)?;
        parse_file_native(ParseRequest {
            filename: normalized,
            file_path: None,
            bytes: Some(bytes),
            force_ai: None,
            ai_model: None,
        })
    })
    .await
    .map_err(|error| format!("Fixture parse task join error: {}", error))?
}

fn resolve_fixtures_dir() -> Option<PathBuf> {
    let mut candidates = vec![];

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("tests").join("fixtures"));
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.join("tests").join("fixtures"));
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("tests").join("fixtures"));
            candidates.push(
                exe_dir
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("tests")
                    .join("fixtures"),
            );
            candidates.push(
                exe_dir
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("tests")
                    .join("fixtures"),
            );
        }
    }

    candidates.into_iter().find(|candidate| candidate.is_dir())
}

fn is_supported_fixture(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    SUPPORTED_EXTENSIONS
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn read_fixture_bytes(filename: &str) -> Result<(String, Vec<u8>)> {
    let filename = filename.trim().to_string();
    if filename.is_empty() {
        return Err("Filename is required".into());
    }
    if !is_supported_fixture(&filename) {
        return Err("Unsupported fixture file type".into());
    }

    // Reject nested paths and traversal attempts.
    let normalized = Path::new(&filename)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();
    if normalized != filename {
        return Err("Invalid fixture filename".into());
    }

    let Some(fixtures_dir) = resolve_fixtures_dir() else {
        return Err("Fixtures directory not found (expected tests/fixtures).".into());
    };

    let fixtures_dir = fixtures_dir
        .canonicalize()
        .map_err(|error| format!("Failed to resolve fixtures directory: {}", error))?;
    let file_path = fixtures_dir.join(&filename);
    if !file_path.exists() {
        return Err(format!("Fixture not found: {}", filename).into());
    }

    let resolved = file_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve fixture path: {}", error))?;
    if !resolved.starts_with(&fixtures_dir) {
        return Err("Invalid fixture path".into());
    }

    let bytes = std::fs::read(&resolved).map_err(|error| {
        format!(
            "Failed to read fixture {:?}: {}",
            resolved.file_name().unwrap_or_default(),
            error
        )
    })?;

    Ok((filename, bytes))
}

fn fixture_display_name(filename: &str) -> String {
    match filename {
        "Ofite 1100.dat" => "Ofite 1100 Rheometer".to_string(),
        "Отчёт Grace.xlsx" => "Grace M5600 HPHT".to_string(),
        "Отчёт Chandler.xls" => "Chandler 5550".to_string(),
        "Отчёт BSL.xlsx" => "BSL Rheometer".to_string(),
        "Отчёт brookfild.xls" => "Brookfield PVS".to_string(),
        "Brookfeild 4.xlsx" => "Brookfield PVS (2)".to_string(),
        "8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv" => {
            "Chandler SST @ 63°C".to_string()
        }
        "8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv" => {
            "Chandler SWB @ 96°C".to_string()
        }
        _ => filename
            .trim_end_matches(".xlsx")
            .trim_end_matches(".xls")
            .trim_end_matches(".csv")
            .trim_end_matches(".dat")
            .trim_end_matches(".txt")
            .to_string(),
    }
}
