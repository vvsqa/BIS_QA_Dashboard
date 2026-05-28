@echo off
title PM Activity Sync with MFA
color 0A

echo.
echo ============================================================
echo   PM Activity Sync with MFA Support
echo ============================================================
echo.
echo   This script will:
echo   1. Open browser for BIS Safety login
echo   2. Wait for you to complete MFA verification
echo   3. Fetch PM Activity data
echo   4. Save to local files AND Google Sheets
echo.
echo   NOTE: If session is valid, MFA will be skipped!
echo.
echo ============================================================
echo.
pause

cd /d "%~dp0"

REM Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found!
    pause
    exit /b 1
)

REM Run sync script
python scripts\pm_sync_with_mfa.py

echo.
pause
