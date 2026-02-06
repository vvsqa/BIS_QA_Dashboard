@echo off
:: Double-click to run. When UAC asks, click Yes so the rule can be added.
setlocal
set "RULE_NAME=QA Dashboard Frontend (port 3000)"

:: Check for admin (net session works only for admin)
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting Administrator rights...
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b 0
)

echo.
echo Adding firewall rule for port 3000 (QA Dashboard)...
echo.

:: Remove existing rules with same name so we can re-add cleanly
netsh advfirewall firewall delete rule name="%RULE_NAME%" >nul 2>&1
netsh advfirewall firewall delete rule name="%RULE_NAME% (Public)" >nul 2>&1

:: Add one rule: allow inbound TCP 3000 for all profiles (Private + Public)
netsh advfirewall firewall add rule name="%RULE_NAME%" dir=in action=allow protocol=TCP localport=3000
if %errorlevel% neq 0 goto err

echo Rule added successfully.
echo.
echo If the URL still does not load from other devices:
echo 1. Confirm this PC network is "Private" (Settings -^> Network -^> Ethernet/Wi-Fi -^> set to Private).
echo 2. On the other device use:  http://YOUR_IP:3000   (run ipconfig on this PC for IPv4).
echo 3. Temporarily turn off "Public" firewall to test: Windows Security -^> Firewall -^> Private network = On, Public = Off for testing.
echo.
goto end
:err
echo Failed to add rule. Error code: %errorlevel%
echo Try: Right-click this file -^> Run as administrator
:end
pause
