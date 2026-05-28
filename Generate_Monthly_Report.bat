@echo off
REM ============================================================
REM   Monthly Team Report - manual runner (Windows)
REM ============================================================
REM   Generates ONE PDF PER TEAM (QA and Development).
REM
REM   Usage:
REM     Generate_Monthly_Report.bat                       -> current month, both teams
REM     Generate_Monthly_Report.bat 2026-04               -> April 2026, both teams
REM     Generate_Monthly_Report.bat 2026-04 --no-email
REM     Generate_Monthly_Report.bat --teams QA            -> only QA
REM     Generate_Monthly_Report.bat --teams DEV --no-email
REM
REM   Notes:
REM     - Requires the backend Python environment with reportlab installed
REM       (already in backend/requirements.txt).
REM     - Email delivery follows MONTHLY_REPORT_EMAIL_ENABLED in backend/.env
REM       unless --email or --no-email is passed.
REM     - PDFs saved to backend\reports\Monthly_Team_Report_<TEAM>_<YYYY-MM>.pdf
REM ============================================================

setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%backend"

set "MONTH_ARG="
set "EMAIL_FLAG="
set "TEAMS_ARG="

REM Parse arguments: first positional that looks like YYYY-MM is the month;
REM --email / --no-email toggles email; --teams QA,DEV limits teams.
:parse_args
if "%~1"=="" goto run
if /I "%~1"=="--no-email" (
    set "EMAIL_FLAG=--no-email"
    shift
    goto parse_args
)
if /I "%~1"=="--email" (
    set "EMAIL_FLAG=--email"
    shift
    goto parse_args
)
if /I "%~1"=="--teams" (
    set "TEAMS_ARG=--teams %~2"
    shift
    shift
    goto parse_args
)
if "%MONTH_ARG%"=="" (
    set "MONTH_ARG=--month %~1"
)
shift
goto parse_args

:run
echo.
echo === Generating Monthly Team Reports (one PDF per team) ===
python run_monthly_report.py %MONTH_ARG% %TEAMS_ARG% %EMAIL_FLAG%
set "EXITCODE=%ERRORLEVEL%"
echo.
if %EXITCODE% NEQ 0 (
    echo Report generation FAILED with exit code %EXITCODE%.
) else (
    echo Done. Find the PDFs under backend\reports\.
    REM Open the latest QA and DEV PDFs for convenience
    for %%T in (QA DEV) do (
        for /f "delims=" %%F in ('dir /b /a:-d /o:-d "%SCRIPT_DIR%backend\reports\Monthly_Team_Report_%%T_*.pdf" 2^>nul') do (
            start "" "%SCRIPT_DIR%backend\reports\%%F"
            goto next_team_%%T
        )
        :next_team_%%T
    )
)

pause
endlocal
exit /b %EXITCODE%
