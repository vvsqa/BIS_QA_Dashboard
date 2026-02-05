@echo off
cd /d "%~dp0"
echo.
echo ===== Share the app on your network =====
echo 1. Start the backend first (start-backend.bat or: cd backend ^& python -m uvicorn main:app --reload --port 8000)
echo 2. Users on the same Wi-Fi/LAN open the URL below in their browser.
echo.

for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -notmatch '^169\.' } | Select-Object -First 1).IPAddress" 2^>nul`) do (
  echo    Share this URL:  http://%%a:3000
  goto :done
)
echo    Share this URL:  http://YOUR_IP:3000   (run ipconfig to find your IPv4 address)
:done
echo.

echo Starting frontend (listening on all interfaces)... Press Ctrl+C to stop.
echo.
cd frontend
set HOST=0.0.0.0
call npm start
pause
