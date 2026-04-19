-- ============================================================
-- Migration: add 'superuser' to the license_type ENUM
-- ============================================================
--
-- Introduces the Superuser tier — the top-privilege licence used by
-- the project owner's personal machines. Clients holding this tier
-- get the alpha update channel (see docs/LICENSING_CHANNELS.md and
-- src-tauri/src/commands/licensing/types.rs:LicenseType::Superuser).
--
-- The client enum has always known about `Superuser` but the DB and
-- admin allowlist did not — attempting to issue a superuser key
-- silently fell through to `standard`, which defeated the whole
-- point of the alpha channel. This migration closes that gap.
--
-- Safe to re-run: MODIFY COLUMN is idempotent, the identity of the
-- ENUM set does not change on repeated application.
-- ============================================================

ALTER TABLE license_keys
    MODIFY COLUMN license_type
        ENUM('trial', 'standard', 'professional', 'enterprise', 'developer', 'superuser')
        NOT NULL DEFAULT 'standard';

-- Verification query (the caller should SELECT this to confirm):
--   SHOW COLUMNS FROM license_keys WHERE Field = 'license_type';
