-- ============================================================
-- Migration: legacy compatibility shim for 'superuser'
-- ============================================================
--
-- Kept for older deploy scripts. The current canonical migration is
-- migrations/normalize_license_types.sql and the current product model is:
-- trial, corporate, developer, superuser.
--
-- Safe to re-run: converges legacy paid tiers to corporate before
-- tightening the ENUM.
-- ============================================================

ALTER TABLE license_keys
    MODIFY COLUMN license_type
        ENUM('trial', 'standard', 'professional', 'enterprise', 'corporate', 'developer', 'superuser')
        NOT NULL DEFAULT 'corporate',
    MODIFY COLUMN expires_at DATETIME NULL;

UPDATE license_keys
SET license_type = 'corporate'
WHERE license_type IN ('standard', 'professional', 'enterprise');

ALTER TABLE license_keys
    MODIFY COLUMN license_type
        ENUM('trial', 'corporate', 'developer', 'superuser')
        NOT NULL DEFAULT 'corporate';

-- Verification query (the caller should SELECT this to confirm):
--   SHOW COLUMNS FROM license_keys WHERE Field = 'license_type';
