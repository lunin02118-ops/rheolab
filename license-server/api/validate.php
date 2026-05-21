<?php
/**
 * API: Validate License
 * POST /api/validate.php
 * 
 * Body: { "key": "XXXX-XXXX-XXXX-XXXX", "machineId": "abc123..." }
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/rate_limiter.php';

setCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Method not allowed', 405);
}

$input = getJsonInput();
$key = strtoupper(trim($input['key'] ?? ''));
$machineId = trim($input['machineId'] ?? '');
$legacyMachineIds = $input['legacyMachineIds'] ?? [];
// Security: cap to prevent O(n) loop abuse
if (is_array($legacyMachineIds)) {
    $legacyMachineIds = array_slice($legacyMachineIds, 0, 10);
}

// Валидация
if (empty($key) || empty($machineId)) {
    jsonError('Ключ и Machine ID обязательны');
}

$db = getDB();

// Rate limiting: 20 validation attempts per minute (more lenient than activate)
enforceRateLimit($db, 'validate', 20, 60);

// Найти ключ
$stmt = $db->prepare('SELECT * FROM license_keys WHERE license_key = ?');
$stmt->execute([$key]);
$license = $stmt->fetch();

if (!$license) {
    jsonError('Ключ не найден', 404);
}

// Проверить статус ПЕРЕД привязкой к машине.
// Если лицензия отозвана/неактивна — ответ один и тот же, независимо от машины.
// Проверка machine_id до is_revoked маскировала отзыв HTTP 403-ошибкой привязки.
if ($license['is_revoked']) {
    logAction($db, $license['id'], $machineId, 'validate', false, 'Ключ отозван');
    jsonResponse([
        'success' => false,
        'valid' => false,
        'reason' => 'revoked',
        'message' => 'Ключ отозван'
    ]);
}

if (!$license['is_active']) {
    logAction($db, $license['id'], $machineId, 'validate', false, 'Ключ неактивен');
    jsonResponse([
        'success' => false,
        'valid' => false,
        'reason' => 'inactive',
        'message' => 'Ключ неактивен'
    ]);
}

// Проверить привязку к машине (после проверки статуса)
if ($license['machine_id'] && $license['machine_id'] !== $machineId) {
    // Check if stored machine_id matches any legacy ID (v1 → v2 migration)
    $isLegacyMigration = false;
    if (is_array($legacyMachineIds)) {
        foreach ($legacyMachineIds as $legacyId) {
            $legacyId = trim($legacyId);
            if (!empty($legacyId) && $license['machine_id'] === $legacyId) {
                $isLegacyMigration = true;
                // Perform transparent migration: update machine_id to new v2 ID
                $stmt = $db->prepare('UPDATE license_keys SET machine_id = ? WHERE id = ?');
                $stmt->execute([$machineId, $license['id']]);
                logAction($db, $license['id'], $machineId, 'migrate_machine', true,
                    'Auto-migrated during validation from ' . $legacyId . ' to ' . $machineId);
                break;
            }
        }
    }

    if (!$isLegacyMigration) {
        logAction($db, $license['id'], $machineId, 'validate', false, 'Несоответствие машины');
        jsonResponse([
            'success' => false,
            'valid' => false,
            'reason' => 'wrong_machine',
            'message' => 'Ключ не привязан к этому устройству'
        ], 403);
    }
}

// Проверить срок. Corporate licenses are permanent and carry `expiresAt: null`.
$isExpired = isLicenseExpired($license);
$daysRemaining = licenseDaysRemaining($license);

// Обновить время проверки
$stmt = $db->prepare('UPDATE license_keys SET last_check_at = NOW() WHERE id = ?');
$stmt->execute([$license['id']]);

// Логируем
logAction($db, $license['id'], $machineId, 'validate', true);

// Формируем ответ from the same signed payload shape as activate/recovery.
try {
    $licenseData = buildSignedLicensePayload($license, $machineId);
} catch (InvalidArgumentException $e) {
    logAction($db, $license['id'], $machineId, 'validate', false, 'Unsupported license type');
    jsonResponse([
        'success' => false,
        'valid' => false,
        'reason' => 'unsupported_type',
        'message' => 'Тип лицензии не поддерживается'
    ], 500);
}

$signed = signLicense($licenseData);

jsonResponse([
    'success'       => true,
    'valid'         => !$isExpired,
    'license'       => $licenseData,
    'signedPayload' => $signed['signedPayload'],  // exact string that was RSA-signed
    'signature'     => $signed['signature'],
    'daysRemaining' => $daysRemaining,
    'isExpired'     => $isExpired,
    'message'       => $isExpired ? 'Срок действия истёк' : 'Лицензия действительна',
]);
