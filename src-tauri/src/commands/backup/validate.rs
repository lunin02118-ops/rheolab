//! Backup filename validation.

use crate::error::Result;

/// Validate a backup filename: no path separators, no ".." traversal, must end in ".db"
pub(super) fn sanitize_backup_filename(filename: &str) -> Result<()> {
    if filename.is_empty() {
        return Err("Backup filename must not be empty".into());
    }
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid backup filename: path traversal not allowed".into());
    }
    if !filename.ends_with(".db") {
        return Err("Invalid backup filename: must end with .db".into());
    }
    let stem = filename.trim_end_matches(".db");
    if stem.is_empty() || stem.starts_with('.') {
        return Err("Invalid backup filename: missing base name".into());
    }
    if !stem
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
    {
        return Err(
            "Invalid backup filename: only ASCII letters, digits, '.', '_' and '-' are allowed"
                .into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod filename_tests {
    use super::sanitize_backup_filename;

    #[test]
    fn rejects_path_traversal_forward_slash() {
        assert!(sanitize_backup_filename("../etc/passwd").is_err());
    }

    #[test]
    fn rejects_path_traversal_backslash() {
        assert!(sanitize_backup_filename("..\\windows\\system32\\config.db").is_err());
    }

    #[test]
    fn rejects_dotdot_in_middle() {
        assert!(sanitize_backup_filename("foo/../secret.db").is_err());
    }

    #[test]
    fn rejects_embedded_slash() {
        assert!(sanitize_backup_filename("subdir/backup.db").is_err());
    }

    #[test]
    fn rejects_non_db_extension() {
        assert!(sanitize_backup_filename("backup.exe").is_err());
    }

    #[test]
    fn rejects_missing_base_name() {
        assert!(sanitize_backup_filename(".db").is_err());
    }

    #[test]
    fn rejects_control_characters() {
        assert!(sanitize_backup_filename("backup\n2024.db").is_err());
    }

    #[test]
    fn rejects_spaces() {
        assert!(sanitize_backup_filename("backup 2024.db").is_err());
    }

    #[test]
    fn accepts_valid_filename() {
        assert!(sanitize_backup_filename("backup-2024-01-15T10-30-00.db").is_ok());
    }
}
