@echo off
title QA Daily Status Report - Live Dashboard
color 1F
echo.
echo  ============================================================
echo     QA Daily Status Report - Live Dashboard
echo  ============================================================
echo.
echo  Starting live dashboard server...
echo  Dashboard will auto-refresh every 5 minutes with live data.
echo  Keep this window open to keep the dashboard running.
echo.

cd /d "D:\Vishnu VS\Projects\qa-dashboard-app\backend"
python qa_daily_report_web.py

echo.
echo  Dashboard server stopped.
echo  Press any key to exit...
pause >nul
