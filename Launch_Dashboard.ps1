$Host.UI.RawUI.WindowTitle = "QA Dashboard - Launcher"
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  QA Dashboard App Launcher" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $projectDir "backend"
$frontendDir = Join-Path $projectDir "frontend"

# Ensure Python and Node are on PATH
$env:PATH = "C:\Users\Vishnu\AppData\Local\Programs\Python\Python311;C:\Users\Vishnu\AppData\Local\Programs\Python\Python311\Scripts;C:\Program Files\nodejs;$env:PATH"

# Kill existing processes on ports 8000 and 3000
Write-Host "[Cleanup] Killing existing processes..." -ForegroundColor Yellow
$ports = @(8000, 3000)
foreach ($port in $ports) {
    $connections = netstat -ano | Select-String "LISTENING" | Select-String ":$port\s"
    foreach ($line in $connections) {
        $parts = $line -split '\s+'
        $pid = $parts[-1]
        if ($pid -and $pid -ne "0") {
            Write-Host "  Killing PID $pid on port $port"
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
}

Start-Sleep -Seconds 2

# Start Backend
Write-Host ""
Write-Host "[Backend] Starting FastAPI on port 8000..." -ForegroundColor Green
Start-Process cmd -ArgumentList "/k", "title QA-Backend && cd /d `"$backendDir`" && uvicorn main:app --host 127.0.0.1 --port 8000"

Start-Sleep -Seconds 4

# Start Frontend
Write-Host "[Frontend] Starting React on port 3000..." -ForegroundColor Green
Start-Process cmd -ArgumentList "/k", "title QA-Frontend && cd /d `"$frontendDir`" && npm start"

Start-Sleep -Seconds 6

# Open browser
Write-Host ""
Write-Host "[Browser] Opening http://localhost:3000 ..." -ForegroundColor Green
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Dashboard launched!" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:8000" -ForegroundColor White
Write-Host "  Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Close the Backend and Frontend windows to stop." -ForegroundColor Gray
Read-Host "Press Enter to close this launcher"
