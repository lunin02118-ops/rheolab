#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Types, constants, and startup key assertion for the licensing module.

use hmac::Hmac;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

// ── Type aliases ───────────────────────────────────────────────────────

pub(super) type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;
pub(super) type HmacSha256 = Hmac<Sha256>;

/// Development sentinel value — used to detect builds that forgot to set the production key.
const DEV_INTEGRITY_KEY: &str = "rheolab-dev-integrity-key-32chars!";
const DEV_BETA_CHANNEL_KEY: &str = "rheolab-beta-channel-dev-key-000";

/// Production integrity key embedded at **compile time** via `INTEGRITY_SECRET_KEY` env var.
///
/// Set the env var before building:
///   `$env:INTEGRITY_SECRET_KEY = "your-prod-secret"; npm run tauri:build`
///
/// Falls back to the dev sentinel if the env var is not set (dev/test only).
/// Runtime env var override is still respected — allows key rotation without rebuild.
pub(super) const DEFAULT_INTEGRITY_KEY: &str =
    match option_env!("INTEGRITY_SECRET_KEY") {
        Some(k) => k,
        None => DEV_INTEGRITY_KEY,
    };

/// Key used to sign and verify time-bounded beta update-channel tokens.
/// Set `BETA_CHANNEL_SECRET` env var at build time; falls back to dev sentinel.
pub(super) const BETA_CHANNEL_KEY: &str =
    match option_env!("BETA_CHANNEL_SECRET") {
        Some(k) => k,
        None => DEV_BETA_CHANNEL_KEY,
    };

pub(super) const STORAGE_SALT: &str = "rheolab-storage-salt";
pub(super) const HW_SALT: &str = "rheolab-hw-";

pub(super) const DB_KEY_DEMO: &str = "demo_state_v4";
pub(super) const DB_KEY_LICENSE: &str = "license_data_v1";
pub(super) const DB_KEY_WAS_LICENSED: &str = "was_licensed_v1";

pub(super) const LICENSE_SERVER_URL: &str = "https://license.vizbuka.ru";
pub(super) const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(target_os = "windows")]
pub(super) const POWERSHELL_PATH: &str =
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

pub(super) const LOCAL_USER_ID: &str = "desktop-local-admin";

// ── License engine constants ───────────────────────────────────────────

/// Maximum demo trial duration in days
pub(super) const DEMO_MAX_DAYS: i64 = 30;
/// Maximum experiments allowed in demo mode
pub(super) const DEMO_MAX_EXPERIMENTS: i64 = 10;
/// Maximum days allowed offline before requiring re-validation
pub(super) const MAX_OFFLINE_DAYS: i64 = 30;
/// Default grace period after license expiry (days)
pub(super) const DEFAULT_GRACE_PERIOD_DAYS: i64 = 30;

// ── License engine types ───────────────────────────────────────────────

/// Authoritative license status determined entirely in Rust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum LicenseStatus {
    /// Full license is active and valid
    Active,
    /// License expired but within grace period
    Grace,
    /// Demo trial is active
    Demo,
    /// Demo trial has expired
    DemoExpired,
    /// License has expired (past grace period)
    Expired,
    /// License is invalid / tampered / revoked
    Invalid,
    /// License was revoked by the server
    Revoked,
}

impl std::fmt::Display for LicenseStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LicenseStatus::Active => write!(f, "active"),
            LicenseStatus::Grace => write!(f, "grace"),
            LicenseStatus::Demo => write!(f, "demo"),
            LicenseStatus::DemoExpired => write!(f, "demo_expired"),
            LicenseStatus::Expired => write!(f, "expired"),
            LicenseStatus::Invalid => write!(f, "invalid"),
            LicenseStatus::Revoked => write!(f, "revoked"),
        }
    }
}

/// Where the license came from
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum LicenseSource {
    Key,
    Demo,
}

/// License type (matches server-side types)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum LicenseType {
    Demo,
    Trial,
    Standard,
    Enterprise,
    Developer,
}

