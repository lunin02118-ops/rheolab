#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Demo (trial) license logic — checking and initialising the 30-day demo period.
//!
//! Reads and writes the HMAC-protected `demo_state_v4` key in SystemState.

use crate::error::Result;
use chrono::{NaiveDate, Utc};
use serde_json;

use super::crypto::{get_system_state, upsert_system_state, verify_signature};

/// Parse a date string loosely: try "%Y-%m-%d" first, then take first 10 chars.
fn parse_date_loose(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok().or_else(|| {
        s.get(..10)
            .and_then(|sub| NaiveDate::parse_from_str(sub, "%Y-%m-%d").ok())
    })
}
use super::features::{demo_features, expired_features};
use super::types::{
    DemoState, LicenseCheckResult, LicenseSource, LicenseStatus, DB_KEY_DEMO, DEMO_MAX_DAYS,
    DEMO_MAX_EXPERIMENTS,
};

/// Check the demo state and return a [`LicenseCheckResult`].
///
/// `server_anchor` is the `first_seen_at` date returned by `register_demo.php`.
/// When provided it acts as a tamper-resistant anchor:
/// - If the server date is **earlier** than the stored `first_launch_date`
///   (e.g. after a DB wipe + reinstall) the local state is corrected so that
///   the 30-day clock continues from the original start, not from zero.
/// - The anchor is persisted inside the HMAC-protected demo state so that
///   even purely offline runs respect it once it has been synced at least once.
///
/// Pass `None` for synchronous call sites that cannot reach the network
/// (startup local-check, license gate, demo counter).
pub(super) fn check_demo(
    conn: &rusqlite::Connection,
    server_anchor: Option<&str>,
) -> LicenseCheckResult {
    let demo = match load_demo_state(conn) {
        Some(d) => d,
        None => {
            // First launch — initialise demo state, using server anchor if available.
            let state = create_initial_demo_state(server_anchor);
            if let Err(e) = save_demo_state(conn, &state) {
                tracing::error!("Failed to save initial demo state: {}", e);
            }
            let days_rem = DEMO_MAX_DAYS
                - (Utc::now().date_naive()
                    - parse_date_loose(&state.first_launch_date)
                        .unwrap_or_else(|| Utc::now().date_naive()))
                .num_days();
            return build_demo_result(
                LicenseStatus::Demo,
                &state,
                Some(days_rem.max(0)),
                Some(DEMO_MAX_EXPERIMENTS - state.experiments_count),
            );
        }
    };

    let today = Utc::now().date_naive();

    // Parse first launch date
    let mut first_launch = match parse_date_loose(&demo.first_launch_date) {
        Some(d) => d,
        None => {
            tracing::warn!(
                "Unparseable demo first_launch_date: {}",
                demo.first_launch_date
            );
            return build_expired_demo("Ошибка данных демо-периода");
        }
    };

    // ── Server anchor correction ───────────────────────────────────────
    // If the server reports an earlier first-seen date (e.g. after a DB wipe),
    // trust the server and update local state accordingly.
    let anchor_date = server_anchor.and_then(parse_date_loose);
    let mut corrected_first_launch: Option<String> = None;
    let mut new_server_anchor: Option<String> = None;

    if let Some(anchor) = anchor_date {
        if anchor <= today {
            if anchor < first_launch {
                // Server has an earlier date → the local counter was reset.
                // Correct it so the 30-day clock continues from the real start.
                tracing::info!(
                    "Demo anchor correction: local first_launch={} → server first_seen={}",
                    first_launch,
                    anchor
                );
                first_launch = anchor;
                corrected_first_launch = Some(anchor.format("%Y-%m-%d").to_string());
            }
            // Always persist the anchor for future offline runs.
            if demo.server_first_seen_at.as_deref() != server_anchor {
                new_server_anchor = server_anchor.map(|s| s.to_string());
            }
        }
    }

    // Clock tamper check: if last_run_date > today, clock was rolled back
    if let Some(ref last_run) = demo.last_run_date {
        if let Some(last) = parse_date_loose(last_run) {
            if today < last {
                tracing::warn!(
                    "Clock tampering detected in demo: today {} < last_run {}",
                    today,
                    last
                );
                return build_expired_demo("Обнаружена манипуляция с системными часами");
            }
        }
    }

    // Days elapsed since first launch
    let days_elapsed = (today - first_launch).num_days();
    let days_remaining = DEMO_MAX_DAYS - days_elapsed;
    let experiments_remaining = DEMO_MAX_EXPERIMENTS - demo.experiments_count;

    // Check limits
    if days_elapsed >= DEMO_MAX_DAYS {
        return build_expired_demo(&format!("Демо-период ({} дней) истёк", DEMO_MAX_DAYS));
    }

    if demo.experiments_count >= DEMO_MAX_EXPERIMENTS {
        return build_expired_demo(&format!(
            "Использовано максимум экспериментов ({})",
            DEMO_MAX_EXPERIMENTS
        ));
    }

    // Update last_run_date (and anchor fields if changed)
    let mut updated = DemoState {
        first_launch_date: corrected_first_launch.unwrap_or_else(|| demo.first_launch_date.clone()),
        server_first_seen_at: new_server_anchor.or_else(|| demo.server_first_seen_at.clone()),
        last_run_date: demo.last_run_date.clone(),
        experiments_count: demo.experiments_count,
        max_days: demo.max_days,
        max_experiments: demo.max_experiments,
    };
    updated.last_run_date = Some(today.format("%Y-%m-%d").to_string());
    if let Err(e) = save_demo_state(conn, &updated) {
        tracing::error!("Failed to update demo last_run_date: {}", e);
    }

    // Active demo
    let show_warning = days_remaining <= 7 || experiments_remaining <= 3;
    let message = format!(
        "Демо-версия: осталось {} дней, {} экспериментов",
        days_remaining.max(0),
        experiments_remaining.max(0),
    );

    LicenseCheckResult {
        status: LicenseStatus::Demo,
        source: LicenseSource::Demo,
        features: demo_features(),
        key: None,
        license_type: Some("demo".to_string()),
        customer_name: None,
        expires_at: Some(
            (first_launch + chrono::Duration::days(DEMO_MAX_DAYS))
                .format("%Y-%m-%d")
                .to_string(),
        ),
        days_remaining: Some(days_remaining),
        experiments_remaining: Some(experiments_remaining),
        message: Some(message),
        show_warning,
    }
}

