# Start QA Dashboard backend (required for Timesheet and other API features).
# Run from project root. Leave this window open; start frontend in another terminal.
Set-Location $PSScriptRoot
Write-Host "Starting backend on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
Write-Host "After you see 'Application startup complete', start the frontend: cd frontend; npm start" -ForegroundColor Yellow
Write-Host ""
Set-Location backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
