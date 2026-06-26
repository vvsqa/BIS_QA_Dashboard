# Registers a Task Scheduler task that launches the QA Dashboard at boot.
# Must be run elevated (admin).
$ErrorActionPreference = "Stop"
$taskName = "QA Dashboard Autostart"
$launcher = "C:\Apps\qa-dashboard-app\start-hosting.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""

$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT30S"

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description "Starts the AURA360 QA Dashboard backend (8000) and frontend (3000) at boot." -Force | Out-Null

Write-Output "Registered scheduled task: $taskName (UserId=$env:USERDOMAIN\$env:USERNAME, AtStartup, S4U)"
