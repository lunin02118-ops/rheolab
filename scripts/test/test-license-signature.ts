/**
 * Test RSA License Signing
 * 
 * Проверяет что подпись и верификация работают корректно
 * Run: npx ts-node scripts/test-license-signature.ts
 */

import { createSign, createVerify } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load keys
const privateKeyPath = join(__dirname, '../keys/license_private.pem');
const publicKeyPath = join(__dirname, '../keys/license_public.pem');

console.log('🔐 Testing RSA License Signing\n');

try {
    const privateKey = readFileSync(privateKeyPath, 'utf8');
    const publicKey = readFileSync(publicKeyPath, 'utf8');

    console.log('✅ Keys loaded');

    // Test license data
    const licenseData = {
        id: 'LIC-TEST-001',
        type: 'standard',
        customerName: 'Тестовый Пользователь',
        email: 'test@example.com',
        machineId: 'abc123def456',
        expiresAt: '2025-12-31T23:59:59Z',
        features: {
            exportPdf: true,
            exportExcel: true,
            aiParsing: true,
            comparison: true
        }
    };

    const dataJson = JSON.stringify(licenseData);
    console.log('\n📄 License Data:');
    console.log(dataJson);

    // Sign the data (simulating server)
    const signer = createSign('RSA-SHA256');
    signer.update(dataJson);
    signer.end();
    const signature = signer.sign(privateKey, 'base64');

    console.log('\n✍️  Signature (base64):');
    console.log(signature.substring(0, 50) + '...');

    // Verify the signature (simulating client)
    const verifier = createVerify('RSA-SHA256');
    verifier.update(dataJson);
    verifier.end();
    const isValid = verifier.verify(publicKey, signature, 'base64');

    if (isValid) {
        console.log('\n✅ SIGNATURE VALID - License is authentic!');
    } else {
        console.log('\n❌ SIGNATURE INVALID - License may be tampered!');
    }

    // Test tampering detection
    console.log('\n🔬 Testing tamper detection...');
    const tamperedData = { ...licenseData, expiresAt: '2099-12-31T23:59:59Z' };
    const tamperedJson = JSON.stringify(tamperedData);

    const verifier2 = createVerify('RSA-SHA256');
    verifier2.update(tamperedJson);
    verifier2.end();
    const isTamperedValid = verifier2.verify(publicKey, signature, 'base64');

    if (!isTamperedValid) {
        console.log('✅ TAMPERED DATA DETECTED - Signature mismatch!');
    } else {
        console.log('❌ ERROR - Tampered data was not detected!');
    }

    console.log('\n🎉 All tests passed!');
    console.log('\n📋 Next steps:');
    console.log('   1. Copy keys/license_private.pem to license.vizbuka.ru/keys/');
    console.log('   2. Copy server/sign_license.php to license.vizbuka.ru/');
    console.log('   3. Update activate.php to use signLicense()');

} catch (error) {
    console.error('❌ Error:', error);
}
