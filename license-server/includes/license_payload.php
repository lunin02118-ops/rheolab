<?php
/**
 * Shared license contract helpers.
 *
 * Keep this file in sync with the desktop client license model:
 * trial, corporate, developer, superuser.
 */

function normalizeLicenseType(?string $type): ?string
{
    $type = strtolower(trim((string) $type));

    if (in_array($type, ['trial', 'corporate', 'developer', 'superuser'], true)) {
        return $type;
    }

    // Legacy paid tiers were removed from the product model. Treat existing
    // rows as corporate so old database state does not produce unsupported
    // signed payloads on the current client.
    if (in_array($type, ['standard', 'professional', 'enterprise'], true)) {
        return 'corporate';
    }

    return null;
}

function isPermanentLicense(array $license): bool
{
    return normalizeLicenseType($license['license_type'] ?? null) === 'corporate';
}

function licenseExpiresAt(array $license): ?string
{
    if (isPermanentLicense($license)) {
        return null;
    }

    $expiresAt = $license['expires_at'] ?? null;
    if ($expiresAt === null || trim((string) $expiresAt) === '') {
        return null;
    }

    return (string) $expiresAt;
}

function isLicenseExpired(array $license): bool
{
    $expiresAt = licenseExpiresAt($license);
    if ($expiresAt === null) {
        return false;
    }

    $timestamp = strtotime($expiresAt);
    return $timestamp !== false && $timestamp < time();
}

function licenseDaysRemaining(array $license): ?int
{
    $expiresAt = licenseExpiresAt($license);
    if ($expiresAt === null) {
        return null;
    }

    $timestamp = strtotime($expiresAt);
    if ($timestamp === false) {
        return null;
    }

    return max(0, (int) ceil(($timestamp - time()) / 86400));
}

function buildSignedLicensePayload(array $license, string $machineId): array
{
    $type = normalizeLicenseType($license['license_type'] ?? null);
    if ($type === null) {
        throw new InvalidArgumentException('Unsupported license type');
    }

    $expiresAt = licenseExpiresAt($license);
    $isCorporate = $type === 'corporate';

    return [
        'id' => (int) $license['id'],
        'key' => $license['license_key'] ?? null,
        'type' => $type,
        'customerName' => $license['customer_name'] ?? '',
        'organization' => $license['organization'] ?? null,
        'email' => $license['customer_email'] ?? null,
        'issuedAt' => $license['created_at'] ?? null,
        'expiresAt' => $expiresAt,
        'activatedAt' => $license['activated_at'] ?: date('Y-m-d H:i:s'),
        'machineId' => $machineId,
        'hardwareBound' => true,
        'permanent' => $isCorporate,
        'offlineAllowed' => $isCorporate,
        'activationMode' => $isCorporate ? 'offline' : 'online',
        'gracePeriodDays' => defined('GRACE_PERIOD_DAYS') ? GRACE_PERIOD_DAYS : 30,
        'seats' => (int) ($license['max_activations'] ?? 1),
    ];
}
