<?php
/**
 * Admin Panel - License Management
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/rate_limiter.php';

// F-10B.1: Harden session cookie before session_start
session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Strict',
    'secure'   => true,
]);
session_start();

// CSRF Token helpers
function generateCSRFToken(): string {
    if (!isset($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function validateCSRFToken(): bool {
    $token = $_POST['csrf_token'] ?? '';
    return isset($_SESSION['csrf_token']) && hash_equals($_SESSION['csrf_token'], $token);
}

const OFFLINE_REQUEST_PREFIX = 'RL-REQ1:';
const OFFLINE_ACTIVATION_PREFIX = 'RL-ACT1:';

function base64UrlDecode(string $value): string|false {
    $padded = strtr($value, '-_', '+/');
    $padding = strlen($padded) % 4;
    if ($padding > 0) {
        $padded .= str_repeat('=', 4 - $padding);
    }
    return base64_decode($padded, true);
}

function base64UrlEncode(string $value): string {
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function decodeOfflineRequestCode(string $requestCode): array {
    $compact = preg_replace('/\s+/', '', trim($requestCode));
    if (!str_starts_with($compact, OFFLINE_REQUEST_PREFIX)) {
        throw new InvalidArgumentException(
            'Код запроса должен начинаться с ' . OFFLINE_REQUEST_PREFIX
        );
    }
    $encoded = substr($compact, strlen(OFFLINE_REQUEST_PREFIX));
    $json = base64UrlDecode($encoded);
    if ($json === false) {
        throw new InvalidArgumentException('Код запроса повреждён: не удалось декодировать base64url.');
    }

    $payload = json_decode($json, true);
    if (!is_array($payload)) {
        throw new InvalidArgumentException('Код запроса повреждён: внутри нет корректного JSON.');
    }

    $machineId = trim((string) ($payload['machineId'] ?? ''));
    if ($machineId === '' || strlen($machineId) > 128) {
        throw new InvalidArgumentException('В коде запроса нет корректного Machine ID.');
    }

    if (($payload['requestType'] ?? '') !== 'corporate_offline_activation') {
        throw new InvalidArgumentException('Код запроса не является запросом корпоративной офлайн-активации.');
    }

    return $payload;
}

function findExistingOfflineLicense(PDO $db, string $machineId): ?array {
    $stmt = $db->prepare('
        SELECT *
        FROM license_keys
        WHERE machine_id = ?
          AND license_type = "corporate"
          AND is_active = 1
          AND is_revoked = 0
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    ');
    $stmt->execute([$machineId]);
    $license = $stmt->fetch();

    return $license ?: null;
}

function createOfflineCorporateLicense(PDO $db, string $machineId, string $platform, string $appVersion): array {
    $customerName = 'Offline Corporate ' . substr($machineId, 0, 8);
    $notes = 'Автоматически создана при офлайн-активации из RL-REQ1.';

    for ($attempt = 0; $attempt < 5; $attempt++) {
        $licenseKey = generateLicenseKey();

        try {
            $stmt = $db->prepare('
                INSERT INTO license_keys (
                    license_key,
                    customer_name,
                    customer_email,
                    organization,
                    license_type,
                    max_activations,
                    current_activations,
                    machine_id,
                    platform,
                    app_version,
                    activated_at,
                    expires_at,
                    last_check_at,
                    is_active,
                    is_revoked,
                    notes
                )
                VALUES (?, ?, NULL, NULL, "corporate", 1, 1, ?, ?, ?, NOW(), NULL, NOW(), 1, 0, ?)
            ');
            $stmt->execute([$licenseKey, $customerName, $machineId, $platform, $appVersion, $notes]);
            $licenseId = (int) $db->lastInsertId();

            $stmt = $db->prepare('SELECT * FROM license_keys WHERE id = ?');
            $stmt->execute([$licenseId]);
            $license = $stmt->fetch();
            if (!$license) {
                throw new RuntimeException('Не удалось перечитать автоматически созданную лицензию.');
            }

            return $license;
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate') && $attempt < 4) {
                continue;
            }
            throw $e;
        }
    }

    throw new RuntimeException('Не удалось создать уникальный корпоративный ключ.');
}

function buildOfflineActivationCode(array $license, array $request): string {
    $machineId = (string) $request['machineId'];
    $payload = buildSignedLicensePayload($license, $machineId);
    $payload['activationMode'] = 'offline';
    $payload['offlineAllowed'] = true;
    $payload['fingerprintVersion'] = $request['fingerprintVersion'] ?? 2;

    $signed = signLicense($payload);
    $envelope = json_encode([
        'payload' => $signed['signedPayload'],
        'signature' => $signed['signature'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if (!is_string($envelope)) {
        throw new RuntimeException('Не удалось собрать envelope офлайн-активации.');
    }

    return OFFLINE_ACTIVATION_PREFIX . base64UrlEncode($envelope);
}

function issueOfflineActivation(PDO $db, string $requestCode): array {
    $request = decodeOfflineRequestCode($requestCode);
    $machineId = (string) $request['machineId'];
    $platform = substr(trim((string) ($request['platform'] ?? 'offline')), 0, 20);
    $appVersion = substr(trim((string) ($request['appVersion'] ?? '')), 0, 20);

    $license = findExistingOfflineLicense($db, $machineId);
    if ($license) {
        $licenseId = (int) $license['id'];
        $stmt = $db->prepare('
            UPDATE license_keys
            SET platform = ?,
                app_version = ?,
                last_check_at = NOW()
            WHERE id = ?
        ');
        $stmt->execute([$platform, $appVersion, $licenseId]);

        $stmt = $db->prepare('SELECT * FROM license_keys WHERE id = ?');
        $stmt->execute([$licenseId]);
        $license = $stmt->fetch();
        if (!$license) {
            throw new RuntimeException('Не удалось перечитать обновлённую лицензию.');
        }
    } else {
        $license = createOfflineCorporateLicense($db, $machineId, $platform, $appVersion);
        $licenseId = (int) $license['id'];
    }

    $activationCode = buildOfflineActivationCode($license, $request);
    logAction($db, $licenseId, $machineId, 'activate', true);

    return [
        'activationCode' => $activationCode,
        'machineId' => $machineId,
        'license' => $license,
    ];
}

function deleteRevokedLicenses(PDO $db, ?int $licenseId = null): int {
    if ($licenseId !== null) {
        if ($licenseId <= 0) {
            return 0;
        }
        $stmt = $db->prepare('DELETE FROM license_keys WHERE id = ? AND is_revoked = 1');
        $stmt->execute([$licenseId]);
        return $stmt->rowCount();
    }

    $stmt = $db->prepare('DELETE FROM license_keys WHERE is_revoked = 1');
    $stmt->execute();
    return $stmt->rowCount();
}

// F-09: DB-backed rate limiting by IP (replaces session-based counter that
// could be bypassed by dropping the PHPSESSID cookie).
function isLoginRateLimited(): bool {
    try {
        $db = getDB();
        return !checkRateLimit($db, 'admin_login', LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_SECONDS);
    } catch (Exception $e) {
        // Fail-closed: if DB/rate-limiter is broken, block login attempts
        return true;
    }
}

function recordFailedLogin(): void {
    // The DB-based rate limiter already recorded this attempt in checkRateLimit().
    // This function is now a no-op but kept for call-site compatibility.
}

function resetLoginAttempts(): void {
    // No persistent reset needed — the DB window-based limiter expires automatically.
}

// Авторизация
if (!isset($_SESSION['admin_logged_in'])) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['login'])) {
        if (isLoginRateLimited()) {
            $loginError = 'Слишком много попыток. Подождите 15 минут.';
        } elseif ($_POST['username'] === ADMIN_USER && password_verify($_POST['password'], ADMIN_PASS_HASH)) {
            session_regenerate_id(true); // F-10B.1: invalidate old session ID on privilege change
            $_SESSION['admin_logged_in'] = true;
            resetLoginAttempts();
            header('Location: index.php');
            exit;
        } else {
            recordFailedLogin();
            $loginError = 'Неверный логин или пароль';
        }
    }

    // Форма входа
    ?>
    <!DOCTYPE html>
    <html lang="ru">

    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RheoLab License Admin</title>
        <style>
            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: #1a1a2e;
                color: #fff;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .login-box {
                background: #16213e;
                padding: 40px;
                border-radius: 12px;
                width: 100%;
                max-width: 400px;
            }

            h1 {
                text-align: center;
                margin-bottom: 30px;
                color: #00d4ff;
            }

            .error {
                background: #ff4757;
                color: #fff;
                padding: 10px;
                border-radius: 6px;
                margin-bottom: 20px;
            }

            input {
                width: 100%;
                padding: 12px;
                margin-bottom: 15px;
                border: 1px solid #0f3460;
                border-radius: 6px;
                background: #0f3460;
                color: #fff;
                font-size: 16px;
            }

            button {
                width: 100%;
                padding: 14px;
                background: linear-gradient(135deg, #667eea, #764ba2);
                border: none;
                border-radius: 6px;
                color: #fff;
                font-size: 16px;
                cursor: pointer;
            }

            button:hover {
                opacity: 0.9;
            }
        </style>
    </head>

    <body>
        <div class="login-box">
            <h1>🔐 RheoLab License</h1>
            <?php if (isset($loginError)): ?>
                <div class="error"><?= htmlspecialchars($loginError) ?></div>
            <?php endif; ?>
            <form method="post">
                <input type="text" name="username" placeholder="Логин" required>
                <input type="password" name="password" placeholder="Пароль" required>
                <button type="submit" name="login">Войти</button>
            </form>
        </div>
    </body>

    </html>
    <?php
    exit;
}

// Выход — POST + CSRF token required to prevent CSRF logout
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['logout']) && validateCSRFToken()) {
    session_destroy();
    header('Location: index.php');
    exit;
}

$db = getDB();

$latestBackupArchive = null;
$backupFiles = glob('/var/backups/license-server/backup_*.tar.gz');
if (is_array($backupFiles) && $backupFiles !== []) {
    rsort($backupFiles, SORT_STRING);
    $latestBackupArchive = $backupFiles[0];
}

// Ручной backup с панели администратора
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['create_backup'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }

    $backupResult = triggerAdminBackup();
    if ($backupResult['success']) {
        $successMessage = nl2br(htmlspecialchars($backupResult['message']));
        $backupFiles = glob('/var/backups/license-server/backup_*.tar.gz');
        if (is_array($backupFiles) && $backupFiles !== []) {
            rsort($backupFiles, SORT_STRING);
            $latestBackupArchive = $backupFiles[0];
        }
    } else {
        $errorMessage = htmlspecialchars($backupResult['message']);
    }
}

// Dry-run проверка восстановления последнего backup
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['verify_backup'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }

    $verifyResult = verifyAdminBackup();
    if ($verifyResult['success']) {
        $successMessage = nl2br(htmlspecialchars($verifyResult['message']));
    } else {
        $errorMessage = nl2br(htmlspecialchars($verifyResult['message']));
    }
}

// State for the offline activation form.
$offlineActivationCode = '';
$offlineActivationMachineId = '';
$offlineActivationRequestCode = '';

// Создание нового ключа
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['create_key'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }
    $newKey = generateLicenseKey();
    $customerName = trim($_POST['customer_name'] ?? '');
    $customerEmail = trim($_POST['customer_email'] ?? '');
    $organization = trim($_POST['organization'] ?? '');
    $licenseType = $_POST['license_type'] ?? 'corporate';
    // F-10B.4: allowlist validation — reject unexpected values.
    // 'superuser' is the top-tier personal licence used by the project owner
    // (alpha update channel). Keep this list in sync with the DB ENUM in
    // database.sql and migrations/normalize_license_types.sql.
    $allowedLicenseTypes = ['trial', 'corporate', 'developer', 'superuser'];
    if (!in_array($licenseType, $allowedLicenseTypes, true)) {
        $licenseType = 'corporate';
    }
    $maxActivations = 1;

    // Trial всегда 1 месяц, corporate бессрочная, developer/superuser — по выбору.
    if ($licenseType === 'trial') {
        $expiresMonths = 1;
        $expiresAt = date('Y-m-d H:i:s', strtotime("+{$expiresMonths} months"));
    } elseif ($licenseType === 'corporate') {
        $expiresAt = null;
    } else {
        $expiresMonths = (int) ($_POST['expires_months'] ?? 12);
        $expiresAt = date('Y-m-d H:i:s', strtotime("+{$expiresMonths} months"));
    }

    $stmt = $db->prepare('
        INSERT INTO license_keys (license_key, customer_name, customer_email, organization, license_type, expires_at, max_activations)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([$newKey, $customerName, $customerEmail, $organization, $licenseType, $expiresAt, $maxActivations]);

    $successMessage = "Ключ создан: <strong>" . htmlspecialchars($newKey) . "</strong>";
}

// Выдача офлайн-активации для корпоративного клиента без интернета
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['generate_offline_activation'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }

    $offlineActivationRequestCode = trim($_POST['offline_request_code'] ?? '');

    try {
        $offlineResult = issueOfflineActivation($db, $offlineActivationRequestCode);
        $offlineActivationCode = $offlineResult['activationCode'];
        $offlineActivationMachineId = $offlineResult['machineId'];
        $successMessage = 'Офлайн-код активации сформирован для ключа <strong>'
            . htmlspecialchars($offlineResult['license']['license_key'])
            . '</strong> и Machine ID: <strong>'
            . htmlspecialchars($offlineActivationMachineId)
            . '</strong>';
    } catch (Throwable $e) {
        $errorMessage = htmlspecialchars($e->getMessage());
    }
}

// Отзыв ключа (POST + CSRF)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['revoke'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }
    $revokeId = (int) $_POST['revoke'];
    $stmt = $db->prepare('SELECT * FROM license_keys WHERE id = ?');
    $stmt->execute([$revokeId]);
    $license = $stmt->fetch();
    if (!$license) {
        $errorMessage = 'Ключ не найден.';
    } elseif (normalizeLicenseType($license['license_type'] ?? null) === 'corporate') {
        $errorMessage = 'Корпоративная офлайн-лицензия не отзывается удалённо: уже выданный RL-ACT1 остаётся рабочим на привязанном железе.';
    } else {
        $stmt = $db->prepare('UPDATE license_keys SET is_revoked = 1, revoked_reason = "Отозван администратором" WHERE id = ?');
        $stmt->execute([$revokeId]);
        header('Location: index.php');
        exit;
    }
}

// Удаление отозванных ключей (POST + CSRF)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['delete_revoked_id'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }
    $deleteRevokedId = (int) $_POST['delete_revoked_id'];
    $deleted = deleteRevokedLicenses($db, $deleteRevokedId);
    if ($deleted > 0) {
        $successMessage = 'Отозванный ключ удалён.';
    } else {
        $errorMessage = 'Ключ не найден или он не находится в статусе revoked.';
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['delete_all_revoked'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }
    $deleted = deleteRevokedLicenses($db);
    $successMessage = $deleted > 0
        ? 'Удалено отозванных ключей: <strong>' . $deleted . '</strong>'
        : 'Отозванных ключей для удаления нет.';
}

// Сброс привязки (POST + CSRF)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['reset'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }
    $resetId = (int) $_POST['reset'];
    $stmt = $db->prepare('SELECT * FROM license_keys WHERE id = ?');
    $stmt->execute([$resetId]);
    $license = $stmt->fetch();
    if (!$license) {
        $errorMessage = 'Ключ не найден.';
    } elseif (normalizeLicenseType($license['license_type'] ?? null) === 'corporate') {
        $errorMessage = 'Сброс привязки не применяется к корпоративной офлайн-лицензии: старый RL-ACT1 всё равно останется рабочим на старом железе.';
    } else {
        $stmt = $db->prepare('UPDATE license_keys SET machine_id = NULL, platform = NULL, app_version = NULL, current_activations = GREATEST(current_activations - 1, 0) WHERE id = ?');
        $stmt->execute([$resetId]);
        header('Location: index.php');
        exit;
    }
}

// Получить все ключи
$licenses = $db->query('SELECT * FROM license_keys ORDER BY created_at DESC')->fetchAll();
$revokedLicenseCount = count(array_filter(
    $licenses,
    static fn(array $license): bool => (int) ($license['is_revoked'] ?? 0) === 1
));

?>
<!DOCTYPE html>
<html lang="ru">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RheoLab License Admin</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #fff;
            padding: 20px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        h1 {
            color: #00d4ff;
            margin-bottom: 10px;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
        }

        .logout {
            color: #ff6b6b;
            text-decoration: none;
        }

        .success {
            background: #2ed573;
            color: #000;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }

        .error-banner {
            background: #ff6b6b;
            color: #fff;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            white-space: pre-wrap;
        }

        .actions-row {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .actions-row form {
            margin: 0;
        }

        .actions-row button {
            margin-top: 0;
        }

        .card {
            background: #16213e;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
        }

        .card h2 {
            color: #00d4ff;
            margin-bottom: 15px;
            font-size: 18px;
        }

        .form-row {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }

        .form-group {
            flex: 1;
            min-width: 200px;
        }

        label {
            display: block;
            margin-bottom: 5px;
            color: #888;
            font-size: 14px;
        }

        input,
        select,
        textarea {
            width: 100%;
            padding: 10px;
            border: 1px solid #0f3460;
            border-radius: 6px;
            background: #0f3460;
            color: #fff;
            font-size: 14px;
        }

        textarea {
            min-height: 96px;
            resize: vertical;
            font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
            line-height: 1.4;
        }

        .activation-code {
            min-height: 140px;
        }

        .instructions {
            margin: 8px 0 12px;
            padding-left: 18px;
            color: #a9b3c7;
            font-size: 13px;
            line-height: 1.5;
        }

        button {
            padding: 12px 24px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            border: none;
            border-radius: 6px;
            color: #fff;
            font-size: 14px;
            cursor: pointer;
            margin-top: 15px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }

        th,
        td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #0f3460;
        }

        th {
            background: #0f3460;
            color: #00d4ff;
        }

        tr:hover {
            background: #0f3460;
        }

        .badge {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
        }

        .badge-active {
            background: #2ed573;
            color: #000;
        }

        .badge-expired {
            background: #ff6b6b;
            color: #fff;
        }

        .badge-revoked {
            background: #666;
            color: #fff;
        }

        .badge-trial {
            background: #ffa502;
            color: #000;
        }

        .badge-developer {
            background: #9b59b6;
            color: #fff;
        }

        .badge-corporate {
            background: #1abc9c;
            color: #fff;
        }

        .badge-superuser {
            background: #e84393;
            color: #fff;
        }

        .actions a {
            margin-right: 10px;
            color: #00d4ff;
            text-decoration: none;
            font-size: 12px;
        }

        .actions a:hover {
            text-decoration: underline;
        }

        .actions a.danger {
            color: #ff6b6b;
        }

        .card-header-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 16px;
        }

        .card-header-row h2 {
            margin-bottom: 0;
        }

        .card-header-row form {
            margin: 0;
        }

        button.danger {
            background: linear-gradient(135deg, #ff6b6b, #c0392b);
        }

        button.danger:disabled {
            cursor: not-allowed;
            opacity: 0.45;
        }

        .btn-link {
            background: none;
            border: none;
            color: #00d4ff;
            cursor: pointer;
            font-size: 12px;
            padding: 0;
            text-decoration: none;
        }

        .btn-link:hover {
            text-decoration: underline;
        }

        .btn-link.danger {
            color: #ff6b6b;
        }

        .key-code {
            font-family: monospace;
            background: #0f3460;
            padding: 4px 8px;
            border-radius: 4px;
        }

        .small {
            color: #666;
            font-size: 12px;
        }

        .expires-group {
            display: block;
        }

        .expires-group.hidden {
            display: none;
        }
    </style>
</head>

<body>
    <div class="container">
        <div class="header">
            <h1>🔑 RheoLab License Admin</h1>
            <form method="post" style="display:inline;margin:0">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(generateCSRFToken()) ?>">
                <button type="submit" name="logout" class="logout" style="background:none;border:none;padding:0;font:inherit;cursor:pointer">Выйти</button>
            </form>
        </div>

        <?php if (isset($successMessage)): ?>
            <div class="success"><?= $successMessage ?></div>
        <?php endif; ?>

        <?php if (isset($errorMessage)): ?>
            <div class="error-banner"><?= $errorMessage ?></div>
        <?php endif; ?>

        <div class="card">
            <h2>➕ Создать новый ключ</h2>
            <form method="post">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(generateCSRFToken()) ?>">
                <div class="form-row">
                    <div class="form-group">
                        <label>Имя клиента *</label>
                        <input type="text" name="customer_name" required>
                    </div>
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" name="customer_email">
                    </div>
                    <div class="form-group">
                        <label>Организация</label>
                        <input type="text" name="organization">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Тип лицензии</label>
                        <select name="license_type" id="license_type" onchange="toggleExpires()">
                            <option value="trial">Пробная (30 дней)</option>
                            <option value="corporate" selected>Корпоративная (бессрочная)</option>
                            <option value="developer">Разработчик (beta)</option>
                            <option value="superuser">Суперпользователь (alpha)</option>
                        </select>
                    </div>
                    <div class="form-group expires-group" id="expires_group">
                        <label>Срок действия</label>
                        <select name="expires_months">
                            <option value="1">1 месяц</option>
                            <option value="3">3 месяца</option>
                            <option value="6">6 месяцев</option>
                            <option value="12" selected>1 год</option>
                            <option value="24">2 года</option>
                            <option value="120">10 лет (бессрочно)</option>
                        </select>
                    </div>
                </div>
                <button type="submit" name="create_key">🔐 Создать ключ</button>
            </form>
        </div>

        <div class="card">
            <h2>📡 Офлайн-активация Corporate</h2>
            <ol class="instructions">
                <li>На компьютере клиента: Активация лицензии → Офлайн Corporate → «Сформировать код».</li>
                <li>Клиент передаёт вам код запроса любым способом: USB, телефон, мессенджер с другого устройства.</li>
                <li>Здесь вставьте код запроса. Сервер сам создаст корпоративную лицензию, привяжет её к Machine ID клиента и выдаст офлайн-код активации.</li>
                <li>Клиент вставляет офлайн-код в программу и нажимает «Активировать офлайн». Интернет на клиентской машине не нужен.</li>
            </ol>
            <form method="post">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(generateCSRFToken()) ?>">
                <div class="form-row">
                    <div class="form-group">
                        <label>Код запроса клиента *</label>
                        <textarea
                            name="offline_request_code"
                            placeholder="RL-REQ1:..."
                            required
                        ><?= htmlspecialchars($offlineActivationRequestCode) ?></textarea>
                    </div>
                </div>
                <button type="submit" name="generate_offline_activation">🔏 Сформировать офлайн-код</button>
            </form>

            <?php if ($offlineActivationCode): ?>
                <div style="margin-top:16px">
                    <label>Офлайн-код активации для клиента</label>
                    <textarea id="offline_activation_code" class="activation-code" readonly><?= htmlspecialchars($offlineActivationCode) ?></textarea>
                    <button type="button" onclick="copyOfflineActivationCode('offline_activation_code')">Скопировать офлайн-код</button>
                    <p class="small">
                        Этот код работает только на машине с Machine ID:
                        <span class="key-code"><?= htmlspecialchars($offlineActivationMachineId) ?></span>
                    </p>
                </div>
            <?php endif; ?>
        </div>

        <div class="card">
            <h2>💾 Резервное копирование сервера лицензий</h2>
            <p class="small">
                Создаёт полный backup базы и файлов лицензирующего сервера через серверный скрипт.
                <?php if ($latestBackupArchive): ?>
                    <br>Последний архив: <?= htmlspecialchars(basename($latestBackupArchive)) ?>
                    <br>Обновлён: <?= htmlspecialchars(date('d.m.Y H:i', filemtime($latestBackupArchive))) ?>
                <?php else: ?>
                    <br>Архивы пока не найдены в /var/backups/license-server.
                <?php endif; ?>
                <br>Проверка восстановления делает dry-run: валидирует архив, SQL-дамп, config.php, keys/license_private.pem и, если настроен S3, объект latest в Beget.
            </p>
            <div class="actions-row">
                <form method="post" onsubmit="return confirm('Запустить полный backup сервера лицензий сейчас?')">
                    <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(generateCSRFToken()) ?>">
                    <button type="submit" name="create_backup">Создать backup</button>
                </form>
                <form method="post" onsubmit="return confirm('Проверить, что последний backup можно восстановить на другом хостинге?')">
                    <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(generateCSRFToken()) ?>">
                    <button type="submit" name="verify_backup">Проверить восстановление</button>
                </form>
            </div>
        </div>

        <div class="card">
            <div class="card-header-row">
                <h2>📋 Все лицензии (<?= count($licenses) ?>)</h2>
                <form method="post" onsubmit="return confirm('Удалить все отозванные ключи? Записи и связанные логи будут удалены из базы.')">
                    <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(generateCSRFToken()) ?>">
                    <button type="submit" name="delete_all_revoked" class="danger" <?= $revokedLicenseCount === 0 ? 'disabled' : '' ?>>
                        Удалить revoked (<?= $revokedLicenseCount ?>)
                    </button>
                </form>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Ключ</th>
                        <th>Клиент</th>
                        <th>Тип</th>
                        <th>Статус</th>
                        <th>Машина</th>
                        <th>Истекает</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($licenses as $lic):
                        $type = normalizeLicenseType($lic['license_type']) ?? $lic['license_type'];
                        $isCorporateOffline = $type === 'corporate';
                        $badgeClass = preg_replace('/[^a-z0-9_-]/', '', strtolower($type));
                        $expiresAt = licenseExpiresAt($lic);
                        $isExpired = isLicenseExpired($lic);
                        $status = 'active';
                        $statusClass = 'badge-active';
                        if ($lic['is_revoked']) {
                            $status = 'revoked';
                            $statusClass = 'badge-revoked';
                        } elseif (!$lic['is_active']) {
                            $status = 'inactive';
                            $statusClass = 'badge-revoked';
                        } elseif ($isExpired) {
                            $status = 'expired';
                            $statusClass = 'badge-expired';
                        }

                        // Локализация типа лицензии
                        $typeLabels = [
                            'trial' => 'Пробная',
                            'corporate' => 'Корпоративная',
                            'developer' => 'Разработчик',
                            'superuser' => 'Суперпользователь'
                        ];
                        $typeLabel = $typeLabels[$type] ?? $type;
                        ?>
                        <tr>
                            <td><span class="key-code"><?= htmlspecialchars($lic['license_key']) ?></span></td>
                            <td>
                                <?= htmlspecialchars($lic['customer_name']) ?>
                                <?php if ($lic['organization']): ?>
                                    <br><span class="small"><?= htmlspecialchars($lic['organization']) ?></span>
                                <?php endif; ?>
                            </td>
                            <td><span class="badge badge-<?= htmlspecialchars($badgeClass) ?>"><?= htmlspecialchars($typeLabel) ?></span>
                            </td>
                            <td><span class="badge <?= $statusClass ?>"><?= $status ?></span></td>
                            <td>
                                <?php if ($lic['machine_id']): ?>
                                    <span class="small"><?= substr($lic['machine_id'], 0, 8) ?>...</span>
                                    <br><span class="small"><?= $lic['platform'] ?></span>
                                <?php else: ?>
                                    <span class="small">—</span>
                                <?php endif; ?>
                            </td>
                            <td>
                                <?php if ($expiresAt === null): ?>
                                    Бессрочно
                                <?php else: ?>
                                    <?= date('d.m.Y', strtotime($expiresAt)) ?>
                                <?php endif; ?>
                                <?php if (!$isExpired && $expiresAt !== null): ?>
                                    <br><span class="small"><?= licenseDaysRemaining($lic) ?>
                                        дней</span>
                                <?php endif; ?>
                            </td>
                            <td class="actions">
                                <?php if ($isCorporateOffline): ?>
                                    <span class="small">Офлайн: код уже выдан</span>
                                <?php elseif ($lic['machine_id']): ?>
                                    <form method="post" style="display:inline" onsubmit="return confirm('Сбросить привязку?')">
                                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(generateCSRFToken()) ?>">
                                        <input type="hidden" name="reset" value="<?= $lic['id'] ?>">
                                        <button type="submit" class="btn-link">Сбросить</button>
                                    </form>
                                <?php endif; ?>
                                <?php if ($lic['is_revoked']): ?>
                                    <form method="post" style="display:inline" onsubmit="return confirm('Удалить отозванный ключ из базы?')">
                                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(generateCSRFToken()) ?>">
                                        <input type="hidden" name="delete_revoked_id" value="<?= $lic['id'] ?>">
                                        <button type="submit" class="btn-link danger">Удалить</button>
                                    </form>
                                <?php elseif (!$isCorporateOffline): ?>
                                    <form method="post" style="display:inline" onsubmit="return confirm('Отозвать ключ?')">
                                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(generateCSRFToken()) ?>">
                                        <input type="hidden" name="revoke" value="<?= $lic['id'] ?>">
                                        <button type="submit" class="btn-link danger">Отозвать</button>
                                    </form>
                                <?php endif; ?>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>

    <script>
        function toggleExpires() {
            const licenseType = document.getElementById('license_type').value;
            const expiresGroup = document.getElementById('expires_group');

            if (licenseType === 'trial' || licenseType === 'corporate') {
                expiresGroup.classList.add('hidden');
            } else {
                expiresGroup.classList.remove('hidden');
            }
        }

        // Initial state
        toggleExpires();

        async function copyOfflineActivationCode(id = 'offline_activation_code') {
            const textarea = document.getElementById(id);
            if (!textarea) return;
            try {
                await navigator.clipboard.writeText(textarea.value);
            } catch (_e) {
                textarea.focus();
                textarea.select();
                document.execCommand('copy');
            }
        }
    </script>
</body>

</html>
