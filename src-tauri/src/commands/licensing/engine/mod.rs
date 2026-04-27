//! License Engine — the single source of truth for license status.
//!
//! [`LicenseEngine`] holds a cached [`LicenseCheckResult`] behind a `RwLock`
//! and exposes the authoritative `check_license()` method that combines:
//! - DB-stored license data (HMAC-verified)
//! - Online validation (revocation, expiry)
//! - Demo period logic
//! - Clock tamper / offline-overdue detection
//! - Feature flag computation
//!
//! The frontend calls `licensing_check` (Tauri command) which delegates to
//! `engine.check()`. No business logic remains on the frontend.

use std::path::PathBuf;
use std::time::Instant;
use tokio::sync::RwLock;

use chrono::{NaiveDate, NaiveDateTime, Utc};

use super::crypto::get_secure_last_check;
use super::features::expired_features;
use super::types::{LicenseCheckResult, LicenseSource, LicenseStatus};

/// How long the cached check result is considered fresh (seconds).
/// Within this window, `check()` returns instantly without any I/O.
const CHECK_CACHE_TTL_SECS: u64 = 120;

/// Minimum interval between HTTP validation requests (seconds).
/// Within this window, `check_stored_license` skips `validate_online` and uses
/// locally stored data only.  Only relevant *within the same process lifetime*
/// (in-memory `Instant`); cross-restart persistence uses `ONLINE_CHECK_INTERVAL_DAYS`.
///
/// Debug builds use 5 minutes so revocation/expiry can be tested without waiting.
#[cfg(debug_assertions)]
const ONLINE_CHECK_INTERVAL_SECS: u64 = 300; // 5 minutes in debug
#[cfg(not(debug_assertions))]
const ONLINE_CHECK_INTERVAL_SECS: u64 = 3600;

/// How many days between online validation attempts.
/// Persisted to encrypted disk storage so it survives restarts.
/// App launches within this window are fully offline — no HTTP, instant start.
///
/// Debug builds use 0 so every new process launch always hits the server.
#[cfg(debug_assertions)]
const ONLINE_CHECK_INTERVAL_DAYS: i64 = 0; // every launch checks in debug
#[cfg(not(debug_assertions))]
const ONLINE_CHECK_INTERVAL_DAYS: i64 = 7;

/// The authoritative licensing engine. Lives in [`AppState`] for the app lifetime.
pub struct LicenseEngine {
    /// Cached result of the last `check()` call.
    cache: RwLock<Option<LicenseCheckResult>>,
    /// When the cache was last populated.
    cache_time: RwLock<Option<Instant>>,
    /// When the last successful HTTP validation was performed.
    /// `None` means no online check has been done this session → check is always due.
    last_online_check: RwLock<Option<Instant>>,
    /// Application data directory (for secure storage and machine ID).
    app_data_dir: PathBuf,
}

mod operations;
mod verification;

impl LicenseEngine {
    /// Write a diagnostic line to `<app_data_dir>/lic_diag.log`.
    /// Always works in release builds — no reliance on tracing/log crates.
    pub fn diag(&self, msg: &str) {
        use std::io::Write as _;
        let path = self.app_data_dir.join("lic_diag.log");
        // Cap at 2 MB to avoid unbounded growth.
        if let Ok(m) = std::fs::metadata(&path) {
            if m.len() > 2 * 1024 * 1024 {
                let _ = std::fs::remove_file(&path);
            }
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
            let _ = writeln!(f, "[{}] [LIC-DIAG] {}", ts, msg);
        }
        // Also emit via tracing so it appears in tauri log plugin if configured.
        tracing::info!("[LIC-DIAG] {}", msg);
    }

