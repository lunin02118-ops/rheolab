<?php
/**
 * HelpersTest — unit tests for includes/helpers.php
 *
 * Tests cover pure PHP functions that have no database or HTTP dependency.
 */

use PHPUnit\Framework\TestCase;

class HelpersTest extends TestCase
{
    // ── isValidKeyFormat ──────────────────────────────────────────────────

    /** @dataProvider validKeyProvider */
    public function test_valid_key_format_accepted(string $key): void
    {
        $this->assertTrue(isValidKeyFormat($key), "Expected '$key' to be valid");
    }

    public static function validKeyProvider(): array
    {
        return [
            'standard uppercase letters'   => ['RHEO-ABCD-EFGH-1234'],
            'all digits'                   => ['1234-5678-9012-3456'],
            'mixed alphanumeric'           => ['A1B2-C3D4-E5F6-G7H8'],
            'all letters'                  => ['AAAA-BBBB-CCCC-DDDD'],
            // isValidKeyFormat() calls strtoupper(), so lowercase is accepted
            'lowercase letters'            => ['rheo-abcd-efgh-1234'],
        ];
    }

    /** @dataProvider invalidKeyProvider */
    public function test_invalid_key_format_rejected(string $key): void
    {
        $this->assertFalse(isValidKeyFormat($key), "Expected '$key' to be invalid");
    }

    public static function invalidKeyProvider(): array
    {
        return [
            'too short'              => ['RHEO-ABCD'],
            'no dashes'              => ['RHEOABCDEFGH1234'],
            'wrong segment length'   => ['RHE-ABCD-EFGH-1234'],
            'special characters'     => ['RHEO-AB!D-EFGH-1234'],
            'five segments'          => ['RHEO-ABCD-EFGH-1234-XXXX'],
            'empty string'           => [''],
            'spaces'                 => ['RHEO ABCD EFGH 1234'],
        ];
    }

    // ── generateLicenseKey ────────────────────────────────────────────────

    public function test_generated_key_passes_format_check(): void
    {
        for ($i = 0; $i < 10; $i++) {
            $key = generateLicenseKey();
            $this->assertTrue(
                isValidKeyFormat($key),
                "Generated key '$key' must pass format validation"
            );
        }
    }

    public function test_generated_key_has_correct_length(): void
    {
        $key = generateLicenseKey();
        // XXXX-XXXX-XXXX-XXXX = 4 × 4 chars + 3 dashes = 19 chars
        $this->assertSame(19, strlen($key));
    }

    public function test_generated_keys_are_unique(): void
    {
        $keys = [];
        for ($i = 0; $i < 50; $i++) {
            $keys[] = generateLicenseKey();
        }
        $this->assertCount(50, array_unique($keys), '50 generated keys must all be unique');
    }

    public function test_generated_key_contains_only_valid_chars(): void
    {
        $key = generateLicenseKey();
        // Remove dashes, verify only A-Z0-9 remain
        $stripped = str_replace('-', '', $key);
        $this->assertMatchesRegularExpression('/^[A-Z0-9]+$/', $stripped);
    }

    // ── getClientIP ───────────────────────────────────────────────────────

    public function test_get_client_ip_returns_string(): void
    {
        $ip = getClientIP();
        $this->assertIsString($ip);
        $this->assertNotEmpty($ip);
    }

    public function test_get_client_ip_default_is_safe(): void
    {
        // Without REMOTE_ADDR set, must return a safe default — not empty/null
        unset($_SERVER['REMOTE_ADDR']);
        $ip = getClientIP();
        $this->assertSame('0.0.0.0', $ip, 'Default IP must be 0.0.0.0 when REMOTE_ADDR is not set');
    }

    public function test_get_client_ip_uses_remote_addr(): void
    {
        $_SERVER['REMOTE_ADDR'] = '192.168.1.100';
        $this->assertSame('192.168.1.100', getClientIP());
        unset($_SERVER['REMOTE_ADDR']);
    }

    public function test_get_client_ip_ignores_proxy_headers(): void
    {
        // Security: must NOT trust X-Forwarded-For (IP spoofing vector)
        $_SERVER['REMOTE_ADDR'] = '10.0.0.1';
        $_SERVER['HTTP_X_FORWARDED_FOR'] = '1.2.3.4';
        $this->assertSame('10.0.0.1', getClientIP(), 'Must use REMOTE_ADDR, not X-Forwarded-For');
        unset($_SERVER['REMOTE_ADDR'], $_SERVER['HTTP_X_FORWARDED_FOR']);
    }
}
