@echo off
title PM Auto-Sync (Every 5 Minutes)
color 0A

echo.
echo ============================================================
echo   PM Activity Auto-Sync to Google Sheets
echo ============================================================
echo.
echo   This will sync PM data to Google Sheets every 5 minutes.
echo.
echo   The sheet will show "Last Updated" timestamp.
echo.
echo   Press Ctrl+C to stop.
echo.
echo ============================================================
echo.

cd /d "%~dp0"

REM Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found!
    pause
    exit /b 1
)

REM Check for session
if not exist "data\bis_session.json" (
    echo.
    echo WARNING: No session found!
    echo Please run pm_authenticate.bat first to login with MFA.
    echo.
    pause
    exit /b 1
)

REM Run auto-sync
python scripts\pm_auto_sync.py

pause
