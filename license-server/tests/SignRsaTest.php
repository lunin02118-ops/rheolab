<?php
/**
 * SignRsaTest — unit tests for includes/sign_rsa.php (via helpers.php)
 *
 * Uses the dev keypair at src-tauri/keys/ which is also used by Rust unit
 * tests, so any mismatch between PHP signing and Rust verification will
 * surface here too.
 */

use PHPUnit\Framework\TestCase;

class SignRsaTest extends TestCase
{
    private static string $publicKeyPath;
    private static bool $keysAvailable = false;

    public static function setUpBeforeClass(): void
    {
        self::$publicKeyPath  = __DIR__ . '/../../src-tauri/keys/dev_public.pem';
        self::$keysAvailable  = file_exists(self::$publicKeyPath)
                                && file_exists(PRIVATE_KEY_PATH);
    }

    private function requireKeys(): void
    {
        if (!self::$keysAvailable) {
            $this->markTestSkipped('Dev keypair not found — skipping RSA tests');
        }
    }

    // ── signLicenseRSA structure ───────────────────────────────────────────

    public function test_sign_returns_required_keys(): void
    {
        $this->requireKeys();
        $result = signLicenseRSA(['id' => 1, 'type' => 'trial']);
        $this->assertArrayHasKey('signature', $result);
        $this->assertArrayHasKey('signedPayload', $result);
        $this->assertArrayHasKey('data', $result);
    }

    public function test_signed_payload_is_valid_json(): void
    {
        $this->requireKeys();
        $data   = ['id' => 42, 'type' => 'developer', 'expiresAt' => '2030-01-01'];
        $result = signLicenseRSA($data);

        $decoded = json_decode($result['signedPayload'], true);
        $this->assertIsArray($decoded, 'signedPayload must decode to an array');
        $this->assertSame($data['id'], $decoded['id']);
        $this->assertSame($data['type'], $decoded['type']);
    }

    public function test_signature_is_base64_encoded(): void
    {
        $this->requireKeys();
        $result = signLicenseRSA(['id' => 1]);
        $decoded = base64_decode($result['signature'], true);
        $this->assertNotFalse($decoded, 'signature must be valid base64');
        $this->assertGreaterThan(0, strlen($decoded));
    }

    public function test_data_field_matches_input(): void
    {
        $this->requireKeys();
        $input  = ['id' => 7, 'type' => 'trial', 'customerName' => 'Acme Corp'];
        $result = signLicenseRSA($input);
        $this->assertSame($input, $result['data']);
    }

    // ── Signature verification with the dev public key ────────────────────

    public function test_signature_verifies_with_dev_public_key(): void
    {
        $this->requireKeys();
        $data   = ['id' => 1, 'type' => 'trial', 'expiresAt' => '2030-12-31'];
        $result = signLicenseRSA($data);

        $pubKey         = openssl_pkey_get_public(file_get_contents(self::$publicKeyPath));
        $rawSignature   = base64_decode($result['signature']);
        $verifyResult   = openssl_verify($result['signedPayload'], $rawSignature, $pubKey, OPENSSL_ALGO_SHA256);

        $this->assertSame(1, $verifyResult, 'Signature must verify against the dev public key');
    }

    public function test_tampered_payload_fails_verification(): void
    {
        $this->requireKeys();
        $data   = ['id' => 1, 'type' => 'trial'];
        $result = signLicenseRSA($data);

        // Tamper: change type to 'developer' in the payload
        $tampered  = str_replace('"trial"', '"developer"', $result['signedPayload']);
        $pubKey    = openssl_pkey_get_public(file_get_contents(self::$publicKeyPath));
        $rawSig    = base64_decode($result['signature']);
        $verifyResult = openssl_verify($tampered, $rawSig, $pubKey, OPENSSL_ALGO_SHA256);

        $this->assertSame(0, $verifyResult, 'Tampered payload must NOT verify');
    }

    public function test_wrong_signature_fails_verification(): void
    {
        $this->requireKeys();
        $data   = ['id' => 1, 'type' => 'trial'];
        $result = signLicenseRSA($data);

        // Corrupt the signature by flipping the last few bytes
        $rawSig    = base64_decode($result['signature']);
        $rawSig[-1] = chr(ord($rawSig[-1]) ^ 0xFF);  // flip bits in last byte
        $pubKey    = openssl_pkey_get_public(file_get_contents(self::$publicKeyPath));
        $verifyResult = openssl_verify($result['signedPayload'], $rawSig, $pubKey, OPENSSL_ALGO_SHA256);

        $this->assertSame(0, $verifyResult, 'Corrupted signature must NOT verify');
    }

    // ── signLicense wrapper ────────────────────────────────────────────────

    public function test_sign_license_wrapper_returns_same_result(): void
    {
        $this->requireKeys();
        $data   = ['id' => 99, 'type' => 'trial'];
        $via    = signLicense($data);           // high-level wrapper in helpers.php
        $direct = signLicenseRSA($data);

        // Both must produce validly-structured results (signatures differ per call)
        $this->assertArrayHasKey('signature', $via);
        $this->assertArrayHasKey('signedPayload', $via);

        // signedPayload is deterministic for same input (JSON encode is stable)
        $this->assertSame($direct['signedPayload'], $via['signedPayload']);
    }

    // ── Unicode / special character handling ──────────────────────────────

    public function test_unicode_customer_name_round_trips_correctly(): void
    {
        $this->requireKeys();
        $data   = ['id' => 5, 'customerName' => 'Виталий Тест', 'type' => 'trial'];
        $result = signLicenseRSA($data);

        $decoded = json_decode($result['signedPayload'], true);
        $this->assertSame('Виталий Тест', $decoded['customerName']);

        // Must still verify
        $pubKey     = openssl_pkey_get_public(file_get_contents(self::$publicKeyPath));
        $verifyRes  = openssl_verify(
            $result['signedPayload'],
            base64_decode($result['signature']),
            $pubKey,
            OPENSSL_ALGO_SHA256
        );
        $this->assertSame(1, $verifyRes);
    }
}
