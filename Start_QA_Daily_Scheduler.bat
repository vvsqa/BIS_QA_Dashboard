@echo off
title QA Daily Report - Auto Scheduler
color 1F
echo.
echo  ============================================================
echo     QA Daily Report - Automatic Scheduler
echo  ============================================================
echo.
echo  This will generate the QA Daily Status Report automatically
echo  every day at 9:00 AM. Keep this window open.
echo.
echo  To change the time, edit QA_DAILY_REPORT_HOUR in .env
echo.

cd /d "D:\Vishnu VS\Projects\qa-dashboard-app\backend"
python qa_daily_report_scheduler.py

echo.
echo  Scheduler stopped. Press any key to exit...
pause >nul
