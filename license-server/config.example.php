<?php
/**
 * RheoLab License Server - Configuration Template
 * 
 * ВАЖНО: Скопируйте этот файл в config.php и заполните реальными значениями!
 * Файл config.php добавлен в .gitignore и НЕ должен попадать в репозиторий.
 */

// Режим разработки (true = показывать ошибки, false = production)
define('DEBUG', false);

// База данных MySQL
define('DB_HOST', 'localhost');
define('DB_NAME', 'rheolab_license');
define('DB_USER', '');  // ← Укажите вашего пользователя БД
define('DB_PASS', '');  // ← Укажите пароль БД
define('DB_CHARSET', 'utf8mb4');

// Секретный ключ для подписи лицензий
// Сгенерируйте: openssl rand -base64 32
define('LICENSE_SECRET', '');  // ← ОБЯЗАТЕЛЬНО сгенерируйте уникальный ключ!

// Shared secret for beta update-channel HMAC token validation (update-channel.php).
// Must match the BETA_CHANNEL_SECRET compile-time env var used when building the Tauri app.
// Set as a server environment variable — NOT stored in config.php (update-channel.php
// reads it via getenv('RHEOLAB_BETA_CHANNEL_SECRET') directly).
// Generate: openssl rand -hex 32
// Deploy:   export RHEOLAB_BETA_CHANNEL_SECRET="<value>"  (Apache: SetEnv, nginx: fastcgi_param)
// If unset, beta channel requests are safely downgraded to stable (fails closed).

// Настройки лицензирования
define('GRACE_PERIOD_DAYS', 30);      // Оффлайн grace period
define('LICENSE_CACHE_DAYS', 7);       // Как часто проверять онлайн

// CORS (разрешённые домены)
// В девелоперской среде можно добавить: 'http://localhost:3000', 'http://localhost:3033'
define('ALLOWED_ORIGINS', [
    'tauri://localhost',   // Tauri app
    'https://localhost'    // Tauri HTTPS
]);

// Админ доступ (bcrypt hash)
// Генерация хеша: php -r "echo password_hash('your-password', PASSWORD_BCRYPT);"
define('ADMIN_USER', '');  // ← Укажите логин администратора
define('ADMIN_PASS_HASH', '');  // ← Укажите bcrypt-хеш пароля!

// Rate limiting
define('LOGIN_MAX_ATTEMPTS', 5);
define('LOGIN_LOCKOUT_SECONDS', 900);  // 15 minutes

// Не редактировать ниже
error_reporting(DEBUG ? E_ALL : 0);
ini_set('display_errors', DEBUG ? '1' : '0');
date_default_timezone_set('Asia/Yekaterinburg');
