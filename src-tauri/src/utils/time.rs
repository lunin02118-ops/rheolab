//! Centralised time helpers — single source of truth for timestamps.
//!
//! Keeping one implementation avoids the silent drift that accumulated
//! before (`now_rfc3339` was copy-pasted across five modules; one call site
//! used a different `%Y-%m-%dT%H:%M:%S%.3fZ` format which created hard-to-
//! trace inconsistencies in downstream consumers).
//!
//! All new code should use [`now_rfc3339`] — use anything else only when
//! you have a concrete reason and document it on the call site.

use chrono::Utc;

/// Current UTC instant formatted as an RFC 3339 / ISO 8601 string.
///
/// Example output: `2025-04-22T23:50:12.345678900+00:00`.
///
/// This matches the format used by the SQLite `datetime('now')` default
/// for existing schema columns (`createdAt`, `updatedAt`) so new code can
/// be mixed with rows written by DDL defaults without reformatting.
#[inline]
pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_rfc3339_is_parsable_iso8601() {
        let s = now_rfc3339();
        chrono::DateTime::parse_from_rfc3339(&s)
            .expect("now_rfc3339 must return a parsable RFC 3339 string");
    }

    #[test]
    fn now_rfc3339_is_monotonic_ish_between_calls() {
        // Not strictly monotonic in wall-clock APIs, but two consecutive
        // calls on the same thread should not jump backwards.
        let a = chrono::DateTime::parse_from_rfc3339(&now_rfc3339()).unwrap();
        let b = chrono::DateTime::parse_from_rfc3339(&now_rfc3339()).unwrap();
        assert!(b >= a, "clock must not travel backwards between calls");
    }
}
