//! Input-validation helpers for `#[tauri::command]` handlers (WP-1.5).
//!
//! Every function returns `Result<T, AppError::BadRequest>` so callers get
//! a structured, user-visible error without boilerplate.

use crate::error::{AppError, Result};
use std::path::{Component, Path, PathBuf};

// ── String bounds ────────────────────────────────────────────────────────────

/// Reject strings that exceed `max` bytes or contain null bytes.
///
/// `field` is used only for the error message (e.g. `"name"`, `"description"`).
pub fn validate_bounded_str(s: &str, max: usize, field: &str) -> Result<()> {
    if s.contains('\0') {
        return Err(AppError::BadRequest(format!(
            "Field '{field}' must not contain null bytes"
        )));
    }
    if s.len() > max {
        return Err(AppError::BadRequest(format!(
            "Field '{field}' exceeds maximum length of {max} bytes (got {})",
            s.len()
        )));
    }
    Ok(())
}

// ── ID format ────────────────────────────────────────────────────────────────

/// Validate an entity ID (experiments, reagents).
///
/// Accepts the actual ID formats used by the codebase:
/// * `exp_<20hex>` — experiments (`generate_experiment_id_from_parts` in `experiments/helpers.rs`)
/// * `reag_<20hex>` — reagents (`generate_reagent_id` in `reagents/helpers.rs`)
/// * `seed_<slug>` — seeded reagents (`reagents/seed_data.rs`)
/// * Plain hex — legacy / short-hash IDs
/// * UUIDs — dev fixture seeds (`tools/fixture_seed`)
///
/// Security: still blocks SQL injection, XSS, path traversal vectors by
/// restricting to `[A-Za-z0-9_-]`. Length 3..=64.
pub fn validate_hash_id(s: &str, field: &str) -> Result<()> {
    if s.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Field '{field}' must not be empty"
        )));
    }
    let len = s.len();
    if !(3..=64).contains(&len) {
        return Err(AppError::BadRequest(format!(
            "Field '{field}' has invalid ID length ({len})"
        )));
    }
    if !s
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(AppError::BadRequest(format!(
            "Field '{field}' must contain only alphanumeric characters, '_' or '-'"
        )));
    }
    Ok(())
}

/// Validate a UUID-formatted string (laboratories, operators).
pub fn validate_uuid(s: &str, field: &str) -> Result<()> {
    if uuid::Uuid::parse_str(s).is_err() {
        return Err(AppError::BadRequest(format!(
            "Field '{field}' is not a valid UUID"
        )));
    }
    Ok(())
}

// ── Path containment ─────────────────────────────────────────────────────────

/// Ensure `requested` lives inside `allowed_root` after canonicalization.
///
/// Returns the canonical absolute path on success.
/// Rejects `..` components *before* canonicalization (defense-in-depth
/// against TOCTOU races with symlink creation).
pub fn validate_path_within(requested: &Path, allowed_root: &Path) -> Result<PathBuf> {
    // Early reject path-traversal components
    for component in requested.components() {
        if matches!(component, Component::ParentDir) {
            return Err(AppError::BadRequest(
                "Path must not contain '..' components".into(),
            ));
        }
    }

    let canonical = requested
        .canonicalize()
        .map_err(|_| AppError::BadRequest("Path does not exist or is not accessible".into()))?;

    let root = allowed_root
        .canonicalize()
        .map_err(|_| AppError::BadRequest("Allowed root does not exist".into()))?;

    if !canonical.starts_with(&root) {
        return Err(AppError::BadRequest(
            "Path is outside the allowed directory".into(),
        ));
    }

    Ok(canonical)
}

/// Validate a user-supplied file path for import/export operations.
///
/// - Must exist (for imports) or parent must exist (for exports).
/// - Must not contain null bytes.
/// - Rejects paths targeting sensitive OS directories.
pub fn validate_user_file_path(path_str: &str, must_exist: bool) -> Result<PathBuf> {
    if path_str.is_empty() {
        return Err(AppError::BadRequest("File path must not be empty".into()));
    }
    if path_str.contains('\0') {
        return Err(AppError::BadRequest(
            "File path must not contain null bytes".into(),
        ));
    }

    let path = Path::new(path_str);

    if must_exist && !path.exists() {
        return Err(AppError::BadRequest("File not found".into()));
    }

    if !must_exist {
        // For export targets: parent directory must exist
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                return Err(AppError::BadRequest(
                    "Target directory does not exist".into(),
                ));
            }
        }
    }

    // Block sensitive directories (defense-in-depth, matches parsing/mod.rs)
    let lower = path_str.to_lowercase();
    let blocked = [
        "\\windows\\system32",
        "/windows/system32",
        "/.ssh",
        "\\.ssh",
        "/.gnupg",
        "\\.gnupg",
        "/.aws",
        "\\.aws",
    ];
    if blocked.iter().any(|b| lower.contains(b)) {
        return Err(AppError::BadRequest(
            "Access to sensitive system directories is not allowed".into(),
        ));
    }

    Ok(path.to_path_buf())
}

// ── File size ────────────────────────────────────────────────────────────────

