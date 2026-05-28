@echo off
title PM Quick Sync (Headless)
color 0A

REM ============================================================
REM  PM QUICK SYNC - Runs without browser window
REM  If MFA is needed, it will notify you in Google Sheets
REM ============================================================

set "PROJECT_DIR=D:\Vishnu VS\Projects\qa-dashboard-app\backend"

cd /d "%PROJECT_DIR%"

echo ============================================================
echo           PM QUICK SYNC (Headless Mode)
echo ============================================================
echo.
echo Time: %date% %time%
echo.
echo This will sync PM data without opening a browser.
echo If MFA is required, you'll see a notification in Google Sheets.
echo.

python scripts\pm_auto_sync_headless.py

echo.
echo ============================================================
if %errorlevel% equ 0 (
    echo Sync completed successfully!
) else (
    echo Sync failed - MFA may be required
    echo Run Start_PM_Sync_Desktop.bat to authenticate
)
echo ============================================================
echo.
pause
