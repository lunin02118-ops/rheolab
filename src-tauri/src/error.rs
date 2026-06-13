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
//! Serialization is intentionally side-effect free. IPC error logging belongs
//! at command boundaries via [`log_ipc_error`], where command/request metadata
//! can be attached and messages are redacted through [`AppError::safe_message`].
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
    pub fn kind_str(&self) -> &'static str {
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
    pub fn safe_message(&self) -> &str {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IpcErrorLogFields<'a> {
    pub command: &'static str,
    pub request_id: &'a str,
    pub kind: &'static str,
    pub message: &'a str,
}

pub fn ipc_error_log_fields<'a>(
    command: &'static str,
    err: &'a AppError,
    request_id: Option<&'a str>,
) -> IpcErrorLogFields<'a> {
    IpcErrorLogFields {
        command,
        request_id: request_id.unwrap_or("unknown"),
        kind: err.kind_str(),
        message: err.safe_message(),
    }
}

pub fn log_ipc_error(command: &'static str, err: &AppError, request_id: Option<&str>) {
    let fields = ipc_error_log_fields(command, err, request_id);
    tracing::error!(
        command = fields.command,
        request_id = fields.request_id,
        kind = fields.kind,
        message = fields.message,
        "IPC command failed"
    );
}

/// Make `AppError` usable as a Tauri command error.
/// Serialises as `{"kind": "…", "message": "…"}` so the frontend can branch
/// on the `kind` field directly instead of doing string-prefix matching.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
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

#[cfg(test)]
mod tests {
    use super::{ipc_error_log_fields, log_ipc_error, AppError};
    use serde_json::json;
    use std::io;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    struct CountingSubscriber {
        events: Arc<AtomicUsize>,
    }

    impl CountingSubscriber {
        fn new(events: Arc<AtomicUsize>) -> Self {
            Self { events }
        }
    }

    impl tracing::Subscriber for CountingSubscriber {
        fn enabled(&self, _metadata: &tracing::Metadata<'_>) -> bool {
            true
        }

        fn new_span(&self, _span: &tracing::span::Attributes<'_>) -> tracing::span::Id {
            tracing::span::Id::from_u64(1)
        }

        fn record(&self, _span: &tracing::span::Id, _values: &tracing::span::Record<'_>) {}

        fn record_follows_from(&self, _span: &tracing::span::Id, _follows: &tracing::span::Id) {}

        fn event(&self, _event: &tracing::Event<'_>) {
            self.events.fetch_add(1, Ordering::SeqCst);
        }

        fn enter(&self, _span: &tracing::span::Id) {}

        fn exit(&self, _span: &tracing::span::Id) {}

        fn register_callsite(
            &self,
            _metadata: &'static tracing::Metadata<'static>,
        ) -> tracing::subscriber::Interest {
            tracing::subscriber::Interest::always()
        }
    }

    #[test]
    fn other_error_serializes_generic_message() {
        let value = serde_json::to_value(AppError::Other(
            "internal path C:\\Users\\secret\\rheolab.db".into(),
        ))
        .expect("serialize AppError");

        assert_eq!(value["kind"], json!("Other"));
        assert_eq!(value["message"], json!("Internal error"));
    }

    #[test]
    fn domain_errors_keep_user_visible_message() {
        let value = serde_json::to_value(AppError::BadRequest("Неверный файл".into()))
            .expect("serialize AppError");

        assert_eq!(value["kind"], json!("BadRequest"));
        assert_eq!(value["message"], json!("Неверный файл"));
    }

    #[test]
    fn infrastructure_errors_use_redacted_safe_messages() {
        let error = AppError::Io(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "C:\\Users\\secret\\rheolab.db",
        ));

        assert_eq!(error.kind_str(), "Io");
        assert_eq!(error.safe_message(), "File operation failed");

        let value = serde_json::to_value(&error).expect("serialize AppError");
        assert_eq!(value["kind"], json!("Io"));
        assert_eq!(value["message"], json!("File operation failed"));
        assert!(!value.to_string().contains("secret"));
    }

    #[test]
    fn ipc_log_fields_use_safe_message_not_display() {
        let error = AppError::Other("raw internal path C:\\Users\\secret\\db.sqlite".into());
        let fields = ipc_error_log_fields("backup_restore", &error, Some("req-42"));

        assert_eq!(fields.command, "backup_restore");
        assert_eq!(fields.request_id, "req-42");
        assert_eq!(fields.kind, "Other");
        assert_eq!(fields.message, "Internal error");
        assert!(!format!("{fields:?}").contains("secret"));
    }

    #[test]
    fn ipc_log_fields_default_request_id_is_unknown() {
        let error = AppError::Sql(rusqlite::Error::InvalidQuery);
        let fields = ipc_error_log_fields("experiments_list", &error, None);

        assert_eq!(fields.request_id, "unknown");
        assert_eq!(fields.kind, "Sql");
        assert_eq!(fields.message, "Database error");
    }

    #[test]
    fn serializing_app_error_does_not_emit_tracing_event() {
        let events = Arc::new(AtomicUsize::new(0));
        let subscriber = CountingSubscriber::new(Arc::clone(&events));

        tracing::subscriber::with_default(subscriber, || {
            let value =
                serde_json::to_value(AppError::Other("raw internal secret".into())).unwrap();
            assert_eq!(value["message"], json!("Internal error"));
        });

        assert_eq!(events.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn log_ipc_error_emits_tracing_event() {
        let events = Arc::new(AtomicUsize::new(0));
        let subscriber = CountingSubscriber::new(Arc::clone(&events));
        let error = AppError::Other("raw internal secret".into());

        tracing::subscriber::with_default(subscriber, || {
            log_ipc_error("experiments_save", &error, Some("req-7"));
        });

        assert_eq!(events.load(Ordering::SeqCst), 1);
    }
}
