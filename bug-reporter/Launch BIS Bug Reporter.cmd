@echo off
REM ===========================================================================
REM  BIS Bug Reporter — launcher. Double-click to start the tool; it opens the
REM  bug-reporting form in your browser. Closing this window stops the tool.
REM  Works whether or not the .exe has been built:
REM    1) if dist\BIS-Bug-Reporter.exe exists  -> run it (no Python needed)
REM    2) else run from Python (dev machines)
REM ===========================================================================
setlocal
cd /d "%~dp0"
title BIS Bug Reporter

if exist "dist\BIS-Bug-Reporter.exe" (
    echo Starting BIS Bug Reporter ...
    start "" "dist\BIS-Bug-Reporter.exe"
    goto :eof
)

echo Packaged EXE not found - starting from Python ...
where py >nul 2>&1
if %errorlevel%==0 (
    set "PYEXE=py"
) else (
    where python >nul 2>&1
    if %errorlevel%==0 (
        set "PYEXE=python"
    ) else (
        echo.
        echo Python was not found, and dist\BIS-Bug-Reporter.exe has not been built.
        echo Either run build.cmd once to create the EXE, or install Python.
        echo.
        pause
        goto :eof
    )
)

REM ensure deps are present (quietly), then run
%PYEXE% -m pip install -q -r requirements.txt
echo.
echo BIS Bug Reporter is running. Your browser will open shortly.
echo Keep this window open while you use it; close it to stop.
echo.
%PYEXE% app.py
