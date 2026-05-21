<?php
/**
 * API: Check License Status (without machine binding check)
 * GET /api/status.php?key=XXXX-XXXX-XXXX-XXXX
 * 
 * Rate limited: 5 requests per minute per IP.
 * Returns only non-sensitive fields (no customer name, organization, activation count).
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/rate_limiter.php';

setCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonError('Method not allowed', 405);
}

$key = strtoupper(trim($_GET['key'] ?? ''));

if (empty($key)) {
    jsonError('Ключ не указан');
}

if (!isValidKeyFormat($key)) {
    jsonError('Неверный формат ключа');
}

$db = getDB();

// Rate limiting: 5 status checks per minute per IP
enforceRateLimit($db, 'status', 5, 60);

$stmt = $db->prepare('SELECT * FROM license_keys WHERE license_key = ?');
$stmt->execute([$key]);
$license = $stmt->fetch();

if (!$license) {
    jsonError('Ключ не найден', 404);
}

$isExpired = isLicenseExpired($license);
$daysRemaining = licenseDaysRemaining($license);

$status = 'active';
if ($license['is_revoked']) {
    $status = 'revoked';
} elseif (!$license['is_active']) {
    $status = 'inactive';
} elseif ($isExpired) {
    $status = 'expired';
}

// Return only non-sensitive fields
jsonResponse([
    'success' => true,
    'status' => $status,
    'licenseType' => normalizeLicenseType($license['license_type']) ?? $license['license_type'],
    'expiresAt' => licenseExpiresAt($license),
    'daysRemaining' => $daysRemaining,
    'isActivated' => !empty($license['machine_id'])
]);
