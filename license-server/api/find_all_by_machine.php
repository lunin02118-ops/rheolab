<?php
/**
 * API: Find All Licenses by Machine ID  (dev-only audit view)
 * POST /api/find_all_by_machine.php
 *
 * Body: { "machineId": "<32-hex>" }
 *
 * Returns a compact list of every license historically bound to this
 * machine (active, revoked, expired).  Does NOT include `signedPayload` or
 * `signature` — it's intended for the admin panel / dev debugging only.
 *
 * Use `find_by_machine.php` (which returns a single signed license) for
 * the real client-side auto-recovery flow.
 *
 * Security posture
 * ----------------
 * - **Rate limit**: 5 / 10 min / IP — stricter than single-license lookup
 *   because this endpoint leaks existence of multiple licenses.
 * - **No full payload**: only key-prefix + type + status is returned.
 *   Even if the response is intercepted, the attacker gets no usable
 *   license record (no signature).
 * - **Audit**: logged as `action='discovery'` with user_agent tag.
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/rate_limiter.php';

setCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Method not allowed', 405);
}

// This endpoint is useful during field diagnostics, but it leaks license
// history for a machine fingerprint. Keep it closed unless explicitly
// enabled on the server for a short maintenance window.
if (getenv('RHEOLAB_ENABLE_DISCOVERY_AUDIT') !== '1') {
    jsonResponse(['success' => false, 'error' => 'not_found'], 404);
}

$db = getDB();
enforceRateLimit($db, 'discovery_all', 5, 600);

$input = getJsonInput();
$machineId = trim($input['machineId'] ?? '');

if (empty($machineId)) {
    jsonError('Machine ID не указан');
}
if (strlen($machineId) < 16 || strlen($machineId) > 128) {
    jsonError('Неверный формат Machine ID', 400);
}

$stmt = $db->prepare('
    SELECT id, license_key, license_type, machine_id,
           is_active, is_revoked, revoked_reason,
           created_at, activated_at, expires_at, last_check_at
    FROM license_keys
    WHERE machine_id = :mid
    ORDER BY activated_at DESC, id DESC
');
$stmt->execute([':mid' => $machineId]);
$rows = $stmt->fetchAll();

$now = time();
$licenses = array_map(function ($r) use ($now) {
    $expiresAt = licenseExpiresAt($r);
    $expired = $expiresAt !== null && strtotime($expiresAt) < $now;
    $status  = $r['is_revoked']    ? 'revoked'
             : (!$r['is_active']   ? 'inactive'
             : ($expired           ? 'expired'
                                   : 'active'));
    return [
        // Key prefix only — never leak the full key without auth
        'keyPrefix'     => substr($r['license_key'], 0, 4) . '-****-****-' . substr($r['license_key'], -4),
        'id'            => (int) $r['id'],
        'type'          => normalizeLicenseType($r['license_type']) ?? $r['license_type'],
        'status'        => $status,
        'revokedReason' => $r['revoked_reason'],
        'issuedAt'      => $r['created_at'],
        'activatedAt'   => $r['activated_at'],
        'expiresAt'     => $expiresAt,
        'lastCheckAt'   => $r['last_check_at'],
    ];
}, $rows);

// Audit (best-effort)
try {
    $auditStmt = $db->prepare('
        INSERT INTO activation_log
            (license_id, machine_id, ip_address, action, success, error_message, user_agent)
        VALUES (NULL, ?, ?, ?, 1, ?, ?)
    ');
    $auditStmt->execute([
        $machineId,
        getClientIP(),
        'discovery',
        sprintf('find_all_by_machine: returned %d rows', count($licenses)),
        $_SERVER['HTTP_USER_AGENT'] ?? null,
    ]);
} catch (PDOException $e) {
    if (defined('DEBUG') && DEBUG) {
        error_log('discovery_all: failed to audit: ' . $e->getMessage());
    }
}

jsonResponse([
    'success'  => true,
    'count'    => count($licenses),
    'licenses' => $licenses,
]);
