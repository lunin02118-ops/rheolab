<?php
/**
 * API: Migrate Machine ID (v1 → v2)
 * POST /api/migrate_machine.php
 * 
 * Body: {
 *   "key": "XXXX-XXXX-XXXX-XXXX",
 *   "machineId": "new_v2_id",
 *   "legacyMachineIds": ["old_v1_id_1", "old_v1_id_2"]
 * }
 * 
 * This endpoint updates the machine_id binding on a license key
 * when the client's hardware fingerprint algorithm changes (v1 → v2).
 * 
 * Security: the caller must provide at least one legacy ID that matches
 * the currently stored machine_id. This proves they are the same physical
 * machine, just running updated fingerprinting code.
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/rate_limiter.php';

setCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Method not allowed', 405);
}

$db = getDB();

// Rate limiting: 5 migration attempts per minute
enforceRateLimit($db, 'migrate_machine', 5, 60);

$input = getJsonInput();
$key = strtoupper(trim($input['key'] ?? ''));
$newMachineId = trim($input['machineId'] ?? '');
$legacyMachineIds = $input['legacyMachineIds'] ?? [];
// Security: cap to prevent O(n) loop abuse
if (is_array($legacyMachineIds)) {
    $legacyMachineIds = array_slice($legacyMachineIds, 0, 10);
}

// Validation
if (empty($key)) {
    jsonError('Ключ не указан');
}

if (empty($newMachineId)) {
    jsonError('Machine ID не указан');
}

if (!is_array($legacyMachineIds) || empty($legacyMachineIds)) {
    jsonError('Legacy Machine IDs не указаны');
}

// Sanitize legacy IDs
$legacyMachineIds = array_map('trim', $legacyMachineIds);
$legacyMachineIds = array_filter($legacyMachineIds, fn($id) => !empty($id));

if (empty($legacyMachineIds)) {
    jsonError('Legacy Machine IDs пусты после валидации');
}

// Find the license
$stmt = $db->prepare('SELECT * FROM license_keys WHERE license_key = ?');
$stmt->execute([$key]);
$license = $stmt->fetch();

if (!$license) {
    jsonError('Ключ не найден', 404);
}

// Must have an existing machine_id binding
if (empty($license['machine_id'])) {
    jsonError('Ключ не привязан к устройству', 400);
}

// If already bound to the new ID, nothing to do
if ($license['machine_id'] === $newMachineId) {
    logAction($db, $license['id'], $newMachineId, 'migrate_machine', true, 'Already up-to-date');
    jsonResponse([
        'success' => true,
        'message' => 'Machine ID уже актуален',
        'migrated' => false
    ]);
}

// Check if the stored machine_id matches any of the legacy IDs
$storedId = $license['machine_id'];
$matched = false;
$matchedLegacyId = '';

foreach ($legacyMachineIds as $legacyId) {
    if ($storedId === $legacyId) {
        $matched = true;
        $matchedLegacyId = $legacyId;
        break;
    }
}

if (!$matched) {
    logAction($db, $license['id'], $newMachineId, 'migrate_machine', false,
        'No legacy ID match. Stored: ' . $storedId . ', Provided: ' . implode(',', $legacyMachineIds));
    jsonError('Ни один из устаревших Machine ID не соответствует текущей привязке', 403);
}

// Perform the migration
$stmt = $db->prepare('
    UPDATE license_keys 
    SET machine_id = ?,
        last_check_at = NOW()
    WHERE id = ?
');
$stmt->execute([$newMachineId, $license['id']]);

logAction($db, $license['id'], $newMachineId, 'migrate_machine', true,
    'Migrated from ' . $matchedLegacyId . ' to ' . $newMachineId);

jsonResponse([
    'success' => true,
    'message' => 'Machine ID успешно обновлён',
    'migrated' => true,
    'previousMachineId' => $matchedLegacyId
]);
