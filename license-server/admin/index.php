<?php
/**
 * Admin Panel - License Management
 */

require_once __DIR__ . '/../includes/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/rate_limiter.php';
require_once __DIR__ . '/demo-users.php';

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

// Создание нового ключа
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['create_key'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }
    $newKey = generateLicenseKey();
    $customerName = trim($_POST['customer_name'] ?? '');
    $customerEmail = trim($_POST['customer_email'] ?? '');
    $organization = trim($_POST['organization'] ?? '');
    $licenseType = $_POST['license_type'] ?? 'standard';
    // F-10B.4: allowlist validation — reject unexpected values.
    // 'superuser' is the top-tier personal licence used by the project owner
    // (alpha update channel). Keep this list in sync with the DB ENUM in
    // database.sql and migrations/add_superuser_type.sql.
    $allowedLicenseTypes = ['trial', 'standard', 'developer', 'enterprise', 'superuser'];
    if (!in_array($licenseType, $allowedLicenseTypes, true)) {
        $licenseType = 'standard';
    }
    $maxActivations = (int) ($_POST['max_activations'] ?? 1);

    // Trial всегда 1 месяц, остальные по выбору
    if ($licenseType === 'trial') {
        $expiresMonths = 1;
    } else {
        $expiresMonths = (int) ($_POST['expires_months'] ?? 12);
    }

    $expiresAt = date('Y-m-d H:i:s', strtotime("+{$expiresMonths} months"));

    $stmt = $db->prepare('
        INSERT INTO license_keys (license_key, customer_name, customer_email, organization, license_type, expires_at, max_activations)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([$newKey, $customerName, $customerEmail, $organization, $licenseType, $expiresAt, $maxActivations]);

    $successMessage = "Ключ создан: <strong>" . htmlspecialchars($newKey) . "</strong>";
}

// Отзыв ключа (POST + CSRF)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['revoke'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }
    $revokeId = (int) $_POST['revoke'];
    $stmt = $db->prepare('UPDATE license_keys SET is_revoked = 1, revoked_reason = "Отозван администратором" WHERE id = ?');
    $stmt->execute([$revokeId]);
    header('Location: index.php');
    exit;
}

// Сброс привязки (POST + CSRF)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['reset'])) {
    if (!validateCSRFToken()) { die('CSRF token validation failed'); }
    $resetId = (int) $_POST['reset'];
    $stmt = $db->prepare('UPDATE license_keys SET machine_id = NULL, platform = NULL, app_version = NULL, current_activations = GREATEST(current_activations - 1, 0) WHERE id = ?');
    $stmt->execute([$resetId]);
    header('Location: index.php');
    exit;
}

// Получить все ключи
$licenses = $db->query('SELECT * FROM license_keys ORDER BY created_at DESC')->fetchAll();

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
        select {
            width: 100%;
            padding: 10px;
            border: 1px solid #0f3460;
            border-radius: 6px;
            background: #0f3460;
            color: #fff;
            font-size: 14px;
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

        .badge-standard {
            background: #3498db;
            color: #fff;
        }

        .badge-enterprise {
            background: #1abc9c;
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
                            <option value="standard" selected>Стандартная</option>
                            <option value="enterprise">Enterprise</option>
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
                    <div class="form-group">
                        <label>Макс. активаций</label>
                        <input type="number" name="max_activations" value="1" min="1" max="100">
                    </div>
                </div>
                <button type="submit" name="create_key">🔐 Создать ключ</button>
            </form>
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
            <h2>📋 Все лицензии (<?= count($licenses) ?>)</h2>
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
                        $isExpired = strtotime($lic['expires_at']) < time();
                        $status = 'active';
                        $statusClass = 'badge-active';
                        if ($lic['is_revoked']) {
                            $status = 'revoked';
                            $statusClass = 'badge-revoked';
                        } elseif ($isExpired) {
                            $status = 'expired';
                            $statusClass = 'badge-expired';
                        }

                        // Локализация типа лицензии
                        $typeLabels = [
                            'trial' => 'Пробная',
                            'standard' => 'Стандартная',
                            'developer' => 'Разработчик',
                            'professional' => 'Professional',
                            'enterprise' => 'Enterprise',
                            'superuser' => 'Суперпользователь'
                        ];
                        $typeLabel = $typeLabels[$lic['license_type']] ?? $lic['license_type'];
                        ?>
                        <tr>
                            <td><span class="key-code"><?= htmlspecialchars($lic['license_key']) ?></span></td>
                            <td>
                                <?= htmlspecialchars($lic['customer_name']) ?>
                                <?php if ($lic['organization']): ?>
                                    <br><span class="small"><?= htmlspecialchars($lic['organization']) ?></span>
                                <?php endif; ?>
                            </td>
                            <td><span class="badge badge-<?= $lic['license_type'] ?>"><?= $typeLabel ?></span>
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
                                <?= date('d.m.Y', strtotime($lic['expires_at'])) ?>
                                <?php if (!$isExpired): ?>
                                    <br><span class="small"><?= ceil((strtotime($lic['expires_at']) - time()) / 86400) ?>
                                        дней</span>
                                <?php endif; ?>
                            </td>
                            <td class="actions">
                                <?php if ($lic['machine_id']): ?>
                                    <form method="post" style="display:inline" onsubmit="return confirm('Сбросить привязку?')">
                                        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(generateCSRFToken()) ?>">
                                        <input type="hidden" name="reset" value="<?= $lic['id'] ?>">
                                        <button type="submit" class="btn-link">Сбросить</button>
                                    </form>
                                <?php endif; ?>
                                <?php if (!$lic['is_revoked']): ?>
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

        <?php renderDemoUsersPanel($db); ?>
    </div>

    <script>
        function toggleExpires() {
            const licenseType = document.getElementById('license_type').value;
            const expiresGroup = document.getElementById('expires_group');

            if (licenseType === 'trial') {
                expiresGroup.classList.add('hidden');
            } else {
                expiresGroup.classList.remove('hidden');
            }
        }

        // Initial state
        toggleExpires();
    </script>
</body>

</html>