@echo off
REM Generate Weekly QA Report
REM This script generates the weekly QA report PDF
REM Designed to be run on Fridays via Windows Task Scheduler

cd /d "D:\Vishnu VS\Projects\qa-dashboard-app\backend"

echo ============================================================
echo Weekly QA Report Generator
echo Date: %date% Time: %time%
echo ============================================================

REM Generate the weekly report
python weekly_report.py

echo.
echo Report generation completed at %time%
echo ============================================================

REM Optional: Open the reports folder
REM explorer "D:\Vishnu VS\Projects\qa-dashboard-app\backend\reports"