impl LicenseType {
    pub fn from_str_loose(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "demo" => LicenseType::Demo,
            "trial" => LicenseType::Trial,
            "enterprise" => LicenseType::Enterprise,
            "developer" => LicenseType::Developer,
            _ => LicenseType::Standard,
        }
    }
}

/// Feature flags determining what the user can do.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LicenseFeatures {
    pub max_experiments: i64,
    pub max_comparison_experiments: i64,
    pub export_pdf: bool,
    pub export_excel: bool,
    pub ai_parsing: bool,
    pub comparison: bool,
    pub watermark: bool,
    pub calibration_analysis: bool,
    pub calibration_parsing: bool,
    pub chandler5550_support: bool,
    pub bsl_r1_support: bool,
}

/// The authoritative result of a license check, computed in Rust.
/// Sent to the frontend as a single atomic snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LicenseCheckResult {
    pub status: LicenseStatus,
    pub source: LicenseSource,
    pub features: LicenseFeatures,

    /// License key (masked for display, e.g. "RHEO-****-****-ABCD")
    pub key: Option<String>,
    /// License type string from server
    pub license_type: Option<String>,
    /// Customer name from license
    pub customer_name: Option<String>,
    /// License expiry date (ISO 8601)
    pub expires_at: Option<String>,
    /// Days remaining until expiry (negative = past due)
    pub days_remaining: Option<i64>,
    /// Experiments remaining (demo mode only)
    pub experiments_remaining: Option<i64>,
    /// Human-readable message
    pub message: Option<String>,
    /// Whether the UI should show a warning banner
    pub show_warning: bool,
}

// ── Startup key assertion ──────────────────────────────────────────────

/// Called once at startup.
///
/// **Release builds**: panics if the binary was compiled without setting
/// `INTEGRITY_SECRET_KEY` and `BETA_CHANNEL_SECRET` at build time
/// (i.e. still uses the dev sentinel keys). This prevents accidentally
/// shipping dev secrets to customers.
///
/// **Debug builds**: silently continues with defaults so that `cargo test` and
/// local dev builds work without extra env setup.
///
/// # End-user deployment
/// The key is embedded **at compile time** — end users do NOT need to set any
/// environment variables.  Build with:
///   `$env:INTEGRITY_SECRET_KEY = "your-prod-secret"; npm run tauri:build`
pub fn assert_production_keys() {
    #[cfg(not(debug_assertions))]
    {
        if DEFAULT_INTEGRITY_KEY == DEV_INTEGRITY_KEY {
            panic!(
                "[licensing] FATAL: production binary compiled with dev integrity key.\n\
                 Set INTEGRITY_SECRET_KEY before building:\n\
                 $env:INTEGRITY_SECRET_KEY = 'your-prod-secret'; npm run tauri:build"
            );
        }
        if BETA_CHANNEL_KEY == DEV_BETA_CHANNEL_KEY {
            panic!(
                "[licensing] FATAL: production binary compiled with dev beta-channel key.\n\
                 Set BETA_CHANNEL_SECRET before building:\n\
                 $env:BETA_CHANNEL_SECRET = 'your-prod-secret'; npm run tauri:build"
            );
        }
    }
}

// ── Response / domain types ────────────────────────────────────────────

/// Internal demo state — used by demo.rs engine module.
#[derive(Debug, Serialize, Deserialize, specta::Type)]
#[specta(export = false)]
#[serde(rename_all = "camelCase")]
pub struct DemoState {
    pub first_launch_date: String,
    /// Server-anchored first-seen date, obtained from register_demo.php.
    /// Once set this is HMAC-protected alongside the rest of the state and
    /// acts as a tamper-resistant backup: if the local DB is wiped the server
    /// anchor is re-fetched on the next online check and corrects first_launch_date.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_first_seen_at: Option<String>,
    pub last_run_date: Option<String>,
    pub experiments_count: i64,
    pub max_days: i64,
    pub max_experiments: i64,
}

#[derive(Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SimpleResult {
    pub success: bool,
    pub message: Option<String>,
    pub error: Option<String>,
    pub deleted_count: Option<i64>,
}
