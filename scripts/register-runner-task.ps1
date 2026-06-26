# Registers the Test-Plan Runner as a Windows scheduled task on the GENERATOR machine.
# Runs `test_plan_runner.py --once` every 5 minutes (processes the dashboard queue unattended).
#
# Edit the three vars below, then run this script (PowerShell) ON THE GENERATOR MACHINE.

$RunnerPath      = "C:\Users\you\bis-automation\test_plan_runner.py"   # where you copied the runner
$BisAutomation   = "C:\Users\you\bis-automation"                       # the repo where /create-test-plan runs
$DashboardBase   = "http://10.1.0.20:8000"                             # the QA dashboard
# Optional: $env:ANTHROPIC_API_KEY only if NOT using the logged-in claude CLI auth.

$python = (Get-Command python).Source
$wrapper = Join-Path (Split-Path $RunnerPath) "run-test-plan-runner.cmd"
@"
@echo off
set DASHBOARD_BASE=$DashboardBase
set BIS_AUTOMATION_DIR=$BisAutomation
"$python" "$RunnerPath" --once >> "%~dp0runner.log" 2>&1
"@ | Out-File -FilePath $wrapper -Encoding ascii -Force

$action  = New-ScheduledTaskAction -Execute $wrapper
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
             -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "BIS Test Plan Runner" -Action $action -Trigger $trigger `
    -Settings $settings -Description "Polls the QA dashboard queue and generates test plans" -Force

Write-Host "Registered 'BIS Test Plan Runner' (every 5 min). Log: $(Split-Path $RunnerPath)\runner.log"
Write-Host "Test now:  python `"$RunnerPath`" --dry-run"
