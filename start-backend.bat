@echo off
cd /d "%~dp0"
echo Starting backend on http://127.0.0.1:8000 ...
echo After you see "Application startup complete", start the frontend in another window: cd frontend ^& npm start
echo.
cd backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
pause