/// Increment the demo experiment count (called when saving an experiment).
pub(super) fn increment_demo_experiments(conn: &rusqlite::Connection) -> Result<()> {
    if let Some(mut demo) = load_demo_state(conn) {
        demo.experiments_count += 1;
        save_demo_state(conn, &demo)
    } else {
        Err("No demo state found".into())
    }
}

// ── Internal helpers ───────────────────────────────────────────────────

fn load_demo_state(conn: &rusqlite::Connection) -> Option<DemoState> {
    let (value, signature) = get_system_state(conn, DB_KEY_DEMO).ok()??;
    if !verify_signature(&value, &signature) {
        tracing::warn!("Demo state HMAC verification failed — treating as missing");
        return None;
    }
    serde_json::from_str(&value).ok()
}

fn save_demo_state(conn: &rusqlite::Connection, state: &DemoState) -> Result<()> {
    let value = serde_json::to_string(state).map_err(|e| e.to_string())?;
    upsert_system_state(conn, DB_KEY_DEMO, &value)
}

fn create_initial_demo_state(server_anchor: Option<&str>) -> DemoState {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    // Use server anchor as first_launch if it's a valid past-or-present date.
    // This handles the case where a user reinstalled and the server already has
    // a first_seen_at that is earlier than today.
    let anchor_valid = server_anchor
        .and_then(parse_date_loose)
        .filter(|&d| d <= Utc::now().date_naive());
    let first_launch_date = anchor_valid
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| today.clone());
    DemoState {
        first_launch_date,
        server_first_seen_at: server_anchor.map(|s| s.to_string()),
        last_run_date: Some(today),
        experiments_count: 0,
        max_days: DEMO_MAX_DAYS,
        max_experiments: DEMO_MAX_EXPERIMENTS,
    }
}

fn build_demo_result(
    status: LicenseStatus,
    _state: &DemoState,
    days_remaining: Option<i64>,
    experiments_remaining: Option<i64>,
) -> LicenseCheckResult {
    LicenseCheckResult {
        status,
        source: LicenseSource::Demo,
        features: demo_features(),
        key: None,
        license_type: Some("demo".to_string()),
        customer_name: None,
        expires_at: None,
        days_remaining,
        experiments_remaining,
        message: None,
        show_warning: false,
    }
}

fn build_expired_demo(message: &str) -> LicenseCheckResult {
    LicenseCheckResult {
        status: LicenseStatus::DemoExpired,
        source: LicenseSource::Demo,
        features: expired_features(),
        key: None,
        license_type: Some("demo".to_string()),
        customer_name: None,
        expires_at: None,
        days_remaining: Some(0),
        experiments_remaining: Some(0),
        message: Some(message.to_string()),
        show_warning: true,
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS SystemState (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                signature TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn first_launch_creates_demo() {
        let conn = setup_test_db();
        let result = check_demo(&conn, None);
        assert_eq!(result.status, LicenseStatus::Demo);
        assert_eq!(result.source, LicenseSource::Demo);
        assert!(result.days_remaining.unwrap() > 0);
    }

    #[test]
    fn expired_demo_state() {
        let conn = setup_test_db();

        // Manually insert an expired demo state (started 31 days ago)
        let old_date = (Utc::now().date_naive() - chrono::Duration::days(31))
            .format("%Y-%m-%d")
            .to_string();
        let state = DemoState {
            first_launch_date: old_date,
            server_first_seen_at: None,
            last_run_date: None,
            experiments_count: 0,
            max_days: DEMO_MAX_DAYS,
            max_experiments: DEMO_MAX_EXPERIMENTS,
        };
        save_demo_state(&conn, &state).unwrap();

        let result = check_demo(&conn, None);
        assert_eq!(result.status, LicenseStatus::DemoExpired);
    }

    #[test]
    fn experiment_limit_reached() {
        let conn = setup_test_db();

        let state = DemoState {
            first_launch_date: Utc::now().format("%Y-%m-%d").to_string(),
            server_first_seen_at: None,
            last_run_date: None,
            experiments_count: DEMO_MAX_EXPERIMENTS,
            max_days: DEMO_MAX_DAYS,
            max_experiments: DEMO_MAX_EXPERIMENTS,
        };
        save_demo_state(&conn, &state).unwrap();

        let result = check_demo(&conn, None);
        assert_eq!(result.status, LicenseStatus::DemoExpired);
    }
}
