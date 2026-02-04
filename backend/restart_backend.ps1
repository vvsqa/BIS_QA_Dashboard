# Restart the FastAPI backend on port 8000 (so Dev Task Planning and other modules load).
# Run from repo root or backend: .\backend\restart_backend.ps1  or  .\restart_backend.ps1
# If localhost:8000 still returns 404 for /dev-planning, open the app via http://<your-IP>:3000 so API calls hit this backend.

$port = 8000
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Find and stop ALL processes listening on port 8000 (any interface)
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
$pids = $listeners | ForEach-Object { $_.OwningProcess } | Sort-Object -Unique
if ($pids.Count -gt 0) {
    Write-Host "Stopping existing process(es) on port $port (PIDs: $($pids -join ', '))..."
    foreach ($p in $pids) {
        try { Stop-Process -Id $p -Force -ErrorAction Stop } catch { Write-Host "  (could not stop PID $p - try running this script as Administrator)" }
    }
    Start-Sleep -Seconds 2
}

Write-Host "Starting backend (uvicorn) on port $port..."
Start-Process -FilePath "python" -ArgumentList "-m", "uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", "8000" -NoNewWindow
Write-Host "Backend started. Dev Task Planning: http://localhost:8000/dev-planning"
Write-Host "If localhost still hits an old backend, open the app at http://<this-machine-IP>:3000 instead of localhost:3000."
