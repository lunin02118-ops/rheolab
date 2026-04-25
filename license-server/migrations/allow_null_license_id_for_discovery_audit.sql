-- Allow NULL license_id on activation_log rows that audit a discovery miss.
--
-- Context:
--   `POST /api/find_by_machine.php` is the auto-recovery endpoint called by
--   the client after an OS reinstall when no local license file exists.  On
--   a miss (no active license bound to the given machine fingerprint) we
--   still want an audit trail — but there is no license_id to reference, so
--   the old `NOT NULL` constraint prevented logging misses at all.
--
--   Hits continue to reference a real license_id; misses insert NULL.
--
-- Safety: the existing FK (license_keys.id, ON DELETE CASCADE) already
-- tolerates NULL — SQL foreign keys allow NULL values by definition, so
-- this only relaxes the column constraint, not the referential integrity.
--
-- Idempotent: re-running this is a no-op if the column is already nullable.

ALTER TABLE activation_log
    MODIFY COLUMN license_id INT NULL;

-- Keep track of the schema change so ops/debug queries can see it.
INSERT IGNORE INTO schema_version (version, description) VALUES
    (7, 'Allow NULL license_id on activation_log for discovery miss audit');
