//! Native file parsing commands for desktop mode.
//!
//! This command domain executes parsing directly in Rust/Tauri runtime and
//! avoids browser-side WASM module bootstrapping for desktop uploads.

use crate::error::Result;
use lru::LruCache;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::num::NonZeroUsize;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::SystemTime;

mod types;
pub(crate) mod helpers;
pub(crate) mod commands;
pub(crate) mod ai_mapper;

pub use types::*;
pub(crate) use commands::parse_file_native;
#[doc(hidden)]
pub use ai_mapper::{AiColumnMapper, StubAiColumnMapper};

/// Tauri command entry-point.  The `#[tauri::command]` macro must live in the
/// same module that is referenced by `generate_handler!`, so we keep a thin
/// delegation wrapper here that calls the real implementation in `commands`.
#[tauri::command]
pub async fn parsing_parse_file(
    request: ParseRequest,
    state: tauri::State<'_, crate::state::AppState>,
) -> crate::error::Result<ParseFileResponse> {
    // Resolve AI key server-side — never sent over IPC.
    let ai_key = {
        let conn = state.pool_conn()?;
        let resolved = crate::commands::api_keys::resolve_active_ai_key(&conn, &state.app_data_dir, "groq");
        if request.force_ai.unwrap_or(false) && resolved.is_none() {
            return Err("force_ai=true but no active Groq API key configured".into());
        }
        resolved
    };
    commands::parsing_parse_file_inner(request, ai_key).await
}

/// Internal adapter for integration tests that need to exercise the parsing
/// pipeline without constructing a full Tauri `State<AppState>`.
#[doc(hidden)]
pub async fn parsing_parse_file_with_resolved_ai_key(
    request: ParseRequest,
    ai_key: Option<String>,
) -> crate::error::Result<ParseFileResponse> {
    commands::parsing_parse_file_inner(request, ai_key).await
}

#[doc(hidden)]
pub async fn parsing_parse_file_with_ai_mapper(
    request: ParseRequest,
    ai_key: Option<String>,
    mapper: &dyn ai_mapper::AiColumnMapper,
) -> crate::error::Result<ParseFileResponse> {
    commands::parsing_parse_file_inner_with_mapper(request, ai_key, mapper).await
}

/// Release the in-process file parse cache.
///
/// Called by the frontend when there's memory pressure (e.g. after closing
/// an experiment).  Also runs `PRAGMA shrink_memory` on a pooled SQLite
/// connection to return page-cache memory to the OS.
#[tauri::command]
pub async fn parsing_release_cache(
    state: tauri::State<'_, crate::state::AppState>,
) -> crate::error::Result<()> {
    // 1. Clear the LRU parse cache
    if let Ok(mut cache) = PARSE_CACHE.lock() {
        cache.clear();
    }
    // 2. Shrink SQLite page cache to release mmap'd/cached pages
    let pool = state.db_pool.clone();
    tokio::task::spawn_blocking(move || {
        if let Ok(conn) = pool.get() {
            let _ = conn.execute_batch("PRAGMA shrink_memory;");
        }
    })
    .await
    .map_err(crate::error::AppError::Join)?;
    Ok(())
}

// ── Path safety ────────────────────────────────────────────────────────────

/// Validate that a frontend-supplied file path is safe to read (F-05).
///
/// * Canonicalises the path (resolves `..\` traversal, symlinks, UNC vs drive
///   letter differences).
/// * Ensures the result is a regular file (not a directory, device, or pipe).
/// * Blocks reads from known sensitive system directories (Windows, Program Files, etc.).
///
/// This prevents a compromised WebView from requesting arbitrary system files.
fn validate_file_path(raw: &str) -> Result<std::path::PathBuf> {
    fn normalized_path_for_compare(path: &std::path::Path) -> String {
        path.to_string_lossy()
            .to_lowercase()
            .replace('/', "\\")
            .trim_start_matches("\\\\?\\")
            .to_string()
    }

    let canonical = std::fs::canonicalize(raw)
        .map_err(|e| format!("Invalid file path '{}': {}", raw, e))?;

    if !canonical.is_file() {
        return Err(format!("Path '{}' does not point to a regular file", raw).into());
    }

    // Block known sensitive system directories (case-insensitive on Windows).
    let path_lower = normalized_path_for_compare(&canonical);
    let blocked_prefixes: &[&str] = &[
        "c:\\windows",
        "c:\\program files",
        "c:\\program files (x86)",
        "c:\\programdata",
        "c:\\$recycle.bin",
    ];
    if let Some(home) = dirs::home_dir() {
        let home_lower = normalized_path_for_compare(&home);
        let sensitive_subdirs = [".ssh", ".gnupg", ".aws", "appdata\\local\\microsoft\\credentials"];
        for subdir in &sensitive_subdirs {
            let blocked = format!("{}\\{}", home_lower, subdir);
            if path_lower.starts_with(&blocked) {
                return Err(crate::error::AppError::BadRequest(
                    format!("Access denied: path '{}' is inside a sensitive directory", raw),
                ));
            }
        }
    }
    for prefix in blocked_prefixes {
        if path_lower.starts_with(prefix) {
            return Err(crate::error::AppError::BadRequest(
                format!("Access denied: path '{}' is inside a system directory", raw),
            ));
        }
    }

    Ok(canonical)
}

