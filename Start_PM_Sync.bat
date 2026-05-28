@echo off
title PM Activity Auto-Sync
color 0A

echo ============================================================
echo           PM ACTIVITY AUTO-SYNC (Google Sheets)
echo ============================================================
echo.
echo This will:
echo   1. Open browser for login (complete MFA manually)
echo   2. Auto-fetch PM data every 5 minutes
echo   3. Auto-export to Google Sheets
echo.
echo Close this window or press Ctrl+C to stop.
echo ============================================================
echo.

cd /d "%~dp0backend"

REM Activate virtual environment if it exists
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)

REM Run the auto-refresh script
python scripts\pm_activity_auto_refresh.py

echo.
echo ============================================================
echo Auto-sync stopped.
echo ============================================================
pause
