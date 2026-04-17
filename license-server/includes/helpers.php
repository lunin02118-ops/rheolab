<?php
/**
 * Helper Functions
 */

require_once __DIR__ . '/../config.php';

/**
 * Отправить JSON ответ
 */
function jsonResponse(array $data, int $statusCode = 200): void
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Отправить ошибку
 */
function jsonError(string $message, int $statusCode = 400): void
{
    jsonResponse(['success' => false, 'error' => $message], $statusCode);
}

/**
 * Получить JSON из тела запроса
 */
function getJsonInput(): array
{
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    return is_array($data) ? $data : [];
}

/**
 * Установить CORS заголовки
 */
function setCorsHeaders(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if (in_array($origin, ALLOWED_ORIGINS)) {
        header("Access-Control-Allow-Origin: $origin");
    }

    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Access-Control-Max-Age: 86400');

    // F-10B.2: Security headers
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');

    // Preflight request
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

/**
 * Генерация лицензионного ключа
 */
function generateLicenseKey(): string
{
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    $parts = [];

    for ($i = 0; $i < 4; $i++) {
        $part = '';
        for ($j = 0; $j < 4; $j++) {
            $part .= $chars[random_int(0, strlen($chars) - 1)];
        }
        $parts[] = $part;
    }

    return implode('-', $parts);
}

/**
 * Валидация формата ключа
 */
function isValidKeyFormat(string $key): bool
{
    return preg_match('/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/', strtoupper($key)) === 1;
}

require_once __DIR__ . '/sign_rsa.php';

/**
 * Создание подписи для лицензии (RSA).
 *
 * @return array{signature: string, signedPayload: string}
 *   signature    — Base64-RSA-SHA256 подпись
 *   signedPayload — точная JSON-строка, которую подписали (PHP json_encode)
 */
function signLicense(array $data): array
{
    $result = signLicenseRSA($data);
    return [
        'signature'    => $result['signature'],
        'signedPayload' => $result['signedPayload'],
    ];
}

/**
 * Проверка подписи
 */
function verifySignature(array $data, string $signature): bool
{
    $result = signLicense($data);
    return hash_equals($result['signature'], $signature);
}

/**
 * Логирование действия
 */
function logAction(PDO $db, int $licenseId, string $machineId, string $action, bool $success, ?string $error = null): void
{
    $stmt = $db->prepare('
        INSERT INTO activation_log (license_id, machine_id, ip_address, action, success, error_message, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ');

    $stmt->execute([
        $licenseId,
        $machineId,
        $_SERVER['REMOTE_ADDR'] ?? null,
        $action,
        $success ? 1 : 0,
        $error,
        $_SERVER['HTTP_USER_AGENT'] ?? null
    ]);
}

/**
 * Get client IP address.
 * Uses REMOTE_ADDR only to prevent IP spoofing via proxy headers.
 */
function getClientIP(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

/**
 * Run a restricted root-side maintenance command from the admin panel.
 *
 * @return array{success: bool, message: string}
 */
function runAdminMaintenanceCommand(string $commandPath, string $successFallback): array
{
    $sudoPath = trim((string) shell_exec('command -v sudo 2>/dev/null'));
    if ($sudoPath === '') {
        return [
            'success' => false,
            'message' => 'sudo не найден на сервере.',
        ];
    }

    $command = escapeshellcmd($sudoPath) . ' ' . escapeshellarg($commandPath) . ' 2>&1';
    $output = [];
    $exitCode = 1;
    exec($command, $output, $exitCode);

    $message = trim(implode("\n", $output));
    if ($message === '') {
        $message = $exitCode === 0 ? $successFallback : 'Команда завершилась с ошибкой без вывода.';
    }

    return [
        'success' => $exitCode === 0,
        'message' => $message,
    ];
}

/**
 * Trigger a server backup from the admin panel via a tightly scoped sudo wrapper.
 *
 * @return array{success: bool, message: string}
 */
function triggerAdminBackup(): array
{
    return runAdminMaintenanceCommand(
        '/usr/local/bin/license-admin-backup-trigger.sh',
        'Backup completed successfully.'
    );
}

/**
 * Verify that the latest backup can be restored on another host.
 *
 * @return array{success: bool, message: string}
 */
function verifyAdminBackup(): array
{
    return runAdminMaintenanceCommand(
        '/usr/local/bin/license-admin-verify-backup.sh',
        'Backup verification completed successfully.'
    );
}
