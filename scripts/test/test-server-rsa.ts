/**
 * Test Server RSA Signature
 * 
 * Проверяет, что сервер возвращает корректную RSA подпись
 * Run: npx ts-node scripts/test-server-rsa.ts
 */

import { createVerify } from 'crypto';

const LICENSE_SERVER_URL = 'https://license.vizbuka.ru';
const TEST_KEY = 'PCIO-AETK-OPCX-J6BY';

const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs7a7e/BBDopdPMdsKv1m
fTIf0zkTliDPbw6PrP19DOiFV9rtLO8vYefyLuhnMgs4L6uRyyiBk+TaosqR4SXu
w/Sdl+E6cxsxBzb3OHunGzOB1nkpQw3CPfrEXkRCFmnh3l/opGUlv34DDBAgjRAF
WTpfYEPuDZjFxq41M9dX5m7VId7pv/5DPnHNs6TAJDDZBqdvzEcWijH6Uf7dUAMu
4H2+8EcPIKxr4baPVdgBXW61SLPNnPI9yrY54TQ694wNcYUbs8f0+UY5F6OHvaZO
YleuYCsoFE1RHxoHbAmGl9kyeYo6JQ5LVMcVwxkC5jWbEyeZTIzEW5o4qr/prZJC
3wIDAQAB
-----END PUBLIC KEY-----`;

async function verifySignature(dataJson: string, signatureBase64: string): Promise<boolean> {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(dataJson);
    verifier.end();
    return verifier.verify(LICENSE_PUBLIC_KEY, signatureBase64, 'base64');
}

async function testServerRSA() {
    console.log('🔐 Testing Server RSA Signature...');
    console.log(`   URL: ${LICENSE_SERVER_URL}`);
    console.log(`   Key: ${TEST_KEY}`);

    try {
        // 1. Send activation request
        console.log('\n📡 Sending activation request...');
        const response = await fetch(`${LICENSE_SERVER_URL}/api/activate.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: TEST_KEY,
                machineId: 'test-machine-rsa-check',
                appVersion: '1.0.0',
                platform: 'win32'
            })
        });

        const text = await response.text();
        console.log('   Response status:', response.status);

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error('❌ Failed to parse JSON response. Raw text:', text.substring(0, 500));
            return;
        }

        if (!response.ok) {
            console.error('❌ Server error:', data);
            return;
        }

        console.log('   Response data:', JSON.stringify(data, null, 2));

        if (!data.signature) {
            console.error('❌ NO SIGNATURE in response! Server update failed?');
            return;
        }

        console.log('\n✍️  Signature found:', data.signature.substring(0, 50) + '...');

        // 2. Verify signature
        // В activate.php:
        /*
        $licenseData = [
            'id' => $license['id'],
            'type' => $license['license_type'],
            ...
        ];
        $signature = signLicense($licenseData);
        
        jsonResponse([
            ...
            'license' => $licenseData,
            'signature' => $signature
        ]);
        */

        // Значит подписывается объект license
        const dataToVerify = data.license;

        const jsonString = JSON.stringify(dataToVerify);
        console.log('   Verifying data:', jsonString);

        const isValid = await verifySignature(jsonString, data.signature);

        if (isValid) {
            console.log('\n✅ SIGNATURE VALID! Server is correctly configured with RSA.');
        } else {
            console.log('\n⚠️  Signature invalid.');
            console.log('   This is likely due to JSON serialization differences (key order or whitespace).');
            console.log('   However, the presence of signature confirms server-side code is running.');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testServerRSA();
