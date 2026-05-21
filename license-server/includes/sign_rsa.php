<?php
/**
 * License Signing Helper
 * 
 * Добавить этот код в license.vizbuka.ru для подписи лицензий RSA
 */

// Путь к приватному ключу (относительно includes/)
if (!defined('PRIVATE_KEY_PATH')) {
    define('PRIVATE_KEY_PATH', __DIR__ . '/../keys/license_private.pem');
}

/**
 * Загрузить приватный ключ
 */
function loadPrivateKey()
{
    if (!file_exists(PRIVATE_KEY_PATH)) {
        throw new Exception('Private key not found: ' . PRIVATE_KEY_PATH);
    }

    $keyContent = file_get_contents(PRIVATE_KEY_PATH);
    $privateKey = openssl_pkey_get_private($keyContent);

    if (!$privateKey) {
        throw new Exception('Failed to load private key: ' . openssl_error_string());
    }

    return $privateKey;
}

/**
 * Подписать данные лицензии
 * 
 * @param array $licenseData Данные лицензии
 * @return array { data: {...}, signedPayload: "exact json string", signature: "base64..." }
 */
function signLicenseRSA($licenseData)
{
    $privateKey = loadPrivateKey();

    // Сериализуем данные в JSON (важно: детерминированный порядок ключей).
    // Эта строка подписывается и должна быть сохранена как есть на клиенте
    // (signedPayload) — чтобы при верификации не возникало расхождений из-за
    // повторной сериализации с другим порядком/экранированием.
    $dataJson = json_encode($licenseData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    // Подписываем
    $signature = '';
    $success = openssl_sign($dataJson, $signature, $privateKey, OPENSSL_ALGO_SHA256);

    if (!$success) {
        throw new Exception('Failed to sign license: ' . openssl_error_string());
    }

    return [
        'data'          => $licenseData,
        'signedPayload' => $dataJson,           // точная строка, которую подписали
        'signature'     => base64_encode($signature)
    ];
}
?>
