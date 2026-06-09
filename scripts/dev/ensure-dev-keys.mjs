/**
 * Ensure the development RSA keypair used by `#[cfg(test)]` builds exists.
 *
 * `src-tauri/src/commands/licensing/crypto.rs` embeds `keys/dev_public.der`
 * (SPKI DER) in test builds, and the licensing tests sign payloads with
 * `keys/dev_private.der` (PKCS#8 DER). Both files are intentionally gitignored
 * (they are throwaway, test-only keys), so `cargo test` — and CI's
 * `export_ts_bindings` check — fails with "couldn't read .../dev_public.der"
 * on a fresh checkout unless they are generated first.
 *
 * This generator is idempotent: it does nothing if both files already exist,
 * so it is safe to run on every build and from any platform (pure Node, no
 * external tools). The tests sign AND verify with this same pair, so any valid
 * RSA-2048 keypair works.
 *
 * Run: node scripts/dev/ensure-dev-keys.mjs
 */
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keysDir = join(here, '..', '..', 'src-tauri', 'keys');
const privPath = join(keysDir, 'dev_private.der');
const pubPath = join(keysDir, 'dev_public.der');

if (existsSync(privPath) && existsSync(pubPath)) {
  console.log('dev keys already present — skipping generation');
  process.exit(0);
}

mkdirSync(keysDir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  // from_pkcs8_der (rsa::pkcs8::DecodePrivateKey) expects PKCS#8 DER.
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  // from_public_key_der (rsa::pkcs8::DecodePublicKey) expects SPKI DER.
  publicKeyEncoding: { type: 'spki', format: 'der' },
});

writeFileSync(privPath, privateKey);
writeFileSync(pubPath, publicKey);
console.log(`generated ${privPath}`);
console.log(`generated ${pubPath}`);
