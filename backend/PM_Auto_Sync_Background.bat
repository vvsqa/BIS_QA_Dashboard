@echo off
title PM Auto-Sync Background
color 0A

REM ============================================================
REM  PM AUTO-SYNC BACKGROUND - Runs continuously in headless mode
REM  Syncs every 5 minutes without browser window
REM  Stops and notifies if MFA is required
REM ============================================================

set "PROJECT_DIR=D:\Vishnu VS\Projects\qa-dashboard-app\backend"

cd /d "%PROJECT_DIR%"

echo ============================================================
echo        PM AUTO-SYNC BACKGROUND (Headless Mode)
echo ============================================================
echo.
echo Time: %date% %time%
echo.
echo This will sync PM data every 5 minutes without a browser.
echo If MFA is required, it will stop and notify you.
echo.
echo Press Ctrl+C to stop manually.
echo ============================================================
echo.

python scripts\pm_auto_sync_headless.py --continuous

echo.
echo ============================================================
echo Auto-sync stopped.
echo.
echo If MFA is required, run Start_PM_Sync_Desktop.bat once
echo to authenticate, then you can run this again.
echo ============================================================
echo.
pause
