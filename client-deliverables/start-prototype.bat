@echo off
REM One-click launcher for the standalone QA Live Metrics prototype server.
REM Independent of the qa-dashboard app. Serves on port 8090.
cd /d "%~dp0"
python serve_prototype.py 8090
pause
