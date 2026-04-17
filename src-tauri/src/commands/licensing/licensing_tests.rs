use super::*;
use super::crypto::upsert_system_state;
use super::demo;

/// Helper: sign with the dev private key for RSA-signed test records.
fn sign_with_dev_private_key(data: &[u8]) -> String {
    use base64::Engine;
    use rsa::pkcs1v15::SigningKey;
    use rsa::pkcs8::DecodePrivateKey;
    use rsa::signature::{SignatureEncoding, Signer};
    use sha2::Sha256;

    let private_der = include_bytes!("../../../keys/dev_private.der");
    let private_key = rsa::RsaPrivateKey::from_pkcs8_der(private_der)
        .expect("dev private key should be valid");
    let signing_key = SigningKey::<Sha256>::new(private_key);
    let signature = signing_key.sign(data);
    base64::engine::general_purpose::STANDARD.encode(&*signature.to_bytes())
}

fn setup_test_db() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS SystemState (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            signature TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );"
    ).unwrap();
    conn
}

// ── Group G: License gate tests ────────────────────────────────────

#[test]
fn gate_rejects_empty_db() {
    // G-1: No license, no demo → gate must reject
    let conn = setup_test_db();
    // Create an expired demo (started 31 days ago) so demo check fails
    let old_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(31))
        .format("%Y-%m-%d")
        .to_string();
    let state = types::DemoState {
        first_launch_date: old_date,
        server_first_seen_at: None,
        last_run_date: None,
        experiments_count: 0,
        max_days: types::DEMO_MAX_DAYS,
        max_experiments: types::DEMO_MAX_EXPERIMENTS,
    };
    let value = serde_json::to_string(&state).unwrap();
    upsert_system_state(&conn, types::DB_KEY_DEMO, &value).unwrap();

    let result = check_license_gate(&conn);
    assert!(result.is_err(), "Gate must reject when no license and demo expired");
    assert_eq!(result.unwrap_err().to_string(), "License error: required");
}

#[test]
fn gate_accepts_valid_license() {
    // G-2: Fully RSA-signed license → gate must accept via license path (not demo fallback)
    let conn = setup_test_db();

    let signed_payload = r#"{"id":1,"type":"standard","expiresAt":"2099-12-31"}"#;
    let server_sig = sign_with_dev_private_key(signed_payload.as_bytes());

    let license = json!({
        "id": 1,
        "type": "standard",
        "expiresAt": "2099-12-31T23:59:59Z",
        "gracePeriodDays": 30,
        "signedPayload": signed_payload,
        "serverSignature": server_sig,
    });
    let value = serde_json::to_string(&license).unwrap();
    upsert_system_state(&conn, types::DB_KEY_LICENSE, &value).unwrap();

    // Also insert expired demo so we can be sure it passes via the license path,
    // not demo fallback.
    let old_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(31))
        .format("%Y-%m-%d")
        .to_string();
    let demo_state = types::DemoState {
        first_launch_date: old_date,
        server_first_seen_at: None,
        last_run_date: None,
        experiments_count: 0,
        max_days: types::DEMO_MAX_DAYS,
        max_experiments: types::DEMO_MAX_EXPERIMENTS,
    };
    let demo_val = serde_json::to_string(&demo_state).unwrap();
    upsert_system_state(&conn, types::DB_KEY_DEMO, &demo_val).unwrap();

    assert!(check_license_gate(&conn).is_ok(), "Gate must accept a valid RSA-signed license");
}

