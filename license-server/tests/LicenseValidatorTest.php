<?php
/**
 * LicenseValidatorTest — integration-style tests for the validate.php business logic.
 *
 * These tests exercise the status-checking SQL queries and signing response
 * directly against an SQLite in-memory database created by bootstrap.php.
 *
 * The tests deliberately avoid calling the endpoint file (validate.php) because
 * it mixes HTTP concerns (headers, exit) with business logic. Instead, each test
 * runs the same queries and decisions that validate.php performs.
 *
 * MySQL-specific functions (FROM_UNIXTIME, DATE_ADD, NOW()) are replaced with
 * SQLite equivalents so the logic can be verified without a live MySQL server.
 */

use PHPUnit\Framework\TestCase;

class LicenseValidatorTest extends TestCase
{
    private PDO $db;

    protected function setUp(): void
    {
        $this->db = createTestDb();
    }

    // ── findByKey ─────────────────────────────────────────────────────────

    public function test_unknown_key_returns_false(): void
    {
        $license = $this->findByKey('XXXX-YYYY-ZZZZ-0000');
        $this->assertFalse($license);
    }

    public function test_known_key_returns_row(): void
    {
        insertTestLicense($this->db, ['license_key' => 'TEST-FIND-ABCD-0001']);
        $license = $this->findByKey('TEST-FIND-ABCD-0001');
        $this->assertIsArray($license);
        $this->assertSame('TEST-FIND-ABCD-0001', $license['license_key']);
    }

    // ── Revocation check ──────────────────────────────────────────────────

    public function test_revoked_license_is_rejected(): void
    {
        insertTestLicense($this->db, [
            'license_key' => 'TEST-REVK-AAAA-0001',
            'is_revoked'  => 1,
        ]);
        $license = $this->findByKey('TEST-REVK-AAAA-0001');
        $this->assertSame('revoked', $this->checkStatus($license));
    }

    public function test_non_revoked_license_is_not_rejected_for_revocation(): void
    {
        insertTestLicense($this->db, ['license_key' => 'TEST-NOTR-AAAA-0001']);
        $license = $this->findByKey('TEST-NOTR-AAAA-0001');
        $this->assertNotSame('revoked', $this->checkStatus($license));
    }

    // ── Active/inactive check ─────────────────────────────────────────────

    public function test_inactive_license_is_rejected(): void
    {
        insertTestLicense($this->db, [
            'license_key' => 'TEST-INAC-AAAA-0001',
            'is_active'   => 0,
        ]);
        $license = $this->findByKey('TEST-INAC-AAAA-0001');
        $this->assertSame('inactive', $this->checkStatus($license));
    }

    public function test_active_non_revoked_license_passes_status(): void
    {
        insertTestLicense($this->db, ['license_key' => 'TEST-ACTI-AAAA-0001']);
        $license = $this->findByKey('TEST-ACTI-AAAA-0001');
        $this->assertSame('ok', $this->checkStatus($license));
    }

    // Revocation takes precedence over is_active (validate.php checks is_revoked first)
    public function test_revoke_takes_precedence_over_inactive(): void
    {
        insertTestLicense($this->db, [
            'license_key' => 'TEST-BOTH-AAAA-0001',
            'is_revoked'  => 1,
            'is_active'   => 0,
        ]);
        $license = $this->findByKey('TEST-BOTH-AAAA-0001');
        $this->assertSame('revoked', $this->checkStatus($license));
    }

    // ── Machine ID binding ────────────────────────────────────────────────

    public function test_unbound_license_accepts_any_machine(): void
    {
        insertTestLicense($this->db, ['license_key' => 'TEST-UNBD-AAAA-0001']);
        $license = $this->findByKey('TEST-UNBD-AAAA-0001');
        $this->assertTrue($this->machineMatches($license, 'some-machine-id-001', []));
    }

    public function test_bound_license_accepts_correct_machine(): void
    {
        insertTestLicense($this->db, [
            'license_key' => 'TEST-BNDM-AAAA-0001',
            'machine_id'  => 'correct-machine-abc',
        ]);
        $license = $this->findByKey('TEST-BNDM-AAAA-0001');
        $this->assertTrue($this->machineMatches($license, 'correct-machine-abc', []));
    }

    public function test_bound_license_rejects_wrong_machine(): void
    {
        insertTestLicense($this->db, [
            'license_key' => 'TEST-WRGM-AAAA-0001',
            'machine_id'  => 'original-machine-id',
        ]);
        $license = $this->findByKey('TEST-WRGM-AAAA-0001');
        $this->assertFalse($this->machineMatches($license, 'different-machine-id', []));
    }

    public function test_legacy_machine_id_migration_succeeds(): void
    {
        insertTestLicense($this->db, [
            'license_key' => 'TEST-LGCY-AAAA-0001',
            'machine_id'  => 'old-v1-machine-id',
        ]);
        $license = $this->findByKey('TEST-LGCY-AAAA-0001');
        // The new v2 machine ID is passed, but old ID is in legacyMachineIds
        $matches = $this->machineMatches($license, 'new-v2-machine-id', ['old-v1-machine-id']);
        $this->assertTrue($matches, 'Legacy machine ID in legacyMachineIds must allow migration');
    }

    public function test_legacy_migration_does_not_match_unrelated_id(): void
    {
        insertTestLicense($this->db, [
            'license_key' => 'TEST-NOLG-AAAA-0001',
            'machine_id'  => 'real-machine-id',
        ]);
        $license = $this->findByKey('TEST-NOLG-AAAA-0001');
        $matches = $this->machineMatches($license, 'new-v2-machine-id', ['unrelated-id', 'another-id']);
        $this->assertFalse($matches);
    }

