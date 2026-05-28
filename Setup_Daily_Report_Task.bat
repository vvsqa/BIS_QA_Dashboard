@echo off
title Setup QA Daily Report - Windows Task Scheduler
color 1F
echo.
echo  ============================================================
echo     Setup Automatic Daily QA Report (Windows Task Scheduler)
echo  ============================================================
echo.
echo  This will create a Windows Scheduled Task to generate the
echo  QA Daily Status Report every day at 9:00 AM automatically.
echo.
echo  NOTE: Run this BAT file as Administrator.
echo.

REM Create the scheduled task
schtasks /create /tn "QA Daily Status Report" /tr "python \"D:\Vishnu VS\Projects\qa-dashboard-app\backend\qa_daily_status_report.py\"" /sc daily /st 09:00 /f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo  [SUCCESS] Scheduled task created!
    echo  The report will be generated daily at 9:00 AM.
    echo.
    echo  To verify:  Open Task Scheduler and look for "QA Daily Status Report"
    echo  To remove:  schtasks /delete /tn "QA Daily Status Report" /f
    echo  To run now: schtasks /run /tn "QA Daily Status Report"
) else (
    echo.
    echo  [ERROR] Failed to create task. Please run this file as Administrator.
)

echo.
echo  Press any key to exit...
pause >nul