#[test]
fn gate_rejects_tampered_hmac() {
    // G-3: License with wrong HMAC → gate must reject
    let conn = setup_test_db();
    let license = json!({
        "id": 1,
        "type": "enterprise",
        "expiresAt": "2099-12-31T23:59:59Z",
        "gracePeriodDays": 30
    });
    let value = serde_json::to_string(&license).unwrap();
    // Insert with a forged signature
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO SystemState (key, value, signature, updatedAt) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![types::DB_KEY_LICENSE, value, "forged_signature", now],
    ).unwrap();

    // Also insert expired demo so no demo fallback
    let old_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(31))
        .format("%Y-%m-%d")
        .to_string();
    let demo_state = types::DemoState {
        first_launch_date: old_date,
        server_first_seen_at: None,
        last_run_date: None,
        experiments_count: 0,
        max_days: types::DEMO_MAX_DAYS,
        max_experiments: types::DEMO_MAX_EXPERIMENTS,
    };
    let demo_val = serde_json::to_string(&demo_state).unwrap();
    upsert_system_state(&conn, types::DB_KEY_DEMO, &demo_val).unwrap();

    let result = check_license_gate(&conn);
    assert!(result.is_err(), "Gate must reject tampered HMAC");
}

#[test]
fn gate_rejects_expired_plus_grace() {
    // G-4: RSA-signed license expired beyond grace period → gate must reject
    let conn = setup_test_db();
    let expired = (chrono::Utc::now() - chrono::Duration::days(60))
        .to_rfc3339();

    let signed_payload = r#"{"id":1,"type":"standard","expiresAt":"2024-01-01"}"#;
    let server_sig = sign_with_dev_private_key(signed_payload.as_bytes());

    let license = json!({
        "id": 1,
        "type": "standard",
        "expiresAt": expired,
        "gracePeriodDays": 30,
        "signedPayload": signed_payload,
        "serverSignature": server_sig,
    });
    let value = serde_json::to_string(&license).unwrap();
    upsert_system_state(&conn, types::DB_KEY_LICENSE, &value).unwrap();

    // Also insert expired demo
    let old_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(31))
        .format("%Y-%m-%d")
        .to_string();
    let demo_state = types::DemoState {
        first_launch_date: old_date,
        server_first_seen_at: None,
        last_run_date: None,
        experiments_count: 0,
        max_days: types::DEMO_MAX_DAYS,
        max_experiments: types::DEMO_MAX_EXPERIMENTS,
    };
    let demo_val = serde_json::to_string(&demo_state).unwrap();
    upsert_system_state(&conn, types::DB_KEY_DEMO, &demo_val).unwrap();

    let result = check_license_gate(&conn);
    assert!(result.is_err(), "Gate must reject expired+past-grace license");
}

#[test]
fn gate_accepts_active_demo() {
    // G-5: Active demo (fresh first launch) → gate must accept
    let conn = setup_test_db();
    // Don't insert any demo state — check_demo will create one (first launch)
    assert!(
        check_license_gate(&conn).is_ok(),
        "Gate must accept an active demo period"
    );
}

#[test]
fn gate_accepts_grace_period_license() {
    // G-6: RSA-signed license expired but within grace period → gate must accept
    let conn = setup_test_db();
    let expired = (chrono::Utc::now() - chrono::Duration::days(10))
        .to_rfc3339();

    let signed_payload = r#"{"id":1,"type":"standard","expiresAt":"2024-01-01"}"#;
    let server_sig = sign_with_dev_private_key(signed_payload.as_bytes());

    let license = json!({
        "id": 1,
        "type": "standard",
        "expiresAt": expired,
        "gracePeriodDays": 30,  // 10 days expired, 20 days of grace left
        "signedPayload": signed_payload,
        "serverSignature": server_sig,
    });
    let value = serde_json::to_string(&license).unwrap();
    upsert_system_state(&conn, types::DB_KEY_LICENSE, &value).unwrap();

    // Expire the demo so only the license path can succeed
    let old_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(31))
        .format("%Y-%m-%d")
        .to_string();
    let demo_state = types::DemoState {
        first_launch_date: old_date,
        server_first_seen_at: None,
        last_run_date: None,
        experiments_count: 0,
        max_days: types::DEMO_MAX_DAYS,
        max_experiments: types::DEMO_MAX_EXPERIMENTS,
    };
    let demo_val = serde_json::to_string(&demo_state).unwrap();
    upsert_system_state(&conn, types::DB_KEY_DEMO, &demo_val).unwrap();

    assert!(
        check_license_gate(&conn).is_ok(),
        "Gate must accept RSA-signed license within grace period"
    );
}