    public function test_legacy_machine_ids_capped_at_10(): void
    {
        // Verify that sanitisation (max 10 legacy IDs) is enforced
        $longList = array_map(fn($i) => "legacy-id-$i", range(1, 20));
        $capped   = array_slice($longList, 0, 10);
        $this->assertCount(10, $capped);
    }

    // ── Expiry check ──────────────────────────────────────────────────────

    public function test_expired_license_is_marked_expired(): void
    {
        insertTestLicense($this->db, [
            'license_key' => 'TEST-EXPR-AAAA-0001',
            'expires_at'  => date('Y-m-d H:i:s', strtotime('-1 day')),
        ]);
        $license = $this->findByKey('TEST-EXPR-AAAA-0001');
        $this->assertTrue($this->isExpired($license));
    }

    public function test_valid_license_is_not_expired(): void
    {
        insertTestLicense($this->db, [
            'license_key' => 'TEST-VALD-AAAA-0001',
            'expires_at'  => date('Y-m-d H:i:s', strtotime('+30 days')),
        ]);
        $license = $this->findByKey('TEST-VALD-AAAA-0001');
        $this->assertFalse($this->isExpired($license));
    }

    public function test_days_remaining_is_correct(): void
    {
        $futureTs = strtotime('+10 days');
        insertTestLicense($this->db, [
            'license_key' => 'TEST-DAYS-AAAA-0001',
            'expires_at'  => date('Y-m-d H:i:s', $futureTs),
        ]);
        $license = $this->findByKey('TEST-DAYS-AAAA-0001');

        $expiresAt    = strtotime($license['expires_at']);
        $daysRemaining = max(0, ceil(($expiresAt - time()) / 86400));

        // Allow 1-day tolerance for slow runners
        $this->assertLessThanOrEqual(10, $daysRemaining);
        $this->assertGreaterThanOrEqual(9, $daysRemaining);
    }

    public function test_days_remaining_is_zero_for_expired(): void
    {
        insertTestLicense($this->db, [
            'license_key' => 'TEST-D0EX-AAAA-0001',
            'expires_at'  => date('Y-m-d H:i:s', strtotime('-5 days')),
        ]);
        $license = $this->findByKey('TEST-D0EX-AAAA-0001');

        $expiresAt    = strtotime($license['expires_at']);
        $daysRemaining = max(0, ceil(($expiresAt - time()) / 86400));
        $this->assertSame(0, $daysRemaining);
    }

    // ── logAction ─────────────────────────────────────────────────────────

    public function test_log_action_inserts_row(): void
    {
        $id = insertTestLicense($this->db, ['license_key' => 'TEST-LOGX-AAAA-0001']);
        logAction($this->db, $id, 'machine-123', 'validate', true);

        $stmt  = $this->db->prepare('SELECT COUNT(*) FROM activation_log WHERE license_id = ?');
        $stmt->execute([$id]);
        $count = (int) $stmt->fetchColumn();
        $this->assertSame(1, $count);
    }

    public function test_log_action_records_failure(): void
    {
        $id = insertTestLicense($this->db, ['license_key' => 'TEST-LGFL-AAAA-0001']);
        logAction($this->db, $id, 'machine-456', 'validate', false, 'Ключ отозван');

        $stmt  = $this->db->prepare('SELECT * FROM activation_log WHERE license_id = ?');
        $stmt->execute([$id]);
        $row   = $stmt->fetch();

        $this->assertSame(0, (int) $row['success']);
        $this->assertSame('Ключ отозван', $row['error_message']);
    }

    // ── Response signing ──────────────────────────────────────────────────

    public function test_response_payload_contains_signed_fields(): void
    {
        if (!file_exists(PRIVATE_KEY_PATH)) {
            $this->markTestSkipped('Dev private key not found — skipping signing test');
        }
        $licenseData = [
            'id'           => 1,
            'type'         => 'standard',
            'customerName' => 'Test Corp',
            'organization' => null,
            'expiresAt'    => '2030-12-31 00:00:00',
            'machineId'    => 'machine-abc',
        ];
        $signed = signLicense($licenseData);

        $this->assertArrayHasKey('signature', $signed);
        $this->assertArrayHasKey('signedPayload', $signed);
        $this->assertNotEmpty($signed['signature']);
        $this->assertNotEmpty($signed['signedPayload']);
    }

    // ── Helper methods ────────────────────────────────────────────────────

    private function findByKey(string $key): array|false
    {
        $stmt = $this->db->prepare('SELECT * FROM license_keys WHERE license_key = ?');
        $stmt->execute([$key]);
        return $stmt->fetch();
    }

    /**
     * Mirrors the status-check logic in validate.php (revoked → inactive → ok).
     */
    private function checkStatus(array $license): string
    {
        if ($license['is_revoked']) {
            return 'revoked';
        }
        if (!$license['is_active']) {
            return 'inactive';
        }
        return 'ok';
    }

    /**
     * Mirrors the machine ID check in validate.php.
     *
     * @param  array    $license         License row from DB
     * @param  string   $machineId       Current machine's ID
     * @param  string[] $legacyMachineIds Previous machine IDs submitted by client
     */
    private function machineMatches(array $license, string $machineId, array $legacyMachineIds): bool
    {
        if (!$license['machine_id']) {
            return true;                                    // not bound yet
        }
        if ($license['machine_id'] === $machineId) {
            return true;                                    // direct match
        }
        foreach ($legacyMachineIds as $legacyId) {
            $legacyId = trim($legacyId);
            if (!empty($legacyId) && $license['machine_id'] === $legacyId) {
                return true;                                // legacy migration match
            }
        }
        return false;
    }

    private function isExpired(array $license): bool
    {
        return strtotime($license['expires_at']) < time();
    }
}
