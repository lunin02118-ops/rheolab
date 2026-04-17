#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Security checks — clock tampering detection and offline overdue validation.
//!
//! Uses the encrypted secure-storage file (outside the DB) to detect system
//! clock manipulation and enforce maximum offline duration.

use chrono::{NaiveDate, Utc};

use super::crypto::get_secure_last_check;
use super::types::MAX_OFFLINE_DAYS;

/// Parse a date string loosely: try "%Y-%m-%d" first, then take first 10 chars.
fn parse_date_loose(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .or_else(|| {
            s.get(..10)
                .and_then(|sub| NaiveDate::parse_from_str(sub, "%Y-%m-%d").ok())
        })
}

/// Returns `true` if the system clock appears to have been rolled back
/// since the last recorded license check.
///
/// Detection: if `now < last_check_date`, the clock was moved backward.
pub(super) fn is_clock_tampered(app_data_dir: &std::path::Path) -> bool {
    let last_check = match get_secure_last_check(app_data_dir) {
        Some(date_str) => date_str,
        None => return false, // No previous check — nothing to compare
    };

    let last_date = match parse_date_loose(&last_check) {
        Some(d) => d,
        None => return false, // Unparseable date — don't block the user
    };

    let today = Utc::now().date_naive();
    today < last_date
}

/// Returns `true` if the app has been offline too long (> [`MAX_OFFLINE_DAYS`]).
///
/// Calculated as: `today - last_check_date > MAX_OFFLINE_DAYS`.
///
/// **F-06 fail-closed**: if no last-check is recorded (storage deleted or
/// missing), returns `true` — the caller MUST force an online revalidation.
/// On genuine first launch this code path is unreachable because
/// `check_stored_license` is only called when a license exists in the DB,
/// and `save_secure_last_check` is always called during activation.
pub(super) fn is_offline_overdue(app_data_dir: &std::path::Path) -> bool {
    let last_check = match get_secure_last_check(app_data_dir) {
        Some(date_str) => date_str,
        None => {
            tracing::warn!(
                "Secure storage missing or unreadable — treating as offline-overdue (fail-closed)"
            );
            return true;
        }
    };

    let last_date = match parse_date_loose(&last_check) {
        Some(d) => d,
        None => return false,
    };

    let today = Utc::now().date_naive();
    let days_since = (today - last_date).num_days();
    days_since > MAX_OFFLINE_DAYS
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_secure_storage_not_tampered() {
        let tmp = std::env::temp_dir().join("rheolab_test_security_no_store");
        let _ = std::fs::create_dir_all(&tmp);
        // Ensure no secure storage file exists
        let secure_path = tmp
            .parent()
            .unwrap_or(&tmp)
            .join(".rheolab")
            .join("rheolab_secure_storage.dat");
        let _ = std::fs::remove_file(&secure_path);

        // Clock tamper: can't detect with no baseline → false
        assert!(!is_clock_tampered(&tmp));
        // Offline overdue: fail-closed — missing storage means overdue (F-06)
        assert!(is_offline_overdue(&tmp));

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
