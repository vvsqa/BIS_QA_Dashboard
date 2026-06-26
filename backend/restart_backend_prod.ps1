# Production-parity backend restart (run AS ADMINISTRATOR).
# The backend is launched at boot by the autostart task as SYSTEM, so a normal user session
# cannot kill it ("Access is denied"). Run this from an elevated PowerShell.
#   Right-click PowerShell -> Run as administrator, then:
#   & C:\Apps\qa-dashboard-app\backend\restart_backend_prod.ps1
$ErrorActionPreference = "SilentlyContinue"
$root = "C:\Apps\qa-dashboard-app"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null

# 1. Stop whatever is listening on 8000 (the old backend), regardless of owner.
$pids = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $pids) {
    Write-Host "Stopping backend PID $p ..."
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    if (Get-Process -Id $p -ErrorAction SilentlyContinue) { & taskkill /F /T /PID $p | Out-Null }
}
Start-Sleep -Seconds 3

# 2. Relaunch exactly as the hosting launcher does: venv python, hidden, logged.
Start-Process -FilePath "$root\backend\venv\Scripts\python.exe" `
    -ArgumentList "-m","uvicorn","main:app","--host","0.0.0.0","--port","8000" `
    -WorkingDirectory "$root\backend" -WindowStyle Hidden `
    -RedirectStandardOutput "$logDir\backend.out.log" `
    -RedirectStandardError  "$logDir\backend.err.log"

# 3. Wait for the port, then confirm the new doc-confidence fields are live.
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { break }
}
$pidNow = (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
           Select-Object -ExpandProperty OwningProcess -Unique)
Write-Host "Backend listening on 8000 -> PID $pidNow"
try {
    $r = Invoke-RestMethod "http://127.0.0.1:8000/live/ticket-lookup?ticket_id=20158" -TimeoutSec 30
    Write-Host ("doc_confidence check -> {0} (unexplained: {1})" -f $r.doc_confidence, ($r.doc_unexplained -join ', '))
} catch {
    Write-Host "Backend up but lookup probe failed (it may still be warming): $($_.Exception.Message)"
}
