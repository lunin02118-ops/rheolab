-- ============================================================
-- Migration: normalize license types for current product model
-- ============================================================
--
-- Current desktop client accepts only:
--   trial, corporate, developer, superuser
--
-- Legacy paid tiers (standard/professional/enterprise) are removed from the
-- product model and are treated as corporate. Corporate licenses are
-- permanent and hardware-bound, so expires_at is nullable.
--
-- Safe to re-run: the UPDATEs are idempotent; MODIFY COLUMN converges the
-- schema to the desired shape.
-- ============================================================

ALTER TABLE license_keys
    MODIFY COLUMN license_type
        ENUM('trial', 'standard', 'professional', 'enterprise', 'corporate', 'developer', 'superuser')
        NOT NULL DEFAULT 'corporate',
    MODIFY COLUMN expires_at DATETIME NULL;

UPDATE license_keys
SET license_type = 'corporate'
WHERE license_type IN ('standard', 'professional', 'enterprise');

UPDATE license_keys
SET expires_at = NULL
WHERE license_type = 'corporate';

ALTER TABLE license_keys
    MODIFY COLUMN license_type
        ENUM('trial', 'corporate', 'developer', 'superuser')
        NOT NULL DEFAULT 'corporate';

ALTER TABLE activation_log
    MODIFY COLUMN action
        ENUM('activate', 'validate', 'deactivate', 'check', 'discovery', 'demo', 'migrate_machine')
        NOT NULL;

INSERT IGNORE INTO schema_version (version, description) VALUES
    (8, 'Normalize license types to trial/corporate/developer/superuser and allow permanent corporate licenses');
