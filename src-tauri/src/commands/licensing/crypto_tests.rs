use super::*;

#[test]
fn hex_roundtrip() {
    let data = b"hello world";
    let encoded = hex::encode(data);
    assert_eq!(encoded, "68656c6c6f20776f726c64");
    let decoded = hex::decode(&encoded).unwrap();
    assert_eq!(decoded, data);
}

#[test]
fn hmac_sign_verify() {
    // Uses DEFAULT_INTEGRITY_KEY (no env-var override needed)
    let value = r#"{"firstLaunchDate":"2026-01-01","experimentsCount":5}"#;
    let sig = sign_data(value);
    assert!(verify_signature(value, &sig));
    assert!(!verify_signature("tampered-value", &sig));
}

// ── RSA server-signature verification tests (F-07 / P2-3 group S) ──

/// Helper: sign data with the dev private key (counterpart of the embedded public key).
/// Uses PKCS#1 v1.5 + SHA-256, matching the PHP `openssl_sign()` algorithm.
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

#[test]
fn rsa_verify_valid_signature() {
    let payload = r#"{"id":42,"type":"standard","customerName":"Test","expiresAt":"2027-01-01"}"#;
    let sig = sign_with_dev_private_key(payload.as_bytes());
    assert!(
        verify_server_signature(payload, &sig),
        "Valid RSA signature should pass verification"
    );
}

#[test]
fn rsa_verify_tampered_payload_fails() {
    let original = r#"{"id":42,"type":"standard","customerName":"Test","expiresAt":"2027-01-01"}"#;
    let sig = sign_with_dev_private_key(original.as_bytes());
    // Tamper the payload
    let tampered = r#"{"id":42,"type":"enterprise","customerName":"Test","expiresAt":"2099-01-01"}"#;
    assert!(
        !verify_server_signature(tampered, &sig),
        "Tampered payload should fail RSA verification"
    );
}

#[test]
fn rsa_verify_bad_base64_fails() {
    let payload = r#"{"id":1}"#;
    assert!(
        !verify_server_signature(payload, "not-valid-base64!!!"),
        "Invalid Base64 should fail gracefully"
    );
}

#[test]
fn rsa_verify_wrong_key_fails() {
    // Use a known-bad 256-byte signature (RSA-2048 signatures are 256 bytes).
    // Any signature not produced by the embedded dev key must fail verification.
    // Avoids generating an ephemeral RSA key (rand 0.9 ↔ rsa 0.9 rand_core conflict).
    use base64::Engine;
    let bad_sig_b64 = base64::engine::general_purpose::STANDARD.encode([0u8; 256]);
    let payload = r#"{"id":99}"#;

    assert!(
        !verify_server_signature(payload, &bad_sig_b64),
        "Signature from a different key should fail"
    );
}

#[test]
fn rsa_verify_empty_inputs() {
    assert!(!verify_server_signature("", ""));
    assert!(!verify_server_signature("data", ""));
}

// ── HMAC tamper-resistance regression tests (P2-3 group S) ─────────

#[test]
fn hmac_constant_time_comparison() {
    // Verify that a wrong-length signature is rejected (early return path)
    let value = "test";
    let sig = sign_data(value);
    assert!(!verify_signature(value, &sig[..sig.len() - 1])); // shorter
    assert!(!verify_signature(value, &format!("{}0", sig))); // longer
}

#[test]
fn system_state_hmac_roundtrip() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE SystemState (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            signature TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );"
    ).unwrap();

    let value = r#"{"license":"data","expiresAt":"2027-01-01"}"#;
    upsert_system_state(&conn, "test_key", value).unwrap();

    let (stored_val, stored_sig) = get_system_state(&conn, "test_key")
        .unwrap()
        .expect("should exist");
    assert_eq!(stored_val, value);
    assert!(verify_signature(&stored_val, &stored_sig));
}

#[test]
fn system_state_tamper_detected() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE SystemState (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            signature TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );"
    ).unwrap();

    upsert_system_state(&conn, "test_key", r#"{"valid":true}"#).unwrap();

    // Tamper with the value directly in DB (bypassing HMAC)
    conn.execute(
        "UPDATE SystemState SET value = '{\"valid\":false,\"type\":\"enterprise\"}' WHERE key = 'test_key'",
        [],
    ).unwrap();

    let (tampered_val, original_sig) = get_system_state(&conn, "test_key")
        .unwrap()
        .expect("should exist");
    assert!(
        !verify_signature(&tampered_val, &original_sig),
        "Tampered SystemState value must fail HMAC verification"
    );
}