/// Reject files larger than `max_bytes`.
pub fn validate_file_size(path: &Path, max_bytes: u64) -> Result<()> {
    let metadata = path
        .metadata()
        .map_err(|_| AppError::BadRequest("Cannot read file metadata".into()))?;

    if metadata.len() > max_bytes {
        let mb = max_bytes / (1024 * 1024);
        return Err(AppError::BadRequest(format!(
            "File exceeds maximum allowed size of {} MB",
            mb
        )));
    }
    Ok(())
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── String bounds ────────────────────────────────────────────────

    #[test]
    fn bounded_str_accepts_valid() {
        assert!(validate_bounded_str("hello", 10, "name").is_ok());
    }

    #[test]
    fn bounded_str_rejects_null_byte() {
        assert!(validate_bounded_str("he\0llo", 10, "name").is_err());
    }

    #[test]
    fn bounded_str_rejects_over_limit() {
        assert!(validate_bounded_str("a".repeat(256).as_str(), 255, "name").is_err());
    }

    #[test]
    fn bounded_str_boundary_exact_limit() {
        let s = "a".repeat(255);
        assert!(validate_bounded_str(&s, 255, "name").is_ok());
    }

    // ── Hash ID ──────────────────────────────────────────────────────

    #[test]
    fn hash_id_accepts_valid_hex() {
        assert!(validate_hash_id("abcdef0123456789", "id").is_ok());
    }

    #[test]
    fn hash_id_accepts_experiment_prefix() {
        // Real format from `generate_experiment_id_from_parts`
        assert!(validate_hash_id("exp_abc123def4567890ab12", "id").is_ok());
    }

    #[test]
    fn hash_id_accepts_reagent_prefix() {
        // Real format from `generate_reagent_id`
        assert!(validate_hash_id("reag_abc123def4567890ab12", "id").is_ok());
    }

    #[test]
    fn hash_id_accepts_seed_slug() {
        // Real format from `reagents/seed_data.rs`
        assert!(validate_hash_id("seed_xanthan_gum", "id").is_ok());
    }

    #[test]
    fn hash_id_accepts_uuid() {
        // Dev fixture-seed format (contains hyphens)
        assert!(validate_hash_id("550e8400-e29b-41d4-a716-446655440000", "id").is_ok());
    }

    #[test]
    fn hash_id_rejects_empty() {
        assert!(validate_hash_id("", "id").is_err());
    }

    #[test]
    fn hash_id_rejects_sql_injection() {
        // Single quote → SQL injection attempt
        assert!(validate_hash_id("abc' OR 1=1--", "id").is_err());
    }

    #[test]
    fn hash_id_rejects_path_traversal() {
        assert!(validate_hash_id("../etc/passwd", "id").is_err());
    }

    #[test]
    fn hash_id_rejects_null_byte() {
        assert!(validate_hash_id("abc\0def", "id").is_err());
    }

    #[test]
    fn hash_id_rejects_too_short() {
        assert!(validate_hash_id("ab", "id").is_err());
    }

    #[test]
    fn hash_id_rejects_too_long() {
        let long = "a".repeat(65);
        assert!(validate_hash_id(&long, "id").is_err());
    }

    // ── UUID ─────────────────────────────────────────────────────────

    #[test]
    fn uuid_accepts_valid() {
        assert!(validate_uuid("550e8400-e29b-41d4-a716-446655440000", "lab").is_ok());
    }

    #[test]
    fn uuid_rejects_invalid() {
        assert!(validate_uuid("not-a-uuid", "lab").is_err());
    }

    #[test]
    fn uuid_rejects_empty() {
        assert!(validate_uuid("", "lab").is_err());
    }

    // ── User file path ───────────────────────────────────────────────

    #[test]
    fn user_path_rejects_empty() {
        assert!(validate_user_file_path("", true).is_err());
    }

    #[test]
    fn user_path_rejects_null_byte() {
        assert!(validate_user_file_path("foo\0bar.db", true).is_err());
    }

    #[test]
    fn user_path_rejects_sensitive_dir() {
        assert!(validate_user_file_path("C:\\Windows\\System32\\config.db", false).is_err());
    }

    #[test]
    fn user_path_rejects_ssh_dir() {
        assert!(validate_user_file_path("/home/user/.ssh/id_rsa", false).is_err());
    }

    // ── Path containment ─────────────────────────────────────────────

    #[test]
    fn path_within_rejects_dotdot() {
        let root = std::env::temp_dir();
        let bad = root.join("..").join("etc").join("passwd");
        assert!(validate_path_within(&bad, &root).is_err());
    }

    // ── File size ────────────────────────────────────────────────────

    #[test]
    fn file_size_accepts_small_file() {
        let tmp = std::env::temp_dir().join("_val_test_small.txt");
        std::fs::write(&tmp, "hello").unwrap();
        let result = validate_file_size(&tmp, 1024);
        let _ = std::fs::remove_file(&tmp);
        assert!(result.is_ok());
    }

    #[test]
    fn file_size_rejects_large_file() {
        let tmp = std::env::temp_dir().join("_val_test_large.txt");
        std::fs::write(&tmp, vec![0u8; 1025]).unwrap();
        let result = validate_file_size(&tmp, 1024);
        let _ = std::fs::remove_file(&tmp);
        assert!(result.is_err());
    }
}
