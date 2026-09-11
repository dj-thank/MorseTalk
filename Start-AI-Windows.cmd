@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" server.py --ai
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    py -3 server.py --ai
  ) else (
    where python >nul 2>nul
    if errorlevel 1 (
      echo Python 3.10 or newer is required for the AI launcher.
      echo Install Python, then run this file again. No pip packages are required.
      pause
      exit /b 1
    )
    python server.py --ai
  )
)
if errorlevel 1 pause
endlocal
