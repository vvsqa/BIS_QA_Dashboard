@echo off
title QA Dashboard - Setup Script
echo ============================================
echo   QA Dashboard - One-Time Setup
echo ============================================
echo.

:: Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Install Python 3.11+ from https://www.python.org/downloads/
    echo         Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)
echo [OK] Python found
python --version

:: Check Node
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js found
node --version

:: Check PostgreSQL
psql --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] psql not found in PATH. If PostgreSQL is installed, add its bin folder to PATH.
    echo           e.g., C:\Program Files\PostgreSQL\14\bin
) else (
    echo [OK] PostgreSQL found
    psql --version
)

echo.
echo --- Step 1: Backend Setup ---
cd /d "%~dp0backend"

:: Create venv if not exists
if not exist "venv" (
    echo Creating Python virtual environment...
    python -m venv venv
)

:: Activate and install deps
echo Installing backend dependencies...
call venv\Scripts\activate.bat
pip install -r requirements.txt --quiet
echo [OK] Backend dependencies installed

:: Check .env
if not exist ".env" (
    echo.
    echo [ACTION NEEDED] Create backend\.env file
    echo   Copy .env.example to .env and fill in:
    echo   - DB_PASSWORD (your PostgreSQL password)
    echo   - PM_API_KEY (PM Tracker API key)
    echo   - TESTRAIL_EMAIL and TESTRAIL_API_KEY
    echo   - REDMINE_API_KEY
    copy .env.example .env >nul
    echo   .env.example copied to .env - EDIT IT NOW
    notepad .env
    pause
) else (
    echo [OK] .env file exists
)

echo.
echo --- Step 2: Frontend Setup ---
cd /d "%~dp0frontend"

if not exist "node_modules" (
    echo Installing frontend dependencies (this may take a few minutes)...
    call npm install --silent
) else (
    echo [OK] Frontend dependencies already installed
)

echo.
echo --- Step 3: Firewall Rules ---
echo Adding firewall rules (requires Administrator)...
netsh advfirewall firewall add rule name="QA Dashboard Backend" dir=in action=allow protocol=tcp localport=8000 >nul 2>&1
netsh advfirewall firewall add rule name="QA Dashboard Frontend" dir=in action=allow protocol=tcp localport=3000 >nul 2>&1
echo [OK] Firewall rules added (ports 8000 and 3000)

echo.
echo --- Step 4: Get Network IP ---
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set IP=%%a
    goto :gotip
)
:gotip
set IP=%IP: =%
echo.
echo ============================================
echo   Setup Complete!
echo ============================================
echo.
echo   Share this URL with your team:
echo   http://%IP%:3000
echo.
echo   To start the app, run:
echo   Launch_Dashboard.bat
echo.
echo   To auto-start on boot:
echo   1. Open Task Scheduler
echo   2. Create Task ^> Trigger: At startup
echo   3. Action: Start Program ^> %~dp0Launch_Dashboard.bat
echo ============================================
pause
