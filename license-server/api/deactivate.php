<?php
/**
 * API: Deactivate License (unbind from machine)
 * POST /api/deactivate.php
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

if (empty($key) || empty($machineId)) {
    jsonError('Ключ и Machine ID обязательны');
}

$db = getDB();

// Rate limiting: 5 deactivation attempts per minute per IP
enforceRateLimit($db, 'deactivate', 5, 60);

$stmt = $db->prepare('SELECT * FROM license_keys WHERE license_key = ?');
$stmt->execute([$key]);
$license = $stmt->fetch();

if (!$license) {
    jsonError('Ключ не найден', 404);
}

if (normalizeLicenseType($license['license_type'] ?? null) === 'corporate') {
    logAction($db, $license['id'], $machineId, 'deactivate', false, 'Corporate license is hardware-bound');
    jsonError('Корпоративная лицензия постоянно привязана к устройству. Сброс возможен только администратором.', 403);
}

// Проверить, что деактивирует та же машина
if ($license['machine_id'] !== $machineId) {
    logAction($db, $license['id'], $machineId, 'deactivate', false, 'Несоответствие машины');
    jsonError('Деактивация возможна только с того же устройства', 403);
}

// Деактивируем (убираем привязку к машине) и уменьшаем счётчик активаций
$stmt = $db->prepare('
    UPDATE license_keys 
    SET machine_id = NULL,
        platform = NULL,
        app_version = NULL,
        current_activations = GREATEST(current_activations - 1, 0)
    WHERE id = ?
');
$stmt->execute([$license['id']]);

logAction($db, $license['id'], $machineId, 'deactivate', true);

jsonResponse([
    'success' => true,
    'message' => 'Лицензия деактивирована. Теперь её можно активировать на другом устройстве.'
]);