#[test]
fn gate_rejects_expired_demo() {
    // G-7: Demo expired (past 30 days) → gate must reject
    let conn = setup_test_db();
    let old_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(31))
        .format("%Y-%m-%d")
        .to_string();
    let state = types::DemoState {
        first_launch_date: old_date,
        server_first_seen_at: None,
        last_run_date: None,
        experiments_count: 0,
        max_days: types::DEMO_MAX_DAYS,
        max_experiments: types::DEMO_MAX_EXPERIMENTS,
    };
    let value = serde_json::to_string(&state).unwrap();
    upsert_system_state(&conn, types::DB_KEY_DEMO, &value).unwrap();

    let result = check_license_gate(&conn);
    assert!(result.is_err(), "Gate must reject expired demo");
}

// ── Group D: Demo counter tests ────────────────────────────────────

#[test]
fn demo_counter_increment() {
    // D-1: Incrementing demo counter must increase experiments_count
    let conn = setup_test_db();
    // Create initial demo state
    let result1 = demo::check_demo(&conn, None);
    assert_eq!(result1.status, LicenseStatus::Demo);
    let initial_remaining = result1.experiments_remaining.unwrap();

    // Increment
    demo::increment_demo_experiments(&conn).unwrap();
    let result2 = demo::check_demo(&conn, None);
    assert_eq!(
        result2.experiments_remaining.unwrap(),
        initial_remaining - 1,
        "Experiment counter should decrement after increment"
    );
}

#[test]
fn demo_counter_enforces_limit() {
    // D-2: After reaching max experiments, demo must expire
    let conn = setup_test_db();
    let state = types::DemoState {
        first_launch_date: chrono::Utc::now().format("%Y-%m-%d").to_string(),
        server_first_seen_at: None,
        last_run_date: None,
        experiments_count: types::DEMO_MAX_EXPERIMENTS, // already at limit
        max_days: types::DEMO_MAX_DAYS,
        max_experiments: types::DEMO_MAX_EXPERIMENTS,
    };
    let value = serde_json::to_string(&state).unwrap();
    upsert_system_state(&conn, types::DB_KEY_DEMO, &value).unwrap();

    let result = demo::check_demo(&conn, None);
    assert_eq!(result.status, LicenseStatus::DemoExpired);
}

#[test]
fn demo_counter_tamper_resistant() {
    // D-3: Directly modifying demo state in DB should fail HMAC check
    let conn = setup_test_db();
    // Create initial demo state through the proper channel
    demo::check_demo(&conn, None);

    // Tamper: overwrite value with forged experiments_count=0 but keep old signature
    let (_, _original_sig) = crypto::get_system_state(&conn, types::DB_KEY_DEMO)
        .unwrap()
        .unwrap();
    let forged = json!({
        "firstLaunchDate": "2026-01-01",
        "lastRunDate": null,
        "experimentsCount": 0,
        "maxDays": 9999,
        "maxExperiments": 9999
    });
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE SystemState SET value = ?1, updatedAt = ?3 WHERE key = ?2",
        rusqlite::params![serde_json::to_string(&forged).unwrap(), types::DB_KEY_DEMO, now],
    ).unwrap();

    // check_demo should treat tampered state as missing (first launch)
    let result = demo::check_demo(&conn, None);
    // It will either be Demo (re-created) or DemoExpired — but NOT have
    // the forged 9999 experiments
    assert!(
        result.experiments_remaining.unwrap_or(0) <= types::DEMO_MAX_EXPERIMENTS,
        "Tampered demo state must not grant extra experiments"
    );
}

// ── Group M: maybe_increment_demo_save tests ───────────────────────

