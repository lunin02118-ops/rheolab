/**
 * RSA Key Generator for License Signing
 * 
 * Generates RSA keypair for license server
 * Run: npx ts-node scripts/generate-license-keys.ts
 */

import { generateKeyPairSync } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputDir = join(__dirname, '../keys');

// Generate RSA keypair
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
    },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
    }
});

// Ensure output directory exists
try {
    mkdirSync(outputDir, { recursive: true });
} catch { }

// Save keys
writeFileSync(join(outputDir, 'license_public.pem'), publicKey);
writeFileSync(join(outputDir, 'license_private.pem'), privateKey);

// Also export the public key as DER (binary) for embedding in the Rust binary via include_bytes!
// This avoids pem-rfc7468 CRLF-handling issues on Windows.
const { publicKey: pubKeyObj } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
import { createPublicKey } from 'crypto';
const pubDer = createPublicKey(publicKey).export({ type: 'spki', format: 'der' }) as Buffer;
writeFileSync(join(outputDir, 'license_public.der'), pubDer);

console.log('✅ RSA Keypair generated:');
console.log(`   Public key (PEM): keys/license_public.pem`);
console.log(`   Public key (DER): keys/license_public.der  ← commit this for Rust embed`);
console.log(`   Private key:      keys/license_private.pem`);
console.log('\n⚠️  IMPORTANT:');
console.log('   - Copy PRIVATE key to: license.vizbuka.ru (server only!)');
console.log('   - Commit license_public.der to repo (embedded in Rust binary via include_bytes!)');
console.log('   - Add /keys/ to .gitignore, but allow !src-tauri/keys/license_public.der');
console.log('\n📋 Public Key PEM:');
console.log(publicKey);
