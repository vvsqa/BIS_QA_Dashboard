# Setup Windows Scheduled Task for Weekly QA Report Generation
# Run this script as Administrator to create the scheduled task

param(
    [string]$TaskTime = "17:00",  # Default: 5:00 PM on Fridays
    [string]$TaskName = "Weekly QA Report Generator"
)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Setting up Weekly QA Report Scheduled Task" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$BatchScript = "D:\Vishnu VS\Projects\qa-dashboard-app\backend\generate_weekly_report.bat"
$WorkingDir = "D:\Vishnu VS\Projects\qa-dashboard-app\backend"

# Check if batch script exists
if (-not (Test-Path $BatchScript)) {
    Write-Host "ERROR: Batch script not found at: $BatchScript" -ForegroundColor Red
    exit 1
}

Write-Host "Task Name: $TaskName" -ForegroundColor Yellow
Write-Host "Schedule: Every Friday at $TaskTime" -ForegroundColor Yellow
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

# Create the trigger (weekly on Friday at specified time)
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At $TaskTime

# Create the principal (run whether user is logged on or not)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

# Create settings
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Register the task
try {
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Generates weekly QA report PDF every Friday"
    
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "SUCCESS: Scheduled task created!" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "The task will run every Friday at $TaskTime" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Reports will be saved to:" -ForegroundColor Yellow
    Write-Host "  D:\Vishnu VS\Projects\qa-dashboard-app\backend\reports\" -ForegroundColor White
    Write-Host ""
    Write-Host "To run the task manually:" -ForegroundColor Yellow
    Write-Host "  schtasks /run /tn `"$TaskName`"" -ForegroundColor White
    Write-Host ""
    Write-Host "To generate a report now:" -ForegroundColor Yellow
    Write-Host "  python weekly_report.py" -ForegroundColor White
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