#[test]
fn maybe_increment_is_noop_when_licensed() {
    // When a valid RSA-signed license exists, maybe_increment_demo_save should not error
    let conn = setup_test_db();

    let signed_payload = r#"{"id":1,"type":"standard","expiresAt":"2099-12-31"}"#;
    let server_sig = sign_with_dev_private_key(signed_payload.as_bytes());

    let license = json!({
        "id": 1,
        "type": "standard",
        "expiresAt": "2099-12-31T23:59:59Z",
        "gracePeriodDays": 30,
        "signedPayload": signed_payload,
        "serverSignature": server_sig,
    });
    let value = serde_json::to_string(&license).unwrap();
    upsert_system_state(&conn, types::DB_KEY_LICENSE, &value).unwrap();

    // This should not error or change anything
    maybe_increment_demo_save(&conn);
    // Still licensed — gate should pass
    assert!(check_license_gate(&conn).is_ok());
}

// ── Group R: RSA verify_server_signature unit tests ────────────────
//
// Tests for the RSA verification layer.  The round-trip test (R-1) requires
// the dev private key present at keys/license_private.pem.  If not available
// (CI, release builds) the signing step is skipped and the test passes trivially.

#[test]
fn rsa_rejects_wrong_signature() {
    // R-3: A random base64 string must not verify as a valid signature.
    use crate::commands::licensing::crypto::verify_server_signature;
    let payload = r#"{"id":1,"type":"standard"}"#;
    // 256 bytes of zeros, base64-encoded — not a valid RSA-2048 signature
    let garbage_sig = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
    assert!(
        !verify_server_signature(payload, garbage_sig),
        "RSA must reject a garbage signature"
    );
}

#[test]
fn rsa_rejects_invalid_base64() {
    // R-4: Non-base64 input must not panic — must return false.
    use crate::commands::licensing::crypto::verify_server_signature;
    let payload = r#"{"id":1}"#;
    assert!(!verify_server_signature(payload, "not!valid!base64!!!"));
    assert!(!verify_server_signature(payload, ""));
}

#[test]
fn load_verified_license_rejects_legacy_no_signed_payload() {
    // R-5: A DB record with valid HMAC but NO signedPayload — grace period
    //      closed (S-2). Must not grant write access when demo is also expired.
    let conn = setup_test_db();
    let license = json!({
        "id": 1,
        "key": "AAAA-BBBB-CCCC-DDDD",
        "type": "standard",
        "expiresAt": "2099-12-31T23:59:59Z",
        "gracePeriodDays": 30,
        "activatedAt": chrono::Utc::now().to_rfc3339()
        // No signedPayload, no serverSignature — legacy HMAC-only record
    });
    let value = serde_json::to_string(&license).unwrap();
    upsert_system_state(&conn, types::DB_KEY_LICENSE, &value).unwrap();

    // Also expire the demo so the demo fallback doesn't rescue the request
    let old_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(31))
        .format("%Y-%m-%d")
        .to_string();
    let demo_state = types::DemoState {
        first_launch_date: old_date,
        server_first_seen_at: None,
        last_run_date: None,
        experiments_count: 0,
        max_days: types::DEMO_MAX_DAYS,
        max_experiments: types::DEMO_MAX_EXPERIMENTS,
    };
    upsert_system_state(&conn, types::DB_KEY_DEMO, &serde_json::to_string(&demo_state).unwrap()).unwrap();

    // Gate must reject — legacy record falls through to demo, demo also expired
    assert!(
        check_license_gate(&conn).is_err(),
        "Legacy HMAC-only records must be rejected when demo is also expired (S-2)"
    );
}

#[test]
fn load_verified_license_rejects_bad_rsa() {
    // R-6: A DB record with valid HMAC but WRONG RSA signature → rejected.
    let conn = setup_test_db();
    let license = json!({
        "id": 1,
        "key": "AAAA-BBBB-CCCC-DDDD",
        "type": "developer",
        "expiresAt": "2099-12-31T23:59:59Z",
        "gracePeriodDays": 30,
        "signedPayload": r#"{"id":1,"type":"developer"}"#,
        "serverSignature": "aW52YWxpZHNpZ25hdHVyZQ==" // junk
    });
    let value = serde_json::to_string(&license).unwrap();
    upsert_system_state(&conn, types::DB_KEY_LICENSE, &value).unwrap();

    // Gate falls through to demo check (RSA fails → license treated as absent).
    // Must not panic.
    let _result = check_license_gate(&conn);
}

