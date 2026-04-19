<?php
/**
 * Update Channel Router
 *
 * Routes Tauri auto-update requests to the correct manifest (stable / beta / alpha)
 * based on the X-Update-Channel request header sent by the app.
 *
 * This endpoint is reached via the .htaccess rewrite rule:
 *   GET /releases/v1/update/{target}/update
 *   → /api/update-channel.php?target={target}
 *
 * Channel ladder (highest → lowest privilege):
 *   alpha   — Superuser  licences (project owner's personal QA tier)
 *   beta    — Developer  licences (internal dev team)
 *   stable  — everything else (Standard / Enterprise / Trial / Demo)
 *
 * - Superuser clients send   X-Update-Channel: alpha  + X-Update-Token: <HMAC>
 * - Developer clients send   X-Update-Channel: beta   + X-Update-Token: <HMAC>
 * - Everyone else sends      X-Update-Channel: stable (or nothing)
 *
 * Falls back to stable.json if the requested channel's manifest doesn't exist.
 *
 * HTTP responses:
 *   200  JSON manifest (stable.json / beta.json / alpha.json)
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
 * Validate a time-bounded HMAC-SHA256 channel token sent by the Tauri app.
 *
 * The message MACed is "<label>:<window>" where window = floor(unix_seconds/300),
 * so alpha and beta tokens cannot be replayed across channels even if the
 * server operator accidentally reuses the same secret for both.
 *
 * Accepts the current and previous 5-minute windows to tolerate clock skew.
 * Returns false (fails closed) when the shared secret is not configured —
 * this means alpha/beta requests get transparently downgraded to stable on
 * a misconfigured host instead of serving pre-release builds to everyone.
 */
function validateChannelToken(string $label, string $envVar, string $provided): bool {
    $secret = (string) (getenv($envVar) ?: '');
    if ($secret === '' || $provided === '') {
        return false;
    }
    $window = (int) (time() / 300);
    foreach ([$window, $window - 1] as $w) {
        $expected = hash_hmac('sha256', "{$label}:{$w}", $secret);
        if (hash_equals($expected, $provided)) {
            return true;
        }
    }
    return false;
}

function validateBetaToken(string $provided): bool {
    return validateChannelToken('beta', 'RHEOLAB_BETA_CHANNEL_SECRET', $provided);
}

function validateAlphaToken(string $provided): bool {
    return validateChannelToken('alpha', 'RHEOLAB_ALPHA_CHANNEL_SECRET', $provided);
}

// Determine channel — alpha/beta are privileged; anything else falls back to stable.
// Note: the switch is deliberately written as a match with a default, not
// as chained `=== 'alpha' || === 'beta'`, so any future typo in a client
// header (e.g. "canary", "nightly") lands safely on stable instead of
// silently opening a new escalation surface.
$rawChannel = strtolower(trim($_SERVER['HTTP_X_UPDATE_CHANNEL'] ?? ''));
switch ($rawChannel) {
    case 'alpha':
    case 'beta':
        $channel = $rawChannel;
        break;
    default:
        $channel = 'stable';
}

// Server-side token verification: privileged channels require a valid HMAC
// proof. This prevents any client from accessing alpha.json / beta.json by
// setting the channel header alone.
if ($channel === 'alpha') {
    $providedToken = trim($_SERVER['HTTP_X_UPDATE_TOKEN'] ?? '');
    if (!validateAlphaToken($providedToken)) {
        $channel = 'stable'; // Downgrade unauthenticated alpha requests to stable
    }
} elseif ($channel === 'beta') {
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
