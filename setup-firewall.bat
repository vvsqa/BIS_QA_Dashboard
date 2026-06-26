@echo off
REM Adds inbound firewall rules for the QA Dashboard (backend 8000, frontend 3000).
REM Must be run as Administrator.
set LOG=%TEMP%\qa_fw_setup.log
echo QA Dashboard firewall setup > "%LOG%"
netsh advfirewall firewall delete rule name="QA Dashboard Backend" >nul 2>&1
netsh advfirewall firewall delete rule name="QA Dashboard Frontend" >nul 2>&1
netsh advfirewall firewall add rule name="QA Dashboard Backend" dir=in action=allow protocol=TCP localport=8000 >> "%LOG%" 2>&1
netsh advfirewall firewall add rule name="QA Dashboard Frontend" dir=in action=allow protocol=TCP localport=3000 >> "%LOG%" 2>&1
echo DONE exit=%ERRORLEVEL% >> "%LOG%"
