-- ============================================================
-- DEVELOPMENT ONLY: Test seed data
-- DO NOT run this on production servers.
-- ============================================================

-- Predictable test key (F-10: removed from main database.sql schema)
INSERT INTO license_keys (
    license_key, customer_name, customer_email, organization,
    license_type, expires_at, notes
) VALUES (
    'TEST-1234-5678-ABCD',
    'Test User',
    'test@example.com',
    'Test Organization',
    'standard',
    DATE_ADD(NOW(), INTERVAL 1 YEAR),
    'Тестовый ключ — ТОЛЬКО ДЛЯ РАЗРАБОТКИ'
);
