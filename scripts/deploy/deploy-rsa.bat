@echo off
REM Deploy RSA keys and scripts to license server
REM 
REM Set environment variables before running:
REM   set LICENSE_SERVER_HOST=your-server-ip
REM   set LICENSE_SERVER_USER=root

if "%LICENSE_SERVER_HOST%"=="" (
    echo Error: Set LICENSE_SERVER_HOST environment variable
    exit /b 1
)
if "%LICENSE_SERVER_USER%"=="" set LICENSE_SERVER_USER=root

set SERVER=%LICENSE_SERVER_USER%@%LICENSE_SERVER_HOST%
set REMOTE_PATH=/var/www/license-server

echo ===================================================
echo Deploying RSA keys and scripts to %SERVER%
echo ===================================================

echo.
echo [1/3] Creating keys directory...
ssh %SERVER% "mkdir -p %REMOTE_PATH%/keys && chmod 700 %REMOTE_PATH%/keys"

echo.
echo [2/3] Uploading private key...
scp keys/license_private.pem %SERVER%:%REMOTE_PATH%/keys/

echo.
echo [3/3] Uploading updated scripts...
scp license-server/includes/sign_rsa.php %SERVER%:%REMOTE_PATH%/includes/
scp license-server/includes/helpers.php %SERVER%:%REMOTE_PATH%/includes/

echo.
echo ===================================================
echo DONE!
echo ===================================================
