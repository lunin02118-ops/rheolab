#!/usr/bin/env python3
"""
Read signedPayload and serverSignature from rheolab.db and verify RSA.
Uses Python's sqlite3 + cryptography library.
"""
import sqlite3
import json
import base64
import os
import sys

# Paths
appdata = os.environ.get("APPDATA", "")
db_path = os.path.join(appdata, "com.rheolab.enterprise", "rheolab.db")

if not os.path.exists(db_path):
    print(f"DB not found: {db_path}")
    sys.exit(1)

print(f"Reading DB: {db_path}")

# Read system_state
conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
rows = conn.execute("SELECT key, value FROM SystemState").fetchall()
conn.close()

lic_record = None
for key, value in rows:
    if key == "lic_license":
        lic_record = json.loads(value)
        break

if not lic_record:
    print("No lic_license found in SystemState")
    sys.exit(1)

signed_payload = lic_record.get("signedPayload", "")
server_sig = lic_record.get("serverSignature", "")

print(f"signedPayload ({len(signed_payload)} chars): {signed_payload!r}")
print(f"serverSignature ({len(server_sig)} chars): {server_sig!r}")

# Decode signature
sig_bytes = base64.b64decode(server_sig)
print(f"sig_bytes length: {len(sig_bytes)}")

# Verify RSA
try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend

    pub_key_pem = open("src-tauri/keys/license_public.pem", "rb").read()
    pub_key = serialization.load_pem_public_key(pub_key_pem, backend=default_backend())
    
    pub_key.verify(
        sig_bytes,
        signed_payload.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256()
    )
    print("RSA VERIFIED OK!")
except ImportError:
    print("cryptography library not installed, trying openssl CLI...")
    # Write payload and sig to temp files for openssl verification
    with open("_tmp_payload.txt", "w", encoding="utf-8") as f:
        f.write(signed_payload)
    with open("_tmp_sig.bin", "wb") as f:
        f.write(sig_bytes)
    print(f"Files written: _tmp_payload.txt ({len(signed_payload)} bytes), _tmp_sig.bin ({len(sig_bytes)} bytes)")
    print("Run: openssl dgst -sha256 -verify src-tauri/keys/license_public.pem -signature _tmp_sig.bin _tmp_payload.txt")
except Exception as e:
    print(f"RSA FAILED: {type(e).__name__}: {e}")
    # Also try with URL-safe base64
    try:
        sig_bytes2 = base64.b64decode(server_sig.replace("-", "+").replace("_", "/") + "==")
        pub_key.verify(sig_bytes2, signed_payload.encode("utf-8"), padding.PKCS1v15(), hashes.SHA256())
        print("RSA VERIFIED with URL-safe base64!")
    except Exception as e2:
        print(f"Also failed with URL-safe: {e2}")
