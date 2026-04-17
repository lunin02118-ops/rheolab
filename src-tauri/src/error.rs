//! Structured error types for all Tauri command domains.
//!
//! `AppError` replaces the legacy `Result<T, String>` pattern.
//! All variants implement `thiserror::Error` for automatic `Display` / `std::error::Error`.
//! `serde::Serialize` encodes the error as a JSON object `{kind, message}`
//! so the frontend can branch on the `kind` field instead of fragile
//! string-prefix matching.  A backward-compatible adapter in
//! `src/lib/tauri/errors.ts` handles both the new object format and the
//! legacy plain-string format during the transition period.
//!
//! Usage:
//! ```rust,ignore
//! use crate::error::{AppError, Result};
//! fn my_command(state: State<'_, AppState>) -> Result<Vec<Foo>> {
//!     let conn = state.pool_conn()?;          // Pool error → AppError::Pool
//!     let rows = conn.prepare("SELECT …")?;   // SQL → AppError::Sql
//!     Ok(rows)
//! }
//! ```

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Connection-pool exhaustion / timeout.
    #[error("Database pool error: {0}")]
    Pool(#[from] r2d2::Error),

    /// rusqlite query / prepare / execute failure.
    #[error("SQL error: {0}")]
    Sql(#[from] rusqlite::Error),

    /// File-system operations.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// tokio `spawn_blocking` join failure.
    #[error("Task join error: {0}")]
    Join(#[from] tokio::task::JoinError),

    /// JSON serialisation / deserialisation.
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// HTTP client errors (reqwest).
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    /// Caller supplied invalid arguments.
    #[error("Bad request: {0}")]
    BadRequest(String),

    /// Licensing / capability gate rejection.
    #[error("License error: {0}")]
    License(String),

    /// Parser / analysis failures.
    #[error("Parse error: {0}")]
    Parse(String),

    /// Catch-all — for legacy migration compatibility.
    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// Machine-readable variant tag, matching `TauriErrorKind` on the TS side.
    fn kind_str(&self) -> &'static str {
        match self {
            Self::Pool(_) => "Pool",
            Self::Sql(_) => "Sql",
            Self::Io(_) => "Io",
            Self::Join(_) => "Join",
            Self::Serde(_) => "Serde",
            Self::Http(_) => "Http",
            Self::BadRequest(_) => "BadRequest",
            Self::License(_) => "License",
            Self::Parse(_) => "Parse",
            Self::Other(_) => "Other",
        }
    }

    /// User-safe error message for IPC responses.
    ///
    /// Infrastructure variants return generic strings that do not expose
    /// internal details (SQL query text, file paths, panic messages, etc.).
    /// Domain variants (BadRequest, License, Parse) pass their message through
    /// unchanged because those strings are deliberately user-visible.
    fn safe_message(&self) -> &str {
        match self {
            Self::Pool(_) => "Database temporarily unavailable",
            Self::Sql(_) => "Database error",
            Self::Io(_) => "File operation failed",
            Self::Join(_) => "Internal processing error",
            Self::Serde(_) => "Data format error",
            Self::Http(_) => "Network error",
            Self::Other(_) => "Internal error",
            // Domain errors — their messages are intentionally user-visible.
            Self::BadRequest(msg) | Self::License(msg) | Self::Parse(msg) => msg.as_str(),
        }
    }
}

/// Make `AppError` usable as a Tauri command error.
/// Serialises as `{"kind": "…", "message": "…"}` so the frontend can branch
/// on the `kind` field directly instead of doing string-prefix matching.
///
/// Note: `tracing::error!` is emitted here so that every error returned from
/// a Tauri IPC command is automatically recorded in the application log.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        tracing::error!(error = %self, "IPC command error");
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind_str())?;
        st.serialize_field("message", self.safe_message())?;
        st.end()
    }
}

/// Convert a bare `String` into an `AppError::Other`.
/// Enables `some_string_result?` in functions returning `Result<_, AppError>`.
impl From<String> for AppError {
    fn from(s: String) -> Self {
        Self::Other(s)
    }
}

/// Convert a string literal into `AppError::Other`.
impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        Self::Other(s.to_owned())
    }
}

/// Project-wide result alias — mirrors `std::io::Result` conventions.
pub type Result<T> = std::result::Result<T, AppError>;
