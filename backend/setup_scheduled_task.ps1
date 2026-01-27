# Setup Windows Scheduled Task for PM Export Auto-Import
# Run this script as Administrator to create the scheduled task

param(
    [string]$TaskTime = "09:00",  # Default start time: 9:00 AM
    [int]$IntervalHours = 1,      # Default: Run every 1 hour
    [string]$TaskName = "PM Tool Export Auto-Import"
)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Setting up Windows Scheduled Task" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$BatchScript = "D:\Vishnu VS\Projects\qa-dashboard-app\backend\auto_import_pm_export.bat"
$WorkingDir = "D:\Vishnu VS\Projects\qa-dashboard-app\backend"

# Check if batch script exists
if (-not (Test-Path $BatchScript)) {
    Write-Host "ERROR: Batch script not found at: $BatchScript" -ForegroundColor Red
    exit 1
}

Write-Host "Task Name: $TaskName" -ForegroundColor Yellow
Write-Host "Schedule: Every $IntervalHours hour(s), starting at $TaskTime" -ForegroundColor Yellow
Write-Host "Script: $BatchScript" -ForegroundColor Yellow
Write-Host ""

# Remove existing task if it exists
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Removing existing task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Create the action
$Action = New-ScheduledTaskAction -Execute $BatchScript -WorkingDirectory $WorkingDir

# Create the trigger (repeats every X hours indefinitely)
$Trigger = New-ScheduledTaskTrigger -Once -At $TaskTime -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) -RepetitionDuration ([TimeSpan]::MaxValue)

# Create the principal (run whether user is logged on or not)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

# Create settings
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Register the task
try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Automatically imports the latest PM Tool TicketReport export from Downloads folder (runs every $IntervalHours hour(s))"
    
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "SUCCESS: Scheduled task created!" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "The task will run every $IntervalHours hour(s)" -ForegroundColor Cyan
    Write-Host "Starting from: $TaskTime" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "To modify the task:" -ForegroundColor Yellow
    Write-Host "  1. Open Task Scheduler (taskschd.msc)" -ForegroundColor White
    Write-Host "  2. Find '$TaskName' in the Task Scheduler Library" -ForegroundColor White
    Write-Host "  3. Right-click to modify triggers, actions, etc." -ForegroundColor White
    Write-Host ""
    Write-Host "To run the task manually:" -ForegroundColor Yellow
    Write-Host "  schtasks /run /tn `"$TaskName`"" -ForegroundColor White
    Write-Host ""
    Write-Host "To delete the task:" -ForegroundColor Yellow
    Write-Host "  schtasks /delete /tn `"$TaskName`" /f" -ForegroundColor White
    Write-Host ""
}
catch {
    Write-Host "ERROR: Failed to create scheduled task" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Try running this script as Administrator" -ForegroundColor Yellow
    exit 1
}
