@echo off
REM Deploy security updates to license server
REM Run this script manually to deploy rate limiting protection
REM 
REM Set environment variables before running:
REM   set LICENSE_SERVER_HOST=your-server-ip
REM   set LICENSE_SERVER_USER=root
REM   set LICENSE_SERVER_PASS=your-password

if "%LICENSE_SERVER_HOST%"=="" (
    echo Error: Set LICENSE_SERVER_HOST environment variable
    exit /b 1
)
if "%LICENSE_SERVER_USER%"=="" set LICENSE_SERVER_USER=root

set SERVER=%LICENSE_SERVER_HOST%
set USER=%LICENSE_SERVER_USER%

echo ========================================
echo   Deploying Security Updates
echo ========================================
echo.

echo [1/4] Uploading rate_limiter.php...
scp license-server/includes/rate_limiter.php %USER%@%SERVER%:/var/www/license-server/includes/

echo [2/4] Uploading updated activate.php...
scp license-server/api/activate.php %USER%@%SERVER%:/var/www/license-server/api/

echo [3/4] Uploading updated validate.php...
scp license-server/api/validate.php %USER%@%SERVER%:/var/www/license-server/api/

echo [4/4] Creating rate_limits table...
echo Run this SQL on server:
echo CREATE TABLE IF NOT EXISTS rate_limits (id INT AUTO_INCREMENT PRIMARY KEY, rate_key VARCHAR(255) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL, INDEX idx_rate_key (rate_key), INDEX idx_expires (expires_at)) ENGINE=InnoDB;

echo.
echo ========================================
echo   Deployment Complete!
echo ========================================
echo.
echo Test: curl -X POST http://license.vizbuka.ru/api/status.php?key=TEST-1234-5678-ABCD
pause