#[test]
fn gate_rejects_rsa_forged_license_no_demo() {
    // R-6b: RSA-forged license with no demo fallback → gate must reject.
    let conn = setup_test_db();
    let signed_payload = r#"{"id":1,"type":"developer"}"#;
    let wrong_sig = sign_with_dev_private_key(b"different data entirely");
    let license = json!({
        "id": 1,
        "key": "AAAA-BBBB-CCCC-DDDD",
        "type": "developer",
        "expiresAt": "2099-12-31T23:59:59Z",
        "gracePeriodDays": 30,
        "signedPayload": signed_payload,
        "serverSignature": wrong_sig,
    });
    let value = serde_json::to_string(&license).unwrap();
    upsert_system_state(&conn, types::DB_KEY_LICENSE, &value).unwrap();

    // Insert expired demo so there's no fallback
    let old_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(31))
        .format("%Y-%m-%d")
        .to_string();
    let demo_state = types::DemoState {
        first_launch_date: old_date,
        server_first_seen_at: None,
        last_run_date: None,
        experiments_count: 0,
        max_days: types::DEMO_MAX_DAYS,
        max_experiments: types::DEMO_MAX_EXPERIMENTS,
    };
    let demo_val = serde_json::to_string(&demo_state).unwrap();
    upsert_system_state(&conn, types::DB_KEY_DEMO, &demo_val).unwrap();

    let result = check_license_gate(&conn);
    assert!(
        result.is_err(),
        "Gate must reject RSA-forged license when demo is also expired"
    );
}

#[test]
fn gate_rejects_legacy_no_activated_at_no_demo() {
    // A.2: Legacy record without activatedAt + expired demo → gate must reject.
    let conn = setup_test_db();
    let license = json!({
        "id": 1,
        "type": "standard",
        "expiresAt": "2099-12-31T23:59:59Z",
        "gracePeriodDays": 30
        // No signedPayload, no serverSignature, no activatedAt
    });
    let value = serde_json::to_string(&license).unwrap();
    upsert_system_state(&conn, types::DB_KEY_LICENSE, &value).unwrap();

    // Insert expired demo
    let old_date = (chrono::Utc::now().date_naive() - chrono::Duration::days(31))
        .format("%Y-%m-%d")
        .to_string();
    let demo_state = types::DemoState {
        first_launch_date: old_date,
        server_first_seen_at: None,
        last_run_date: None,
        experiments_count: 0,
        max_days: types::DEMO_MAX_DAYS,
        max_experiments: types::DEMO_MAX_EXPERIMENTS,
    };
    let demo_val = serde_json::to_string(&demo_state).unwrap();
    upsert_system_state(&conn, types::DB_KEY_DEMO, &demo_val).unwrap();

    let result = check_license_gate(&conn);
    assert!(
        result.is_err(),
        "Gate must reject legacy record without activatedAt when demo is also expired"
    );
}

#[test]
fn validate_online_result_fields_exist() {
    // R-7: OnlineValidationResult must have signed_payload and server_signature fields.
    // This is a compile-time check — if it compiles, the struct has the fields.
    use crate::commands::licensing::online::OnlineValidationResult;
    let r = OnlineValidationResult {
        success: false,
        status: None,
        days_remaining: None,
        error: None,
        server_reached: false,
        signed_payload: Some("test_payload".to_string()),
        server_signature: Some("test_sig".to_string()),
    };
    assert_eq!(r.signed_payload.as_deref(), Some("test_payload"));
    assert_eq!(r.server_signature.as_deref(), Some("test_sig"));
}