/// Bounded in-process parse cache.
///
/// Key: FNV-inspired 64-bit digest of (filename, path, file-size, mtime).
/// Value: Arc-wrapped response — cloned on hit to avoid copying ~MB of data.
/// Bypassed when bytes are supplied (no stable key) or force_ai=true.
/// LRU capacity reduced from 12 → 4.
/// Each entry holds thousands of `ParsedPoint`s (~2-5 MB each).
/// 12 entries = 24-60 MB permanently retained; 4 entries = 8-20 MB — still
/// useful for re-parsing the same file but much friendlier on RSS.
pub(crate) static PARSE_CACHE: LazyLock<Mutex<LruCache<u64, Arc<ParseFileResponse>>>> =
    LazyLock::new(|| Mutex::new(LruCache::new(NonZeroUsize::new(4).expect("4 is non-zero"))));

pub(crate) fn parse_cache_key(filename: &str, file_path: &str) -> Option<u64> {
    let meta = fs::metadata(file_path).ok()?;
    let size = meta.len();
    let mtime = meta
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut h = DefaultHasher::new();
    filename.hash(&mut h);
    file_path.hash(&mut h);
    size.hash(&mut h);
    mtime.hash(&mut h);
    Some(h.finish())
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use super::helpers::{
        normalize_date_string, normalize_optional_date, build_summary, round2,
    };

    // ── helpers ──────────────────────────────────────────────────────────────

    fn pt(time: f64, visc: f64, temp: f64, pres: f64) -> ParsedPoint {
        ParsedPoint {
            time_sec: time,
            viscosity_cp: visc,
            temperature_c: temp,
            speed_rpm: 0.0,
            shear_rate_s1: 0.0,
            shear_stress_pa: 0.0,
            pressure_bar: pres,
            bath_temperature_c: None,
        }
    }

    // ── normalize_date_string ────────────────────────────────────────────────

    #[test]
    fn date_already_iso_passes_through() {
        assert_eq!(normalize_date_string("2024-03-15"), "2024-03-15");
    }

    #[test]
    fn date_dot_dmy_four_digit_year_normalises() {
        assert_eq!(normalize_date_string("15.03.2024"), "2024-03-15");
    }

    #[test]
    fn date_dot_dmy_two_digit_year_normalises() {
        assert_eq!(normalize_date_string("05.07.23"), "2023-07-05");
    }

    #[test]
    fn date_empty_string_passes_through() {
        assert_eq!(normalize_date_string(""), "");
    }

    #[test]
    fn date_whitespace_only_returns_empty() {
        assert_eq!(normalize_date_string("   "), "");
    }

    #[test]
    fn date_unknown_format_passes_through_unchanged() {
        let raw = "January 2024";
        assert_eq!(normalize_date_string(raw), raw);
    }

    // ── normalize_optional_date ──────────────────────────────────────────────

    #[test]
    fn optional_date_none_returns_none() {
        assert_eq!(normalize_optional_date(None), None);
    }

    #[test]
    fn optional_date_empty_str_returns_none() {
        assert_eq!(normalize_optional_date(Some("")), None);
    }

    #[test]
    fn optional_date_valid_input_normalises() {
        assert_eq!(
            normalize_optional_date(Some("15.03.2024")),
            Some("2024-03-15".to_string())
        );
    }

    // ── round2 ───────────────────────────────────────────────────────────────

    #[test]
    fn round2_truncates_beyond_two_places() {
        assert_eq!(round2(3.14159), 3.14);
    }

    #[test]
    fn round2_rounds_up_at_half() {
        assert_eq!(round2(3.145), 3.15);
    }

    #[test]
    fn round2_exact_value_unchanged() {
        assert_eq!(round2(2.50), 2.50);
    }

    #[test]
    fn round2_zero_is_zero() {
        assert_eq!(round2(0.0), 0.0);
    }

    // ── build_summary ────────────────────────────────────────────────────────

    #[test]
    fn summary_empty_returns_zero_count_and_all_none() {
        let s = build_summary(&[]);
        assert_eq!(s.point_count, 0);
        assert!(s.time_range.is_none());
        assert!(s.viscosity_range.is_none());
        assert!(s.temperature_range.is_none());
        assert!(s.pressure_range.is_none());
    }

    #[test]
    fn summary_single_point_all_ranges_equal_min_max() {
        let s = build_summary(&[pt(10.0, 100.0, 25.0, 0.0)]);
        assert_eq!(s.point_count, 1);
        let tr = s.time_range.unwrap();
        assert_eq!(tr.start, 10.0);
        assert_eq!(tr.end, 10.0);
        assert_eq!(tr.duration_minutes, 0.0);
        let vr = s.viscosity_range.unwrap();
        assert_eq!(vr.min, 100.0);
        assert_eq!(vr.max, 100.0);
        assert_eq!(vr.avg, 100.0);
    }

    #[test]
    fn summary_zero_pressure_produces_no_pressure_range() {
        let pts = vec![pt(0.0, 50.0, 25.0, 0.0), pt(60.0, 100.0, 63.0, 0.0)];
        let s = build_summary(&pts);
        assert!(s.pressure_range.is_none(), "zero pressure → no pressure range");
    }

    #[test]
    fn summary_positive_pressure_produces_range() {
        let pts = vec![pt(0.0, 50.0, 25.0, 1.50), pt(60.0, 100.0, 63.0, 3.00)];
        let s = build_summary(&pts);
        let pr = s.pressure_range.expect("positive pressure → Some range");
        assert_eq!(pr.min, 1.5);
        assert_eq!(pr.max, 3.0);
    }

    #[test]
    fn summary_multi_point_computes_correct_avg_and_duration() {
        let pts = vec![pt(0.0, 100.0, 20.0, 0.0), pt(120.0, 200.0, 40.0, 0.0)];
        let s = build_summary(&pts);
        let tr = s.time_range.unwrap();
        assert_eq!(tr.start, 0.0);
        assert_eq!(tr.end, 120.0);
        assert_eq!(tr.duration_minutes, 2.0);
        let vr = s.viscosity_range.unwrap();
        assert_eq!(vr.min, 100.0);
        assert_eq!(vr.max, 200.0);
        assert_eq!(vr.avg, 150.0);
        let cr = s.temperature_range.unwrap();
        assert_eq!(cr.min, 20.0);
        assert_eq!(cr.max, 40.0);
        assert_eq!(cr.avg, 30.0);
    }

    // ── parse_file_native error paths ────────────────────────────────────────

    fn req_no_ai(filename: &str, file_path: Option<&str>, bytes: Option<Vec<u8>>) -> ParseRequest {
        ParseRequest {
            filename: filename.to_string(),
            file_path: file_path.map(|s| s.to_string()),
            bytes,
            force_ai: None,
            ai_model: None,
        }
    }

    #[test]
    fn parse_file_native_rejects_empty_filename() {
        let err = parse_file_native(req_no_ai("  ", Some("/any/path"), None))
            .unwrap_err()
            .to_string();
        assert!(err.contains("Filename"), "expected Filename error, got: {err}");
    }

    #[test]
    fn parse_file_native_rejects_no_path_and_no_bytes() {
        let result = parse_file_native(req_no_ai("test.csv", None, None));
        assert!(result.is_err(), "missing both path and bytes must fail");
    }

    #[test]
    fn parse_file_native_rejects_empty_bytes() {
        let err = parse_file_native(req_no_ai("test.csv", None, Some(vec![])))
            .unwrap_err()
            .to_string();
        assert!(
            err.to_lowercase().contains("empty"),
            "expected 'empty' in error, got: {err}"
        );
    }

    #[test]
    fn parse_file_native_rejects_nonexistent_file_path() {
        let result = parse_file_native(req_no_ai(
            "test.csv",
            Some("RHEOLAB_DEFINITELY_NOT_EXISTING_PATH_xyz123.csv"),
            None,
        ));
        assert!(result.is_err(), "nonexistent path must fail");
    }

    #[test]
    fn validate_file_path_blocks_windows_system_dir() {
        let result = validate_file_path("C:\\Windows\\System32\\notepad.exe");
        assert!(result.is_err(), "system dir must be blocked");
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("system directory"), "expected system dir error, got: {err_msg}");
    }

    #[test]
    fn validate_file_path_blocks_ssh_dir() {
        let result = validate_file_path(
            &format!("{}/.ssh/id_rsa", dirs::home_dir().unwrap().display())
        );
        // Even if the file doesn't exist, canonicalize will fail first.
        // If it does exist, it should be blocked.
        assert!(result.is_err(), ".ssh dir must be blocked or not exist");
    }

    #[test]
    fn validate_file_path_blocks_program_files() {
        let result = validate_file_path("C:\\Program Files\\test");
        assert!(result.is_err(), "Program Files must be blocked or not exist");
    }
}
