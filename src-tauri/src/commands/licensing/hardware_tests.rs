use super::*;

#[test]
fn sanitize_filters_bogus() {
    assert_eq!(sanitize("To be filled by O.E.M."), None);
    assert_eq!(sanitize("0123456789ABCDEF"), None);
    assert_eq!(sanitize("00000000"), None);
    assert_eq!(sanitize("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"), None);
    assert_eq!(sanitize("ab"), None); // too short
    assert!(sanitize("BFEBFBFF000A0653").is_some());
}

#[test]
fn v2_id_deterministic() {
    let id1 = compute_v2_id("cpu123", "mobo456", "bios789");
    let id2 = compute_v2_id("cpu123", "mobo456", "bios789");
    assert_eq!(id1, id2);
    assert_eq!(id1.unwrap().len(), 32);
}

#[test]
fn v2_id_differs_from_v1() {
    // v1 used HW_SALT ("rheolab-hw-"), v2 uses HW_SALT_V2 ("rheolab-hw-v2-")
    let parts = vec!["cpu123", "mobo456", "bios789"];
    let combined = parts.join("|");

    let mut h1 = Sha256::new();
    h1.update(format!("{}{}", HW_SALT, combined));
    let r1 = format!("{:x}", h1.finalize())[..32].to_string();

    let v2 = compute_v2_id("cpu123", "mobo456", "bios789").unwrap();
    assert_ne!(r1, v2, "v2 ID must differ from v1 ID");
}

#[test]
fn cache_does_not_store_machine_id() {
    let tmp = std::env::temp_dir().join("rheolab_test_cache_v2");
    let _ = std::fs::create_dir_all(&tmp);
    let _ = std::fs::remove_file(tmp.join(CACHE_FILE));
    let _ = std::fs::remove_file(tmp.join(".machine_id_hw"));

    let id = get_or_create_machine_id(&tmp);
    assert!(!id.is_empty());
    assert_eq!(id.len(), 32);

    // S-4: Verify that the cache file on disk does NOT contain the machine ID.
    let cache_path = tmp.join(CACHE_FILE);
    if cache_path.exists() {
        let content = std::fs::read_to_string(&cache_path).unwrap();
        assert!(
            !content.contains(&id),
            "Cache file must NOT contain the machine ID (S-4 hardening)"
        );
        // Verify the file is the encrypted envelope format (v3 with nonce + ciphertext)
        let envelope: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(envelope["v"], 3u8, "Cache must use encrypted format v3");
        assert!(envelope["n"].is_string(), "Cache must have a nonce field");
        assert!(
            envelope["c"].is_string(),
            "Cache must have a ciphertext field"
        );
        // Verify the decrypted cache has the expected structure
        let decrypted = read_cache(&tmp).expect("Encrypted cache must be readable by read_cache");
        assert_eq!(decrypted.version, 2);
        assert!(!decrypted.components_hash.is_empty());
    }

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn machine_id_format() {
    let tmp = std::env::temp_dir().join("rheolab_test_machine_id_v2");
    let _ = std::fs::create_dir_all(&tmp);
    let _ = std::fs::remove_file(tmp.join(CACHE_FILE));
    let _ = std::fs::remove_file(tmp.join(".machine_id_hw"));
    let id = get_or_create_machine_id(&tmp);
    assert!(!id.is_empty());
    let _ = std::fs::remove_dir_all(&tmp);
}
