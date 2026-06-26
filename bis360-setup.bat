@echo off
REM Opens firewall for port 80 and renames this PC to BIS360. Run as Administrator.
REM Does NOT restart; the rename takes effect on the next reboot.
set LOG=%TEMP%\bis360_setup.log
echo BIS360 setup > "%LOG%"
netsh advfirewall firewall delete rule name="BIS 360 Frontend 80" >nul 2>&1
netsh advfirewall firewall add rule name="BIS 360 Frontend 80" dir=in action=allow protocol=TCP localport=80 >> "%LOG%" 2>&1
echo --- rename --- >> "%LOG%"
powershell -NoProfile -Command "Rename-Computer -NewName 'BIS360' -Force" >> "%LOG%" 2>&1
echo DONE errorlevel=%ERRORLEVEL% >> "%LOG%"
