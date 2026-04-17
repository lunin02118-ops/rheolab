@echo off
REM Check server paths
REM Set LICENSE_SERVER_HOST and LICENSE_SERVER_USER env vars first

if "%LICENSE_SERVER_HOST%"=="" (
    echo Error: Set LICENSE_SERVER_HOST environment variable
    exit /b 1
)
if "%LICENSE_SERVER_USER%"=="" set LICENSE_SERVER_USER=root

set SERVER=%LICENSE_SERVER_USER%@%LICENSE_SERVER_HOST%
ssh %SERVER% "ls -la /var/www /var/www/html"
