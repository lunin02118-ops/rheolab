@echo off
REM ============================================
REM Deploy License Server Migrations
REM Run this script to apply all pending migrations
REM ============================================

echo.
echo ========================================
echo   RheoLab License Server Migration
echo ========================================
echo.

REM Copy migration script to server
echo Step 1: Uploading migration script...
scp license-server\migrations\check_and_apply_migrations.sql root@license.vizbuka.ru:/tmp/

REM Run migration
echo.
echo Step 2: Applying migrations...
ssh root@license.vizbuka.ru "mysql -u root rheolab_license < /tmp/check_and_apply_migrations.sql"

echo.
echo Step 3: Cleanup...
ssh root@license.vizbuka.ru "rm /tmp/check_and_apply_migrations.sql"

echo.
echo ========================================
echo   Migration Complete!
echo ========================================
echo.
pause
