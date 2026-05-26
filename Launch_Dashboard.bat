@echo off
title QA Dashboard Launcher

echo.
echo ========================================
echo   QA Dashboard Launcher
echo ========================================
echo.

REM ---- Auto-detect Python and Node paths ----
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not in PATH. Run DEPLOY_SETUP.bat first.
    pause
    exit /b 1
)
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not in PATH. Run DEPLOY_SETUP.bat first.
    pause
    exit /b 1
)

REM ---- Kill old cmd windows by title ----
echo Closing old windows...
taskkill /FI "WINDOWTITLE eq QA Backend*" /F 2>nul
taskkill /FI "WINDOWTITLE eq QA Frontend*" /F 2>nul

REM ---- Kill processes on ports 8000 and 3000 ----
echo Stopping old processes...
for /f "tokens=5" %%P in ('netstat -aon ^| find "LISTENING" ^| find ":8000 "') do (
    taskkill /F /PID %%P 2>nul
)
for /f "tokens=5" %%P in ('netstat -aon ^| find "LISTENING" ^| find ":3000 "') do (
    taskkill /F /PID %%P 2>nul
)

timeout /t 3 /nobreak >nul

REM ---- Activate venv if exists ----
set VENV_ACTIVATE=
if exist "%~dp0backend\venv\Scripts\activate.bat" (
    set VENV_ACTIVATE=call "%~dp0backend\venv\Scripts\activate.bat" ^&^&
)

REM ---- Write temp backend starter ----
echo @echo off > "%TEMP%\qadash_backend.bat"
echo title QA Backend >> "%TEMP%\qadash_backend.bat"
echo cd /d "%~dp0backend" >> "%TEMP%\qadash_backend.bat"
if defined VENV_ACTIVATE (
    echo call venv\Scripts\activate.bat >> "%TEMP%\qadash_backend.bat"
)
echo python -m uvicorn main:app --host 0.0.0.0 --port 8000 >> "%TEMP%\qadash_backend.bat"

REM ---- Write temp frontend starter ----
echo @echo off > "%TEMP%\qadash_frontend.bat"
echo title QA Frontend >> "%TEMP%\qadash_frontend.bat"
echo set HOST=0.0.0.0 >> "%TEMP%\qadash_frontend.bat"
echo cd /d "%~dp0frontend" >> "%TEMP%\qadash_frontend.bat"
echo npm start >> "%TEMP%\qadash_frontend.bat"

REM ---- Launch backend ----
echo Starting backend...
start "" "%TEMP%\qadash_backend.bat"
timeout /t 8 /nobreak >nul

REM ---- Launch frontend ----
echo Starting frontend...
start "" "%TEMP%\qadash_frontend.bat"
timeout /t 10 /nobreak >nul

REM ---- Get network IP ----
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    set IP=%%a
    goto :gotip
)
:gotip
set IP=%IP: =%

REM ---- Open browser ----
echo Opening browser...
start http://localhost:3000

echo.
echo ========================================
echo   Dashboard launched!
echo   Local:    http://localhost:3000
echo   Network:  http://%IP%:3000
echo   Backend:  http://localhost:8000/docs
echo ========================================
echo.
echo Share http://%IP%:3000 with your team.
echo This window will close in 10 seconds.
timeout /t 10 /nobreak >nul
