<?php
/**
 * PHPUnit Bootstrap for License Server Tests
 *
 * Sets up environment variables and constants required by config.php and
 * includes/ before any test class is loaded. Tests that need MySQL or a
 * real PEM key are tagged @group integration and excluded by default.
 */

// ── Environment variables expected by config.php ─────────────────────────

putenv('RHEOLAB_DB_HOST=localhost');
putenv('RHEOLAB_DB_NAME=rheolab_license_test');
putenv('RHEOLAB_DB_USER=test');
putenv('RHEOLAB_DB_PASS=test');
putenv('RHEOLAB_LICENSE_SECRET=test-license-secret-at-least-32chars!!');
putenv('RHEOLAB_ADMIN_USER=admin');
putenv('RHEOLAB_ADMIN_PASS_HASH=' . password_hash('testpassword', PASSWORD_BCRYPT));

// ── Override PRIVATE_KEY_PATH before sign_rsa.php defines it ─────────────
// Point to the dev keypair that is also used by Rust unit tests.

define('PRIVATE_KEY_PATH', __DIR__ . '/../../src-tauri/keys/dev_private.pem');

// ── Now load application config and helpers ───────────────────────────────

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../includes/helpers.php';

// ── Test database helper (SQLite in-memory for unit tests) ─────────────────

/**
 * Create a minimal SQLite in-memory database with the license_keys and
 * activation_log schema.  Used by unit tests that need DB access without
 * a live MySQL server.
 */
function createTestDb(): PDO
{
    $db = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    $db->exec("
        CREATE TABLE license_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_key VARCHAR(19) UNIQUE NOT NULL,
            customer_name VARCHAR(255) NOT NULL,
            customer_email VARCHAR(255),
            organization VARCHAR(255),
            license_type VARCHAR(20) DEFAULT 'standard',
            max_activations INTEGER DEFAULT 1,
            current_activations INTEGER DEFAULT 0,
            machine_id VARCHAR(64),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            activated_at DATETIME,
            expires_at DATETIME NOT NULL,
            last_check_at DATETIME,
            is_active INTEGER DEFAULT 1,
            is_revoked INTEGER DEFAULT 0,
            revoked_reason VARCHAR(255),
            grace_period_days INTEGER DEFAULT 30
        )
    ");

    $db->exec("
        CREATE TABLE activation_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_id INTEGER,
            machine_id VARCHAR(64),
            ip_address VARCHAR(45),
            action VARCHAR(30),
            success INTEGER DEFAULT 0,
            error_message TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ");

    $db->exec("
        CREATE TABLE rate_limits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rate_key VARCHAR(255) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL
        )
    ");

    return $db;
}

/**
 * Insert a test license into the given DB and return its ID.
 *
 * @param PDO    $db
 * @param array  $overrides Fields to override from sensible defaults.
 */
function insertTestLicense(PDO $db, array $overrides = []): int
{
    $defaults = [
        'license_key'    => 'TEST-AAAA-BBBB-1234',
        'customer_name'  => 'Test User',
        'license_type'   => 'standard',
        'expires_at'     => date('Y-m-d H:i:s', strtotime('+1 year')),
        'is_active'      => 1,
        'is_revoked'     => 0,
        'grace_period_days' => 30,
    ];
    $row = array_merge($defaults, $overrides);

    $columns = implode(', ', array_keys($row));
    $placeholders = ':' . implode(', :', array_keys($row));
    $stmt = $db->prepare("INSERT INTO license_keys ($columns) VALUES ($placeholders)");
    foreach ($row as $col => $val) {
        $stmt->bindValue(":$col", $val);
    }
    $stmt->execute();
    return (int) $db->lastInsertId();
}
