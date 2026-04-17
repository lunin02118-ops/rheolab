#!/usr/bin/env python3
"""Add full payload+signature logging to load_verified_license."""
import re

path = "src-tauri/src/commands/licensing/engine/verification.rs"
with open(path, encoding="utf-8") as f:
    content = f.read()

# Add full payload/sig logging before the RSA check
old = '                self.diag(&format!("serverSignature length: {} chars", server_sig.len()));\n\n                if !verify_server_signature(payload, server_sig) {'
new = '                self.diag(&format!("serverSignature length: {} chars", server_sig.len()));\n                self.diag(&format!("signedPayload FULL: {:?}", payload));\n                self.diag(&format!("serverSignature FULL: {:?}", server_sig));\n\n                if !verify_server_signature(payload, server_sig) {'

if old in content:
    content = content.replace(old, new, 1)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("verification.rs: DONE")
else:
    idx = content.find("serverSignature length:")
    print(f"Pattern not found. Context at 'serverSignature length':")
    print(repr(content[idx:idx+300]))
