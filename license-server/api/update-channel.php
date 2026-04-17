<?php
/**
 * Update Channel Router
 *
 * Routes Tauri auto-update requests to the correct manifest (stable or beta)
 * based on the X-Update-Channel request header sent by the app.
 *
 * This endpoint is reached via the .htaccess rewrite rule:
 *   GET /releases/v1/update/{target}/update
 *   → /api/update-channel.php?target={target}
 *
 * - Developer-licensed clients send  X-Update-Channel: beta
 * - All other clients send           X-Update-Channel: stable  (or nothing)
 * - Falls back to stable.json when beta.json hasn't been published yet.
 *
 * HTTP responses:
 *   200  JSON manifest (stable.json or beta.json)
 *   204  No Content — no manifest exists for this platform (no update)
 *   400  Bad Request — malformed target parameter
 */

// Sanitise the target parameter (only alphanumerics, hyphens, underscores)
$rawTarget = $_GET['target'] ?? '';
$target    = preg_replace('/[^a-zA-Z0-9_\-]/', '', $rawTarget);

if (empty($target)) {
    http_response_code(400);
    exit;
}

/**
 * Validate a time-bounded HMAC-SHA256 beta-channel token sent by the Tauri app.
 * Accepts the current and previous 5-minute windows to tolerate clock skew.
 * Returns false (fails closed) if the shared secret is not configured.
 */
function validateBetaToken(string $provided): bool {
    $secret = (string) (getenv('RHEOLAB_BETA_CHANNEL_SECRET') ?: '');
    if ($secret === '' || $provided === '') {
        return false;
    }
    $window = (int) (time() / 300);
    foreach ([$window, $window - 1] as $w) {
        $expected = hash_hmac('sha256', "beta:{$w}", $secret);
        if (hash_equals($expected, $provided)) {
            return true;
        }
    }
    return false;
}

// Determine channel — only 'beta' is special; everything else falls back to 'stable'
$rawChannel = strtolower(trim($_SERVER['HTTP_X_UPDATE_CHANNEL'] ?? ''));
$channel    = ($rawChannel === 'beta') ? 'beta' : 'stable';

// Server-side token verification: beta channel requires a valid HMAC proof.
// This prevents any client from accessing beta.json by setting the header alone.
if ($channel === 'beta') {
    $providedToken = trim($_SERVER['HTTP_X_UPDATE_TOKEN'] ?? '');
    if (!validateBetaToken($providedToken)) {
        $channel = 'stable'; // Downgrade unauthenticated beta requests to stable
    }
}

$baseDir      = '/var/www/license-server/releases/v1/update/' . $target;
$manifestPath = $baseDir . '/' . $channel . '.json';

// Graceful fallback: if beta manifest hasn't been published yet, serve stable
if (!file_exists($manifestPath)) {
    $manifestPath = $baseDir . '/stable.json';
}

if (!file_exists($manifestPath)) {
    // No update manifest available for this platform — Tauri treats 204 as "up to date"
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
// Diagnostic header (not used by Tauri, helpful for debugging)
header('X-Channel-Served: ' . $channel);
readfile($manifestPath);
