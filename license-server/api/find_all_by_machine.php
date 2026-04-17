<?php
/**
 * API: Find All Licenses by Machine ID
 * POST /api/find_all_by_machine.php
 * 
 * Возвращает ВСЕ активные лицензии для машины (для dev режима)
 * Body: { "machineId": "abc123..." }
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/rate_limiter.php';

setCorsHeaders();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Method not allowed', 405);
}

jsonError(
    'Machine-ID recovery endpoint has been disabled. Please reactivate manually with the license key.',
    410
);
