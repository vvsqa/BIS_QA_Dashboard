@echo off
title PM Activity Auto-Sync
color 0A

echo ============================================================
echo           PM ACTIVITY AUTO-SYNC (Google Sheets)
echo ============================================================
echo.
echo Starting at: %date% %time%
echo.

cd /d "%~dp0"
echo Working directory: %cd%
echo.

REM Use system Python (playwright is installed there)
echo Using system Python...

echo.
echo Checking Python...
python --version
if %errorlevel% neq 0 (
    echo ERROR: Python not found!
    pause
    exit /b 1
)

echo.
echo Checking Playwright...
python -c "from playwright.sync_api import sync_playwright; print('Playwright OK')"
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Playwright not working. Installing browsers...
    playwright install chromium
)

echo.
echo ============================================================
echo Starting PM Activity Auto-Refresh...
echo.
echo This will:
echo   1. Open browser for login (complete MFA manually)
echo   2. Auto-fetch PM data every 5 minutes
echo   3. Auto-export to Google Sheets
echo.
echo Press Ctrl+C to stop at any time.
echo ============================================================
echo.

REM Run the auto-refresh script
python scripts\pm_activity_auto_refresh.py

echo.
echo ============================================================
echo Auto-sync stopped at: %date% %time%
echo ============================================================
echo.
if %errorlevel% neq 0 (
    echo ERROR CODE: %errorlevel%
    echo.
    echo If browser didn't open, try running:
    echo   playwright install chromium
    echo.
)
pause
