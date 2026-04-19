-- RheoLab License Server Database Schema
-- MySQL 5.7+ / MariaDB 10.3+
-- 
-- This is the CANONICAL schema — all migrations are consolidated here.
-- Last updated: 2026-02-28

CREATE DATABASE IF NOT EXISTS rheolab_license 
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE rheolab_license;

-- ─── Schema Version ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_version (
    version INT NOT NULL PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description VARCHAR(255)
) ENGINE=InnoDB;

INSERT IGNORE INTO schema_version (version, description) VALUES
(1, 'Initial schema: license_keys, activation_log, admins'),
(2, 'Add rate_limits table'),
(3, 'Add demo_users table'),
(4, 'Add developer license type'),
(5, 'Add discovery/demo/migrate_machine to activation_log ENUM'),
(6, 'Add user_agent to activation_log');

-- ─── Лицензионные ключи ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS license_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    license_key VARCHAR(19) UNIQUE NOT NULL,  -- XXXX-XXXX-XXXX-XXXX
    
    -- Владелец
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255),
    organization VARCHAR(255),
    phone VARCHAR(50),
    
    -- Тип лицензии. See migrations/add_superuser_type.sql — kept in sync
    -- with src-tauri/src/commands/licensing/types.rs::LicenseType.
    license_type ENUM('trial', 'standard', 'professional', 'enterprise', 'developer', 'superuser') DEFAULT 'standard',
    
    -- Лимиты
    max_activations INT DEFAULT 1,
    current_activations INT DEFAULT 0,
    
    -- Привязка к машине
    machine_id VARCHAR(64),
    platform VARCHAR(20),
    app_version VARCHAR(20),
    
    -- Даты
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    activated_at DATETIME,
    expires_at DATETIME NOT NULL,
    last_check_at DATETIME,
    
    -- Статус
    is_active BOOLEAN DEFAULT TRUE,
    is_revoked BOOLEAN DEFAULT FALSE,
    revoked_reason VARCHAR(255),
    
    -- Комментарии
    notes TEXT,
    
    INDEX idx_license_key (license_key),
    INDEX idx_machine_id (machine_id),
    INDEX idx_expires (expires_at),
    INDEX idx_customer_email (customer_email)
) ENGINE=InnoDB;

-- ─── История активаций и проверок ────────────────────────────
CREATE TABLE IF NOT EXISTS activation_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    license_id INT NOT NULL,
    machine_id VARCHAR(64),
    ip_address VARCHAR(45),
    action ENUM('activate', 'validate', 'deactivate', 'check', 'discovery', 'demo', 'migrate_machine') NOT NULL,
    success BOOLEAN DEFAULT TRUE,
    error_message VARCHAR(255),
    user_agent VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (license_id) REFERENCES license_keys(id) ON DELETE CASCADE,
    INDEX idx_license_id (license_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB;

-- ─── Администраторы ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ─── Rate Limiting ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rate_key VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    INDEX idx_rate_key (rate_key),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Демо-пользователи ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS demo_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    machine_id VARCHAR(64) UNIQUE NOT NULL,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    INDEX idx_machine_id (machine_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Администратор должен быть создан через install.sh с уникальным паролем.
-- Тестовые данные — см. migrations/seed_test_data.sql (ONLY FOR DEVELOPMENT).
