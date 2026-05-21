<?php
/**
 * Legacy endpoint tombstone.
 *
 * Demo mode was removed from the product model. Keep this file deployable so
 * old server copies are overwritten and stop recording demo_users rows.
 */

require_once __DIR__ . '/../includes/helpers.php';

setCorsHeaders();

jsonResponse([
    'success' => false,
    'error' => 'demo_removed',
    'message' => 'Demo registration is no longer supported.'
], 410);
