@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-autonomous-windows.ps1" %*
endlocal
