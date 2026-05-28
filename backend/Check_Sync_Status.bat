@echo off
title PM Sync Status Check
color 0B

echo ============================================================
echo              PM SYNC STATUS CHECK
echo ============================================================
echo.
echo Checking at: %date% %time%
echo.

cd /d "%~dp0"
echo Working directory: %cd%
echo.

python scripts\check_sync_status.py

echo.
echo ============================================================
if %errorlevel% neq 0 (
    echo ERROR: Script failed with code %errorlevel%
) else (
    echo Status check complete.
)
echo ============================================================
echo.
echo Press any key to close...
pause >nul
