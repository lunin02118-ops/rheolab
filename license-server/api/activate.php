<?php
/**
 * API: Activate License
 * POST /api/activate.php
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

// Rate limiting: 10 activation attempts per minute
$db = getDB();
enforceRateLimit($db, 'activate', 10, 60);

$input = getJsonInput();
$key = strtoupper(trim($input['key'] ?? ''));
$machineId = trim($input['machineId'] ?? '');
$appVersion = trim($input['appVersion'] ?? '');
$platform = trim($input['platform'] ?? '');
$legacyMachineIds = $input['legacyMachineIds'] ?? [];
// Security: cap to prevent O(n) loop abuse
if (is_array($legacyMachineIds)) {
    $legacyMachineIds = array_slice($legacyMachineIds, 0, 10);
}

// Валидация
if (empty($key)) {
    jsonError('Ключ не указан');
}

if (!isValidKeyFormat($key)) {
    jsonError('Неверный формат ключа');
}

if (empty($machineId)) {
    jsonError('Machine ID не указан');
}

// Найти ключ
$stmt = $db->prepare('SELECT * FROM license_keys WHERE license_key = ?');
$stmt->execute([$key]);
$license = $stmt->fetch();

if (!$license) {
    jsonError('Ключ не найден', 404);
}

// Проверить отзыв
if ($license['is_revoked']) {
    logAction($db, $license['id'], $machineId, 'activate', false, 'Ключ отозван');
    jsonError('Ключ отозван: ' . ($license['revoked_reason'] ?: 'без указания причины'), 403);
}

// Проверить активность
if (!$license['is_active']) {
    logAction($db, $license['id'], $machineId, 'activate', false, 'Ключ неактивен');
    jsonError('Ключ неактивен', 403);
}

// Проверить срок действия
if (strtotime($license['expires_at']) < time()) {
    logAction($db, $license['id'], $machineId, 'activate', false, 'Срок действия истёк');
    jsonError('Срок действия ключа истёк', 403);
}

// Проверить привязку к машине
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
                    'Auto-migrated during activation from ' . $legacyId . ' to ' . $machineId);
                break;
            }
        }
    }

    if (!$isLegacyMigration) {
        logAction($db, $license['id'], $machineId, 'activate', false,
            'Несоответствие Machine ID: ' . $license['machine_id'] . ' vs ' . $machineId);
        jsonError('Этот ключ уже активирован на другом устройстве. Обратитесь в поддержку для сброса привязки.', 403);
    }
}

// Проверить лимит активаций (только для новых привязок)
if (!$license['machine_id'] && $license['current_activations'] >= $license['max_activations']) {
    logAction($db, $license['id'], $machineId, 'activate', false, 'Превышен лимит активаций');
    jsonError('Превышен лимит активаций для этого ключа', 403);
}

// Первая активация (чистый ключ)
if (!$license['machine_id']) {
    $stmt = $db->prepare('
        UPDATE license_keys 
        SET machine_id = ?, 
            platform = ?,
            app_version = ?,
            activated_at = NOW(),
            current_activations = current_activations + 1,
            last_check_at = NOW()
        WHERE id = ?
    ');
    $stmt->execute([$machineId, $platform, $appVersion, $license['id']]);
} else {
    // Повторная активация той же машины (обновление метаданных)
    $stmt = $db->prepare('UPDATE license_keys SET last_check_at = NOW(), app_version = ? WHERE id = ?');
    $stmt->execute([$appVersion, $license['id']]);
}

// Логируем успех
logAction($db, $license['id'], $machineId, 'activate', true);

send_response:

// Формируем ответ с лицензией
$licenseData = [
    'id' => $license['id'],
    'type' => $license['license_type'],
    'customerName' => $license['customer_name'],
    'organization' => $license['organization'],
    'email' => $license['customer_email'],
    'issuedAt' => $license['created_at'],
    'expiresAt' => $license['expires_at'],
    'activatedAt' => $license['activated_at'] ?: date('Y-m-d H:i:s'),
    'machineId' => $machineId
];

// Подписываем лицензию
$signed = signLicense($licenseData);

jsonResponse([
    'success'       => true,
    'message'       => 'Лицензия успешно активирована',
    'license'       => $licenseData,
    'signedPayload' => $signed['signedPayload'],  // exact string that was RSA-signed
    'signature'     => $signed['signature'],
]);
