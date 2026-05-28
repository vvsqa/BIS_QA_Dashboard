@echo off
title PM Sync Status Check
color 0B

REM ============================================================
REM  CONFIGURATION - Update this path if you move the project
REM ============================================================
set "PROJECT_DIR=D:\Vishnu VS\Projects\qa-dashboard-app\backend"
REM ============================================================

echo ============================================================
echo              PM SYNC STATUS CHECK
echo ============================================================
echo.
echo Checking at: %date% %time%
echo.

cd /d "%PROJECT_DIR%"
if %errorlevel% neq 0 (
    echo ERROR: Cannot find project directory!
    echo Expected: %PROJECT_DIR%
    echo.
    echo Please update PROJECT_DIR in this batch file.
    echo.
    pause
    exit /b 1
)

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
