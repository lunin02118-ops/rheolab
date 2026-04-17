<?php
/**
 * Rate Limiter для License Server
 * 
 * Защита от brute-force атак на активацию/валидацию лицензий
 */

require_once __DIR__ . '/helpers.php';

/**
 * Проверяет rate limit для IP
 * 
 * @param PDO $db База данных
 * @param string $action Тип действия (activate, validate, etc)
 * @param int $maxAttempts Максимум попыток
 * @param int $windowSeconds Размер окна в секундах
 * @return bool true если разрешено, false если лимит превышен
 */
function checkRateLimit(PDO $db, string $action, int $maxAttempts = 10, int $windowSeconds = 60): bool
{
    $ip = getClientIP();
    $key = "rate:{$action}:{$ip}";
    $now = time();
    $windowStart = $now - $windowSeconds;

    // Используем таблицу rate_limits (нужно создать)
    try {
        // Очищаем старые записи
        $stmt = $db->prepare('DELETE FROM rate_limits WHERE expires_at < NOW()');
        $stmt->execute();

        // Считаем запросы в окне
        $stmt = $db->prepare('
            SELECT COUNT(*) as cnt FROM rate_limits 
            WHERE rate_key = ? AND created_at > FROM_UNIXTIME(?)
        ');
        $stmt->execute([$key, $windowStart]);
        $row = $stmt->fetch();
        $count = (int) ($row['cnt'] ?? 0);

        if ($count >= $maxAttempts) {
            return false;
        }

        // Добавляем новую запись
        $stmt = $db->prepare('
            INSERT INTO rate_limits (rate_key, created_at, expires_at) 
            VALUES (?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))
        ');
        $stmt->execute([$key, $windowSeconds * 2]); // Храним чуть дольше для cleanup

        return true;
    } catch (PDOException $e) {
        // Fail-close: if table doesn't exist, block the request
        if (DEBUG) {
            error_log("Rate limit error: " . $e->getMessage());
        }
        return false;
    }
}

/**
 * Возвращает 429 если лимит превышен
 */
function enforceRateLimit(PDO $db, string $action, int $maxAttempts = 10, int $windowSeconds = 60): void
{
    if (!checkRateLimit($db, $action, $maxAttempts, $windowSeconds)) {
        jsonResponse([
            'success' => false,
            'error' => 'Слишком много запросов. Попробуйте позже.',
            'retryAfter' => $windowSeconds
        ], 429);
    }
}
