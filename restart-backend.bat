@echo off
REM Restart the QA Dashboard backend so it loads the latest code.
REM RIGHT-CLICK this file -> "Run as administrator" (the running backend is elevated).
title Restart QA Dashboard Backend
echo ============================================================
echo  Restarting QA Dashboard backend (port 8000)...
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Apps\qa-dashboard-app\backend\restart_backend_prod.ps1"
echo.
echo ============================================================
echo  If you see "Backend listening on 8000 -> PID ####" above,
echo  it worked. You can close this window.
echo ============================================================
pause
