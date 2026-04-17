<?php
/**
 * API: Register Demo
 * POST /api/register_demo.php
 * 
 * Body: { "machineId": "abc123..." }
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/rate_limiter.php';

setCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Method not allowed', 405);
}

$input = getJsonInput();
$machineId = trim($input['machineId'] ?? '');

if (empty($machineId)) {
    jsonError('Machine ID обязателен');
}

$db = getDB();

// Rate limiting: 5 demo registrations per hour per IP
enforceRateLimit($db, 'register_demo', 5, 3600);

// Проверить, есть ли уже регистрация для этой машины
$stmt = $db->prepare('SELECT first_seen_at FROM demo_users WHERE machine_id = ?');
$stmt->execute([$machineId]);
$existing = $stmt->fetch();

$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

if ($existing) {
    // Обновляем время последнего визита
    $stmt = $db->prepare('UPDATE demo_users SET last_seen_at = NOW(), ip_address = ? WHERE machine_id = ?');
    $stmt->execute([$ip, $machineId]);

    $firstSeenAt = $existing['first_seen_at'];
} else {
    // Новая регистрация
    $stmt = $db->prepare('INSERT INTO demo_users (machine_id, ip_address) VALUES (?, ?)');
    $stmt->execute([$machineId, $ip]);

    $firstSeenAt = date('Y-m-d H:i:s');
}

jsonResponse([
    'success' => true,
    'firstSeenAt' => $firstSeenAt,
    'message' => $existing ? 'Demo synchronized' : 'Demo registered'
]);
