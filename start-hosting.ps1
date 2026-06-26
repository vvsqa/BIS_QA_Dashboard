# Headless startup launcher for the BIS 360 dashboard.
# Starts backend (uvicorn, 0.0.0.0:8000) and frontend (react-scripts, 0.0.0.0:80).
# Invoked by the "QA Dashboard Autostart" scheduled task at boot.
$ErrorActionPreference = "SilentlyContinue"
$root = "C:\Apps\qa-dashboard-app"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")

# Free ports 8000, 80, 3000 if anything is already listening (clean restart)
foreach ($port in 8000, 80, 3000) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 2

# Backend: uvicorn from the venv. python.exe is a real executable, so Start-Process
# with stream redirection is reliable (avoids cmd.exe quote-stripping of the path).
Start-Process -FilePath "$root\backend\venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000" `
    -WorkingDirectory "$root\backend" -WindowStyle Hidden `
    -RedirectStandardOutput "$logDir\backend.out.log" `
    -RedirectStandardError  "$logDir\backend.err.log"

Start-Sleep -Seconds 6

# Frontend: react-scripts dev server, network-accessible, no auto-launched browser.
# Launched via cmd so its shell redirection captures the dev-server output.
$env:HOST = "0.0.0.0"
$env:PORT = "80"
$env:BROWSER = "none"
$env:REACT_APP_API_BASE = ""
$env:REACT_APP_DEV_PROXY_TARGET = "http://127.0.0.1:8000"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm start > `"$logDir\frontend.log`" 2>&1" `
    -WorkingDirectory "$root\frontend" -WindowStyle Hidden
