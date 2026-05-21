<?php
/**
 * API: Find License by Machine ID  (auto-recovery by hardware fingerprint)
 * POST /api/find_by_machine.php
 *
 * Body: { "machineId": "<32-hex>" }
 *
 * Purpose
 * -------
 * Lets a client that lost its local license file (e.g. after an OS reinstall
 * on the *same* hardware) restore the most recent active license for its
 * machine fingerprint without re-entering the license key.
 *
 * Security posture
 * ----------------
 * - **Rate limit**: 10 requests / 10 min / IP (via `rate_limits` table).
 *   Brute-forcing 128-bit fingerprints at this rate is infeasible.
 * - **Bound to machine**: returns only `machine_id = :mid`, the same
 *   fingerprint is inlined into the RSA-signed payload, so the response
 *   cannot be replayed on a different machine — client-side RSA verify
 *   would pass but local `machineId != current_machine_id` check fails.
 * - **No recovery for revoked / inactive / expired licenses**: those return
 *   the same 404 as "not found" to avoid leaking license existence.
 * - **Audit trail**: every call (hit or miss) is recorded in
 *   `activation_log` with `action = 'discovery'`.
 *
 * Response shape (success):
 * {
 *   "success": true,
 *   "license": { id, type, customerName, organization, email,
 *                issuedAt, expiresAt, activatedAt, machineId },
 *   "signedPayload": "<canonical JSON string>",
 *   "signature":     "<base64 RSA-SHA256 signature>"
 * }
 *
 * Response shape (no active license for this machine):
 * HTTP 404 { "success": false, "error": "not_found" }
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/rate_limiter.php';

setCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Method not allowed', 405);
}

$db = getDB();

// 10 requests per 10 minutes per IP — plenty for legit OS-reinstall flow,
// infeasible for brute-forcing 128-bit fingerprints.
enforceRateLimit($db, 'discovery', 10, 600);

$input = getJsonInput();
$machineId = trim($input['machineId'] ?? '');

if (empty($machineId)) {
    jsonError('Machine ID не указан');
}

// Cheap sanity check: v2 fingerprints are lowercase hex, 32 chars.
// Accept anything that's at least 16 chars to avoid breaking legacy v1 IDs
// that might still be in some older DB rows.
if (strlen($machineId) < 16 || strlen($machineId) > 128) {
    jsonError('Неверный формат Machine ID', 400);
}

// Find the most recent ACTIVE, NON-REVOKED, NON-EXPIRED license bound to
// this exact fingerprint.  Ordering by `activated_at DESC` means a user who
// ever had multiple keys on the same box gets the newest one back, which
// matches the legacy beta.4 behaviour documented in
// scripts/test/test-license-full.ts.
$stmt = $db->prepare('
    SELECT *
    FROM license_keys
    WHERE machine_id   = :mid
      AND is_revoked   = 0
      AND is_active    = 1
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY activated_at DESC, id DESC
    LIMIT 1
');
$stmt->execute([':mid' => $machineId]);
$license = $stmt->fetch();

if (!$license) {
    // Log the miss so we can see legit recovery attempts in the audit trail
    // even when no license exists.  license_id = 0 works because the column
    // has no FK constraint when the row is inserted this way.
    //
    // Use a direct INSERT (not logAction) because logAction requires a valid
    // license FK and we may have no row to reference.
    try {
        $auditStmt = $db->prepare('
            INSERT INTO activation_log
                (license_id, machine_id, ip_address, action, success, error_message, user_agent)
            VALUES (NULL, ?, ?, ?, 0, ?, ?)
        ');
        $auditStmt->execute([
            $machineId,
            getClientIP(),
            'discovery',
            'no active license for machine',
            $_SERVER['HTTP_USER_AGENT'] ?? null,
        ]);
    } catch (PDOException $e) {
        // activation_log.license_id may be NOT NULL in some older deploys —
        // don't fail the request just because we couldn't audit the miss.
        if (defined('DEBUG') && DEBUG) {
            error_log('discovery: failed to audit miss: ' . $e->getMessage());
        }
    }
    jsonResponse(['success' => false, 'error' => 'not_found'], 404);
}

// Update last_check_at so validate_online timing reflects the recovery.
$updateStmt = $db->prepare('UPDATE license_keys SET last_check_at = NOW() WHERE id = ?');
$updateStmt->execute([$license['id']]);

// Build the license payload in EXACTLY the same shape as activate.php so the
// client's db_record construction in engine/operations.rs::activate works
// verbatim for the recovery path too.
try {
    $licenseData = buildSignedLicensePayload($license, $machineId);
} catch (InvalidArgumentException $e) {
    if (defined('DEBUG') && DEBUG) {
        error_log('discovery: unsupported license type: ' . ($license['license_type'] ?? ''));
    }
    jsonResponse(['success' => false, 'error' => 'not_found'], 404);
}

// RSA-sign the payload (same signer used by activate.php).
try {
    $signed = signLicense($licenseData);
} catch (Exception $e) {
    if (defined('DEBUG') && DEBUG) {
        error_log('discovery: RSA signing failed: ' . $e->getMessage());
    }
    jsonError('Ошибка подписи лицензии', 500);
}

// Audit the successful recovery.
logAction($db, (int) $license['id'], $machineId, 'discovery', true);

jsonResponse([
    'success'       => true,
    'license'       => $licenseData,
    'key'           => $license['license_key'],   // client needs it to populate db_record.key
    'signedPayload' => $signed['signedPayload'],  // exact JSON string that was RSA-signed
    'signature'     => $signed['signature'],      // base64 RSA-SHA256
]);