    /// Create a new engine. Does NOT perform an initial check — call `check()` explicitly.
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            cache: RwLock::new(None),
            cache_time: RwLock::new(None),
            last_online_check: RwLock::new(None),
            app_data_dir,
        }
    }

    /// Returns `true` if a fresh HTTP validation against the license server is needed.
    ///
    /// Two-tier check:
    /// 1. **In-memory** (`Instant`): if an online check was done in this process
    ///    session within the last hour, skip immediately.
    /// 2. **Persistent** (encrypted disk): read the last-check date saved by
    ///    `save_secure_last_check`.  If it was saved within `ONLINE_CHECK_INTERVAL_DAYS`
    ///    (7 days), report not due — the app starts completely offline-first.
    ///
    /// This is the key mechanism that prevents an HTTP round-trip on every restart:
    /// after a successful online check, the app can be launched up to 7 days later
    /// without any network at all, showing the correct license status instantly.
    pub(super) async fn is_online_check_due(&self) -> bool {
        // Fast path: online check was done recently in this process session.
        if let Some(t) = *self.last_online_check.read().await {
            if t.elapsed().as_secs() < ONLINE_CHECK_INTERVAL_SECS {
                return false;
            }
        }

        // Persistent path: read last-check date from encrypted disk storage.
        // If within ONLINE_CHECK_INTERVAL_DAYS we can skip HTTP entirely.
        match get_secure_last_check(&self.app_data_dir) {
            Some(date_str) => {
                let last_date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
                    .ok()
                    .or_else(|| {
                        date_str
                            .get(..10)
                            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
                    });
                match last_date {
                    Some(d) => {
                        let days_since = (Utc::now().date_naive() - d).num_days();
                        // Negative means clock was rolled back — treat as due (clock tampering
                        // is caught separately by is_clock_tampered, but be safe here too).
                        days_since < 0 || days_since >= ONLINE_CHECK_INTERVAL_DAYS
                    }
                    None => true, // Unreadable date — must check
                }
            }
            // No persistent record → must check online.
            None => true,
        }
    }

    /// Record that an HTTP validation was just performed against the server.
    /// Suppresses further HTTP calls until `ONLINE_CHECK_INTERVAL_SECS` elapses.
    pub(super) async fn mark_online_check_done(&self) {
        *self.last_online_check.write().await = Some(Instant::now());
    }

    /// Get the cached result (if any). Returns `None` before the first `check()`.
    pub async fn cached(&self) -> Option<LicenseCheckResult> {
        self.cache.read().await.clone()
    }

    /// Whether the current cached status allows write operations (save, export).
    pub async fn can_write(&self) -> bool {
        match self.cached().await {
            Some(r) => matches!(
                r.status,
                LicenseStatus::Active | LicenseStatus::Grace | LicenseStatus::Demo
            ),
            None => false,
        }
    }

    pub(super) async fn set_cache(&self, result: LicenseCheckResult) {
        let mut cache = self.cache.write().await;
        *cache = Some(result);
        drop(cache);
        let mut t = self.cache_time.write().await;
        *t = Some(Instant::now());
    }

    /// Store a result in the cache **without** updating `cache_time`.
    ///
    /// Used by `check_local_startup` so that `licensing_get_status` can return
    /// a value immediately (fast startup path), while the background `check()`
    /// still sees a stale TTL and performs the full online validation.
    pub(super) async fn set_cache_value_only(&self, result: LicenseCheckResult) {
        let mut cache = self.cache.write().await;
        *cache = Some(result);
        // Intentionally NOT updating cache_time — the next check() call will
        // bypass the TTL fast-path and run the full online validation.
    }
}

// ── Free helpers (used by impl blocks in submodules) ───────────────────

pub(super) fn build_invalid(message: &str) -> LicenseCheckResult {
    LicenseCheckResult {
        status: LicenseStatus::Invalid,
        source: LicenseSource::Demo,
        features: expired_features(),
        key: None,
        license_type: None,
        customer_name: None,
        expires_at: None,
        days_remaining: None,
        experiments_remaining: None,
        message: Some(message.to_string()),
        show_warning: true,
    }
}

/// Mask a license key for display: "RHEO-ABCD-EFGH-1234" → "RHEO-****-****-1234"
pub(super) fn mask_key(key: &str) -> String {
    let parts: Vec<&str> = key.split('-').collect();
    if parts.len() >= 4 {
        let first = parts[0];
        let last = parts[parts.len() - 1];
        let middle: Vec<String> = parts[1..parts.len() - 1]
            .iter()
            .map(|p| "*".repeat(p.len()))
            .collect();
        format!("{}-{}-{}", first, middle.join("-"), last)
    } else if key.len() > 8 {
        let visible = 4;
        format!(
            "{}{}{}",
            &key[..visible],
            "*".repeat(key.len() - visible * 2),
            &key[key.len() - visible..]
        )
    } else {
        key.to_string()
    }
}

/// Parse an expiry date string (ISO 8601 or SQL datetime).
pub(super) fn parse_expiry(s: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.to_utc())
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                .map(|dt| dt.and_utc())
                .ok()
        })
        .or_else(|| {
            NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .ok()
                .and_then(|d| d.and_hms_opt(23, 59, 59))
                .map(|dt| dt.and_utc())
        })
}

/// Compute days remaining from an expiry date string.
pub(super) fn compute_days_remaining(expires_at: Option<&str>) -> Option<i64> {
    let exp_str = expires_at?;
    let expiry = parse_expiry(exp_str)?;
    Some((expiry.date_naive() - Utc::now().date_naive()).num_days())
}

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;
