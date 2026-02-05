@echo off
:: Run this script as Administrator (right-click -> Run as administrator)
:: so that other PCs on your network can open the app URL (e.g. http://10.1.0.165:3000)
netsh advfirewall firewall add rule name="QA Dashboard Frontend (port 3000)" dir=in action=allow protocol=TCP localport=3000
if %errorlevel% equ 0 (
  echo Firewall rule added. Other devices can now open the app URL on port 3000.
) else (
  echo Failed. Make sure you ran this as Administrator.
)
pause
