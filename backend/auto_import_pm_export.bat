@echo off
REM Auto-import latest PM Tool export from Downloads folder
REM This script is designed to be run by Windows Task Scheduler

cd /d "D:\Vishnu VS\Projects\qa-dashboard-app\backend"

echo ============================================================
echo PM Tool Export Auto-Import
echo Date: %date% Time: %time%
echo ============================================================

REM Run the import script
python sync_excel_to_db.py --import-latest

echo.
echo Import completed at %time%
echo ============================================================
