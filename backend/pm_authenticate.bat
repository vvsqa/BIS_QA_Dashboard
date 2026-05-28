@echo off
title PM Authentication (MFA)
color 0E

echo.
echo ============================================================
echo   PM Authentication with MFA
echo ============================================================
echo.
echo   This will open a browser for you to:
echo   1. Enter MFA code if prompted
echo   2. Complete login
echo.
echo   After login, the session is saved for auto-sync.
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

REM Run MFA script
python scripts\pm_sync_with_mfa.py

echo.
echo ============================================================
echo   Session saved! You can now run pm_auto_sync.bat
echo ============================================================
pause
