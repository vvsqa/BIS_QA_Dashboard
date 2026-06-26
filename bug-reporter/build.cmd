@echo off
REM Build BIS-Bug-Reporter.exe (single double-click file, no Python needed on QA machines)
setlocal
cd /d "%~dp0"

echo === Installing dependencies ===
python -m pip install -r requirements.txt || goto :err
python -m pip install pyinstaller || goto :err

echo === Building EXE ===
pyinstaller --noconfirm --onefile --name BIS-Bug-Reporter ^
  --hidden-import page ^
  --collect-submodules uvicorn ^
  --add-data "BIS-Bug-Reporter-User-Guide.pdf;." ^
  app.py || goto :err

echo.
echo === Done ===
echo EXE: %~dp0dist\BIS-Bug-Reporter.exe
echo Distribute that single file. First run: open Settings, paste your Redmine API key.
goto :eof

:err
echo BUILD FAILED.
exit /b 1
